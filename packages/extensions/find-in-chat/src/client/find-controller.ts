/**
 * The find bar's controller: a UI-framework-agnostic state machine that
 * owns every listener (the document-capture Ctrl/Cmd+F interception, the
 * find input's Enter/Escape family, the body MutationObserver, and the
 * session-list subscription), the CSS Custom Highlight painting, the
 * debounced query research (the input shows at once; the scan trails the
 * last keystroke, and a navigation flush runs it on demand), and the
 * center-scroll navigation. The React bar is a thin view over
 * `subscribe`/`getSnapshot`; it registers its input element so the
 * controller can gate the Enter family to it and restore focus on close.
 *
 * Coverage honesty: searches run over the chat flow's live DOM — exactly
 * what the browser's own find can see — and the state carries the
 * searched-row count plus the "an earlier page is unloaded" probe so the
 * bar can say so. Nothing here calls `loadOlder`: the view keeps every
 * loaded node mounted, so auto-paging would grow the DOM without bound.
 * @module @deepseek-ai/dsh-client-find-in-chat/client/find-controller
 */

import { countSearchedRows, findChatMatches, hasEarlierPages, type ChatTextMatch } from './find-engine.ts'

/** Highlight registry names (CSS Custom Highlight API). */
const HIGHLIGHT_ALL = 'dsh-find-in-chat-all'
const HIGHLIGHT_ACTIVE = 'dsh-find-in-chat-active'

/** Mutation-rescan debounce, in milliseconds. */
const RESCAN_DEBOUNCE_MS = 200

/** Query-research debounce, in milliseconds; a navigation flushes it. */
const QUERY_DEBOUNCE_MS = 200

/** The stylesheet for the two highlight pseudo-elements above. */
const HIGHLIGHT_CSS = [
  `::highlight(${HIGHLIGHT_ALL}) { background-color: rgba(250, 204, 21, 0.30); }`,
  `::highlight(${HIGHLIGHT_ACTIVE}) { background-color: rgba(250, 204, 21, 0.65); }`,
].join('\n')

/** The session-list share the controller needs: the current session id. */
export interface FindSessionsSource {
  /** Subscribe to list changes; returns the disposer. */
  subscribe(listener: () => void): () => void
  /** Latest list snapshot; only `current` is read. */
  getSnapshot(): { readonly current: unknown }
}

/** Dependencies for {@link createFindController}. */
export interface FindControllerDeps {
  /** The live session list; a current-session change closes the bar. */
  readonly sessions: FindSessionsSource
}

/** Observable state snapshot for the find bar. */
export interface FindState {
  /** Whether the bar is mounted. */
  readonly open: boolean
  /** Bumped on every open request; the bar refocuses and selects on change. */
  readonly revision: number
  /** The raw query text. */
  readonly query: string
  /** Current match index, 0-based; -1 when there is none. */
  readonly index: number
  /** Total match count for the query. */
  readonly total: number
  /** Settled chat rows in the searched DOM window. */
  readonly searchedRows: number
  /** Whether an earlier history page remains unloaded. */
  readonly earlierPages: boolean
}

/** The controller face the bar and the plugin body consume. */
export interface FindController {
  /** Subscribe to state changes (useSyncExternalStore-compatible). */
  readonly subscribe: (listener: () => void) => () => void
  /** Latest state snapshot. */
  readonly getSnapshot: () => FindState
  /** The bar registers its input element; the Enter family gates to it. */
  bindInput(element: HTMLElement | null): void
  /** Replace the query and re-run the search (index resets to the head). */
  setQuery(query: string): void
  /** Step the current match by delta with wrap-around; scrolls it center. */
  step(delta: 1 | -1): void
  /** Close the bar, clear highlights, restore the pre-open focus. */
  close(): void
  /** Remove every listener, observer, style, and highlight entry. */
  dispose(): void
}

const CLOSED_STATE: FindState = {
  open: false,
  revision: 0,
  query: '',
  index: -1,
  total: 0,
  searchedRows: 0,
  earlierPages: false,
}

