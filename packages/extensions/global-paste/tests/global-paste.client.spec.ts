// @vitest-environment jsdom
/**
 * global-paste plugin halves: the browser entry's document-level paste
 * listener against faked sessions/conversation services (with fiber teardown
 * proving removal — HMR safety), the inert node entry, and the invariant
 * companion's ownership reservation.
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

/**
 * Dispatch a file drop onto the given target with a dataTransfer stub shaped as
 * the plugin's drop branch reads it (files + types). jsdom omits
 * DragEvent/DataTransfer, so the stub mirrors only what onDrop consumes.
 */
function dispatchDrop(files: readonly File[], target: EventTarget): Event {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true })
  target.dispatchEvent(event)
  return event
}

/** Dispatch a dragover over the given target; fileDrag toggles the 'Files' type. */
function dispatchDragOver(target: EventTarget, fileDrag: boolean): Event {
  const dataTransfer = { files: [], types: fileDrag ? ['Files'] : [], dropEffect: 'none' }
  const event = new Event('dragover', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true })
  target.dispatchEvent(event)
  return event
}

/** Let the drop's async read-and-inject continuation settle (file.text() is microtask-based). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
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
  card: HTMLElement
  composer: HTMLTextAreaElement
}

interface BenchOptions {
  readonly draft?: string
  readonly phase?: InputSnapshot['phase']
  readonly noSession?: boolean
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

  const ctx = new Context()
  ctx.provide('sessions', {
    list,
    scope: (id: SessionId) => id === SESSION ? ({ scopeOf: () => SESSION } as never) : undefined,
  } as never)
  ctx.provide('conversation', {
    input: { for: () => input },
  } as never)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  // Mount the composer card + textarea the plugin queries for. The card carries
  // data-composer-card so the file-drop listeners can locate the drop zone.
  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
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

  const bench: Bench = { ctx, fiber, input, card, composer }
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

  it('ignores paste when there is no current session', async () => {
    const { input } = await bench({ noSession: true })
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

  describe('text-file drop', () => {
    it('injects a single dropped text file as a "# name" block at the draft end', async () => {
      const { input, card, composer } = await bench({ draft: 'hello' })
      const file = new File(['world'], 'note.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], card)
      expect(event.defaultPrevented).toBe(true)
      await settle()
      expect(input.setDraft).toHaveBeenCalledOnce()
      expect(input.setDraft).toHaveBeenCalledWith('hello\n# note.txt\nworld')
      expect(document.activeElement).toBe(composer)
    })

    it('concatenates multiple dropped text files with blank-line separators', async () => {
      const { input, card } = await bench({ draft: '' })
      const a = new File(['alpha'], 'a.txt', { type: 'text/plain' })
      const b = new File(['beta'], 'b.md', { type: 'text/markdown' })
      const event = dispatchDrop([a, b], card)
      expect(event.defaultPrevented).toBe(true)
      await settle()
      expect(input.setDraft).toHaveBeenCalledWith('# a.txt\nalpha\n\n# b.md\nbeta')
    })

    it('recognizes a code file by extension when its MIME is not text/', async () => {
      const { input, card } = await bench({ draft: '' })
      const file = new File(['const x = 1'], 'app.ts', { type: '' })
      const event = dispatchDrop([file], card)
      expect(event.defaultPrevented).toBe(true)
      await settle()
      expect(input.setDraft).toHaveBeenCalledWith('# app.ts\nconst x = 1')
    })

    it('leaves a file with no extension and no MIME to native handling', async () => {
      const { input, card } = await bench({ draft: '' })
      const file = new File(['data'], 'noextension', { type: '' })
      const event = dispatchDrop([file], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves an image drop to the native intake', async () => {
      const { input, card } = await bench({ draft: '' })
      const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
      const event = dispatchDrop([image], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves a mixed text+image batch wholly to the native intake', async () => {
      const { input, card } = await bench({ draft: '' })
      const text = new File(['hi'], 'a.txt', { type: 'text/plain' })
      const image = new File([Uint8Array.of(1)], 'p.png', { type: 'image/png' })
      const event = dispatchDrop([text, image], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves an empty file drop to native handling', async () => {
      const { input, card } = await bench({ draft: '' })
      const event = dispatchDrop([], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves a drop outside the composer card to native handling', async () => {
      const { input } = await bench({ draft: '' })
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], document.body)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves a drop whose target is not an element to native handling', async () => {
      const { input } = await bench({ draft: '' })
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], document)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves a text-file drop through when there is no current session', async () => {
      const { input, card } = await bench({ draft: '', noSession: true })
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('leaves a text-file drop through while the machine is submitting', async () => {
      const { input, card } = await bench({ draft: '', phase: 'submitting' })
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], card)
      expect(event.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('abandons injection if the machine turns busy during the async read', async () => {
      const { input, card } = await bench({ draft: 'hello' })
      const file = new File(['world'], 'a.txt', { type: 'text/plain' })
      const event = dispatchDrop([file], card)
      // The takeover is decided synchronously (preventDefault), but the machine
      // flips to submitting before the async read settles — the injection bails.
      expect(event.defaultPrevented).toBe(true)
      input.state.set({ draft: 'hello', phase: 'submitting' })
      await settle()
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('still injects but skips focus if the composer unmounts during the read', async () => {
      const { input, card, composer } = await bench({ draft: '' })
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      dispatchDrop([file], card)
      composer.remove()
      await settle()
      expect(input.setDraft).toHaveBeenCalledOnce()
    })

    it('fires a synthetic window dragend on takeover to clear the composer overlay', async () => {
      const { card } = await bench({ draft: '' })
      const dragEnd = vi.fn()
      window.addEventListener('dragend', dragEnd)
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      dispatchDrop([file], card)
      expect(dragEnd).toHaveBeenCalledOnce()
      window.removeEventListener('dragend', dragEnd)
    })

    it('ignores drag events that carry no dataTransfer', async () => {
      const { input, card } = await bench({ draft: '' })
      const drop = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(drop, 'dataTransfer', { value: null, configurable: true })
      card.dispatchEvent(drop)
      expect(drop.defaultPrevented).toBe(false)
      const over = new Event('dragover', { bubbles: true, cancelable: true })
      Object.defineProperty(over, 'dataTransfer', { value: null, configurable: true })
      card.dispatchEvent(over)
      expect(over.defaultPrevented).toBe(false)
      expect(input.setDraft).not.toHaveBeenCalled()
    })

    it('takes over dragover on the composer card for a file drag', async () => {
      const { card } = await bench({ draft: '' })
      const event = dispatchDragOver(card, true)
      expect(event.defaultPrevented).toBe(true)
      expect((event as DragEvent).dataTransfer?.dropEffect).toBe('copy')
    })

    it('leaves dragover outside the composer card to native handling', async () => {
      await bench({ draft: '' })
      const event = dispatchDragOver(document.body, true)
      expect(event.defaultPrevented).toBe(false)
    })

    it('leaves a non-file dragover on the composer card to native handling', async () => {
      const { card } = await bench({ draft: '' })
      const event = dispatchDragOver(card, false)
      expect(event.defaultPrevented).toBe(false)
    })

    it('fiber teardown removes the drop listener (HMR safety)', async () => {
      const { fiber, input, card } = await bench({ draft: '' })
      await fiber.dispose()
      const file = new File(['hi'], 'a.txt', { type: 'text/plain' })
      dispatchDrop([file], card)
      await settle()
      expect(input.setDraft).not.toHaveBeenCalled()
    })
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
