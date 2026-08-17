/**
 * Whole-page paste, browser half: a document-level capture-phase `paste`
 * listener that routes clipboard text into the current session's draft when the
 * composer is not already focused. Mirrors Claude.ai's "paste anywhere into the
 * composer" behavior.
 *
 * The listener rides the capture phase so it runs BEFORE the composer textarea's
 * own React `onPaste`: when the textarea is already focused the listener lets
 * the event pass through to the native handler (no double-insert). When the
 * composer is not focused (or focus is on a non-editable element), the listener
 * appends the clipboard text to the draft end through the public
 * `ctx.conversation.input` service and prevents the default paste.
 *
 * Only text is routed here. Clipboard files (images) carry no `text/plain` and
 * are left to the composer's own intake — first-party image paste is unchanged.
 * @module @deepseek-ai/dsh-client-global-paste/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Selector for the composer textarea (marked by InputBar via data-dsh-composer). */
const COMPOSER_SELECTOR = 'textarea[data-dsh-composer]'

/** Editable element tags whose own paste must not be hijacked. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * Required services: the session list (to read the current session) and the
 * conversation face (to resolve the per-session input facade).
 */
export const inject = ['sessions', 'conversation']

/**
 * Whether an element is an editable control whose own paste should be honored.
 * Covers form inputs, textareas, selects, and contenteditable regions.
 * @param el - the element to test; null/undefined is not editable.
 */
function isEditable(el: HTMLElement | null | undefined): boolean {
  if (el === null || el === undefined) return false
  if (EDITABLE_TAGS.has(el.tagName)) return true
  return el.isContentEditable
}

/**
 * Whether the composer textarea is currently visible and not covered by an
 * overlay (an approval/user-question takeover panel can keep the InputBar DOM
 * alive while visually masking it). Probes the composer's center with
 * elementFromPoint: if the topmost element there is not the composer or a
 * descendant of the composer's owner, the composer is considered occluded and
 * the paste is silently ignored rather than routed into a hidden field.
 * @param composer - the composer textarea element.
 * @returns true when the composer is visible to the user.
 */
function composerVisible(composer: HTMLTextAreaElement): boolean {
  const rect = composer.getBoundingClientRect()
  // A zero-size composer (collapsed dock) cannot receive a focused paste.
  if (rect.width === 0 || rect.height === 0) return false
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  // Offscreen composer: the center is outside the viewport.
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false
  const hit = document.elementFromPoint(cx, cy)
  if (hit === null) return false
  // The composer itself or anything inside its dock reads as visible.
  return hit === composer || composer.contains(hit) || hit.contains(composer)
}

/**
 * Client plugin body: mount the document-level capture-phase paste listener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      // Step 1: no clipboard data or no text — leave native handling intact
      // (this includes file/image paste, which the composer owns).
      if (event.clipboardData === null) return
      const text = event.clipboardData.getData('text/plain')
      if (text === '') return

      // Step 2: no current session — nothing to route into.
      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return

      // Step 3: resolve the session's input facade; ignore when missing.
      const actx = ctx.sessions.scope(current)
      if (actx === undefined) return
      const input = ctx.conversation.input.for(actx)

      // Step 4: a submit/adjudication transaction is in flight — drop the paste
      // rather than racing the machine. `claimed` still accepts draft edits.
      const state = input.state.getSnapshot()
      if (state.phase === 'adjudicating' || state.phase === 'submitting') return

      const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
      if (composer === null) return

      const active = document.activeElement

      // Step 5: composer already focused — let its own onPaste handle this; the
      // capture-phase listener must not double-process. The textarea's React
      // handler runs on the bubble path after this returns without preventing.
      if (active === composer) return

      // Step 6: focus is on another editable element — honor its native paste.
      if (isEditable(active === null ? undefined : (active as HTMLElement))) return

      // Step 7: composer masked by a takeover overlay — silently ignore.
      if (!composerVisible(composer)) return

      // Route: append to the draft end and focus the composer without scrolling.
      event.preventDefault()
      input.setDraft(state.draft + text)
      composer.focus({ preventScroll: true })
    }

    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('paste', onPaste, true)
    }
  }, 'global-paste: document paste listener')
}
