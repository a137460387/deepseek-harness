// @vitest-environment jsdom
/**
 * text-file-cards browser half on a real cordis Context with fake sessions/
 * conversation faces and the real SlotRegistry/LocaleRuntime: the drop
 * listener stages pure text-file batches as card state (never the draft),
 * applies the size/batch ceilings with input notices, leaves images, mixed
 * batches, busy machines, masked composers, removed sessions, offline
 * continuable children, a null dataTransfer, and an empty batch to native
 * handling, and the dock's inject face expands a card into the draft or
 * unstages it (a rejected read fails soft with the card kept; a machine that
 * turns busy during the read abandons the expansion; a composer unmounted
 * during the read still gets the draft edit without the focus; an
 * empty-content file expands to a header-only block). The dock component
 * renders the staged
 * row (empty renders nothing). Registration disposal rides the plugin fiber
 * (HMR safety). The node half and the invariant companion are exercised over
 * the same Context.
 */
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry, createSnapshotStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { TextFileCardsDock, type TextFileCardsDockProps, type TextFileCardsInjected } from '../src/client/TextFileCardsDock.tsx'
import type { StagedFilesState } from '../src/client/text-files.ts'
import { MAX_BATCH_FILES, MAX_FILE_BYTES } from '../src/client/text-files.ts'
import { zh } from '../src/client/locales.ts'
import { apply as nodeApply } from '../src/index.ts'
import * as TextFileCardsInvariant from '../src/invariant.ts'

afterEach(cleanup)

const SESSION = 'session' as SessionId

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

/**
 * Dispatch a file drop onto the given target with a dataTransfer stub shaped
 * as the plugin's drop branch reads it. jsdom omits DragEvent/DataTransfer, so
 * the stub mirrors only what onDrop consumes.
 */
function dispatchDrop(files: readonly File[], target: EventTarget): Event {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' }
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer, configurable: true })
  target.dispatchEvent(event)
  return event
}

/** Let the staging continuation settle (File metadata reads are microtask-based). */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
}

interface FakeInput {
  setDraft: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  state: ReturnType<typeof createSnapshotStore<InputSnapshot>>
}

interface InputSnapshot {
  readonly draft: string
  readonly phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
}

