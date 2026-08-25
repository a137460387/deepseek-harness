// @vitest-environment jsdom
/**
 * draft-keeper plugin halves: the browser entry's draft mirror against faked
 * sessions/conversation services over a real LocaleRuntime and jsdom's
 * localStorage — the debounced write and its record shape, the immediate
 * entry deletion on an emptied draft (a send or a manual clear), the
 * forced-flush exits (session switch, pagehide, beforeunload, teardown), the
 * once-per-session restore gate (locks, plain phase, empty live draft, empty
 * queue, stored draft) and its one-time guard, the steering-queue hold, the
 * live-list prune, the coexistence with input-history-recall's traversal (a
 * non-empty live draft is saved, never overwritten), HMR teardown (pending
 * write flushed, restored set rebuilt, storage crossing the reload), the
 * silent degradation when localStorage fails or does not exist, and the
 * best-effort clearing that keeps a quota-latched mirror from resurrecting
 * a draft the user watched disappear. Plus the inert node entry and the
 * invariant companion's ownership reservation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as DraftKeeperInvariant from '../src/invariant.ts'

/** The single storage key the browser half owns. */
const STORAGE_KEY = 'dsh.draft-keeper'
/** The write debounce, mirrored from the plugin for timer math. */
const SAVE_DEBOUNCE_MS = 300

/** One queue row as the input-state projection shapes it (shape-opaque here). */
interface QueueRow { readonly id: number }

/** The input-state snapshot fields the plugin reads. */
interface InputSnapshot {
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  readonly queue: readonly QueueRow[]
}

/** Fake per-session input facade: setDraft writes through, notify records. */
interface FakeInput {
  setDraft: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  state: ReturnType<typeof createSnapshotStore<InputSnapshot>>
}

/** Mutable fake of the session-level lock facts the shared resolution reads. */
interface SessionLockSnapshot {
  removed: boolean
  subagent: null
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  list: ReturnType<typeof createSnapshotStore<SessionListState>>
  sessionSnapshot: SessionLockSnapshot
  input: (sessionId: SessionId) => FakeInput
}

interface BenchOptions {
  readonly sessions?: readonly string[]
  readonly current?: string
  readonly phase?: InputSnapshot['phase']
  readonly draft?: string
  readonly queue?: readonly QueueRow[]
  readonly listPhase?: 'pending' | 'ready'
  readonly removed?: boolean
}

/** Build a session-list snapshot over the bench's session ids. */
function listState(current: string | undefined, ids: readonly string[], phase: 'pending' | 'ready' = 'ready'): SessionListState {
  return {
    ids: ids.map(id => id as SessionId),
    byId: {},
    current: current === undefined ? undefined : (current as SessionId),
    phase,
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

/** The stored drafts as they sit on disk. */
function storedDrafts(): Record<string, string> {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === null ? {} : (JSON.parse(raw) as { drafts: Record<string, string> }).drafts
}

/** Seed the on-disk record the way a previous page lifetime left it. */
function seedStored(drafts: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, drafts }))
}

/** One fake facade whose setDraft publishes through the state store. */
function makeInput(snapshot: InputSnapshot): FakeInput {
  const input = {} as FakeInput
  input.state = createSnapshotStore<InputSnapshot>(snapshot)
  input.setDraft = vi.fn((text: string) => {
    input.state.set({ ...input.state.getSnapshot(), draft: text })
  })
  input.notify = vi.fn()
  return input
}

// Track the active bench so its subscriptions are torn down between tests;
// jsdom shares one document and one localStorage across the suite.
let activeBench: Bench | undefined

/**
 * Boot the browser half over a real Context with a real LocaleRuntime and
 * faked sessions/conversation services, one input facade per session.
 */
