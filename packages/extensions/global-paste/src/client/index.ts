/**
 * Whole-page paste, browser half: a document-level capture-phase `paste`
 * listener that routes clipboard content into the current session's composer.
 * Mirrors Claude.ai's "paste anywhere into the composer" behavior.
 *
 * The listener rides the capture phase so it runs BEFORE the composer
 * textarea's own React `onPaste`. Two routing paths:
 *
 * - **Text**: appended to the draft end through the public
 *   `ctx.conversation.input` service (`setDraft`).
 * - **Files (images)**: re-dispatched as a paste event onto the composer
 *   textarea, so the composer's own `onPaste` runs the full image intake
 *   (format/limit pre-check, preview URL creation, attachment-rail rendering).
 *   This avoids duplicating the package-private draft-image creation path and
 *   keeps first-party image behavior intact. Verified viable in Chromium:
 *   a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File
 *   items is honored by the target's `onPaste` (clipboardData.items and
 *   getData are both readable). A browser whose constructors throw (old
 *   Safari) fails soft — the image half is left to native handling and the
 *   text half still routes.
 *
 * When the composer textarea is already focused the paste listener lets the
 * event pass through to the native handler (no double-processing).
 *
 * Composer lock alignment: paste routing mirrors the composer's own disabled
 * predicate wherever a plugin can observe it — a removed session and a
 * continuable child whose exact parent is offline leave the composer
 * read-only, so the listener ignores pastes there too. The remaining lock
 * reasons are owner-prop facts with no public signal: the inert no-workspace
 * hero has no current session (the current-session guard already covers it),
 * and an owner block is composer-internal.
 *
 * Text-file DROPS are owned by the companion `text-file-cards` plugin, which
 * mounts its own capture-phase drop listener and stages dropped text files as
 * cards over the composer.
 * @module @deepseek-ai/dsh-client-global-paste/client
 */

import type { AgentContext, ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
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
 * Re-dispatch a paste event carrying the given clipboard items onto the
 * composer textarea, so its own `onPaste` runs the full image intake (format
 * and limit pre-check, preview URL, attachment rail). The composer is focused
 * first so the re-dispatched event is indistinguishable from a user paste while
 * the composer is active. The original document-level event is prevented so it
 * does not also land on whatever element held focus.
 *
 * Browsers that cannot construct the synthetic clipboard pieces (old Safari
 * throws TypeError on the `DataTransfer` constructor or the `clipboardData`
 * init) fail soft: the forward is reported as unavailable so the caller leaves
 * the paste to native handling instead of half-swallowing it.
 * @param composer - the composer textarea to target.
 * @param clipboardData - the original event's clipboardData to mirror.
 * @returns true when the forwarded paste was constructed and dispatched.
 */
function forwardImagePaste(composer: HTMLTextAreaElement, clipboardData: DataTransfer): boolean {
  try {
    dispatchForwardedPaste(composer, clipboardData)
    return true
  } catch {
    // Old Safari throws TypeError constructing a DataTransfer or a ClipboardEvent
    // with a clipboardData init, making the image forward unavailable. Nothing
    // else can reach here: dispatchForwardedPaste only runs DOM constructors and
    // calls, and letting the error escape the listener would break the text
    // branch below — a constructor failure must not swallow the whole paste.
    return false
  }
}

/**
 * Construct and dispatch the forwarded paste event (the throwing part of
 * {@link forwardImagePaste}, isolated so the caller can fail soft).
 * @param composer - the composer textarea to target.
 * @param clipboardData - the original event's clipboardData to mirror.
 */
function dispatchForwardedPaste(composer: HTMLTextAreaElement, clipboardData: DataTransfer): void {
  // Mirror the file items (images) onto a fresh DataTransfer. getData('text/plain')
  // is intentionally NOT copied: the composer's onPaste would otherwise also
  // append the text via pasteBegin, duplicating what the text branch already did
  // (a mixed paste with both text and images splits: text → setDraft, images → here).
  const dt = new DataTransfer()
  for (const item of clipboardData.items) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file !== null) dt.items.add(file)
    }
  }
  composer.focus({ preventScroll: true })
  composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}

