// @vitest-environment jsdom
/**
 * long-text-fold browser half on a real cordis Context with fake sessions/
 * conversation faces and the real SlotRegistry/LocaleRuntime: the paste
 * takeover stages a threshold-crossing plain-text paste (focused: a
 * marker-only synthetic paste re-dispatched onto the composer so the upstream
 * PASTE_COMMAND inserts at the caret; unfocused: a draft-end setDraft append),
 * applies the storage fail-open (an unstaggable paste flows on natively plus
 * an error notice), and leaves every guard case to native handling — files or
 * mixed clips, below-threshold text, no session, busy machines, masked
 * composers, a foreign editable holding focus, its own forwarded events. The
 * capture keydown/click listeners restore staged markers to the full text
 * synchronously (Enter on the composer, the upstream-labeled primary button,
 * idempotent across the pair) while missing entries notify without blocking,
 * corrupted markers stay inert, and Shift/composition Enter never submits.
 * The dock renders staged cards and drives preview/remove; the preview popup
 * closes on an outside press; the chat renderer folds long texts into the
 * probe-marked card and mirrors the shipped bubble for short texts.
 * Registration disposal rides the plugin fiber (HMR safety). The node half
 * and the invariant companion are exercised over the same Context.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { en as conversationEn, zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { apply, inject } from '../src/client/index.ts'
import { LongTextFoldDock, PreviewPopup, type LongTextFoldDockInjected, type PreviewPopupProps } from '../src/client/dock.tsx'
import { LongTextFoldNodeView, type LongTextFoldNodeProps } from '../src/client/fold-view.tsx'
import type { StagedState } from '../src/client/staged-store.ts'
import { MAX_STAGED_BYTES, markerOf } from '../src/client/markers.ts'
import { en, zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'
import * as LongTextFoldInvariant from '../src/invariant.ts'

afterEach(cleanup)

const SESSION = 'session' as SessionId
const T = makeTranslate(zh)

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

/** A plain-text paste above the staging threshold. */
const LONG_TEXT = `${'long '.repeat(400)}end`
const MARKER_1 = markerOf(1)

/**
 * Dispatch a paste event with a clipboardData stub shaped as the plugin reads
 * it (jsdom omits ClipboardEvent/DataTransfer constructors).
 */
function dispatchPaste(text: string, opts: { files?: readonly File[]; forwarded?: boolean } = {}): ClipboardEvent {
  type Item = { kind: string; type?: string; getAsFile: () => File | null }
  const items: Item[] = (opts.files ?? []).map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))
  if (text !== '') items.push({ kind: 'string', type: 'text/plain', getAsFile: () => null })
  const dataTransfer = {
    getData: (type: string) => type === 'text/plain' ? text : '',
    items,
  }
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: dataTransfer, configurable: true })
  if (opts.forwarded === true) Object.defineProperty(event, 'dshLongTextForwarded', { value: true, configurable: true })
  document.dispatchEvent(event)
  return event
}

/**
 * jsdom omits DataTransfer and ClipboardEvent. Stub both globally so the
 * plugin's focused-forward path can construct and dispatch (global-paste
 * test precedent; setData backs the marker payload).
 */
