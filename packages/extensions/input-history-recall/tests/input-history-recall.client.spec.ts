// @vitest-environment jsdom
/**
 * input-history-recall plugin halves: the browser entry's document-level
 * capture-phase keydown listener against faked sessions/conversation/
 * inputTriggers services (with fiber teardown proving removal — HMR safety),
 * the inert node entry, and the invariant companion's ownership reservation.
 * Lock states (removed session, an offline continuable parent, submit/
 * adjudicate/claim phases, an open candidate menu, IME composition) leave the
 * key to native handling like the composer's own read-only states. The
 * traversal round trip (recall older, walk forward, restore the stashed
 * draft), the session-switch reset, and the send-clear reset are asserted
 * against a stateful draft fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as RecallInvariant from '../src/invariant.ts'

/** Input phases the plugin distinguishes (the recall gate accepts plain only). */
type Phase = 'plain' | 'adjudicating' | 'claimed' | 'submitting'

/** Minimal message-node shape the history read touches. */
interface NodeLike {
  kind: 'user' | 'steering' | 'assistant'
  content: readonly { type: string; text?: string }[]
}

/** Mutable fake of the session-level facts the plugin's lock read touches. */
interface SessionSnapshot {
  nodes: NodeLike[]
  removed: boolean
  subagent: {
    address: { parentSessionId: SessionId; childSessionId: SessionId; mode: 'continuable' }
    parentAvailable: boolean
  } | null
}

interface FakeInput {
  setDraft: ReturnType<typeof vi.fn>
  state: ReturnType<typeof createSnapshotStore<{ draft: string; phase: Phase }>>
}

/** Build a user/steering message node carrying the given text blocks. */
function message(kind: 'user' | 'steering', ...texts: readonly string[]): NodeLike {
  return { kind, content: texts.map(text => ({ type: 'text', text })) }
}

/** Build an image-only user message node (no text blocks to recall). */
function imageOnlyMessage(): NodeLike {
  return { kind: 'user', content: [{ type: 'image' }] }
}

/** Build an assistant message node (never recalled). */
function assistantNode(text: string): NodeLike {
  return { kind: 'assistant', content: [{ type: 'text', text }] }
}

