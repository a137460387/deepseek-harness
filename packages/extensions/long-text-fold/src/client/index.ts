/**
 * Long-text paste staging cards, browser half: a document-level capture-phase
 * `paste` listener takes over a long plain-text paste — the text is staged in
 * localStorage under the current session and the draft receives a short
 * `[LongText#N]` marker instead — and capture-phase keydown/click listeners
 * restore every staged marker to its full text synchronously before the
 * composer's own submit path reads the draft. The sent message therefore
 * carries the exact inline-paste shape (one verbatim text block), while the
 * chat side folds sent long texts into expandable cards through the
 * `conversation.chat.node` keyed slot ('user' and 'steering' keys).
 *
 * Marker insertion reuses the composer's own paste path: the focused-composer
 * takeover re-dispatches a marker-only synthetic ClipboardEvent (the
 * global-paste forward pattern) so the upstream PASTE_COMMAND inserts the
 * marker at the caret; the unfocused takeover appends the marker through the
 * public `setDraft`. The composition mounts this row BEFORE global-paste so
 * the unfocused takeover sees the document capture event first.
 *
 * Storage failures fail open: an unstaggable paste inserts its full text
 * natively (this listener lets the event through) and surfaces a notice. A
 * marker whose entry was evicted expands nothing and sends its literal short
 * text, which the chat side renders as-is (too short to fold).
 * @module @deepseek-ai/dsh-client-long-text-fold/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-chat SlotMap merge (the conversation.chat.node entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation)
// and the ui-conversation SlotMap merges (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale service's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { composerVisible, resolveEditableInput } from '@deepseek-ai/dsh-client-composer-guards/client'
import {
  LongTextFoldDock, PreviewPopup,
  type LongTextFoldDockInjected, type PreviewInjected, type PreviewRequest,
} from './dock.tsx'
import { LongTextFoldNodeView } from './fold-view.tsx'
import { en, zh, type LongTextFoldKey } from './locales.ts'
import { expandDraft, hasMarker, markerOf, overThreshold } from './markers.ts'
import { createStagedStore } from './staged-store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The staged-card dock, fold card, and preview copy. */
    longTextFold: LongTextFoldKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'longTextFold'

/** Selector for the composer contenteditable (marked by InputBar via data-dsh-composer). */
const COMPOSER_SELECTOR = '[data-dsh-composer]'

/** Upstream composer-bar labels of the primary submit button (aria-label). */
const PRIMARY_LABEL_KEYS = ['input.send', 'input.send.steer', 'input.send.queue'] as const

/** Synthetic paste events forwarded onto the composer carry this self-id flag. */
type ForwardedPaste = ClipboardEvent & { dshLongTextForwarded?: boolean }

/** Editable elements whose own paste must be honored (global-paste discipline). */
function isEditable(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/**
 * Re-dispatch a marker-only paste onto the composer so the upstream
 * PASTE_COMMAND inserts the marker at the caret (the ClipboardEvent/
 * DataTransfer constructors throw on old Safari).
 * @param composer - the composer contenteditable.
 * @param marker - the literal marker text.
 * @returns true when the forward was constructed and dispatched.
 */
function forwardMarkerPaste(composer: HTMLElement, marker: string): boolean {
  try {
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', marker)
    const forwarded = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    }) as ForwardedPaste
    forwarded.dshLongTextForwarded = true
    composer.dispatchEvent(forwarded)
    return true
  } catch {
    // Old Safari throws constructing the clipboard pieces; nothing else can
    // reach here — the caller falls back to a draft-end marker append.
    return false
  }
}