/**
 * Create the find controller over the live document.
 * @param deps - the session-list source the auto-close subscribes to.
 * @returns the controller; `dispose()` is its only end.
 */
export function createFindController(deps: FindControllerDeps): FindController {
  let state = CLOSED_STATE
  const listeners = new Set<() => void>()
  let matches: readonly ChatTextMatch[] = []
  let input: HTMLElement | null = null
  let restoreFocus: HTMLElement | null = null
  let rescanTimer: ReturnType<typeof setTimeout> | undefined
  let queryTimer: ReturnType<typeof setTimeout> | undefined

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const patch = (part: Partial<FindState>): void => {
    state = { ...state, ...part }
    notify()
  }

  /** The live chat flow, when a chat view is mounted. */
  const chatFlow = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-chat-flow]')

  /** Any open dialog (settings, permission confirm) defers to native find. */
  const dialogOpen = (): boolean => document.querySelector('[role="dialog"]') !== null

  /** The CSS Custom Highlight painting face, or null where unsupported. */
  const highlightKit = (): {
    set: (name: string, ranges: readonly Range[]) => void
    clear: (name: string) => void
  } | null => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null
    if (typeof Highlight === 'undefined') return null
    const registry = CSS.highlights
    return {
      set(name, ranges) {
        if (ranges.length === 0) {
          registry.delete(name)
          return
        }
        registry.set(name, new Highlight(...ranges))
      },
      clear(name) {
        registry.delete(name)
      },
    }
  }

  /** Build a DOM Range for one match. */
  const rangeOf = (match: ChatTextMatch): Range => {
    const range = document.createRange()
    range.setStart(match.node, match.start)
    range.setEnd(match.node, match.end)
    return range
  }

  /** Paint all/active highlight registers when the platform supports them. */
  const paint = (): void => {
    const kit = highlightKit()
    if (kit === null) return
    if (state.query.trim() === '' || matches.length === 0) {
      kit.clear(HIGHLIGHT_ALL)
      kit.clear(HIGHLIGHT_ACTIVE)
      return
    }
    kit.set(HIGHLIGHT_ALL, matches.map(rangeOf))
    const active = matches[state.index]
    /* v8 ignore next -- index is 0..len-1 whenever matches is non-empty; every writer keeps the pair invariant. */
    if (active === undefined) {
      kit.clear(HIGHLIGHT_ACTIVE)
      return
    }
    kit.set(HIGHLIGHT_ACTIVE, [rangeOf(active)])
  }

  /** Scroll the active match to the conversation scrollport's center. */
  const scrollToActive = (): void => {
    if (state.index < 0 || state.index >= matches.length) return
    const match = matches[state.index]
    /* v8 ignore next -- the index bounds check above already pinned the match. */
    if (match === undefined) return
    // The hosting element's box, not the range's: jsdom implements no
    // Range.getBoundingClientRect, and the row is the centering unit anyway.
    const host = match.node.parentElement
    /* v8 ignore next -- a scanned node detaching mid-step loses its match to the rescan first. */
    if (host === null) return
    const rect = host.getBoundingClientRect()
    const port = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (port === null) return
    const portRect = port.getBoundingClientRect()
    const delta = (rect.top + rect.height / 2) - (portRect.top + portRect.height / 2)
    if (typeof port.scrollTo === 'function') port.scrollTo({ top: port.scrollTop + delta })
    else port.scrollTop += delta
  }

  /** Re-run the search over the live flow and repaint. */
  const research = (mode: 'reset' | 'clamp'): void => {
    const flow = chatFlow()
    matches = flow === null ? [] : findChatMatches(flow, state.query)
    const index = matches.length === 0
      ? -1
      : mode === 'reset' ? 0
        : Math.min(state.index, matches.length - 1)
    patch({
      index,
      total: matches.length,
      searchedRows: flow === null ? 0 : countSearchedRows(flow),
      earlierPages: flow !== null && hasEarlierPages(flow),
    })
    paint()
  }

  /**
   * Run the pending query research now. The timer path scrolls the fresh head
   * match into view (the immediate-research behavior the debounce replaced);
   * a navigation flush suppresses that scroll so the step's own centering
   * stays the only one.
   * @param scroll - whether the fresh head match scrolls into view.
   */
  const runPendingResearch = (scroll: boolean): void => {
    if (queryTimer === undefined) return
    clearTimeout(queryTimer)
    queryTimer = undefined
    if (!state.open) return
    research('reset')
    if (scroll) scrollToActive()
  }

  /** Step the current match, flushing a pending research first. */
  const step = (delta: 1 | -1): void => {
    if (!state.open) return
    runPendingResearch(false)
    if (matches.length === 0) return
    patch({ index: (state.index + delta + matches.length) % matches.length })
    paint()
    scrollToActive()
  }

  const open = (): void => {
    if (state.open) {
      patch({ revision: state.revision + 1 })
      return
    }
    /* v8 ignore next -- the null arm: jsdom always reports an HTMLElement activeElement (body at minimum). */
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    patch({ open: true, revision: state.revision + 1 })
    research('reset')
  }

  const close = (): void => {
    if (!state.open) return
    if (queryTimer !== undefined) {
      clearTimeout(queryTimer)
      queryTimer = undefined
    }
    matches = []
    state = { ...CLOSED_STATE }
    paint()
    notify()
    const target = restoreFocus
    restoreFocus = null
    if (target !== null && target.isConnected) target.focus({ preventScroll: true })
    else if (input !== null && document.activeElement === input) input.blur()
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'f' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      // No live chat view (blank hero, trajectory tab), or a dialog owns the
      // page: leave the key to the browser's own find.
      if (chatFlow() === null || dialogOpen()) return
      event.preventDefault()
      open()
      return
    }
    if (!state.open || input === null || document.activeElement !== input) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
  }

  const onMutation = (): void => {
    if (rescanTimer !== undefined) clearTimeout(rescanTimer)
    rescanTimer = setTimeout(() => {
      rescanTimer = undefined
      if (!state.open) return
      // The chat flow unmounting (view switched away, session closed) ends
      // the search; any other mutation rescans so streaming stays live.
      if (chatFlow() === null) {
        close()
        return
      }
      research('clamp')
    }, RESCAN_DEBOUNCE_MS)
  }

  let lastCurrent = deps.sessions.getSnapshot().current
  const offSessions = deps.sessions.subscribe(() => {
    const next = deps.sessions.getSnapshot().current
    if (next !== lastCurrent) {
      lastCurrent = next
      if (state.open) close()
    }
  })

  document.addEventListener('keydown', onKeyDown, true)
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onMutation)
  observer?.observe(document.body, { childList: true, subtree: true })
  const style = document.createElement('style')
  style.dataset.findInChatHighlights = ''
  style.textContent = HIGHLIGHT_CSS
  document.head.append(style)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return state
    },
    bindInput(element) {
      input = element
    },
    setQuery(query) {
      if (!state.open || query === state.query) return
      patch({ query })
      if (queryTimer !== undefined) clearTimeout(queryTimer)
      queryTimer = setTimeout(() => { runPendingResearch(true) }, QUERY_DEBOUNCE_MS)
    },
    step,
    close,
    dispose() {
      if (rescanTimer !== undefined) {
        clearTimeout(rescanTimer)
        rescanTimer = undefined
      }
      if (queryTimer !== undefined) {
        clearTimeout(queryTimer)
        queryTimer = undefined
      }
      document.removeEventListener('keydown', onKeyDown, true)
      observer?.disconnect()
      offSessions()
      style.remove()
      const kit = highlightKit()
      if (kit !== null) {
        kit.clear(HIGHLIGHT_ALL)
        kit.clear(HIGHLIGHT_ACTIVE)
      }
      matches = []
      state = CLOSED_STATE
      input = null
      listeners.clear()
    },
  }
}