async function bench(over: BenchOptions = {}): Promise<Bench> {
  const sessionIds = (over.sessions ?? ['s1']).map(id => id as SessionId)
  const inputs = new Map<SessionId, FakeInput>(sessionIds.map(id => [
    id,
    makeInput({ draft: over.draft ?? '', phase: over.phase ?? 'plain', queue: over.queue ?? [] }),
  ]))
  const currentId = over.current ?? sessionIds[0]
  const list = createSnapshotStore<SessionListState>(listState(currentId, sessionIds, over.listPhase ?? 'ready'))
  const sessionSnapshot: SessionLockSnapshot = { removed: over.removed === true, subagent: null }

  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    list,
    scope: (id: SessionId) => inputs.has(id) ? ({ scopeOf: () => id } as never) : undefined,
    sessionOf: () => ({ getSnapshot: () => sessionSnapshot }),
  } as never)
  ctx.provide('conversation', {
    input: {
      for: (actx: { scopeOf(): SessionId }) => {
        const input = inputs.get(actx.scopeOf())
        if (input === undefined) throw new Error('bench: no input facade for scope')
        return input
      },
    },
  } as never)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  const b: Bench = {
    ctx,
    fiber,
    list,
    sessionSnapshot,
    input: (sessionId) => {
      const input = inputs.get(sessionId)
      if (input === undefined) throw new Error('bench: unknown session')
      return input
    },
  }
  activeBench = b
  return b
}

/** Publish a draft edit the way the input machine's shell would. */
function setDraftOf(b: Bench, sessionId: string, text: string): void {
  const input = b.input(sessionId as SessionId)
  input.state.set({ ...input.state.getSnapshot(), draft: text })
}

/** Publish a queue change with the draft held as-is. */
function setQueueOf(b: Bench, sessionId: string, queue: readonly QueueRow[]): void {
  const input = b.input(sessionId as SessionId)
  input.state.set({ ...input.state.getSnapshot(), queue })
}

/** Let the real debounce window elapse (the timer was scheduled on the real clock). */
async function runDebounce(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, SAVE_DEBOUNCE_MS + 50))
}

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (activeBench !== undefined) {
    await activeBench.fiber.dispose()
    activeBench = undefined
  }
})

