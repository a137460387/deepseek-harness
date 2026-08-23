/**
 * Text-file drop staging cards, browser half: a document-level capture-phase
 * `drop` listener takes over a drop of a PURE text-file batch anywhere over
 * the window — the same zone the composer's whole-window image intake covers
 * — and stages the files as compact cards in the `conversation.input.dock`
 * strip instead of inlining their content into the draft. Clicking a card
 * expands `# <filename>` + the file's content at the draft end (and focuses
 * the composer); the close button unstages without touching the draft.
 *
 * Staging instead of inlining keeps long documents out of the draft: the
 * content crosses into the message only on the user's explicit expand click.
 * The expanded text still rides the ordinary draft, so the model-visible
 * shape is exactly the inline-drop shape — no new session event, no
 * attachment pipeline.
 *
 * Ceilings: a file over MAX_FILE_BYTES is refused with an input notice (its
 * content would crowd out the context window once expanded), and a batch
 * beyond MAX_BATCH_FILES stages its head and reports the tail as refused.
 *
 * Composer lock alignment: staging and expanding mirror the composer's own
 * disabled predicate wherever a plugin can observe it — a removed session
 * and a continuable child whose exact parent is offline leave the composer
 * read-only, so both paths refuse there too. The visibility and lock
 * predicates are the shared ones from
 * `@deepseek-ai/dsh-client-composer-guards` (a module-table row requested
 * through `dsh.client.external`). The remaining lock reasons are
 * owner-prop facts with no public signal: the inert no-workspace hero has no
 * current session (the current-session guard already covers it), and an
 * owner block is composer-internal.
 *
 * Any image or other non-text file in the batch lets the WHOLE batch through
 * to the composer's native image intake (no splitting), so images keep the
 * first-party path. The composer's own whole-window dragover listener already
 * allows file drops and sets the copy cursor, so this plugin adds no dragover
 * handling; the text-vs-image decision is made at drop, when the files are
 * readable. The takeover fires a synthetic `dragend` on window so the
 * composer's drag-active overlay — whose own `onDrop` reset was skipped by
 * the capture-phase stopPropagation and which an OS file drag never ends
 * with — clears; every other window dragend listener also receives that
 * event, matching what a real drag's end would deliver.
 * @module @deepseek-ai/dsh-client-text-file-cards/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation)
// and the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  composerVisible, resolveEditableInput, sessionAcceptsEdits,
} from '@deepseek-ai/dsh-client-composer-guards/client'
import { TextFileCardsDock, type TextFileCardsInjected } from './TextFileCardsDock.tsx'
import { en, zh, type TextFileCardsKey } from './locales.ts'
import {
  createStagedFilesSource, formatBytes, isTextFile, MAX_BATCH_FILES, MAX_FILE_BYTES,
} from './text-files.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The staging cards' copy. */
    textFileCards: TextFileCardsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'textFileCards'

/** Selector for the composer textarea (marked by InputBar via data-dsh-composer). */
const COMPOSER_SELECTOR = 'textarea[data-dsh-composer]'

/**
 * Required services: the session list (current session), the conversation
 * face (per-session input facade), locale (dictionaries + notice copy), and
 * slots (the dock registration).
 */
export const inject = ['slots', 'sessions', 'conversation', 'locale']

/**
 * Client plugin body: mount the capture-phase drop listener and the dock
 * registration over one shared staged-file source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const staged = createStagedFilesSource()
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'text-file-cards: dictionaries')

  ctx.effect(() => {
    const onDrop = (event: DragEvent): void => {
      // Whole-window takeover, matching the zone of the composer's own image
      // intake. An empty batch, a batch carrying any image or other non-text
      // file, or no live input: leave the event to native handling (the
      // composer's whole-window image intake). Never split a batch, so images
      // keep the first-party path.
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null) return
      const files = Array.from(dataTransfer.files)
      if (files.length === 0) return
      if (!files.every(isTextFile)) return
      const resolved = resolveEditableInput(ctx)
      if (resolved === undefined) return
      const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
      if (composer === null) return
      // Composer masked by a takeover overlay — leave the drop to native
      // handling instead of staging invisibly.
      if (!composerVisible(composer)) return
      const { input, sessionId, liveSessionIds } = resolved

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

      // Ceilings: oversized files are refused outright; an oversized batch
      // stages its head. Both refusals surface as input notices.
      const oversized = files.filter(file => file.size > MAX_FILE_BYTES)
      const acceptable = files.filter(file => file.size <= MAX_FILE_BYTES)
      const stagedFiles = acceptable.slice(0, MAX_BATCH_FILES)
      const overflow = acceptable.length - stagedFiles.length
      staged.add(sessionId, stagedFiles, liveSessionIds)
      if (oversized.length > 0) {
        input.notify('error', t('error.tooLarge', {
          size: formatBytes(MAX_FILE_BYTES),
          names: oversized.map(file => file.name).join(', '),
        }))
      }
      if (overflow > 0) input.notify('error', t('error.tooMany', { count: MAX_BATCH_FILES }))
    }

    document.addEventListener('drop', onDrop, true)
    return () => {
      document.removeEventListener('drop', onDrop, true)
    }
  }, 'text-file-cards: document drop listener')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'text-file-cards',
    order: 5,
    locale: NS,
    inject: (sessionId): TextFileCardsInjected => ({
      expand: async (fileId) => {
        const entry = staged.get(sessionId, fileId)
        if (entry === undefined) return
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) return
        const session = ctx.sessions.sessionOf(actx)
        if (session === undefined || !sessionAcceptsEdits(session)) return
        const input = ctx.conversation.input.for(actx)
        const before = input.state.getSnapshot()
        if (before.phase === 'adjudicating' || before.phase === 'submitting') return
        let content: string
        try {
          content = await entry.file.text()
        } catch {
        // The staged file's read rejected (its OS file vanished since the
        // drop, or the browser revoked the blob). Nothing else can reach
        // here — the read is the only throwing step. Fail soft the way
        // global-paste's image forward does: the card stays staged so the
        // user can retry or remove it, and the slot inject path must not
        // throw through the dock's click handler.
          return
        }
        // Re-check after the async read: a submit may have started while the
        // file was being read, and the session-level locks may have turned
        // (removal, a lost parent).
        const after = input.state.getSnapshot()
        if (after.phase === 'adjudicating' || after.phase === 'submitting') return
        const recheck = ctx.sessions.sessionOf(actx)
        if (recheck === undefined || !sessionAcceptsEdits(recheck)) return
        const block = `# ${entry.name}\n${content}`
        input.setDraft(after.draft === '' ? block : `${after.draft}\n${block}`)
        staged.remove(sessionId, fileId)
        const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
        if (composer !== null) composer.focus({ preventScroll: true })
      },
      remove: (fileId) => {
        staged.remove(sessionId, fileId)
      },
      hooks: { stagedFiles: staged.store },
    }),
  }, TextFileCardsDock))
}