/** Build a session list snapshot with the given sessions and current selection. */
function listState(ids: readonly SessionId[], current: SessionId | undefined): SessionListState {
  return {
    ids: [...ids],
    byId: {},
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  /** The mounted composer textarea; null in noComposer benches (dispatch on document). */
  composer: HTMLTextAreaElement | null
  /** Draft writes per session id (the stateful setDraft fake). */
  inputs: Map<SessionId, FakeInput>
  /** Mutable per-session snapshots (nodes, removed, subagent). */
  snapshots: Map<SessionId, SessionSnapshot>
  list: ReturnType<typeof createSnapshotStore<SessionListState>>
  menu: ReturnType<typeof createSnapshotStore<{ open: boolean }>>
  /** Switch the current session through the list store. */
  readonly switchTo: (id: SessionId) => void
}

interface BenchOptions {
  readonly draft?: string
  readonly phase?: Phase
  readonly noSession?: boolean
  readonly scopeUndefined?: boolean
  readonly sessionFaceUndefined?: boolean
  readonly removed?: boolean
  readonly parentOffline?: boolean
  readonly menuOpen?: boolean
  readonly noTriggers?: boolean
  readonly noComposer?: boolean
  readonly nodes?: readonly NodeLike[]
}

// Track the active bench so its document listener is torn down between tests;
// jsdom shares one document across the suite, so a leaked listener from an
// earlier test would intercept a later test's keypress and swallow it.
let activeBench: Bench | undefined

/**
 * Boot the browser half over a real Context with faked sessions and
 * conversation services. Two sessions ('a' and 'b') exist so session-switch
 * resets can be exercised; the composer textarea is mounted into the
 * document, focused, and left with a collapsed caret at offset 0.
 */
async function bench(over: BenchOptions = {}): Promise<Bench> {
  const ids: SessionId[] = ['a' as SessionId, 'b' as SessionId]
  const draft = over.draft ?? ''
  const phase = over.phase ?? 'plain'
  const nodes = over.nodes ?? [message('user', 'first'), message('user', 'second')]

  const inputs = new Map<SessionId, FakeInput>()
  const snapshots = new Map<SessionId, SessionSnapshot>()
  for (const id of ids) {
    const state = createSnapshotStore<{ draft: string; phase: Phase }>({ draft, phase })
    inputs.set(id, {
      // Stateful fake: a recalled write must be visible to the next keypress
      // (the emptied-draft reset and the stash restore both read it back).
      setDraft: vi.fn((text: string) => { state.set({ ...state.getSnapshot(), draft: text }) }),
      state,
    })
    snapshots.set(id, {
      nodes: [...nodes],
      removed: over.removed === true,
      subagent: over.parentOffline === true
        ? {
          address: { parentSessionId: 'parent' as SessionId, childSessionId: id, mode: 'continuable' },
          parentAvailable: false,
        }
        : null,
    })
  }

  const list = createSnapshotStore<SessionListState>(
    listState(ids, over.noSession === true ? undefined : ids[0]),
  )
  const menu = createSnapshotStore<{ open: boolean }>({ open: over.menuOpen === true })

  const actxOf = (id: SessionId): { sessionId: SessionId } => ({ sessionId: id })
  const ctx = new Context()
  ctx.provide('sessions', {
    list,
    scope: (id: SessionId) => over.scopeUndefined === true ? undefined : actxOf(id),
    sessionOf: (actx: { sessionId: SessionId }) =>
      over.sessionFaceUndefined === true ? undefined : { getSnapshot: () => snapshots.get(actx.sessionId) },
  } as never)
  ctx.provide('conversation', {
    input: { for: (actx: { sessionId: SessionId }) => inputs.get(actx.sessionId) },
  } as never)
  if (over.noTriggers !== true) {
    ctx.provide('inputTriggers', {
      sessionOf: () => ({ menu }),
    } as never)
  }

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  let composer: HTMLTextAreaElement | null = null
  if (over.noComposer !== true) {
    composer = document.createElement('textarea')
    composer.setAttribute('data-dsh-composer', '')
    // The DOM value mirrors the starting draft so a nonzero caret can be
    // placed (the engine clamps the selection to the value length); the
    // plugin itself never reads the DOM value.
    composer.value = draft
    document.body.appendChild(composer)
    composer.focus()
    composer.setSelectionRange(0, 0)
  }

  const theBench: Bench = {
    ctx,
    fiber,
    composer,
    inputs,
    snapshots,
    list,
    menu,
    switchTo: (id: SessionId) => { list.set(listState(ids, id)) },
  }
  activeBench = theBench
  return theBench
}

/** Dispatch one keydown on the target and return the event for assertions. */
function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  // Ensure a clean document between tests.
  document.body.innerHTML = ''
})

afterEach(async () => {
  if (activeBench !== undefined) {
    await activeBench.fiber.dispose()
    activeBench = undefined
  }
  vi.restoreAllMocks()
})

