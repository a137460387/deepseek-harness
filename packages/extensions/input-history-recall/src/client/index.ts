/**
 * Composer history recall, browser half: a document-level capture-phase
 * `keydown` listener that walks the current session's sent-message history
 * with ArrowUp/ArrowDown, mirroring Claude.ai's composer behavior.
 *
 * ArrowUp with the caret at offset 0 and no selection recalls the newest sent
 * message into the draft; further presses walk older; ArrowDown walks back,
 * and walking past the newest entry restores the draft as it was before the
 * traversal started. The history is read fresh from the session snapshot on
 * each keypress (user and steering message nodes, text blocks only), the
 * draft is written through the public `ctx.conversation.input` service
 * (`setDraft`), and the composer textarea is located read-only through the
 * `data-dsh-composer` selector — InputBar and every packages/client file stay
 * untouched.
 *
 * Guards, evaluated in order before a key is claimed: IME composition (the
 * candidate window owns the arrow keys), composer focus, the session-level
 * composer locks (removed session, offline continuable parent — the shared
 * predicate from `@deepseek-ai/dsh-client-composer-guards`, requested as a
 * module-table row through `dsh.client.external`), a non-plain input phase
 * (a claimed command line or a submit transaction must not be overwritten),
 * and an open candidate menu (the slash pipeline's own arrow arbitration
 * wins; the key is left to pass through to the composer's React handler).
 *
 * The traversal state is one in-memory slot in the apply closure: it survives
 * no reload, ends on session switches and on a cleared draft (a send), and
 * never crosses a plugin boundary.
 *
 * @module @deepseek-ai/dsh-client-input-history-recall/client
 */

import type { ClientContext, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the input-trigger service's Context merge (ctx.inputTriggers).
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { sessionAcceptsEdits } from '@deepseek-ai/dsh-client-composer-guards/client'

/** Selector for the composer textarea (marked by InputBar via data-dsh-composer). */
const COMPOSER_SELECTOR = 'textarea[data-dsh-composer]'

/** One live history traversal over the current session's sent texts. */
interface RecallSlot {
  /** The session the traversal was opened on; a different current session ends it. */
  readonly sessionId: SessionId
  /** Index into the sent-text history currently displayed. */
  cursor: number
  /** Draft as it was before the first ArrowUp; restored when ArrowDown walks past the newest entry. */
  stash: string
}

/**
 * Required services: the session list (current session + sent history) and
 * the conversation face (per-session input facade). The input-trigger service
 * is read optionally through `ctx.get` so compositions without the slash
 * pipeline still get history recall.
 */
export const inject = ['sessions', 'conversation']

/**
 * The current session's sent texts, oldest first: user and steering message
 * nodes' text blocks concatenated in order. Image-only messages contribute
 * nothing and are dropped; non-text blocks are skipped. Read fresh on each
 * keypress — the conversation snapshot is the authority and no second copy
 * of the history is kept.
 * @param session - the session face behind the current scope.
 * @returns the non-empty sent texts in log order.
 */
function sentTexts(session: SessionFace): readonly string[] {
  const texts: string[] = []
  for (const node of session.getSnapshot().nodes) {
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    let text = ''
    for (const block of node.content) {
      if (block.type === 'text') text += block.text
    }
    if (text !== '') texts.push(text)
  }
  return texts
}

/**
 * Claim one key for the traversal: the native caret move must not run
 * (preventDefault) and the composer's own React onKeyDown must not see it
 * (stopPropagation ends the capture descent before the React root).
 * @param event - the keydown event being claimed.
 */
function swallow(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Client plugin body: mount the document-level capture-phase keydown listener.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The one live traversal slot. Only the current session can traverse; the
  // slot dies with the plugin fiber and is reset by session switches, draft
  // clears, and walking past the newest entry.
  let active: RecallSlot | null = null

  ctx.effect(() => {
    // Session switches end any live traversal: the cursor indexes the
    // history of the session the traversal was opened on. The list store
    // notifies synchronously (default flush), so a keypress can never
    // observe a slot left over from a previous current session.
    const offList = ctx.sessions.list.subscribe(() => {
      const current = ctx.sessions.list.getSnapshot().current
      if (active !== null && active.sessionId !== current) active = null
    })

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      // IME composition owns the arrow keys (candidate navigation).
      // keyCode 229 is the legacy composition signal engines emit without isComposing.
      // oxlint-disable-next-line typescript/no-deprecated
      if (event.isComposing || event.keyCode === 229) return
      const composer = document.querySelector<HTMLTextAreaElement>(COMPOSER_SELECTOR)
      if (composer === null || document.activeElement !== composer) return

      const current = ctx.sessions.list.getSnapshot().current
      if (current === undefined) return
      const actx = ctx.sessions.scope(current)
      const session = actx === undefined ? undefined : ctx.sessions.sessionOf(actx)
      if (actx === undefined || session === undefined || !sessionAcceptsEdits(session)) return
      const input = ctx.conversation.input.for(actx)
      const state = input.state.getSnapshot()
      // Recall replaces the whole draft, so it is refused outside the plain
      // phase: a claimed command line and a submit transaction must not be
      // overwritten from history.
      if (state.phase !== 'plain') return
      // An open candidate menu wins: the slash pipeline's own arrow
      // arbitration consumes the key, so it is left to pass through.
      if (ctx.get('inputTriggers')?.sessionOf(actx).menu.getSnapshot().open === true) return

      // An emptied draft ends the traversal: every traversal write is
      // non-empty text, so an empty draft means the message was sent or the
      // draft cleared while traversing.
      if (active !== null && state.draft === '') active = null

      const history = sentTexts(session)
      if (event.key === 'ArrowUp') {
        if (active === null) {
          // Entry requires the caret at offset 0 with no selection (the
          // claude.ai gesture). Mid-traversal presses skip the recheck: the
          // draft rewrite leaves the caret where the engine puts it.
          if (composer.selectionStart !== 0 || composer.selectionEnd !== 0) return
          if (history.length === 0) return
          active = { sessionId: current, cursor: history.length, stash: state.draft }
        }
        // Already at the oldest entry (or the history read came back empty):
        // swallow the key and hold the displayed content.
        if (active.cursor === 0 || history.length === 0) {
          swallow(event)
          return
        }
        active.cursor -= 1
      } else {
        // Not traversing: ArrowDown keeps its native behavior entirely.
        if (active === null) return
        if (active.cursor >= history.length - 1) {
          // Past the newest entry: restore the stashed draft and end the traversal.
          const stash = active.stash
          active = null
          input.setDraft(stash)
          swallow(event)
          return
        }
        active.cursor += 1
      }
      const text = history[active.cursor]
      if (text === undefined) {
        // The history read shrank below the cursor. Session nodes are
        // append-only, so this is unreachable in practice; ending the
        // traversal without writing is the self-healing fallback.
        active = null
        return
      }
      input.setDraft(text)
      swallow(event)
    }

    document.addEventListener('keydown', onKeydown, true)
    return () => {
      offList()
      document.removeEventListener('keydown', onKeydown, true)
    }
  }, 'input-history-recall: composer keydown listener')
}