function installClipboardConstructors(): void {
  type Item = { kind: string; type?: string; getAsFile: () => File | null }
  class FakeItemList extends Array<Item> {
    add(file: File): void { this.push({ kind: 'file', type: file.type, getAsFile: () => file }) }
  }
  class FakeDataTransfer {
    items = new FakeItemList()
    text = ''
    setData = (type: string, value: string): void => { if (type === 'text/plain') this.text = value }
    getData = (type: string): string => type === 'text/plain' ? this.text : ''
  }
  class FakeClipboardEvent extends Event {
    clipboardData: FakeDataTransfer
    constructor(type: string, init: EventInit & { clipboardData?: FakeDataTransfer } = {}) {
      super(type, init)
      this.clipboardData = init.clipboardData ?? new FakeDataTransfer()
    }
  }
  Object.defineProperty(globalThis, 'DataTransfer', { value: FakeDataTransfer, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'ClipboardEvent', { value: FakeClipboardEvent, configurable: true, writable: true })
}

/** Map-backed Storage stand-in with an injectable write-failure mode. */
class FakeStorage {
  private readonly map = new Map<string, string>()
  /** When true, every setItem throws QuotaExceededError (staged-store fail-open path). */
  failWrites = false

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new DOMException('quota exceeded', 'QuotaExceededError')
    this.map.set(key, value)
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}

let fake: FakeStorage

function installStorage(instance: FakeStorage): void {
  fake = instance
  Object.defineProperty(globalThis, 'localStorage', { value: instance, configurable: true, writable: true })
}

/**
 * The takeover's failure notices surface through the session-routed notify
 * seat; the exact copy depends on the runtime locale, so the level is pinned
 * exactly and the body against this package's two dictionaries.
 */
function expectErrorNotice(input: { notify: ReturnType<typeof vi.fn> }, key: 'error.storage' | 'error.missing'): void {
  expect(input.notify).toHaveBeenCalledOnce()
  expect(input.notify.mock.calls[0]?.[0]).toBe('error')
  expect([zh[key], en[key]]).toContain(String(input.notify.mock.calls[0]?.[1]))
}

interface InputSnapshot {
  draft: string
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

interface FakeInput {
  setDraft: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  state: ReturnType<typeof createSnapshotStore<InputSnapshot>>
}

interface BenchOptions {
  readonly draft?: string
  readonly phase?: InputSnapshot['phase']
  readonly noSession?: boolean
  readonly noComposer?: boolean
  readonly occluded?: boolean
  readonly removed?: boolean
  readonly parentOffline?: boolean
  /** Make every staged-store write refuse before the plugin boots. */
  readonly failStorage?: boolean
}

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  input: FakeInput
  composer: HTMLTextAreaElement | null
  locale: LocaleRuntime
  dockInject: () => LongTextFoldDockInjected
  stagedState: () => StagedState
}

// Track the active bench so its document listeners tear down between tests;
// jsdom shares one document across the suite, so a leaked listener from an
// earlier test would intercept a later test's events.
let activeBench: Bench | undefined

/**
 * Boot the browser half over a real Context with the real SlotRegistry and
 * LocaleRuntime (carrying the real upstream `conversation` dictionary the
 * submit-button labels match against), faked sessions/conversation services,
 * and a mounted composer the visibility probe sees.
 */
async function bench(over: BenchOptions = {}): Promise<Bench> {
  const draft = over.draft ?? ''
  const phase = over.phase ?? 'plain'
  const state = createSnapshotStore<InputSnapshot>({ draft, phase })
  // The fake mirrors the real facade: a setDraft write updates the state the
  // submit plane reads, so idempotency across a gesture is observable.
  const input: FakeInput = {
    setDraft: vi.fn((text: string) => { state.update((snapshot) => { snapshot.draft = text }) }),
    notify: vi.fn(),
    state,
  }
  const list = createSnapshotStore<SessionListState>(listState(over.noSession === true ? undefined : SESSION))
  const sessionSnapshot = {
    removed: over.removed === true,
    subagent: over.parentOffline === true
      ? { address: { parentSessionId: 'parent' as SessionId, childSessionId: SESSION, mode: 'continuable' }, parentAvailable: false }
      : null,
  }

  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, (() => null) as never)
  const locale = new LocaleRuntime(ctx)
  locale.register('conversation', { zh: conversationZh, en: conversationEn })
  ctx.provide('locale', locale)
  ctx.provide('sessions', {
    list,
    scope: (id: SessionId) => id === SESSION ? ({ scopeOf: () => SESSION } as never) : undefined,
    sessionOf: () => ({ getSnapshot: () => sessionSnapshot }),
  } as never)
  ctx.provide('conversation', {
    input: { for: () => input },
  } as never)

  if (over.failStorage === true) fake.failWrites = true

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  let composer: HTMLTextAreaElement | null = null
  if (over.noComposer !== true) {
    composer = document.createElement('textarea')
    composer.setAttribute('data-dsh-composer', '')
    composer.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 400, height: 30, right: 410, bottom: 40, x: 10, y: 10, toJSON: () => ({}),
    })
    document.body.appendChild(composer)
  }
  const mask = document.createElement('div')
  document.body.appendChild(mask)
  document.elementFromPoint = () => (over.occluded === true ? mask : composer)

  const dockInject = (): LongTextFoldDockInjected => {
    const entry = ctx.slots.entries('conversation.input.dock')[0]
    if (entry === undefined) throw new Error('dock entry not registered')
    return (entry.inject as unknown as (sessionId: SessionId) => LongTextFoldDockInjected)(SESSION)
  }
  const bench: Bench = {
    ctx,
    fiber,
    input,
    composer,
    locale,
    dockInject,
    stagedState: () => dockInject().hooks.staged.getSnapshot(),
  }
  activeBench = bench
  return bench
}

