// @vitest-environment jsdom
/**
 * global-paste plugin halves: the browser entry's document-level paste
 * listener against faked sessions/conversation services (with fiber teardown
 * proving removal — HMR safety), the inert node entry, and the invariant
 * companion's ownership reservation. Locked sessions (removed, an offline
 * continuable parent) ignore pastes like the composer's own read-only states.
 * A browser whose synthetic clipboard constructors throw fails soft: text
 * routing survives a mixed paste and an image-only paste falls to native
 * handling. Text-file drops are owned by the companion text-file-cards plugin
 * and tested there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as GlobalPasteInvariant from '../src/invariant.ts'

/** A clipboard paste event carrying the given text, dispatched on document. */
function dispatchPaste(text: string, opts: { files?: readonly File[] } = {}): ClipboardEvent {
  // jsdom omits DataTransfer/ClipboardEvent constructors, so build a plain
  // event with a clipboardData stub shaped exactly as the plugin reads it.
  type Item = { kind: string; type?: string; getAsFile: () => File | null }
  const items: Item[] = (opts.files ?? []).map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))
  if (text !== '') items.push({ kind: 'string', type: 'text/plain', getAsFile: () => null })
  const dataTransfer = {
    getData: (type: string) => type === 'text/plain' ? text : '',
    items,
  }
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: dataTransfer, configurable: true })
  document.dispatchEvent(event)
  return event
}

/**
 * jsdom omits DataTransfer and ClipboardEvent. Stub both globally so the
 * plugin's forwardImagePaste path can construct and dispatch. The forwarded
 * DataTransfer mirrors the same items shape dispatchPaste uses; ClipboardEvent
 * carries it through to the composer's listener.
 */