/**
 * Whether the session behind a scope still accepts draft edits under the
 * composer's observable lock conditions: the session face resolves, the
 * session is not removed, and a continuable subagent child still has its
 * exact parent available (the composer renders read-only in all three
 * cases). The owner-prop lock reasons (the inert hero, an owner block) have
 * no public signal and stay out of reach.
 * @param ctx - client root context.
 * @param actx - the session's Agent-scoped context.
 * @returns true when every session-level composer lock stands open.
 */
function sessionAcceptsEdits(ctx: ClientContext, actx: AgentContext): boolean {
  const session = ctx.sessions.sessionOf(actx)
  if (session === undefined) return false
  const snapshot = session.getSnapshot()
  if (snapshot.removed) return false
  const subagent = snapshot.subagent
  return subagent === null || subagent.address.mode !== 'continuable' || subagent.parentAvailable
}

/**
 * Resolve the current session's input facade when it can accept a draft edit:
 * a current session exists, its scope resolves, every session-level composer
 * lock stands open, and the input machine is not in a submit/adjudication
 * transaction (`claimed` still accepts edits).
 * @param ctx - client root context.
 * @returns the input facade and its state snapshot, or undefined to pass
 * through.
 */
function resolveEditableInput(ctx: ClientContext) {
  const current = ctx.sessions.list.getSnapshot().current
  if (current === undefined) return undefined
  const actx = ctx.sessions.scope(current)
  if (actx === undefined || !sessionAcceptsEdits(ctx, actx)) return undefined
  const input = ctx.conversation.input.for(actx)
  const state = input.state.getSnapshot()
  if (state.phase === 'adjudicating' || state.phase === 'submitting') return undefined
  return { input, state }
}

/**
 * Client plugin body: mount the document-level capture-phase paste listener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      // No clipboard data — nothing to route; leave native handling intact.
      if (event.clipboardData === null) return
      const text = event.clipboardData.getData('text/plain')
      const hasFiles = Array.from(event.clipboardData.items).some(item => item.kind === 'file')
      // No text and no files — nothing for this listener to do.
      if (text === '' && !hasFiles) return

      // Resolve the current session's input facade when it can accept a draft
      // edit; a missing session/scope or an in-flight submit/adjudication
      // leaves the paste to native handling.
      const resolved = resolveEditableInput(ctx)
      if (resolved === undefined) return
      const { input, state } = resolved

      const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
      if (composer === null) return

      const active = document.activeElement

      // Composer already focused — let its own onPaste handle this; the
      // capture-phase listener must not double-process. The textarea's React
      // handler runs on the bubble path after this returns without preventing.
      if (active === composer) return

      // Focus is on another editable element — honor its native paste.
      if (isEditable(active === null ? undefined : (active as HTMLElement))) return

      // Composer masked by a takeover overlay — silently ignore.
      if (!composerVisible(composer)) return

      // Route files (images) by re-dispatching onto the composer so its own
      // onPaste runs the image intake. A browser that cannot construct the
      // synthetic pieces leaves the image half to native handling; text (if
      // any) is still routed below, and the forwarded event copies only file
      // items to avoid double-inserting text.
      const forwarded = hasFiles && forwardImagePaste(composer, event.clipboardData)
      if (forwarded) event.preventDefault()
      // Route text by appending to the draft end through the public service.
      if (text !== '') {
        event.preventDefault()
        input.setDraft(state.draft + text)
        // Focus the composer when the image forward did not already do it.
        if (!forwarded) composer.focus({ preventScroll: true })
      }
    }

    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('paste', onPaste, true)
    }
  }, 'global-paste: document paste listener')
}
