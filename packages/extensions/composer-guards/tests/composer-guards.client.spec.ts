// @vitest-environment jsdom
/**
 * composer-guards browser half: the shared composer predicates against faked
 * sessions/conversation services — the visibility probe's occlusion branches,
 * the session-level lock matrix, and the editable-input resolution's guard
 * order — plus the inert node entry and the invariant companion's ownership
 * reservation.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionFace, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, composerVisible, resolveEditableInput, sessionAcceptsEdits } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as ComposerGuardsInvariant from '../src/invariant.ts'

const SESSION = 'session' as SessionId

/** Mutable fake of the session-level lock facts the guards read. */
interface SessionLockSnapshot {
  removed: boolean
  subagent: {
    address: { parentSessionId: SessionId; childSessionId: SessionId; mode: 'one-shot' | 'continuable' }
    parentAvailable: boolean
  } | null
}

interface InputSnapshot {
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

/** One subagent lock fact as the session snapshot reports it. */
function subagent(mode: 'one-shot' | 'continuable', parentAvailable: boolean): SessionLockSnapshot['subagent'] {
  return {
    address: { parentSessionId: 'parent' as SessionId, childSessionId: SESSION, mode },
    parentAvailable,
  }
}

/** A session face resolving to the given lock snapshot. */
function face(snapshot: SessionLockSnapshot): SessionFace {
  return { getSnapshot: () => snapshot } as unknown as SessionFace
}

/** Default composer rect: 100x30 at (0,0), fully inside the viewport. */
const RECT = { left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30, x: 0, y: 0 }

/**
 * Mount a composer textarea with the given rect overrides; every visibility
 * probe answers through `hit`, which receives the probed center.
 */
function mountComposer(
  rect: Partial<DOMRect>,
  hit: (cx: number, cy: number) => Element | null,
): HTMLTextAreaElement {
  const composer = document.createElement('textarea')
  composer.getBoundingClientRect = () => ({ ...RECT, ...rect, toJSON: () => ({}) })
  document.body.appendChild(composer)
  document.elementFromPoint = (cx: number, cy: number) => hit(cx, cy)
  return composer
}

interface BenchOptions {
  readonly phase?: InputSnapshot['phase']
  readonly noSession?: boolean
  readonly noScope?: boolean
  readonly noFace?: boolean
  readonly removed?: boolean
  readonly parentOffline?: boolean
  readonly ids?: SessionId[]
}

/** Build a client root-context fake over the given session and input facts. */
function bench(over: BenchOptions = {}) {
  const input = { state: createSnapshotStore<InputSnapshot>({ draft: 'draft', phase: over.phase ?? 'plain' }) }
  const list = createSnapshotStore<SessionListState>({
    ids: over.ids ?? (over.noSession === true ? [] : [SESSION]),
    byId: {},
    current: over.noSession === true ? undefined : SESSION,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  })
  const sessionSnapshot: SessionLockSnapshot = {
    removed: over.removed === true,
    subagent: over.parentOffline === true ? subagent('continuable', false) : null,
  }
  const ctx = {
    sessions: {
      list,
      scope: (id: SessionId) => over.noScope === true || id !== SESSION ? undefined : ({ scopeOf: () => SESSION } as never),
      sessionOf: () => over.noFace === true ? undefined : face(sessionSnapshot),
    },
    conversation: { input: { for: () => input } },
  } as unknown as ClientContext
  return { ctx, input, list }
}

beforeEach(() => {
  // Ensure a clean document between tests.
  document.body.innerHTML = ''
})

describe('composerVisible', () => {
  it('rejects a zero-size composer (collapsed dock)', () => {
    const composer = mountComposer({ width: 0, right: 0 }, () => composer)
    expect(composerVisible(composer)).toBe(false)
  })

  it('rejects a composer whose center is left of the viewport', () => {
    const composer = mountComposer({ left: -200, x: -200, right: -100 }, () => composer)
    expect(composerVisible(composer)).toBe(false)
  })

  it('rejects a composer whose center is below the viewport', () => {
    const top = window.innerHeight + 10
    const composer = mountComposer({ top, y: top, bottom: top + 30 }, () => composer)
    expect(composerVisible(composer)).toBe(false)
  })

  it('rejects a composer whose center is above the viewport', () => {
    const composer = mountComposer({ top: -40, y: -40, bottom: -10 }, () => composer)
    expect(composerVisible(composer)).toBe(false)
  })

  it('rejects a composer whose center is right of the viewport', () => {
    const left = window.innerWidth + 10
    const composer = mountComposer({ left, x: left, right: left + 100 }, () => composer)
    expect(composerVisible(composer)).toBe(false)
  })

  it('rejects a composer whose center probe hits nothing', () => {
    const composer = mountComposer({}, () => null)
    expect(composerVisible(composer)).toBe(false)
  })

  it('accepts a composer the probe hits directly at its center', () => {
    const composer = mountComposer({}, (cx, cy) => cx === 50 && cy === 15 ? composer : null)
    expect(composerVisible(composer)).toBe(true)
  })

  it('accepts a composer whose probe lands on a descendant inside it', () => {
    const composer = mountComposer({}, () => composer)
    const child = document.createElement('span')
    composer.appendChild(child)
    document.elementFromPoint = () => child
    expect(composerVisible(composer)).toBe(true)
  })

  it('accepts a composer whose probe lands on an ancestor (the dock card)', () => {
    const card = document.createElement('div')
    const composer = mountComposer({}, () => card)
    card.appendChild(composer)
    expect(composerVisible(composer)).toBe(true)
  })
})

describe('sessionAcceptsEdits', () => {
  it('rejects a removed session', () => {
    expect(sessionAcceptsEdits(face({ removed: true, subagent: null }))).toBe(false)
  })

  it('accepts a plain live session', () => {
    expect(sessionAcceptsEdits(face({ removed: false, subagent: null }))).toBe(true)
  })

  it('accepts a continuable child whose exact parent is available', () => {
    expect(sessionAcceptsEdits(face({ removed: false, subagent: subagent('continuable', true) }))).toBe(true)
  })

  it('rejects a continuable child whose exact parent is offline', () => {
    expect(sessionAcceptsEdits(face({ removed: false, subagent: subagent('continuable', false) }))).toBe(false)
  })

  it('accepts a one-shot child regardless of parent availability', () => {
    expect(sessionAcceptsEdits(face({ removed: false, subagent: subagent('one-shot', false) }))).toBe(true)
  })
})

describe('resolveEditableInput', () => {
  it('returns undefined with no current session', () => {
    expect(resolveEditableInput(bench({ noSession: true }).ctx)).toBeUndefined()
  })

  it('returns undefined when the scope does not resolve', () => {
    expect(resolveEditableInput(bench({ noScope: true }).ctx)).toBeUndefined()
  })

  it('returns undefined when the session face does not resolve', () => {
    expect(resolveEditableInput(bench({ noFace: true }).ctx)).toBeUndefined()
  })

  it('returns undefined when the session is removed', () => {
    expect(resolveEditableInput(bench({ removed: true }).ctx)).toBeUndefined()
  })

  it("returns undefined when a continuable child's parent is offline", () => {
    expect(resolveEditableInput(bench({ parentOffline: true }).ctx)).toBeUndefined()
  })

  it('returns undefined while the input machine is submitting', () => {
    expect(resolveEditableInput(bench({ phase: 'submitting' }).ctx)).toBeUndefined()
  })

  it('returns undefined while the input machine is adjudicating', () => {
    expect(resolveEditableInput(bench({ phase: 'adjudicating' }).ctx)).toBeUndefined()
  })

  it('resolves while the input machine holds a claimed command line', () => {
    expect(resolveEditableInput(bench({ phase: 'claimed' }).ctx)).toBeDefined()
  })

  it('resolves the input facade with its state snapshot and session context', () => {
    const { ctx, input } = bench()
    const resolved = resolveEditableInput(ctx)
    expect(resolved?.input).toBe(input)
    expect(resolved?.state.draft).toBe('draft')
    expect(resolved?.state.phase).toBe('plain')
    expect(resolved?.sessionId).toBe(SESSION)
    expect(resolved?.liveSessionIds).toEqual([SESSION])
  })

  it('carries the live session-id list for staged-state pruning', () => {
    const other = 'other' as SessionId
    const { ctx } = bench({ ids: [SESSION, other] })
    expect(resolveEditableInput(ctx)?.liveSessionIds).toEqual([SESSION, other])
  })
})

describe('composer-guards halves', () => {
  it('contributes no browser behavior of its own', () => {
    expect(apply).not.toThrow()
  })

  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('composer-guards invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(ComposerGuardsInvariant)
    await fiber.await()
    expect(ComposerGuardsInvariant.name).toBe('client-composer-guards-invariant')
    expect(ComposerGuardsInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
