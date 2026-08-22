/**
 * Composer draft persistence, browser half: mirrors the current session's
 * unsent draft into localStorage and restores it into the empty composer
 * after a reload or crash.
 *
 * The draft is read from the current session's input-state store
 * (`ctx.conversation.input.for(actx).state`, the InputZone currency) and
 * written back through the public single write path (`setDraft`) — InputBar
 * and every packages/client file stay untouched. Draft edits debounce into
 * one localStorage record per session key; an emptied draft (a send or a
 * manual clear) deletes its entry immediately so a reload never resurrects
 * text the user watched disappear. A session switch, `pagehide`,
 * `beforeunload`, and plugin teardown all flush the pending write
 * synchronously, so the debounce never widens the loss window.
 *
 * A draft that empties because it moved into the steering queue is the one
 * exception: the queue is transient, so the entry is held until the queue
 * drains (the text reached the turn and the entry goes) — a reload while
 * messages are still queued restores the text as an editable draft.
 *
 * Restore runs once per session per plugin lifetime, only as a session
 * becomes current, and only when the whole composer is safely writable: the
 * shared `resolveEditableInput` resolution (session locks open, no submit or
 * adjudication in flight), the `plain` phase (a claimed command line must
 * not turn into plain text), an empty live draft, an empty queue, and a
 * stored non-empty draft. The restored text re-enters through `setDraft`,
 * and an info notice says what happened. Only plain text survives: slash
 * command claims and @ reference chips are machine state beside the draft
 * string and restore as nothing (the chip's display text is ordinary draft
 * text and survives as such).
 *
 * Entries whose sessions left the live session list are pruned on every list
 * change (once the list has arrived — the pending phase carries an empty id
 * list by construction).
 *
 * A storage that throws (quota, private mode) or does not exist disables the
 * whole mirror silently for the plugin lifetime; the composer never notices.
 * @module @deepseek-ai/dsh-client-draft-keeper/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation)
// and names the input facade contract the restore path writes through.
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale service's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { resolveEditableInput } from '@deepseek-ai/dsh-client-composer-guards/client'
import { createDraftStore } from './draft-store.ts'
import { en, zh, type DraftKeeperKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The draft-keeper's restore notice copy. */
    draftKeeper: DraftKeeperKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'draftKeeper'

/** Single localStorage key; the payload carries its own version. */
const STORAGE_KEY = 'dsh.draft-keeper'

/** Debounce window for draft writes, in milliseconds. */
const SAVE_DEBOUNCE_MS = 300

/** The per-session input facade the conversation service resolves for a scope. */
type SessionInput = ReturnType<IConversation['input']['for']>

/**
 * Required services: the session list (current session + live session ids),
 * the conversation face (per-session input facade), and locale (the restore
 * notice copy).
 */
export const inject = ['sessions', 'conversation', 'locale']

/** One watched session: its input-state subscription plus queue-hold state. */
interface Watch {
  readonly sessionId: SessionId
  /** Dispose this session's input-state subscription. */
  off: () => void
  /** Set while the draft emptied into the still-pending steering queue. */
  queueHeld: boolean
}