describe('draft-keeper browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'conversation', 'locale'])
  })

  it('debounces draft edits into one storage record', async () => {
    const b = await bench()
    vi.useFakeTimers()
    setDraftOf(b, 's1', 'hello')
    setDraftOf(b, 's1', 'hello world')
    expect(storedDrafts()).toEqual({})
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1)
    expect(storedDrafts()).toEqual({})
    vi.advanceTimersByTime(1)
    expect(storedDrafts()).toEqual({ s1: 'hello world' })
    vi.useRealTimers()
  })

  it('deletes the entry immediately when the draft empties', async () => {
    const b = await bench()
    setDraftOf(b, 's1', 'temporary')
    await runDebounce()
    expect(storedDrafts()).toEqual({ s1: 'temporary' })
    setDraftOf(b, 's1', '')
    expect(storedDrafts()).toEqual({})
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('flushes the pending write before a session switch subscribes away', async () => {
    const b = await bench({ sessions: ['s1', 's2'] })
    vi.useFakeTimers()
    setDraftOf(b, 's1', 'draft of the session being left')
    b.list.set(listState('s2', ['s1', 's2']))
    // The switch itself flushed: no timer had to fire first.
    expect(storedDrafts()).toEqual({ s1: 'draft of the session being left' })
    vi.useRealTimers()
  })

  it('flushes the pending write on pagehide', async () => {
    const b = await bench()
    vi.useFakeTimers()
    setDraftOf(b, 's1', 'before the page hides')
    window.dispatchEvent(new Event('pagehide'))
    expect(storedDrafts()).toEqual({ s1: 'before the page hides' })
    vi.useRealTimers()
  })

  it('flushes the pending write on beforeunload', async () => {
    const b = await bench()
    vi.useFakeTimers()
    setDraftOf(b, 's1', 'before the page unloads')
    window.dispatchEvent(new Event('beforeunload'))
    expect(storedDrafts()).toEqual({ s1: 'before the page unloads' })
    vi.useRealTimers()
  })

  it('restores a stored draft into the empty composer with an info notice', async () => {
    seedStored({ s1: 'saved text' })
    const b = await bench()
    expect(b.input('s1' as SessionId).setDraft).toHaveBeenCalledWith('saved text')
    const input = b.input('s1' as SessionId)
    expect(input.notify).toHaveBeenCalledOnce()
    expect(input.notify.mock.calls[0]?.[0]).toBe('info')
    expect(String(input.notify.mock.calls[0]?.[1])).toMatch(/draft|草稿/)
    // The restored text is the live draft now, and the entry survives it.
    expect(input.state.getSnapshot().draft).toBe('saved text')
    expect(storedDrafts()).toEqual({ s1: 'saved text' })
  })

  it('restores only once per session per plugin lifetime', async () => {
    seedStored({ s1: 'first restore' })
    const b = await bench({ sessions: ['s1', 's2'] })
    expect(b.input('s1' as SessionId).setDraft).toHaveBeenCalledTimes(1)
    // Empty the restored draft (the entry goes), then re-seed storage so a
    // guardless plugin would restore again on the next become-current.
    setDraftOf(b, 's1', '')
    seedStored({ s1: 're-seeded' })
    b.list.set(listState('s2', ['s1', 's2']))
    b.list.set(listState('s1', ['s1', 's2']))
    expect(b.input('s1' as SessionId).setDraft).toHaveBeenCalledTimes(1)
  })

  it('does not restore over a non-empty live draft (history-recall traversal)', async () => {
    seedStored({ s1: 'the pre-traversal draft' })
    // The traversal wrote a recalled message into the draft: restoring over
    // it would overwrite the user's live composer state.
    const b = await bench({ draft: 'recalled by ArrowUp' })
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
    expect(b.input('s1' as SessionId).notify).not.toHaveBeenCalled()
    // The traversal draft itself persists like any ordinary edit.
    await runDebounce()
    expect(storedDrafts()).toEqual({ s1: 'recalled by ArrowUp' })
  })

  it('does not restore outside the plain phase', async () => {
    seedStored({ s1: 'claimed command' })
    const b = await bench({ phase: 'claimed' })
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
  })

  it('does not restore when the session composer locks are closed', async () => {
    seedStored({ s1: 'locked away' })
    const b = await bench({ removed: true })
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
  })

  it('does not restore while steering queue rows are pending', async () => {
    seedStored({ s1: 'queued world' })
    const b = await bench({ queue: [{ id: 1 }] })
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
  })

  it('does not restore when nothing is stored', async () => {
    const b = await bench()
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
    expect(b.input('s1' as SessionId).notify).not.toHaveBeenCalled()
  })

  it('holds the entry while the draft sits in the steering queue, deletes when it drains', async () => {
    const b = await bench()
    setDraftOf(b, 's1', 'steer me')
    await runDebounce()
    expect(storedDrafts()).toEqual({ s1: 'steer me' })
    // Enter queued the message: the draft emptied into the transient queue.
    setQueueOf(b, 's1', [{ id: 1 }])
    setDraftOf(b, 's1', '')
    expect(storedDrafts()).toEqual({ s1: 'steer me' })
    // The queue drained into the turn: the text was consumed.
    setQueueOf(b, 's1', [])
    expect(storedDrafts()).toEqual({})
  })

  it('prunes entries whose sessions left the live list, but only once it arrived', async () => {
    seedStored({ s1: 'live', gone: 'stale' })
    // A pending list carries an empty id list by construction — no prune yet.
    const b = await bench({ listPhase: 'pending' })
    expect(storedDrafts()).toEqual({ s1: 'live', gone: 'stale' })
    b.list.set(listState('s1', ['s1'], 'ready'))
    expect(storedDrafts()).toEqual({ s1: 'live' })
  })

  it('does not resurrect a manually cleared draft across a simulated reload', async () => {
    const b = await bench()
    setDraftOf(b, 's1', 'delete me before reload')
    await runDebounce()
    setDraftOf(b, 's1', '')
    expect(storedDrafts()).toEqual({})
    await b.fiber.dispose()
    // The page reloads: the plugin lifetime restarts against the same storage
    // and an empty live composer.
    const input = b.input('s1' as SessionId)
    input.state.set({ ...input.state.getSnapshot(), draft: '' })
    const fiber2 = b.ctx.plugin({ inject: [...inject], apply })
    await fiber2.await()
    expect(input.setDraft).not.toHaveBeenCalled()
    await fiber2.dispose()
  })

  it('teardown flushes the pending write and a reloaded lifetime restores again', async () => {
    const b = await bench()
    vi.useFakeTimers()
    setDraftOf(b, 's1', 'kept across the plugin reload')
    await b.fiber.dispose()
    // The teardown flush landed; storage crossed the plugin lifetime.
    expect(storedDrafts()).toEqual({ s1: 'kept across the plugin reload' })
    vi.useRealTimers()
    // With no subscriber left, emptying the live draft leaves the entry.
    const input = b.input('s1' as SessionId)
    input.state.set({ ...input.state.getSnapshot(), draft: '' })
    // HMR remount: the restored set is rebuilt, so the session is eligible
    // again — the draft comes back exactly once per new lifetime.
    const fiber2 = b.ctx.plugin({ inject: [...inject], apply })
    await fiber2.await()
    expect(input.setDraft).toHaveBeenCalledWith('kept across the plugin reload')
    await fiber2.dispose()
  })

  it('stays silent when storage writes start failing mid-lifetime', async () => {
    const b = await bench()
    // jsdom keeps the storage methods on Storage.prototype and hands out an
    // opaque instance, so an instance-level spy never intercepts — spy the
    // prototype the instance dispatches through.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => { setDraftOf(b, 's1', 'doomed') }).not.toThrow()
    await runDebounce()
    expect(storedDrafts()).toEqual({})
    expect(() => { setDraftOf(b, 's1', '') }).not.toThrow()
    setItem.mockRestore()
  })

  it('still clears a stored draft after a quota latch so a reload resurrects nothing', async () => {
    const b = await bench()
    setDraftOf(b, 's1', 'stored before the failure')
    await runDebounce()
    expect(storedDrafts()).toEqual({ s1: 'stored before the failure' })
    // Quota failure shape: the growth write fails; the clearing path needs
    // only the key removal, which a quota-blocked storage still allows.
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    setDraftOf(b, 's1', 'a longer draft that fails to persist')
    await runDebounce()
    expect(storedDrafts()).toEqual({ s1: 'stored before the failure' })
    // The user clears (or sends): the latch must not swallow the deletion.
    setDraftOf(b, 's1', '')
    expect(storedDrafts()).toEqual({})
    setItem.mockRestore()
    // Simulated reload: a fresh lifetime over the same storage restores nothing.
    await b.fiber.dispose()
    const input = b.input('s1' as SessionId)
    input.state.set({ ...input.state.getSnapshot(), draft: '' })
    const fiber2 = b.ctx.plugin({ inject: [...inject], apply })
    await fiber2.await()
    expect(input.setDraft).not.toHaveBeenCalled()
    await fiber2.dispose()
  })

  it('degrades to a no-op without localStorage', async () => {
    seedStored({ s1: 'unread' })
    vi.stubGlobal('localStorage', undefined)
    const b = await bench()
    expect(b.input('s1' as SessionId).setDraft).not.toHaveBeenCalled()
    expect(() => { setDraftOf(b, 's1', 'never stored') }).not.toThrow()
    await runDebounce()
    vi.unstubAllGlobals()
    expect(storedDrafts()).toEqual({ s1: 'unread' })
  })
})

describe('draft-keeper node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('draft-keeper invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(DraftKeeperInvariant)
    await fiber.await()
    expect(DraftKeeperInvariant.name).toBe('client-draft-keeper-invariant')
    expect(DraftKeeperInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