interface BenchOptions {
  readonly draft?: string
  readonly phase?: InputSnapshot['phase']
  readonly noSession?: boolean
  readonly noComposer?: boolean
  readonly occluded?: boolean
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

interface Bench {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  input: FakeInput
  composer: HTMLTextAreaElement | null
  sessionSnapshot: SessionLockSnapshot
  face: () => TextFileCardsInjected
  stagedState: () => StagedFilesState
}

/**
 * Boot the browser half over a real Context with the real SlotRegistry and
 * LocaleRuntime, faked sessions/conversation services, and a mounted composer
 * textarea the visibility probe sees (unless the option masks or omits it).
 */
async function bench(over: BenchOptions = {}): Promise<Bench> {
  const draft = over.draft ?? ''
  const phase = over.phase ?? 'plain'
  const input: FakeInput = {
    setDraft: vi.fn(),
    notify: vi.fn(),
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
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root', children: {
      'conversation.input.dock': { kind: 'list', scope: 'session' },
    },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
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

  let composer: HTMLTextAreaElement | null = null
  if (over.noComposer !== true) {
    composer = document.createElement('textarea')
    composer.setAttribute('data-dsh-composer', '')
    composer.getBoundingClientRect = () => ({
      left: 10, top: 10, width: 400, height: 30, right: 410, bottom: 40, x: 10, y: 10, toJSON: () => ({}),
    })
    document.body.appendChild(composer)
  }
  // jsdom does not implement elementFromPoint; the occluded option reports a
  // disjoint mask element so the visibility probe fails.
  const mask = document.createElement('div')
  document.body.appendChild(mask)
  document.elementFromPoint = () => (over.occluded === true ? mask : composer)

  return {
    ctx,
    fiber,
    input,
    composer,
    sessionSnapshot,
    face: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) throw new Error('dock entry not registered')
      const factory = entry.inject as unknown as (sessionId: SessionId) => TextFileCardsInjected
      return factory(SESSION)
    },
    stagedState: () => {
      const entry = ctx.slots.entries('conversation.input.dock')[0]
      if (entry === undefined) throw new Error('dock entry not registered')
      const factory = entry.inject as unknown as (sessionId: SessionId) => TextFileCardsInjected
      return factory(SESSION).hooks.stagedFiles.getSnapshot()
    },
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('text-file-cards drop takeover', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'sessions', 'conversation', 'locale'])
  })

  it('stages a pure text-file drop as card state without touching the draft', async () => {
    const b = await bench({ draft: 'keep me' })
    const dragEnd = vi.fn()
    window.addEventListener('dragend', dragEnd)
    const file = new File(['world'], 'note.txt', { type: 'text/plain' })
    const event = dispatchDrop([file], document.body)
    expect(event.defaultPrevented).toBe(true)
    await settle()
    const staged = b.stagedState().bySession[SESSION]
    expect(staged?.map(entry => ({ name: entry.name, size: entry.size }))).toEqual([{ name: 'note.txt', size: 5 }])
    expect(b.input.setDraft).not.toHaveBeenCalled()
    expect(dragEnd).toHaveBeenCalledOnce()
    window.removeEventListener('dragend', dragEnd)
    await b.fiber.dispose()
  })

  it('stages multiple files in drop order', async () => {
    const b = await bench()
    const a = new File(['alpha'], 'a.txt', { type: 'text/plain' })
    const m = new File(['beta'], 'b.md', { type: '' })
    dispatchDrop([a, m], document.body)
    await settle()
    expect(b.stagedState().bySession[SESSION]?.map(entry => entry.name)).toEqual(['a.txt', 'b.md'])
    await b.fiber.dispose()
  })

  it('leaves an image drop to the native intake', async () => {
    const b = await bench()
    const image = new File([Uint8Array.of(1, 2, 3)], 'pixel.png', { type: 'image/png' })
    const event = dispatchDrop([image], document.body)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('leaves a mixed text+image batch wholly to the native intake', async () => {
    const b = await bench()
    const text = new File(['hi'], 'a.txt', { type: 'text/plain' })
    const image = new File([Uint8Array.of(1)], 'p.png', { type: 'image/png' })
    const event = dispatchDrop([text, image], document.body)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('leaves a file with no extension and no MIME to native handling', async () => {
    const b = await bench()
    const event = dispatchDrop([new File(['data'], 'noextension', { type: '' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await b.fiber.dispose()
  })

  it('leaves a drop through when there is no current session', async () => {
    const b = await bench({ noSession: true })
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await b.fiber.dispose()
  })

  it('leaves a drop through while the machine is submitting or adjudicating', async () => {
    for (const phase of ['submitting', 'adjudicating'] as const) {
      const b = await bench({ phase })
      const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
      expect(event.defaultPrevented).toBe(false)
      await b.fiber.dispose()
    }
  })

  it('leaves a drop through when no composer is mounted', async () => {
    const b = await bench({ noComposer: true })
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await b.fiber.dispose()
  })

  it('leaves a drop through when the composer is occluded', async () => {
    const b = await bench({ occluded: true })
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await b.fiber.dispose()
  })

  it('ignores a drop that carries no dataTransfer', async () => {
    const b = await bench()
    const drop = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(drop, 'dataTransfer', { value: null, configurable: true })
    document.body.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('leaves an empty-batch drop to native handling', async () => {
    const b = await bench()
    const event = dispatchDrop([], document.body)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('leaves a drop through when the session is removed', async () => {
    const b = await bench({ removed: true })
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it("leaves a drop through when a continuable child's parent is offline", async () => {
    const b = await bench({ parentOffline: true })
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('refuses an oversized file with an error notice and stages nothing', async () => {
    const b = await bench()
    const big = new File(['x'.repeat(MAX_FILE_BYTES + 1)], 'big.txt', { type: 'text/plain' })
    const event = dispatchDrop([big], document.body)
    expect(event.defaultPrevented).toBe(true)
    await settle()
    expect(b.stagedState().bySession).toEqual({})
    expect(b.input.notify).toHaveBeenCalledOnce()
    expect(b.input.notify.mock.calls[0]?.[0]).toBe('error')
    expect(String(b.input.notify.mock.calls[0]?.[1])).toContain('big.txt')
    await b.fiber.dispose()
  })

  it('stages the head of an oversized batch and reports the tail', async () => {
    const b = await bench()
    const files = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) => new File(['x'], `f${index}.txt`, { type: 'text/plain' }))
    dispatchDrop(files, document.body)
    await settle()
    expect(b.stagedState().bySession[SESSION]?.length).toBe(MAX_BATCH_FILES)
    expect(b.input.notify).toHaveBeenCalledOnce()
    expect(String(b.input.notify.mock.calls[0]?.[1])).toContain(String(MAX_BATCH_FILES))
    await b.fiber.dispose()
  })

  it('fiber teardown removes the drop listener and the dock entry (HMR safety)', async () => {
    const b = await bench()
    await b.fiber.dispose()
    const event = dispatchDrop([new File(['hi'], 'a.txt', { type: 'text/plain' })], document.body)
    expect(event.defaultPrevented).toBe(false)
    expect(b.ctx.slots.entries('conversation.input.dock')).toEqual([])
  })
})

describe('text-file-cards inject face', () => {
  it('expands a card into an empty draft and unstages it', async () => {
    const b = await bench({ draft: '' })
    dispatchDrop([new File(['world'], 'note.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    await b.face().expand(entry.id)
    expect(b.input.setDraft).toHaveBeenCalledOnce()
    expect(b.input.setDraft).toHaveBeenCalledWith('# note.txt\nworld')
    expect(b.stagedState().bySession).toEqual({})
    expect(document.activeElement).toBe(b.composer)
    await b.fiber.dispose()
  })

  it('appends the expanded block to a non-empty draft with a newline', async () => {
    const b = await bench({ draft: 'existing' })
    dispatchDrop([new File(['world'], 'note.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    await b.face().expand(entry.id)
    expect(b.input.setDraft).toHaveBeenCalledWith('existing\n# note.txt\nworld')
    await b.fiber.dispose()
  })

  it('abandons an expand when the machine turns busy before the read', async () => {
    const b = await bench()
    dispatchDrop([new File(['world'], 'note.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    // The drop staged while plain; the machine flips to submitting before the
    // expand's pre-read check runs — the expansion must bail.
    b.input.state.set({ draft: '', phase: 'submitting' })
    await b.face().expand(entry.id)
    expect(b.input.setDraft).not.toHaveBeenCalled()
    expect(b.stagedState().bySession[SESSION]?.length).toBe(1)
    await b.fiber.dispose()
  })

  it('fails soft when the expand read rejects: no throw, no draft edit, card kept', async () => {
    const b = await bench({ draft: 'keep' })
    const file = new File(['world'], 'note.txt', { type: 'text/plain' })
    file.text = () => Promise.reject(new Error('blob revoked'))
    dispatchDrop([file], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    await expect(b.face().expand(entry.id)).resolves.toBeUndefined()
    expect(b.input.setDraft).not.toHaveBeenCalled()
    expect(b.stagedState().bySession[SESSION]?.length).toBe(1)
    await b.fiber.dispose()
  })

  it('abandons an expand when the machine turns busy during the read', async () => {
    const b = await bench()
    const file = new File(['world'], 'note.txt', { type: 'text/plain' })
    let release!: (text: string) => void
    file.text = () => new Promise((resolve) => { release = resolve })
    dispatchDrop([file], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    const pending = b.face().expand(entry.id)
    // The pre-read checks passed while plain; the machine flips to submitting
    // before the read settles — the post-read recheck must bail, and the
    // card must survive for a retry once the machine is plain again.
    b.input.state.set({ draft: '', phase: 'submitting' })
    release('world')
    await pending
    expect(b.input.setDraft).not.toHaveBeenCalled()
    expect(b.stagedState().bySession[SESSION]?.length).toBe(1)
    await b.fiber.dispose()
  })

  it('still expands but skips focus when the composer unmounts during the read', async () => {
    const b = await bench()
    const file = new File(['hi'], 'note.txt', { type: 'text/plain' })
    let release!: (text: string) => void
    file.text = () => new Promise((resolve) => { release = resolve })
    dispatchDrop([file], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    const pending = b.face().expand(entry.id)
    b.composer?.remove()
    release('hi')
    await pending
    expect(b.input.setDraft).toHaveBeenCalledOnce()
    expect(b.input.setDraft).toHaveBeenCalledWith('# note.txt\nhi')
    expect(b.stagedState().bySession).toEqual({})
    expect(document.activeElement).not.toBe(b.composer)
    await b.fiber.dispose()
  })

  it('stages an empty-content text file and expands it to a header-only block', async () => {
    const b = await bench({ draft: '' })
    dispatchDrop([new File([''], 'empty.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    expect(entry.size).toBe(0)
    await b.face().expand(entry.id)
    expect(b.input.setDraft).toHaveBeenCalledWith('# empty.txt\n')
    expect(b.stagedState().bySession).toEqual({})
    await b.fiber.dispose()
  })

  it('abandons an expand when the session turns removed after staging', async () => {
    const b = await bench()
    dispatchDrop([new File(['world'], 'note.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    b.sessionSnapshot.removed = true
    await b.face().expand(entry.id)
    expect(b.input.setDraft).not.toHaveBeenCalled()
    expect(b.stagedState().bySession[SESSION]?.length).toBe(1)
    await b.fiber.dispose()
  })

  it('treats expand of an unknown id as a no-op', async () => {
    const b = await bench()
    await b.face().expand('nope')
    expect(b.input.setDraft).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('removes a staged card without touching the draft', async () => {
    const b = await bench()
    dispatchDrop([new File(['world'], 'note.txt', { type: 'text/plain' })], document.body)
    await settle()
    const entry = b.stagedState().bySession[SESSION]?.[0]
    if (entry === undefined) throw new Error('staging failed')
    b.face().remove(entry.id)
    expect(b.stagedState().bySession).toEqual({})
    expect(b.input.setDraft).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('treats remove of an unknown id as a no-op', async () => {
    const b = await bench()
    expect(() => { b.face().remove('nope') }).not.toThrow()
    await b.fiber.dispose()
  })
})

describe('TextFileCardsDock component', () => {
  const t = makeTranslate(zh)

  /** Minimal dock props over a fixed staged state. */
  function dockProps(bySession: StagedFilesState['bySession'], expand = vi.fn(), remove = vi.fn()) {
    const state: StagedFilesState = { bySession }
    return {
      expand,
      remove,
      sessionId: SESSION,
      useStagedFiles: (sel: (s: StagedFilesState) => unknown) => sel(state),
      t,
    } as unknown as TextFileCardsDockProps & { expand: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }
  }

  it('renders nothing when the session has no staged files', () => {
    const { container } = render(<TextFileCardsDock {...dockProps({})} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders one chip per staged file with name and size', () => {
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const { container } = render(<TextFileCardsDock {...dockProps({ [SESSION]: [{ id: 'a', name: 'note.txt', size: file.size, file }] })} />)
    expect(container.querySelector('[data-text-file-cards]')).not.toBeNull()
    expect(container.textContent).toContain('note.txt')
    expect(container.textContent).toContain('5 B')
  })

  it('expands through the card button and removes through the close button', () => {
    const expand = vi.fn()
    const remove = vi.fn()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    const props = dockProps({ [SESSION]: [{ id: 'a', name: 'note.txt', size: file.size, file }] }, expand, remove)
    const { getByRole } = render(<TextFileCardsDock {...props} />)
    getByRole('button', { name: '插入文件 note.txt 到草稿' }).click()
    expect(expand).toHaveBeenCalledWith('a')
    getByRole('button', { name: '移除文件 note.txt' }).click()
    expect(remove).toHaveBeenCalledWith('a')
  })
})

describe('text-file-cards node half', () => {
  it('contributes no host behavior', () => {
    expect(nodeApply).not.toThrow()
  })
})

describe('text-file-cards invariant companion', () => {
  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(TextFileCardsInvariant)
    await fiber.await()
    expect(TextFileCardsInvariant.name).toBe('client-text-file-cards-invariant')
    expect(TextFileCardsInvariant.inject).toEqual(['invariants'])
    expect(() => { (ctx.emit as (event: string) => void)('slots/changed') }).not.toThrow()
    await fiber.dispose()
  })
})
