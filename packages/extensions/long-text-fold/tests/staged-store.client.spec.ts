// @vitest-environment jsdom
/**
 * Staged-store unit pins over a fake localStorage: put/text round-trips and
 * key isolation, submit-time touch recency, LRU eviction by entry count and
 * total budget (seeded oversized origins, no megabyte loops), dead-session
 * pruning, oversized-entry refusal, quota propagation (nothing staged), an
 * unavailable-storage throw, snapshot publication for the dock, and reload
 * durability from the second store instance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MAX_ENTRIES, MAX_STAGED_BYTES, countLines } from '../src/client/markers.ts'
import { StagedStoreError, createStagedStore } from '../src/client/staged-store.ts'

const S1 = 's1' as SessionId
const S2 = 's2' as SessionId

/** Map-backed Storage stand-in with an injectable write-failure mode. */
class FakeStorage {
  private readonly map = new Map<string, string>()
  /** When true, every setItem throws QuotaExceededError. */
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

/** Seed one stored entry directly (bypasses put) for LRU/budget scenarios. */
function seedEntry(sessionId: string, seq: number, text: string, at: number): void {
  fake.setItem(
    `dsh-long-text-fold:v1:s:${sessionId}:${String(seq)}`,
    JSON.stringify({ sessionId, seq, text, lines: countLines(text), createdAt: at, at }),
  )
}

/** Let wall-clock LRU recency separate two operations deterministically. */
async function tick(ms = 3): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, ms) })
}

beforeEach(() => {
  installStorage(new FakeStorage())
})

afterEach(() => {
  fake.clear()
})

describe('long-text-fold staged store basics', () => {
  it('round-trips a staged text and publishes the dock snapshot', () => {
    const store = createStagedStore()
    const seq = store.put(S1, 'hello\nworld', [S1])
    expect(seq).toBe(1)
    expect(store.text(S1, seq)).toBe('hello\nworld')
    const snapshot = store.store.getSnapshot()
    expect(snapshot.bySession[S1]).toEqual([
      { seq: 1, preview: 'hello', chars: 11, lines: 2 },
    ])
  })

  it('keeps sessions isolated by key', () => {
    const store = createStagedStore()
    const first = store.put(S1, 'first', [S1, S2])
    const second = store.put(S2, 'second', [S1, S2])
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(store.text(S1, first)).toBe('first')
    expect(store.text(S2, second)).toBe('second')
    expect(store.text(S1, second)).toBeUndefined()
    expect(Object.keys(store.store.getSnapshot().bySession).sort()).toEqual([S1, S2].sort())
  })

  it('survives a reload through the second store instance', () => {
    const store = createStagedStore()
    const seq = store.put(S1, 'durable', [S1])
    const reloaded = createStagedStore()
    expect(reloaded.text(S1, seq)).toBe('durable')
    expect(reloaded.store.getSnapshot().bySession[S1]).toHaveLength(1)
  })

  it('continues the sequence from the highest live entry', () => {
    seedEntry(S1, 7, 'seeded', Date.now())
    const reloaded = createStagedStore()
    expect(reloaded.put(S1, 'next', [S1])).toBe(8)
  })

  it('removes an entry from storage and the snapshot', () => {
    const store = createStagedStore()
    const seq = store.put(S1, 'gone soon', [S1])
    store.remove(S1, seq)
    expect(store.text(S1, seq)).toBeUndefined()
    expect(store.store.getSnapshot().bySession[S1]).toBeUndefined()
  })

  it('remove of an unknown seq is a no-op', () => {
    const store = createStagedStore()
    store.remove(S1, 99)
  })
})

