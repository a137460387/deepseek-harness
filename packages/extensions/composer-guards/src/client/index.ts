/**
 * Shared composer guards, browser half: the three predicates the fork's
 * composer plugins (global-paste, text-file-cards, input-history-recall)
 * share for deciding whether a plugin-side write may reach the composer right
 * now — whether the composer textarea is visible and unoccluded, whether the
 * session-level composer locks stand open, and whether the current session's
 * input facade can accept a draft edit.
 *
 * This package is a library row, not a feature plugin: its `apply` is inert
 * and it provides no services or slots. It exists as a dynamic `dsh.client`
 * row so consumers can share its code — each consumer declares
 * `@deepseek-ai/dsh-client-composer-guards/client` in `dsh.client.external`,
 * the graph composer orders this row before them, and the browser module
 * table resolves the request to this bundle's exports. The helpers stay pure
 * over public seams only: DOM probes and the `sessions` / `conversation`
 * services every consumer already injects.
 * @module @deepseek-ai/dsh-client-composer-guards/client
 */

import type { ClientContext, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation)
// and names the input facade contract the resolution returns.
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * Client plugin body — inert. The row exists to supply this module through
 * the browser module table (`dsh.client.external`), not to run anything.
 */
export function apply(): void {}

/**
 * Whether the composer textarea is currently visible and not covered by an
 * overlay (an approval/user-question takeover panel can keep the InputBar DOM
 * alive while visually masking it). Probes the composer's center with
 * elementFromPoint: if the topmost element there is not the composer or a
 * descendant of the composer's owner, the composer is considered occluded and
 * the caller should leave the event to native handling rather than route it
 * into a hidden field.
 * @param composer - the composer textarea element.
 * @returns true when the composer is visible to the user.
 */
export function composerVisible(composer: HTMLTextAreaElement): boolean {
  const rect = composer.getBoundingClientRect()
  // A zero-size composer (collapsed dock) cannot receive an interaction.
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
 * Whether the session still accepts draft edits under the composer's
 * observable lock conditions: the session is not removed, and a continuable
 * subagent child still has its exact parent available (the composer renders
 * read-only in both cases). The owner-prop lock reasons (the inert hero, an
 * owner block) have no public signal and stay out of reach.
 * @param session - the session face behind the current scope.
 * @returns true when every session-level composer lock stands open.
 */
export function sessionAcceptsEdits(session: SessionFace): boolean {
  const snapshot = session.getSnapshot()
  if (snapshot.removed) return false
  const subagent = snapshot.subagent
  return subagent === null || subagent.address.mode !== 'continuable' || subagent.parentAvailable
}

/** The per-session input facade the conversation service resolves for a scope. */
type SessionInput = ReturnType<IConversation['input']['for']>

/** The input facade's state snapshot. */
type InputSnapshot = ReturnType<SessionInput['state']['getSnapshot']>

/**
 * The editable input resolution: everything a caller needs to write through
 * the current session's input facade.
 */
export interface EditableInput {
  /** The per-session input facade (draft writes, notices, state store). */
  readonly input: SessionInput
  /** The facade's state snapshot at resolution time. */
  readonly state: InputSnapshot
  /** The session the facade belongs to. */
  readonly sessionId: SessionId
  /** The live session-id list at resolution time (staged-state prune currency). */
  readonly liveSessionIds: SessionId[]
}

/**
 * Resolve the current session's input facade when it can accept a draft edit:
 * a current session exists, its scope resolves, every session-level composer
 * lock stands open, and the input machine is not in a submit/adjudication
 * transaction (`claimed` still accepts edits). The state snapshot rides along
 * for draft-appending callers; the session id and the live session-id list
 * ride along for callers that key staged state by session and prune it when
 * the list changes.
 * @param ctx - client root context.
 * @returns the input facade with its state snapshot and session context, or
 * undefined to pass through.
 */
export function resolveEditableInput(ctx: ClientContext): EditableInput | undefined {
  const list = ctx.sessions.list.getSnapshot()
  const current = list.current
  if (current === undefined) return undefined
  const actx = ctx.sessions.scope(current)
  if (actx === undefined) return undefined
  const session = ctx.sessions.sessionOf(actx)
  if (session === undefined || !sessionAcceptsEdits(session)) return undefined
  const input = ctx.conversation.input.for(actx)
  const state = input.state.getSnapshot()
  if (state.phase === 'adjudicating' || state.phase === 'submitting') return undefined
  return { input, state, sessionId: current, liveSessionIds: list.ids }
}