beforeEach(() => {
  document.body.innerHTML = ''
  installClipboardConstructors()
  installStorage(new FakeStorage())
})

afterEach(async () => {
  if (activeBench !== undefined) {
    await activeBench.fiber.dispose()
    activeBench = undefined
  }
  fake.failWrites = false
  vi.restoreAllMocks()
})

describe('long-text-fold browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'conversation', 'locale'])
  })
})

describe('long-text-fold paste takeover', () => {
  it('stages a focused long paste and forwards the marker to the composer', async () => {
    const { input, composer, stagedState } = await bench({ draft: 'keep' })
    composer!.focus()
    const dispatchSpy = vi.spyOn(composer!, 'dispatchEvent')
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(true)
    const staged = stagedState().bySession[SESSION] ?? []
    expect(staged).toHaveLength(1)
    expect(staged[0]!.chars).toBe(LONG_TEXT.length)
    // The marker went to the composer's own paste path, not the draft.
    const forwarded = dispatchSpy.mock.calls.find(([e]) => e.type === 'paste')
    expect(forwarded).toBeDefined()
    const forwardedData = (forwarded![0] as unknown as { clipboardData: { getData: (type: string) => string } }).clipboardData
    expect(forwardedData.getData('text/plain')).toBe(MARKER_1)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('appends the marker at the draft end when the composer is not focused', async () => {
    const { input, composer, stagedState } = await bench({ draft: 'keep' })
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(true)
    expect(input.setDraft).toHaveBeenCalledWith(`keep${MARKER_1}`)
    expect(stagedState().bySession[SESSION]).toHaveLength(1)
    expect(document.activeElement).toBe(composer)
  })

  it('leaves a short paste to native handling', async () => {
    const { input, stagedState } = await bench({ draft: 'keep' })
    const event = dispatchPaste('just a sentence')
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })

  it('leaves a clipboard carrying files wholly to native handling', async () => {
    const { input, stagedState } = await bench({ draft: 'keep' })
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchPaste(LONG_TEXT, { files: [image] })
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })

  it('leaves a paste through when there is no current session', async () => {
    const { input } = await bench({ noSession: true })
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('leaves a paste through while the machine is submitting', async () => {
    const { input } = await bench({ phase: 'submitting' })
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('leaves a paste through when the composer is occluded', async () => {
    const { input, stagedState } = await bench({ occluded: true })
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })

  it('honors a foreign editable holding focus', async () => {
    const { input, composer } = await bench({ draft: 'keep' })
    const foreign = document.createElement('textarea')
    document.body.appendChild(foreign)
    foreign.focus()
    expect(document.activeElement).toBe(foreign)
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(foreign)
    void composer
  })

  it('fails open when storage refuses: native flow plus an error notice', async () => {
    const { input, stagedState } = await bench({ failStorage: true })
    const event = dispatchPaste(LONG_TEXT)
    // The takeover did NOT stop the event, so the native paste (or
    // global-paste) still receives the full text.
    expect(event.defaultPrevented).toBe(false)
    expectErrorNotice(input, 'error.storage')
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })

  it('fails open when the text exceeds the staging ceiling', async () => {
    const { input, stagedState } = await bench({ draft: 'keep' })
    const oversized = 'x'.repeat(MAX_STAGED_BYTES + 1)
    const event = dispatchPaste(oversized)
    expect(event.defaultPrevented).toBe(false)
    expectErrorNotice(input, 'error.storage')
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })

  it('ignores its own forwarded marker paste', async () => {
    const { input, stagedState } = await bench({ draft: 'keep' })
    const event = dispatchPaste(LONG_TEXT, { forwarded: true })
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(stagedState().bySession[SESSION]).toBeUndefined()
  })
})

describe('long-text-fold submit interception', () => {
  it('restores the staged text synchronously on Enter', async () => {
    const { input, composer } = await bench({ draft: 'keep' })
    dispatchPaste(LONG_TEXT)
    expect(input.state.getSnapshot().draft).toBe(`keep${MARKER_1}`)
    composer!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(input.setDraft).toHaveBeenCalledWith(`keep${LONG_TEXT}`)
    expect(input.notify).not.toHaveBeenCalled()
    expect(input.state.getSnapshot().draft).toBe(`keep${LONG_TEXT}`)
  })

  it('notifies without blocking when the staged entry is missing', async () => {
    const { input, composer } = await bench({ draft: `x ${markerOf(42)} y` })
    composer!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(input.setDraft).not.toHaveBeenCalled()
    expectErrorNotice(input, 'error.missing')
  })

  it('keeps a corrupted marker inert', async () => {
    const { input, composer } = await bench({ draft: '[LongText#1 ] loose' })
    composer!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(input.setDraft).not.toHaveBeenCalled()
    expect(input.notify).not.toHaveBeenCalled()
  })

  it('restores on a click of the upstream-labeled primary button', async () => {
    const b = await bench({ draft: 'keep' })
    const { input } = b
    dispatchPaste(LONG_TEXT)
    const button = document.createElement('button')
    // The label comes from the same locale seat the plugin matches against,
    // so the pin is the matching mechanism, not one locale's copy.
    button.setAttribute('aria-label', b.locale.bind('conversation')('input.send'))
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(input.setDraft).toHaveBeenCalledWith(`keep${LONG_TEXT}`)
  })

  it('ignores clicks on buttons with other labels', async () => {
    const { input } = await bench({ draft: `x ${MARKER_1}` })
    const button = document.createElement('button')
    button.setAttribute('aria-label', conversationZh['input.commands'])
    document.body.appendChild(button)
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('never expands on Shift+Enter', async () => {
    const { input, composer } = await bench({ draft: `x ${MARKER_1}` })
    composer!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('never expands during IME composition', async () => {
    const { input, composer } = await bench({ draft: `x ${MARKER_1}` })
    composer!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
    expect(input.setDraft).not.toHaveBeenCalled()
  })

  it('is idempotent across the keydown+click pair of one gesture', async () => {
    const b = await bench({ draft: 'keep' })
    const { input } = b
    dispatchPaste(LONG_TEXT)
    const button = document.createElement('button')
    button.setAttribute('aria-label', b.locale.bind('conversation')('input.send'))
    document.body.appendChild(button)
    button.focus()
    // Call 1: the takeover's marker append. Call 2: the keydown expansion.
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(input.setDraft).toHaveBeenCalledTimes(2)
    // Call 3 never happens: the draft no longer carries a marker, so the
    // synthetic click's expansion pass is a no-op.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(input.setDraft).toHaveBeenCalledTimes(2)
    expect(input.setDraft).toHaveBeenLastCalledWith(`keep${LONG_TEXT}`)
  })

  it('fiber teardown removes the listeners and the dock entry (HMR safety)', async () => {
    const { ctx, fiber, input } = await bench({ draft: 'keep' })
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(1)
    await fiber.dispose()
    activeBench = undefined
    expect(ctx.slots.entries('conversation.input.dock')).toHaveLength(0)
    const event = dispatchPaste(LONG_TEXT)
    expect(event.defaultPrevented).toBe(false)
    expect(input.setDraft).not.toHaveBeenCalled()
  })
})

describe('LongTextFoldDock component', () => {
  interface DockOverrides {
    readonly bySession?: StagedState['bySession']
    readonly preview?: ReturnType<typeof vi.fn>
    readonly remove?: ReturnType<typeof vi.fn>
  }

  function dockProps(over: DockOverrides = {}): LongTextFoldDockProps {
    const store = createSnapshotStore<StagedState>({ bySession: over.bySession ?? {} })
    return {
      sessionId: SESSION,
      preview: over.preview ?? vi.fn(),
      remove: over.remove ?? vi.fn(),
      useStaged: selector => selector(store.getSnapshot()),
      t: T,
    } as LongTextFoldDockProps
  }

  it('renders nothing when the session has no staged entries', () => {
    const { container } = render(<LongTextFoldDock {...dockProps()} />)
    expect(container.querySelector('[data-long-text-fold-dock]')).toBeNull()
  })

  it('renders one card per staged entry with preview and meta', () => {
    const { container } = render(<LongTextFoldDock {...dockProps({
      bySession: { [SESSION]: [{ seq: 3, preview: 'error log head', chars: 4321, lines: 88 }] },
    })} />)
    const dock = container.querySelector('[data-long-text-fold-dock]')
    expect(dock).not.toBeNull()
    expect(dock!.textContent).toContain('error log head')
    expect(dock!.textContent).toContain(T('card.meta', { chars: 4321, lines: 88 }))
  })

  it('drives preview and remove through the card buttons', () => {
    const preview = vi.fn()
    const remove = vi.fn()
    const { getByRole } = render(<LongTextFoldDock {...dockProps({
      bySession: { [SESSION]: [{ seq: 5, preview: 'entry', chars: 10, lines: 1 }] },
      preview,
      remove,
    })} />)
    fireEvent.click(getByRole('button', { name: T('card.preview') }))
    expect(preview).toHaveBeenCalledWith(5)
    fireEvent.click(getByRole('button', { name: T('card.remove') }))
    expect(remove).toHaveBeenCalledWith(5)
  })
})

describe('PreviewPopup component', () => {
  function previewProps(over: {
    request: PreviewRequest | null
    text?: (sessionId: SessionId, seq: number) => string | undefined
    close?: ReturnType<typeof vi.fn>
  }): PreviewPopupProps {
    const store = createSnapshotStore<PreviewRequest | null>(over.request)
    return {
      useRequest: selector => selector(store.getSnapshot()),
      text: over.text ?? (() => 'the full staged text'),
      close: over.close ?? vi.fn(),
      t: T,
    } as PreviewPopupProps
  }

  it('renders nothing without a request', () => {
    const { container } = render(<PreviewPopup {...previewProps({ request: null })} />)
    expect(container.querySelector('[data-long-text-fold-preview]')).toBeNull()
  })

  it('shows the staged text and closes on an outside press', () => {
    const close = vi.fn()
    const { container } = render(<PreviewPopup {...previewProps({ request: { sessionId: SESSION, seq: 2 }, close })} />)
    const panel = container.querySelector('[data-long-text-fold-preview]')
    expect(panel).not.toBeNull()
    expect(panel!.textContent).toContain('the full staged text')
    fireEvent.pointerDown(document.body)
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('LongTextFoldNodeView component', () => {
  const openFile = vi.fn()
  const openSkill = vi.fn()
  const renderMessageImages = vi.fn(() => <div data-testid="images" />)

  function nodeProps(content: readonly unknown[], over: {
    referenceLabels?: readonly string[]
  } = {}): LongTextFoldNodeProps {
    return {
      node: { data: { content, time: 1_700_000_000_000, referenceLabels: over.referenceLabels, skillNames: undefined } },
      renderMessageImages,
      openFile,
      openSkill,
      t: T,
    } as LongTextFoldNodeProps
  }

  it('folds a long text into the probe-marked card and expands on click', () => {
    const long = 'word '.repeat(600)
    const { container } = render(<LongTextFoldNodeView {...nodeProps([{ type: 'text', text: long }])} />)
    const card = container.querySelector('[data-long-text-fold="card"]')
    expect(card).not.toBeNull()
    expect(card!.textContent).toContain('word')
    expect(container.textContent).not.toContain(long.trim())
    fireEvent.click(card!.querySelector('button')!)
    expect(container.querySelector('[data-long-text-fold="expanded"]')).not.toBeNull()
    expect(container.textContent).toContain(long.trim())
  })

  it('renders a short text as the shipped bubble shape without the probe', () => {
    const { container } = render(<LongTextFoldNodeView {...nodeProps([{ type: 'text', text: 'short answer' }])} />)
    expect(container.querySelector('[data-long-text-fold]')).toBeNull()
    expect(container.textContent).toContain('short answer')
  })

  it('renders a file attachment as the file card', () => {
    const { container } = render(<LongTextFoldNodeView {...nodeProps([
      { type: 'file', attachment: { attachmentId: 'sha256:aa', name: 'report.pdf', bytes: 2048 } },
      { type: 'text', text: 'see attached' },
    ])} />)
    const fileRow = container.querySelector('[data-message-attachments]')
    expect(fileRow).not.toBeNull()
    expect(fileRow!.textContent).toContain('report.pdf')
    expect(fileRow!.textContent).toContain('PDF')
  })

  it('renders the mirrored reference summary for labeled messages', () => {
    const { container } = render(<LongTextFoldNodeView {...nodeProps(
      [{ type: 'text', text: 'short' }],
      { referenceLabels: ['alpha', 'beta'] },
    )} />)
    expect(container.textContent).toContain(T('reference.summary', { labels: 'alpha、beta' }))
  })
})

describe('long-text-fold node half and invariant companion', () => {
  it('contributes no host behavior', () => {
    expect(() => nodeApply()).not.toThrow()
  })

  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(LongTextFoldInvariant)
    await fiber.await()
    expect(LongTextFoldInvariant.name).toBe('client-long-text-fold-invariant')
    expect(LongTextFoldInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
