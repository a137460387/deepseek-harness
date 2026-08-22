// @vitest-environment jsdom
/**
 * The find controller over a jsdom chat-flow document: the Ctrl/Cmd+F
 * interception gates (chat flow present, no dialog, plain F without
 * Shift/Alt), the already-open refocus revision, the find input's
 * Enter/Escape family gated to the bound input, query research with
 * wrap-around stepping, the CSS Custom Highlight painting under a stubbed
 * platform registry and the degraded no-paint path, the center-scroll
 * navigation through the conversation scrollport, the session-switch
 * auto-close, the MutationObserver rescan (streaming picks up new nodes,
 * the flow unmounting closes), and the dispose contract (no listener,
 * observer, style, or highlight residue). Plus the inert node entry and
 * the invariant companion's ownership reservation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createFindController, type FindController, type FindState } from '../src/client/find-controller.ts'
import { apply as applyNode } from '../src/index.ts'
import * as FindInChatInvariant from '../src/invariant.ts'

/** The two highlight registry names the controller paints. */
const HIGHLIGHT_ALL = 'dsh-find-in-chat-all'
const HIGHLIGHT_ACTIVE = 'dsh-find-in-chat-active'

/** One row of chat prose appended to the flow. */
function addRow(flow: HTMLElement, text: string, key = text): HTMLElement {
  const row = document.createElement('div')
  row.dataset.chatAnchorKey = key
  row.append(document.createTextNode(text))
  flow.append(row)
  return row
}

/** The controlled world: scrollport, flow, bound input, sessions store. */
interface Bench {
  controller: FindController
  flow: HTMLElement
  scroll: HTMLElement
  input: HTMLInputElement
  list: ReturnType<typeof createFakeSessions>
  states: FindState[]
}

/** Fake session list: a snapshot store over just the `current` id. */
function createFakeSessions(current: string) {
  return createSnapshotStore<{ current: string }>({ current })
}

/** Every bench built in this file, disposed together so one test's failure cannot leak listeners into the next. */
const benches: Bench[] = []

/** Build the world; rows arrive per-test through `bench.flow`. */
function bench(options: { readonly scroll?: boolean } = {}): Bench {
  document.body.innerHTML = ''
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  const scroll = document.createElement('div')
  const input = document.createElement('input')
  if (options.scroll === false) {
    document.body.append(flow)
  } else {
    scroll.dataset.conversationScroll = ''
    scroll.append(flow)
    document.body.append(scroll)
  }
  document.body.append(input)
  const list = createFakeSessions('s1')
  const controller = createFindController({ sessions: list })
  controller.bindInput(input)
  const states: FindState[] = [controller.getSnapshot()]
  controller.subscribe(() => {
    states.push(controller.getSnapshot())
  })
  const built: Bench = { controller, flow, scroll, input, list, states }
  benches.push(built)
  return built
}

/** Dispatch a keydown on the document (the controller listens on capture). */
function key(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.ctrl === true,
    metaKey: mods.meta === true,
    shiftKey: mods.shift === true,
    altKey: mods.alt === true,
  })
  document.dispatchEvent(event)
  return event
}

/** Install a stubbed CSS Custom Highlight registry plus Highlight class. */
function stubHighlightApi(): Map<string, { ranges: Range[] }> {
  const registry = new Map<string, { ranges: Range[] }>()
  vi.stubGlobal('CSS', { highlights: registry })
  // The real API takes the ranges spread (constructor(...ranges)); the stub
  // mirrors that shape so assertions read the collected array.
  vi.stubGlobal('Highlight', class {
    public readonly ranges: Range[]
    constructor(...ranges: Range[]) {
      this.ranges = ranges
    }
  })
  return registry
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  for (const built of benches.splice(0)) built.controller.dispose()
  vi.unstubAllGlobals()
})

describe('find controller interception', () => {
  it('opens on Ctrl+F and prevents the native find', () => {
    const b = bench()
    addRow(b.flow, 'needle one')
    const event = key('f', { ctrl: true })
    expect(event.defaultPrevented).toBe(true)
    expect(b.controller.getSnapshot().open).toBe(true)
    b.controller.dispose()
  })

  it('opens on Cmd+F (the macOS chord)', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    expect(key('f', { meta: true }).defaultPrevented).toBe(true)
    expect(b.controller.getSnapshot().open).toBe(true)
    b.controller.dispose()
  })

  it('leaves Shift/Alt chords and plain keys to the page', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    expect(key('f', { ctrl: true, shift: true }).defaultPrevented).toBe(false)
    expect(key('f', { ctrl: true, alt: true }).defaultPrevented).toBe(false)
    expect(key('f').defaultPrevented).toBe(false)
    expect(key('g', { ctrl: true }).defaultPrevented).toBe(false)
    expect(b.controller.getSnapshot().open).toBe(false)
    b.controller.dispose()
  })

  it('leaves the key to native find with no chat flow mounted', () => {
    document.body.innerHTML = ''
    const list = createFakeSessions('s1')
    const controller = createFindController({ sessions: list })
    expect(key('f', { ctrl: true }).defaultPrevented).toBe(false)
    expect(controller.getSnapshot().open).toBe(false)
    controller.dispose()
  })

  it('leaves the key to native find while a dialog owns the page', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    expect(key('f', { ctrl: true }).defaultPrevented).toBe(false)
    expect(b.controller.getSnapshot().open).toBe(false)
    b.controller.dispose()
  })

  it('bumps the revision on a repeated Ctrl+F instead of reopening', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    const before = b.controller.getSnapshot().revision
    key('f', { ctrl: true })
    const after = b.controller.getSnapshot()
    expect(after.open).toBe(true)
    expect(after.revision).toBe(before + 1)
    b.controller.dispose()
  })
})