/**
 * Client plugin body: mount the draft mirror — the current session's
 * input-state subscription, the restore check on session switches, the
 * steering-queue hold, and the flush-on-exit listeners.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'draft-keeper: dictionaries')

  ctx.effect(() => {
    // Non-browser runs (node unit benches) have no localStorage: the mirror
    // starts permanently off — the same silent contract as a storage failure.
    const store = createDraftStore(typeof localStorage === 'undefined' ? undefined : localStorage, STORAGE_KEY)
    const restored = new Set<SessionId>()
    let watch: Watch | null = null
    let pending: { readonly sessionId: SessionId; readonly text: string } | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    /** Write the pending debounced draft now; idempotent (pagehide, switch, teardown). */
    const flush = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (pending !== null) {
        const { sessionId, text } = pending
        pending = null
        store.set(sessionId, text)
      }
    }

    /**
     * Apply one observed draft change to the mirror.
     * @param subject - the watched session the change belongs to.
     * @param text - the next draft text.
     * @param queueLength - the queue length in the same snapshot.
     */
    const onDraft = (subject: Watch, text: string, queueLength: number): void => {
      if (text === '') {
        if (queueLength > 0) {
          // The draft moved into the steering queue: flush the debounce so
          // the entry holds the queued text, and hold it there until the
          // queue drains (it is transient — a reload restores the text).
          flush()
          subject.queueHeld = true
          return
        }
        // Sent or manually cleared: the pending write is cancelled and the
        // entry goes now, so a reload cannot resurrect text the user watched
        // disappear.
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
        pending = null
        store.remove(subject.sessionId)
        subject.queueHeld = false
        return
      }
      subject.queueHeld = false
      pending = { sessionId: subject.sessionId, text }
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS)
    }

    /**
     * Try the once-per-session restore as this session becomes current.
     * @param sessionId - the session that just became current.
     * @param input - its input facade.
     */
    const maybeRestore = (sessionId: SessionId, input: SessionInput): void => {
      if (restored.has(sessionId)) return
      // The shared resolution gates the write: a current session must exist,
      // its scope must resolve, the session-level composer locks must stand
      // open, and no submit or adjudication may be in flight.
      const resolved = resolveEditableInput(ctx)
      if (resolved === undefined || resolved.sessionId !== sessionId) return
      const { state } = resolved
      // Plain phase only (a claimed command line must not turn into plain
      // text), nothing live in the composer (an empty draft), and nothing
      // pending in the queue (queued rows own the "empty" draft).
      if (state.phase !== 'plain' || state.draft !== '' || state.queue.length > 0) return
      const saved = store.get(sessionId)
      if (saved === undefined) return
      restored.add(sessionId)
      input.setDraft(saved)
      input.notify('info', t('restore.notice'))
    }

    /**
     * Subscribe to one session's input-state store (the current session).
     * @param sessionId - the session to watch.
     */
    const watchSession = (sessionId: SessionId): void => {
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) return
      const input = ctx.conversation.input.for(actx)
      maybeRestore(sessionId, input)
      const subject: Watch = { sessionId, off: () => {}, queueHeld: false }
      let last = input.state.getSnapshot().draft
      subject.off = input.state.subscribe(() => {
        const snapshot = input.state.getSnapshot()
        if (snapshot.draft !== last) {
          last = snapshot.draft
          onDraft(subject, snapshot.draft, snapshot.queue.length)
        } else if (subject.queueHeld && snapshot.draft === '' && snapshot.queue.length === 0) {
          // The steering queue drained with the draft still empty: the held
          // text reached the turn, so its entry goes.
          subject.queueHeld = false
          store.remove(subject.sessionId)
        }
      })
      watch = subject
    }

    /** React to the session list: switch the watched session, prune the mirror. */
    const onList = (): void => {
      const list = ctx.sessions.list.getSnapshot()
      if (watch === null || watch.sessionId !== list.current) {
        // Flush BEFORE unsubscribing: the write for the session being left
        // completes synchronously, so a switch loses nothing.
        flush()
        if (watch !== null) {
          watch.off()
          watch = null
        }
        if (list.current !== undefined) watchSession(list.current)
      }
      // Prune only against an arrived list: the pending phase's empty id
      // list is a load state, not a sessionless world.
      if (list.phase === 'ready') store.prune(list.ids)
    }

    const offList = ctx.sessions.list.subscribe(onList)
    // The list may already hold a current session at effect setup (a plugin
    // reload lands after boot): catch it now; later notifications follow.
    onList()

    // The forced-flush exits: both fire flush, which is idempotent.
    const onExit = (): void => {
      flush()
    }
    window.addEventListener('pagehide', onExit)
    window.addEventListener('beforeunload', onExit)

    return () => {
      // Teardown flushes too: a plugin reload keeps every pending write.
      flush()
      if (watch !== null) watch.off()
      offList()
      window.removeEventListener('pagehide', onExit)
      window.removeEventListener('beforeunload', onExit)
    }
  }, 'draft-keeper: draft persistence')
}