describe('long-text-fold staged store refusals', () => {
  it('refuses a single entry over the staging ceiling', () => {
    const store = createStagedStore()
    try {
      store.put(S1, 'x'.repeat(MAX_STAGED_BYTES + 1), [S1])
      expect.unreachable('put should have thrown')
    } catch (error) {
      expect((error as StagedStoreError).reason).toBe('too-large')
    }
    expect(store.store.getSnapshot().bySession[S1]).toBeUndefined()
  })

  it('propagates a quota failure and stages nothing', () => {
    const store = createStagedStore()
    fake.failWrites = true
    expect(() => store.put(S1, 'never stored', [S1])).toThrow(StagedStoreError)
    try {
      store.put(S1, 'never stored', [S1])
      expect.unreachable('put should have thrown')
    } catch (error) {
      expect((error as StagedStoreError).reason).toBe('quota')
    }
    expect(store.text(S1, 1)).toBeUndefined()
    expect(store.store.getSnapshot().bySession[S1]).toBeUndefined()
  })

  it('throws unavailable without localStorage', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true })
    const store = createStagedStore()
    try {
      store.put(S1, 'no storage', [S1])
      expect.unreachable('put should have thrown')
    } catch (error) {
      expect((error as StagedStoreError).reason).toBe('unavailable')
    }
  })
})

describe('long-text-fold staged store LRU', () => {
  it('evicts the oldest-recency entry past the entry cap', async () => {
    seedEntry(S1, 1, 'a'.repeat(10), Date.now())
    const store = createStagedStore()
    // Fill to the cap (entry 1 seeded; add up to MAX_ENTRIES).
    for (let seq = 2; seq <= MAX_ENTRIES; seq += 1) {
      await tick()
      store.put(S1, `text-${String(seq)}`, [S1])
    }
    await tick()
    // Touch entry 1 so it becomes the most recent.
    expect(store.text(S1, 1)).toBe('a'.repeat(10))
    await tick()
    store.put(S1, 'overflow', [S1])
    // Entry 2 is now the oldest recency and must be evicted; the touched
    // entry 1 and the fresh overflow survive.
    expect(store.text(S1, 2)).toBeUndefined()
    expect(store.text(S1, 1)).toBe('a'.repeat(10))
    expect(store.text(S1, MAX_ENTRIES + 1)).toBe('overflow')
  }, 20_000)

  it('evicts down to the total budget from seeded oversized origins', () => {
    // Three 900k entries = 2.7M units, over the 2M budget; loading does not
    // evict, the next put does.
    seedEntry(S1, 1, 'x'.repeat(900_000), 1_000)
    seedEntry(S1, 2, 'y'.repeat(900_000), 2_000)
    seedEntry(S1, 3, 'z'.repeat(900_000), 3_000)
    const store = createStagedStore()
    store.put(S1, 'fresh', [S1])
    expect(store.text(S1, 1)).toBeUndefined()
    expect(store.text(S1, 2)).toBe('y'.repeat(900_000))
    expect(store.text(S1, 3)).toBe('z'.repeat(900_000))
    expect(store.text(S1, 4)).toBe('fresh')
  })

  it('bumps recency at submit time so restored entries survive eviction', async () => {
    // Three 700k entries = 2.1M, over the 2M budget; the load does not evict,
    // the next put does — after touching entry 1, entry 2 is the oldest.
    seedEntry(S1, 1, 'a'.repeat(700_000), 1_000)
    seedEntry(S1, 2, 'b'.repeat(700_000), 2_000)
    seedEntry(S1, 3, 'c'.repeat(700_000), 3_000)
    const store = createStagedStore()
    await tick()
    expect(store.text(S1, 1)).toBe('a'.repeat(700_000))
    await tick()
    store.put(S1, 'fresh', [S1])
    expect(store.text(S1, 2)).toBeUndefined()
    expect(store.text(S1, 1)).toBe('a'.repeat(700_000))
    expect(store.text(S1, 3)).toBe('c'.repeat(700_000))
    expect(store.text(S1, 4)).toBe('fresh')
  })
})

describe('long-text-fold staged store pruning', () => {
  it('prunes dead sessions at the next staging', () => {
    const store = createStagedStore()
    store.put(S1, 'stale', [S1])
    expect(store.text(S1, 1)).toBe('stale')
    store.put(S2, 'live', [S2])
    expect(store.text(S1, 1)).toBeUndefined()
    expect(store.text(S2, 2)).toBe('live')
    expect(store.store.getSnapshot().bySession[S1]).toBeUndefined()
  })
})
