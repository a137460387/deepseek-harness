/**
 * The draft mirror's storage layer: record round-trip and on-disk shape,
 * wholesale discard of a malformed or wrong-version payload (no migration),
 * immediate entry deletion on empty text and full-record removal when the
 * last entry goes, live-list pruning, and the silent-disable latch — any
 * storage failure (quota, private mode) or a missing localStorage turns every
 * later operation into a no-op without throwing.
 */

import { describe, expect, it, vi } from 'vitest'
import { createDraftStore, type DraftStorage } from '../src/client/draft-store.ts'

/** In-memory stand-in for the storage slice the store reads and writes. */
class MemoryStorage implements DraftStorage {
  readonly map = new Map<string, string>()
  getItem = vi.fn((key: string): string | null => this.map.get(key) ?? null)
  setItem = vi.fn((key: string, value: string): void => { this.map.set(key, value) })
  removeItem = vi.fn((key: string): void => { this.map.delete(key) })
}

/** Read the on-disk record as the plugin wrote it. */
function readRecord(storage: MemoryStorage, key = 'dsh.draft-keeper'): { version?: number; drafts?: Record<string, string> } {
  const raw = storage.map.get(key)
  return raw === undefined ? {} : JSON.parse(raw) as { version?: number; drafts?: Record<string, string> }
}

describe('createDraftStore', () => {
  it('round-trips a draft through the single record', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    expect(store.get('s1')).toBeUndefined()
    store.set('s1', 'hello')
    expect(store.get('s1')).toBe('hello')
    expect(readRecord(storage)).toEqual({ version: 1, drafts: { s1: 'hello' } })
    store.set('s2', 'two')
    expect(readRecord(storage)).toEqual({ version: 1, drafts: { s1: 'hello', s2: 'two' } })
    store.set('s1', 'edited')
    expect(store.get('s1')).toBe('edited')
    expect(readRecord(storage).drafts).toEqual({ s1: 'edited', s2: 'two' })
  })

  it('removes the entry on empty text and drops the key with the last entry', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s1', 'only')
    store.set('s1', '')
    expect(store.get('s1')).toBeUndefined()
    expect(storage.map.has('dsh.draft-keeper')).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledWith('dsh.draft-keeper')
  })

  it('drops one session entry without touching the others', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s1', 'one')
    store.set('s2', 'two')
    store.remove('s1')
    expect(readRecord(storage).drafts).toEqual({ s2: 'two' })
  })

  it('skips the write when the text is unchanged', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s1', 'same')
    storage.setItem.mockClear()
    store.set('s1', 'same')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('discards a malformed record wholesale instead of migrating it', () => {
    const storage = new MemoryStorage()
    for (const raw of [
      'not json',
      'null',
      '{"version":2,"drafts":{"s1":"future"}}',
      '{"drafts":{"s1":"versionless"}}',
      '{"version":1,"drafts":"not-an-object"}',
      '{"version":1,"drafts":{"s1":42,"s2":"kept"}}',
    ]) {
      storage.map.set('dsh.draft-keeper', raw)
      const store = createDraftStore(storage, 'dsh.draft-keeper')
      // Non-string entries drop with the malformed record; a wholesale-discard
      // read never resurrects partial data.
      expect(store.get('s1')).toBeUndefined()
    }
    // The discarded record is not rewritten until the next real write, which
    // then starts a fresh well-formed record.
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s3', 'fresh')
    expect(readRecord(storage)).toEqual({ version: 1, drafts: { s3: 'fresh' } })
  })

  it('prunes entries whose sessions left the live list', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s1', 'live')
    store.set('gone', 'stale')
    store.prune(['s1'])
    expect(readRecord(storage).drafts).toEqual({ s1: 'live' })
    store.prune(['s1'])
    expect(readRecord(storage).drafts).toEqual({ s1: 'live' })
  })

  it('latches off silently when a write fails and never throws again', () => {
    const storage = new MemoryStorage()
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    store.set('s1', 'first')
    storage.setItem.mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    expect(() => { store.set('s1', 'second') }).not.toThrow()
    expect(storage.map.get('dsh.draft-keeper')).toBe(JSON.stringify({ version: 1, drafts: { s1: 'first' } }))
    // The latch is permanent: later reads see the last good record only.
    storage.setItem.mockImplementation((key: string, value: string) => { storage.map.set(key, value) })
    store.set('s2', 'never written')
    expect(readRecord(storage).drafts).toEqual({ s1: 'first' })
    expect(() => { store.remove('s1') }).not.toThrow()
    expect(readRecord(storage).drafts).toEqual({ s1: 'first' })
    expect(() => { store.prune([]) }).not.toThrow()
    expect(readRecord(storage).drafts).toEqual({ s1: 'first' })
  })

  it('latches off when the first read fails (private mode)', () => {
    const storage = new MemoryStorage()
    storage.getItem.mockImplementation(() => { throw new DOMException('unavailable', 'SecurityError') })
    const store = createDraftStore(storage, 'dsh.draft-keeper')
    expect(store.get('s1')).toBeUndefined()
    expect(() => { store.set('s1', 'text') }).not.toThrow()
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('starts permanently off without a storage (no localStorage in this environment)', () => {
    const store = createDraftStore(undefined, 'dsh.draft-keeper')
    expect(store.get('s1')).toBeUndefined()
    expect(() => {
      store.set('s1', 'text')
      store.remove('s1')
      store.prune(['s1'])
    }).not.toThrow()
    expect(store.get('s1')).toBeUndefined()
  })
})
