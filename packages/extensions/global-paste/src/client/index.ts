/**
 * Whole-page paste and text-file drop, browser half: document-level
 * capture-phase `paste` / `dragover` / `drop` listeners that route clipboard
 * content and dropped text files into the current session's composer. Mirrors
 * Claude.ai's "paste anywhere into the composer" behavior.
 *
 * The paste listener rides the capture phase so it runs BEFORE the composer
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
 *   getData are both readable).
 *
 * When the composer textarea is already focused the paste listener lets the
 * event pass through to the native handler (no double-processing).
 *
 * File drop: the capture-phase `dragover`/`drop` listeners take over a drop of
 * a PURE text-file batch that lands inside the composer card
 * (`[data-composer-card]`), reading the files and appending them to the draft
 * end (one `# <filename>` header per file, files joined by a blank line). Any
 * image or other non-text file in the batch lets the WHOLE batch through to
 * the composer's native image intake (no splitting). The takeover fires a
 * synthetic `dragend` on window so the composer's drag-active overlay — whose
 * own `onDrop` reset was skipped by the capture-phase stopPropagation and which
 * an OS file drag never ends with — clears; every other window dragend listener
 * also receives that event, matching what a real drag's end would deliver.
 * @module @deepseek-ai/dsh-client-global-paste/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Selector for the composer textarea (marked by InputBar via data-dsh-composer). */
const COMPOSER_SELECTOR = 'textarea[data-dsh-composer]'

/** Selector for the composer card container (marked by InputBar via data-composer-card). */
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** Editable element tags whose own paste must not be hijacked. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * File extensions treated as plain text/code for drop intake. A dropped file is
 * text when its extension is listed here or its MIME type starts with `text/`;
 * anything else (images, binaries, unrecognized) is left to the composer's
 * native image intake.
 */
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log',
  'json', 'yaml', 'toml', 'ini', 'xml', 'csv', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cs', 'swift', 'php', 'sh', 'ps1', 'sql',
  'html', 'css', 'scss', 'vue', 'svelte',
])

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
 * @param composer - the composer textarea to target.
 * @param clipboardData - the original event's clipboardData to mirror.
 */
function forwardImagePaste(composer: HTMLTextAreaElement, clipboardData: DataTransfer): void {
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
 * Whether a dropped file is plain text: its MIME type starts with `text/`, or
 * its extension is in TEXT_EXTENSIONS. A file with neither signal (no extension
 * and an empty MIME type) is NOT treated as text and is left to the composer's
 * native intake.
 * @param file - the dropped file to classify.
 * @returns true when the file is recognized as text.
 */
function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase())
}

/**
 * The composer card enclosing the drag event's drop point, or null when the
 * pointer is outside every composer card (in which case the event is left
 * alone).
 * @param event - the dragover or drop event.
 * @returns the enclosing composer-card element, or null.
 */
function composerCardAt(event: DragEvent): Element | null {
  const target = event.target
  if (!(target instanceof Element)) return null
  return target.closest(COMPOSER_CARD_SELECTOR)
}

/**
 * Resolve the current session's input facade when it can accept a draft edit:
 * a current session exists, its scope resolves, and the input machine is not in
 * a submit/adjudication transaction (`claimed` still accepts edits).
 * @param ctx - client root context.
 * @returns the input facade and its state snapshot, or undefined to pass
 * through.
 */
function resolveEditableInput(ctx: ClientContext) {
  const current = ctx.sessions.list.getSnapshot().current
  if (current === undefined) return undefined
  const actx = ctx.sessions.scope(current)
  if (actx === undefined) return undefined
  const input = ctx.conversation.input.for(actx)
  const state = input.state.getSnapshot()
  if (state.phase === 'adjudicating' || state.phase === 'submitting') return undefined
  return { input, state }
}

/**
 * Client plugin body: mount the document-level capture-phase paste and
 * file-drop listeners.
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
      // onPaste runs the image intake. Text (if any) is appended below; the
      // forwarded event copies only file items to avoid double-inserting text.
      if (hasFiles) {
        event.preventDefault()
        forwardImagePaste(composer, event.clipboardData)
      }
      // Route text by appending to the draft end through the public service.
      if (text !== '') {
        event.preventDefault()
        input.setDraft(state.draft + text)
        if (!hasFiles) composer.focus({ preventScroll: true })
      }
    }

    const onDragOver = (event: DragEvent): void => {
      // Only the composer-card drop zone is taken over; anywhere else the
      // event is left to native handling (the composer's whole-page image
      // drop). dragover exposes only types, not files, so the text-vs-image
      // decision is deferred to drop.
      if (composerCardAt(event) === null) return
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null) return
      if (!dataTransfer.types.includes('Files')) return
      event.preventDefault()
      event.stopPropagation()
      dataTransfer.dropEffect = 'copy'
    }

    const onDrop = (event: DragEvent): void => {
      // Outside the composer card, an empty batch, a batch carrying any image
      // or other non-text file, or no live input: leave the event to native
      // handling (the composer's whole-page image intake). Never split a batch,
      // so images keep the first-party path.
      if (composerCardAt(event) === null) return
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null) return
      const files = Array.from(dataTransfer.files)
      if (files.length === 0) return
      if (!files.every(isTextFile)) return
      const resolved = resolveEditableInput(ctx)
      if (resolved === undefined) return
      const { input } = resolved

      // Take over synchronously: block the browser's file-open default and keep
      // the event from reaching the composer's bubble-phase onDrop (which would
      // run the text files through the image intake).
      event.preventDefault()
      event.stopPropagation()
      // The composer's drag-active overlay is cleared by its own onDrop's
      // reset(), which the stopPropagation above skips, and an OS file drag
      // fires no dragend — fire a synthetic one on window to run the composer's
      // unguarded reset listener. Every window dragend listener receives it,
      // matching what a real drag's end would deliver.
      window.dispatchEvent(new Event('dragend'))

      void (async () => {
        const blocks = await Promise.all(files.map(async file => `# ${file.name}\n${await file.text()}`))
        // Re-check the machine after the async read: a submit may have started
        // while the files were being read.
        const state = input.state.getSnapshot()
        if (state.phase === 'adjudicating' || state.phase === 'submitting') return
        const block = blocks.join('\n\n')
        input.setDraft(state.draft === '' ? block : state.draft + '\n' + block)
        const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
        if (composer !== null) composer.focus({ preventScroll: true })
      })()
    }

    document.addEventListener('paste', onPaste, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('drop', onDrop, true)
    }
  }, 'global-paste: document paste and file-drop listeners')
}