function installClipboardConstructors(): void {
  type Item = { kind: string; type?: string; getAsFile: () => File | null }
  // A DataTransferItemList-like object: array-indexed plus add() and iteration.
  class FakeItemList extends Array<Item> {
    add(file: File): void { this.push({ kind: 'file', type: file.type, getAsFile: () => file }) }
  }
  class FakeDataTransfer {
    items = new FakeItemList()
    getData = () => ''
  }
  class FakeClipboardEvent extends Event {
    clipboardData: { items: FakeItemList; getData: () => string }
    constructor(type: string, init: EventInit & { clipboardData?: { items: FakeItemList; getData: () => string } } = {}) {
      super(type, init)
      this.clipboardData = init.clipboardData ?? { items: new FakeItemList(), getData: () => '' }
    }
  }
  Object.defineProperty(globalThis, 'DataTransfer', { value: FakeDataTransfer, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'ClipboardEvent', { value: FakeClipboardEvent, configurable: true, writable: true })
}

/** Build a session list snapshot with one current session. */
function listState(current: SessionId | undefined): SessionListState {
  return {
    ids: current === undefined ? [] : [current],
    byId: {},
    current,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

interface FakeInput {
  setDraft: ReturnType<typeof vi.fn>
  state: ReturnType<typeof createSnapshotStore<InputSnapshot>>
}

interface InputSnapshot {
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  input: FakeInput
  composer: HTMLTextAreaElement
}

interface BenchOptions {
  readonly draft?: string
  readonly phase?: InputSnapshot['phase']
  readonly noSession?: boolean
  readonly removed?: boolean
  readonly parentOffline?: boolean
}

/** Mutable fake of the session-level lock facts the plugin's alignment reads. */
interface SessionLockSnapshot {
  removed: boolean
  subagent: {
    address: { parentSessionId: SessionId; childSessionId: SessionId; mode: 'continuable' }
    parentAvailable: boolean
  } | null
}

// Track the active bench so its document listener is torn down between tests;
// jsdom shares one document across the suite, so a leaked listener from an
// earlier test would intercept a later test's paste and preventDefault it.
let activeBench: Bench | undefined

/**
 * Boot the browser half over a real Context with faked sessions and
 * conversation services. The composer textarea is mounted into the document so
 * the plugin's elementFromPoint visibility probe sees it.
 */
async function bench(over: BenchOptions = {}): Promise<Bench> {
  const SESSION = 'session' as SessionId
  const draft = over.draft ?? ''
  const phase = over.phase ?? 'plain'
  const input: FakeInput = {
    setDraft: vi.fn(),
    state: createSnapshotStore<InputSnapshot>({ draft, phase }),
  }
  const list = createSnapshotStore<SessionListState>(listState(over.noSession === true ? undefined : SESSION))
  const sessionSnapshot: SessionLockSnapshot = {
    removed: over.removed === true,
    subagent: over.parentOffline === true
      ? { address: { parentSessionId: 'parent' as SessionId, childSessionId: SESSION, mode: 'continuable' }, parentAvailable: false }
      : null,
  }

  const ctx = new Context()
  ctx.provide('sessions', {
    list,
    scope: (id: SessionId) => id === SESSION ? ({ scopeOf: () => SESSION } as never) : undefined,
    sessionOf: () => ({ getSnapshot: () => sessionSnapshot }),
  } as never)
  ctx.provide('conversation', {
    input: { for: () => input },
  } as never)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  // Mount the composer textarea the plugin queries for, inside a container
  // standing in for the composer card.
  const card = document.createElement('div')
  const composer = document.createElement('textarea')
  composer.setAttribute('data-dsh-composer', '')
  composer.getBoundingClientRect = () => ({
    left: 10, top: 10, width: 400, height: 30, right: 410, bottom: 40, x: 10, y: 10, toJSON: () => ({}),
  })
  card.appendChild(composer)
  document.body.appendChild(card)
  // jsdom does not implement elementFromPoint; define it to return the composer
  // (visible, not occluded) so the plugin's visibility probe passes.
  document.elementFromPoint = () => composer

  const bench: Bench = { ctx, fiber, input, composer }
  activeBench = bench
  return bench
}

beforeEach(() => {
  // Ensure a clean document between tests.
  document.body.innerHTML = ''
  installClipboardConstructors()
})

afterEach(async () => {
  if (activeBench !== undefined) {
    await activeBench.fiber.dispose()
    activeBench = undefined
  }
  vi.restoreAllMocks()
})

/**
 * Install a DataTransfer constructor that throws, standing in for old Safari
 * where `new DataTransfer()` raises TypeError.
 */
function installThrowingDataTransfer(): void {
  function ThrowingDataTransfer(): never {
    throw new TypeError('not constructible')
  }
  Object.defineProperty(globalThis, 'DataTransfer', { value: ThrowingDataTransfer, configurable: true, writable: true })
}

describe('global-paste browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'conversation'])
  })

  it('routes whole-page text paste to the draft end', async () => {
    const { input } = await bench({ draft: 'hello' })
    const event = dispatchPaste(' world')
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledOnce()
    expect(input.setDraft).toHaveBeenCalledWith('hello world')
  })

  it('ignores paste with no text and no files', async () => {
    const { input } = await bench({ draft: 'hello' })
    const event = dispatchPaste('')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('forwards image-only paste onto the composer (no text duplication)', async () => {
    const { input } = await bench({ draft: 'hello' })
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-dsh-composer]')!
    const dispatchSpy = vi.spyOn(composer, 'dispatchEvent')
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchPaste('', { files: [image] })
    expect(event.defaultPrevented).toBe(true)
    // The image path forwards via a re-dispatched paste event; setDraft (text)
    // is not called because there is no text.
    expect(input.setDraft).not.toHaveBeenCalled()
    // A paste event was dispatched onto the composer (dispatchEvent takes one arg).
    const forwarded = dispatchSpy.mock.calls.find(([e]) => e.type === 'paste')
    expect(forwarded).toBeDefined()
    // The composer is now focused.
    expect(document.activeElement).toBe(composer)
  })

  it('splits a mixed paste: text to setDraft, images forwarded to the composer', async () => {
    const { input } = await bench({ draft: 'hello' })
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-dsh-composer]')!
    const dispatchSpy = vi.spyOn(composer, 'dispatchEvent')
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchPaste(' world', { files: [image] })
    expect(event.defaultPrevented).toBe(true)
    // Text routed through the public service.
    expect(input.setDraft).toHaveBeenCalledWith('hello world')
    // Image forwarded onto the composer.
    const forwarded = dispatchSpy.mock.calls.find(([e]) => e.type === 'paste')
    expect(forwarded).toBeDefined()
  })

  it('keeps text routing alive when the synthetic clipboard constructor throws', async () => {
    const { input } = await bench({ draft: 'hello' })
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-dsh-composer]')!
    installThrowingDataTransfer()
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchPaste(' world', { files: [image] })
    // The text half still routes and takes over the paste for it.
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledWith('hello world')
    // The fallback focuses the composer since the forward did not.
    expect(document.activeElement).toBe(composer)
  })

  it('leaves an image-only paste to native handling when the constructor throws', async () => {
    const { input } = await bench({ draft: 'hello' })
    installThrowingDataTransfer()
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchPaste('', { files: [image] })
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('ignores paste when there is no current session', async () => {
    const { input } = await bench({ noSession: true })
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('ignores paste when the session is removed', async () => {
    const { input } = await bench({ removed: true })
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it("ignores paste when a continuable child's parent is offline", async () => {
    const { input } = await bench({ parentOffline: true })
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('ignores paste while the input machine is submitting', async () => {
    const { input } = await bench({ phase: 'submitting' })
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('ignores paste while the input machine is adjudicating', async () => {
    const { input } = await bench({ phase: 'adjudicating' })
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('lets the composer handle paste when it is already focused (no double-insert)', async () => {
    const { input } = await bench({ draft: 'hello' })
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-dsh-composer]')!
    composer.focus()
    expect(document.activeElement).toBe(composer)
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('does not hijack paste focused on another editable element', async () => {
    const { input } = await bench({ draft: 'hello' })
    const other = document.createElement('input')
    document.body.appendChild(other)
    other.focus()
    const event = dispatchPaste('text')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('focuses the composer after routing a whole-page paste', async () => {
    await bench({ draft: '' })
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-dsh-composer]')!
    expect(document.activeElement).not.toBe(composer)
    dispatchPaste('text')
    expect(document.activeElement).toBe(composer)
  })

  it('fiber teardown removes the document listener (HMR safety)', async () => {
    const { ctx, fiber, input } = await bench({ draft: '' })
    await fiber.dispose()
    // After teardown, a paste no longer reaches the input facade.
    dispatchPaste('text')
    expect(input.setDraft).not.toHaveBeenCalled()
    // The Context is still usable (provide stayed intact; only the listener left).
    expect(ctx).toBeDefined()
  })
})

describe('global-paste node half', () => {
  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })
})

describe('global-paste invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(GlobalPasteInvariant)
    await fiber.await()
    expect(GlobalPasteInvariant.name).toBe('client-global-paste-invariant')
    expect(GlobalPasteInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