/**
 * Required services: the session list (current session), the conversation
 * face (per-session input facade), locale (dictionaries + notice copy +
 * upstream submit-button labels), and slots (the dock/fold registrations).
 */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/**
 * Client plugin body: mount the capture-phase listeners and the slot
 * registrations over one shared staged store.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const tUpstream = ctx.locale.bind('conversation')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'long-text-fold: dictionaries')

  const staged = createStagedStore()
  const previewStore = createSnapshotStore<PreviewRequest | null>(null)

  const isPrimarySubmit = (target: Element): boolean => {
    const button = target.closest('button')
    if (button === null) return false
    const label = button.getAttribute('aria-label')
    if (label === null) return false
    for (const key of PRIMARY_LABEL_KEYS) {
      if (tUpstream(key) === label) return true
    }
    return false
  }

  /**
   * Restore every staged marker in the current draft to its full text,
   * synchronously, before the native submit path reads the projection
   * (setDraft commits discretely, so the refreshed draft is visible to the
   * submit that this gesture then reaches). resolveEditableInput already
   * refuses during submit/adjudication phases and this runs without an await,
   * so one resolve covers the whole restore.
   */
  const maybeExpand = (): void => {
    const resolved = resolveEditableInput(ctx)
    if (resolved === undefined) return
    const draft = resolved.state.draft
    if (!hasMarker(draft)) return
    const result = expandDraft(draft, seq => staged.text(resolved.sessionId, seq))
    if (result.draft !== draft) resolved.input.setDraft(result.draft)
    if (result.missing.length > 0) resolved.input.notify('error', t('error.missing'))
  }

  ctx.effect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if ((event as ForwardedPaste).dshLongTextForwarded === true) return
      const dataTransfer = event.clipboardData
      if (dataTransfer === null) return
      // Never split a clipboard: files (or a mixed clip) stay with the
      // composer's native file/image intake.
      if (Array.from(dataTransfer.items).some(item => item.kind === 'file')) return
      const text = dataTransfer.getData('text/plain')
      if (!overThreshold(text)) return
      const resolved = resolveEditableInput(ctx)
      if (resolved === undefined) return
      const composer = document.querySelector<HTMLElement>(COMPOSER_SELECTOR)
      if (composer === null || !composerVisible(composer)) return
      const active = document.activeElement
      if (active instanceof HTMLElement && active !== composer && isEditable(active)) return
      let seq: number
      try {
        seq = staged.put(resolved.sessionId, text, resolved.liveSessionIds)
      } catch {
        // Staging refused (oversized, quota, no storage): fail open — the
        // event flows on to the native paste (or global-paste) so the full
        // text still lands in the draft, plus a visible notice.
        resolved.input.notify('error', t('error.storage'))
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const marker = markerOf(seq)
      if (active === composer) {
        // Focused: the forward lets the upstream paste path insert the marker
        // at the caret; a failed construction falls back to a draft-end append.
        if (!forwardMarkerPaste(composer, marker)) resolved.input.setDraft(resolved.state.draft + marker)
        return
      }
      resolved.input.setDraft(resolved.state.draft + marker)
      composer.focus({ preventScroll: true })
    }
    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('paste', onPaste, true)
    }
  }, 'long-text-fold: paste takeover')

  ctx.effect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      const target = event.target
      if (!(target instanceof Element)) return
      const composer = document.querySelector<HTMLElement>(COMPOSER_SELECTOR)
      const fromComposer = composer !== null && (target === composer || composer.contains(target))
      if (!fromComposer && !isPrimarySubmit(target)) return
      maybeExpand()
    }
    const onClick = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!isPrimarySubmit(target)) return
      maybeExpand()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('click', onClick, true)
    }
  }, 'long-text-fold: submit interception')

  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'long-text-fold',
    order: 6,
    locale: NS,
    inject: (sessionId: SessionId): LongTextFoldDockInjected => ({
      preview: (seq) => { previewStore.set({ sessionId, seq }) },
      remove: (seq) => { staged.remove(sessionId, seq) },
      hooks: { staged: staged.store },
    }),
  }, LongTextFoldDock)), 'long-text-fold: input dock')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'long-text-fold-preview',
    order: 500,
    locale: NS,
    inject: (): PreviewInjected => ({
      close: () => { previewStore.set(null) },
      text: (sessionId, seq) => staged.text(sessionId, seq),
      hooks: { request: previewStore },
    }),
  }, PreviewPopup)), 'long-text-fold: preview popup')

  ctx.effect(() => ctx.slots.inject('conversation.chat.node', () => {
    const offUser = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', locale: NS }, LongTextFoldNodeView)
    const offSteering = ctx.slots.register({ name: 'conversation.chat.node', key: 'steering', locale: NS }, LongTextFoldNodeView)
    return () => {
      offUser()
      offSteering()
    }
  }), 'long-text-fold: chat fold')
}