describe('find controller search and stepping', () => {
  it('researches on query changes and reports counts and coverage', () => {
    const b = bench()
    const older = document.createElement('div')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Load earlier'
    older.append(button)
    b.flow.append(older)
    addRow(b.flow, 'needle one', 'row-1')
    addRow(b.flow, 'plain', 'row-2')
    addRow(b.flow, 'needle two', 'row-3')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    const state = b.controller.getSnapshot()
    expect(state.total).toBe(2)
    expect(state.index).toBe(0)
    expect(state.searchedRows).toBe(3)
    expect(state.earlierPages).toBe(true)
    b.controller.dispose()
  })

  it('keeps a blank query matchless', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.controller.setQuery('   ')
    expect(b.controller.getSnapshot().total).toBe(0)
    expect(b.controller.getSnapshot().index).toBe(-1)
    b.controller.dispose()
  })

  it('ignores identical queries and closed-bar writes', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    const afterQuery = b.states.length
    b.controller.setQuery('needle')
    expect(b.states).toHaveLength(afterQuery)
    b.controller.close()
    const afterClose = b.states.length
    b.controller.setQuery('other')
    expect(b.states).toHaveLength(afterClose)
    expect(b.controller.getSnapshot().query).toBe('')
    b.controller.dispose()
  })

  it('steps forward and backward with wrap-around from the bound input', () => {
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    b.input.focus()
    key('Enter')
    expect(b.controller.getSnapshot().index).toBe(1)
    key('Enter')
    expect(b.controller.getSnapshot().index).toBe(0)
    key('Enter', { shift: true })
    expect(b.controller.getSnapshot().index).toBe(1)
    b.controller.dispose()
  })

  it('leaves Enter doing nothing without matches', () => {
    const b = bench()
    addRow(b.flow, 'plain')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    b.input.focus()
    key('Enter')
    expect(b.controller.getSnapshot().index).toBe(-1)
    b.controller.dispose()
  })

  it('gates the Enter/Escape family to the bound input', () => {
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    key('Enter')
    expect(b.controller.getSnapshot().index).toBe(0)
    key('Escape')
    expect(b.controller.getSnapshot().open).toBe(true)
    b.controller.dispose()
  })

  it('closes on Escape from the bound input and restores the pre-open focus', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    key('f', { ctrl: true })
    b.input.focus()
    key('Escape')
    expect(b.controller.getSnapshot().open).toBe(false)
    expect(document.activeElement).toBe(outside)
    b.controller.dispose()
  })

  it('blurs the input on close when the pre-open focus is gone', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()
    key('f', { ctrl: true })
    outside.remove()
    b.input.focus()
    b.controller.close()
    expect(document.activeElement).not.toBe(b.input)
    expect(b.controller.getSnapshot().open).toBe(false)
    b.controller.dispose()
  })

  it('treats a close on a closed bar as a no-op', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    b.controller.close()
    expect(b.states).toHaveLength(1)
    b.controller.dispose()
  })

  it('centers the active match through the scrollport scrollTo', () => {
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    const scrollTo = vi.fn()
    b.scroll.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    scrollTo.mockClear()
    b.input.focus()
    key('Enter')
    expect(scrollTo).toHaveBeenCalledTimes(1)
    b.controller.dispose()
  })

  it('still steps when the scrollport is missing', () => {
    const b = bench({ scroll: false })
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    b.controller.step(1)
    expect(b.controller.getSnapshot().index).toBe(1)
    b.controller.dispose()
  })

  it('reports an empty window when the flow disappears mid-search', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    b.flow.remove()
    b.controller.setQuery('needle two')
    const state = b.controller.getSnapshot()
    expect(state.total).toBe(0)
    expect(state.searchedRows).toBe(0)
    b.controller.dispose()
  })
})