describe('input-history-recall browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'conversation'])
  })

  it('recalls the newest sent message on ArrowUp at caret 0', async () => {
    const { composer, inputs } = await bench({ draft: 'wip' })
    const input = inputs.get('a' as SessionId)!
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledOnce()
    expect(input.setDraft).toHaveBeenCalledWith('second')
    expect(input.state.getSnapshot().draft).toBe('second')
  })

  it('walks older on repeated ArrowUp and restores the stashed draft via ArrowDown', async () => {
    const nodes = [message('user', 'a1'), assistantNode('r1'), message('steering', 'a2'), message('user', 'a3')]
    const { composer, inputs } = await bench({ draft: 'wip', nodes })
    const input = inputs.get('a' as SessionId)!
    for (const expected of ['a3', 'a2', 'a1']) {
      expect(press(composer!, 'ArrowUp').defaultPrevented).toBe(true)
      expect(input.state.getSnapshot().draft).toBe(expected)
    }
    for (const expected of ['a2', 'a3', 'wip']) {
      expect(press(composer!, 'ArrowDown').defaultPrevented).toBe(true)
      expect(input.state.getSnapshot().draft).toBe(expected)
    }
    expect(input.setDraft).toHaveBeenCalledTimes(6)
  })

  it('restores an empty pre-traversal draft as empty', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    const input = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('second')
    press(composer!, 'ArrowDown')
    expect(input.state.getSnapshot().draft).toBe('')
  })

  it('ignores ArrowUp when the caret is not at offset 0', async () => {
    const { composer, inputs } = await bench({ draft: 'hello' })
    composer!.setSelectionRange(2, 2)
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores ArrowUp when a selection is active', async () => {
    const { composer, inputs } = await bench({ draft: 'hello' })
    composer!.setSelectionRange(0, 2)
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('leaves ArrowDown to native behavior when not traversing', async () => {
    const { composer, inputs } = await bench({ draft: 'hello' })
    const event = press(composer!, 'ArrowDown')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores keys other than the arrows', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    const event = press(composer!, 'Enter')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys during IME composition (isComposing)', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    const event = press(composer!, 'ArrowUp', { isComposing: true })
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys during IME composition (legacy keyCode 229)', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    Object.defineProperty(event, 'keyCode', { value: 229 })
    composer!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when the composer is not focused', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when the composer is absent from the document', async () => {
    const { inputs } = await bench({ draft: '', noComposer: true })
    const event = press(document, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when there is no current session', async () => {
    const { composer, inputs } = await bench({ draft: '', noSession: true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when the scope does not resolve', async () => {
    const { composer, inputs } = await bench({ draft: '', scopeUndefined: true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when the session face does not resolve', async () => {
    const { composer, inputs } = await bench({ draft: '', sessionFaceUndefined: true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores arrow keys when the session is removed', async () => {
    const { composer, inputs } = await bench({ draft: '', removed: true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it("ignores arrow keys when a continuable child's parent is offline", async () => {
    const { composer, inputs } = await bench({ draft: '', parentOffline: true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('refuses recall while the input machine is submitting', async () => {
    const { composer, inputs } = await bench({ draft: '', phase: 'submitting' })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('refuses recall while the input machine is adjudicating', async () => {
    const { composer, inputs } = await bench({ draft: '', phase: 'adjudicating' })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('refuses recall while a command line is claimed', async () => {
    const { composer, inputs } = await bench({ draft: '', phase: 'claimed' })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('leaves the key to the candidate menu while it is open', async () => {
    const { composer, inputs } = await bench({ draft: '', menuOpen: true })
    let reachedComposer = false
    composer!.addEventListener('keydown', () => { reachedComposer = true })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
    expect(reachedComposer).toBe(true)
  })

  it('recalls without the input-trigger service composed', async () => {
    const { composer, inputs } = await bench({ draft: '', noTriggers: true })
    const input = inputs.get('a' as SessionId)!
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledWith('second')
  })

  it('ignores ArrowUp when the session has no sent history', async () => {
    const { composer, inputs } = await bench({ draft: '', nodes: [] })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('ignores ArrowUp when the history holds only image-only messages', async () => {
    const { composer, inputs } = await bench({ draft: '', nodes: [imageOnlyMessage(), assistantNode('r')] })
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
  })

  it('swallows ArrowUp at the oldest entry without changing the draft', async () => {
    const nodes = [message('user', 'x'), message('user', 'y')]
    const { composer, inputs } = await bench({ draft: '', nodes })
    const input = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('y')
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('x')
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(true)
    expect(input.state.getSnapshot().draft).toBe('x')
    expect(input.setDraft).toHaveBeenCalledTimes(2)
  })

  it('holds the displayed content when the history read comes back empty mid-traversal', async () => {
    const nodes = [message('user', 'x'), message('user', 'y')]
    const { composer, inputs, snapshots } = await bench({ draft: '', nodes })
    const input = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('y')
    snapshots.get('a' as SessionId)!.nodes = []
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledTimes(1)
    expect(input.state.getSnapshot().draft).toBe('y')
  })

  it('ends the traversal when the history read shrinks below the cursor', async () => {
    const nodes = [message('user', 'a'), message('user', 'b'), message('user', 'c')]
    const { composer, inputs, snapshots } = await bench({ draft: '', nodes })
    const input = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('c')
    snapshots.get('a' as SessionId)!.nodes = [message('user', 'a')]
    // The stale cursor (2) walks past the shrunk history end (1): the
    // traversal ends without a write and the key passes through.
    const event = press(composer!, 'ArrowUp')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).toHaveBeenCalledTimes(1)
    expect(input.state.getSnapshot().draft).toBe('c')
  })

  it('ends the traversal when the draft empties (a send)', async () => {
    const { composer, inputs } = await bench({ draft: 'wip' })
    const input = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    expect(input.state.getSnapshot().draft).toBe('second')
    // A successful send commits the draft away from the input machine.
    input.state.set({ draft: '', phase: 'plain' })
    const event = press(composer!, 'ArrowDown')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).toHaveBeenCalledTimes(1)
  })

  it('ends the traversal when the current session switches', async () => {
    const nodes = [message('user', 'one'), message('user', 'two')]
    const { composer, inputs, snapshots, switchTo } = await bench({ draft: '', nodes })
    snapshots.get('b' as SessionId)!.nodes = [message('user', 'bee1'), message('user', 'bee2')]
    const inputA = inputs.get('a' as SessionId)!
    press(composer!, 'ArrowUp')
    press(composer!, 'ArrowUp')
    expect(inputA.state.getSnapshot().draft).toBe('one')
    // Switch to b: the traversal slot dies with the current change.
    switchTo('b' as SessionId)
    const inputB = inputs.get('b' as SessionId)!
    expect(press(composer!, 'ArrowUp').defaultPrevented).toBe(true)
    expect(inputB.setDraft).toHaveBeenCalledWith('bee2')
    // Switch back to a: no traversal is live, so ArrowDown passes through.
    switchTo('a' as SessionId)
    expect(press(composer!, 'ArrowDown').defaultPrevented).toBe(false)
  })

  it('stops a claimed key from reaching the composer while letting passed keys through', async () => {
    const { composer, inputs } = await bench({ draft: '' })
    let reachedComposer = 0
    composer!.addEventListener('keydown', () => { reachedComposer += 1 })
    // A claimed key never reaches the composer's own handler.
    press(composer!, 'ArrowUp')
    expect(reachedComposer).toBe(0)
    // A key left to native handling does: the send-clear reset ends the
    // traversal, so the following ArrowDown passes through untouched.
    inputs.get('a' as SessionId)!.state.set({ draft: '', phase: 'plain' })
    press(composer!, 'ArrowDown')
    expect(reachedComposer).toBe(1)
  })

  it('fiber teardown removes the document listener (HMR safety)', async () => {
    const { ctx, fiber, composer, inputs } = await bench({ draft: '' })
    await fiber.dispose()
    press(composer!, 'ArrowUp')
    expect(inputs.get('a' as SessionId)!.setDraft).not.toHaveBeenCalled()
    expect(ctx).toBeDefined()
  })
})

describe('input-history-recall node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('input-history-recall invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(RecallInvariant)
    await fiber.await()
    expect(RecallInvariant.name).toBe('client-input-history-recall-invariant')
    expect(RecallInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