describe('find controller session and mutation wiring', () => {
  it('closes when the current session changes', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    expect(b.controller.getSnapshot().open).toBe(true)
    b.list.set({ current: 's2' })
    expect(b.controller.getSnapshot().open).toBe(false)
    b.controller.dispose()
  })

  it('stays open when the list notifies without a current change', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.list.set({ current: 's1' })
    expect(b.controller.getSnapshot().open).toBe(true)
    b.controller.dispose()
  })

  it('rescans on DOM mutations so streaming stays live', async () => {
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    expect(b.controller.getSnapshot().total).toBe(1)
    b.controller.step(1)
    expect(b.controller.getSnapshot().index).toBe(0)
    addRow(b.flow, 'needle b', 'row-2')
    await vi.waitFor(() => {
      expect(b.controller.getSnapshot().total).toBe(2)
    })
    expect(b.controller.getSnapshot().index).toBe(0)
    b.controller.dispose()
  })

  it('clamps the index when mutations shrink the match set', async () => {
    const b = bench()
    const rowA = addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    b.controller.step(1)
    expect(b.controller.getSnapshot().index).toBe(1)
    rowA.remove()
    await vi.waitFor(() => {
      expect(b.controller.getSnapshot().total).toBe(1)
    })
    expect(b.controller.getSnapshot().index).toBe(0)
    b.controller.dispose()
  })

  it('closes when the chat flow unmounts (view switched away)', async () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    expect(b.controller.getSnapshot().open).toBe(true)
    b.flow.remove()
    await vi.waitFor(() => {
      expect(b.controller.getSnapshot().open).toBe(false)
    })
    b.controller.dispose()
  })

  it('ignores mutations while closed', async () => {
    const b = bench()
    addRow(b.flow, 'needle')
    addRow(b.flow, 'needle two', 'row-2')
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-chat-anchor-key]').length).toBe(2)
    })
    expect(b.states).toHaveLength(1)
    b.controller.dispose()
  })

  it('works without a MutationObserver on the platform', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    expect(b.controller.getSnapshot().total).toBe(1)
    b.controller.dispose()
  })
})

describe('find controller highlight painting', () => {
  it('paints all and active registers through the platform API', () => {
    const registry = stubHighlightApi()
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    expect(registry.get(HIGHLIGHT_ALL)?.ranges).toHaveLength(2)
    expect(registry.get(HIGHLIGHT_ACTIVE)?.ranges).toHaveLength(1)
    b.input.focus()
    key('Enter')
    expect(registry.get(HIGHLIGHT_ACTIVE)?.ranges[0]?.startContainer.textContent).toBe('needle b')
    b.controller.dispose()
    expect(registry.has(HIGHLIGHT_ALL)).toBe(false)
    expect(registry.has(HIGHLIGHT_ACTIVE)).toBe(false)
  })

  it('clears both registers on close', () => {
    const registry = stubHighlightApi()
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    b.controller.setQuery('needle')
    expect(registry.has(HIGHLIGHT_ALL)).toBe(true)
    b.controller.close()
    expect(registry.has(HIGHLIGHT_ALL)).toBe(false)
    expect(registry.has(HIGHLIGHT_ACTIVE)).toBe(false)
    b.controller.dispose()
  })

  it('degrades silently without the highlight API', () => {
    const b = bench()
    addRow(b.flow, 'needle a', 'row-1')
    addRow(b.flow, 'needle b', 'row-2')
    key('f', { ctrl: true })
    expect(() => {
      b.controller.setQuery('needle')
      b.controller.step(1)
      b.controller.close()
    }).not.toThrow()
    expect(b.states.some(state => state.total === 2)).toBe(true)
    b.controller.dispose()
  })

  it('degrades when the registry exists but Highlight is missing', () => {
    const registry = new Map<string, unknown>()
    vi.stubGlobal('CSS', { highlights: registry })
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    expect(() => {
      b.controller.setQuery('needle')
    }).not.toThrow()
    expect(registry.size).toBe(0)
    b.controller.dispose()
  })
})

describe('find controller dispose', () => {
  it('removes every listener, the style, and the interception', () => {
    const b = bench()
    addRow(b.flow, 'needle')
    key('f', { ctrl: true })
    expect(document.querySelector('style[data-find-in-chat-highlights]')).not.toBeNull()
    b.controller.dispose()
    expect(key('f', { ctrl: true }).defaultPrevented).toBe(false)
    expect(document.querySelector('style[data-find-in-chat-highlights]')).toBeNull()
    const notified = vi.fn()
    b.controller.subscribe(notified)
    b.list.set({ current: 's2' })
    expect(notified).not.toHaveBeenCalled()
  })
})

describe('find-in-chat node entry and invariant companion', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })

  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(FindInChatInvariant)
    await fiber.await()
    expect(FindInChatInvariant.name).toBe('client-find-in-chat-invariant')
    expect(FindInChatInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
