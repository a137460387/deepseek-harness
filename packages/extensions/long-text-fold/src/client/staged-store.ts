/**
 * localStorage-backed staged long texts, keyed per session, plus the
 * in-memory snapshot store the dock renders from.
 *
 * Storage failures propagate as {@link StagedStoreError}: the paste takeover
 * fails open (native paste plus a visible notice), so a broken or full
 * storage never blocks or silences the user's text. Eviction is LRU over a
 * capped entry count and total-text budget; entries of sessions that no
 * longer exist are pruned at every staging.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { MAX_ENTRIES, MAX_STAGED_BYTES, MAX_TOTAL_BYTES, countLines, firstLine } from './markers.ts'

const KEY_PREFIX = 'dsh-long-text-fold:v1:s:'
const SEQ_KEY = 'dsh-long-text-fold:v1:seq'

/** One staged long text (the dock's read model; the full text never re-enters React). */
export interface StagedEntry {
  /** The marker sequence number (the draft marker's `#N`). */
  readonly seq: number
  /** The trimmed first line, ellipsized. */
  readonly preview: string
  /** Text length in UTF-16 code units. */
  readonly chars: number
  /** Newline-separated line count. */
  readonly lines: number
}

/** Staged entries keyed by session id (the dock renders one session's row). */
export interface StagedState {
  bySession: Record<string, readonly StagedEntry[]>
}

/** Why a staged write could not be persisted. */
export type StagedStoreFailure = 'unavailable' | 'too-large' | 'quota'

/** A staged-write refusal; the caller fails open with a notice. */
export class StagedStoreError extends Error {
  /** The failure reason. */
  readonly reason: StagedStoreFailure

  /** @param reason - why the write was refused. */
  constructor(reason: StagedStoreFailure) {
    super(`long-text-fold staged store: ${reason}`)
    this.name = 'StagedStoreError'
    this.reason = reason
  }
}

interface StoredEntry {
  readonly sessionId: SessionId
  readonly seq: number
  readonly text: string
  readonly lines: number
  readonly createdAt: number
  /** LRU recency, bumped at staging and at submit-time expansion. */
  at: number
}

function storage(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

function entryKey(sessionId: SessionId, seq: number): string {
  return `${KEY_PREFIX}${sessionId}:${String(seq)}`
}

function dockEntry(entry: StoredEntry): StagedEntry {
  return { seq: entry.seq, preview: firstLine(entry.text), chars: entry.text.length, lines: entry.lines }
}

function parseEntry(raw: string): StoredEntry | undefined {
  const parsed = JSON.parse(raw) as Partial<StoredEntry>
  if (
    typeof parsed.sessionId !== 'string'
    || typeof parsed.seq !== 'number'
    || typeof parsed.text !== 'string'
    || typeof parsed.lines !== 'number'
    || typeof parsed.at !== 'number'
  ) return undefined
  return parsed as StoredEntry
}

/** The staged store: localStorage durability plus the dock's snapshot view. */
export interface StagedStore {
  /** The dock-facing snapshot of staged entries, grouped by session. */
  readonly store: SnapshotStore<StagedState>
  /**
   * Stage one text under a session.
   * @param sessionId - session that owns the staged text.
   * @param text - the full pasted text.
   * @param liveSessionIds - current session list; dead sessions' entries are pruned.
   * @returns the marker sequence number for the draft placeholder.
   * @throws {@link StagedStoreError} when the text cannot be durably staged.
   */
  put(sessionId: SessionId, text: string, liveSessionIds: readonly SessionId[]): number
  /**
   * Resolve one marker's staged full text and bump its LRU recency.
   * @param sessionId - session that owns the staged text.
   * @param seq - the marker sequence number.
   * @returns the full text, or undefined once evicted/removed/never staged.
   */
  text(sessionId: SessionId, seq: number): string | undefined
  /**
   * Drop one staged entry (the dock remove button, and the submit-time
   * cleanup once the submitted draft cleared).
   * @param sessionId - session that owns the staged text.
   * @param seq - the marker sequence number.
   */
  remove(sessionId: SessionId, seq: number): void
}

/**
 * Create a fresh staged store, loading any entries this origin already holds.
 * @returns the store with its snapshot hydrated from localStorage.
 */
export function createStagedStore(): StagedStore {
  const ls = storage()
  const store = createSnapshotStore<StagedState>({ bySession: {} })
  const memory = new Map<string, StoredEntry>()

  if (ls !== undefined) {
    for (let index = 0; index < ls.length; index += 1) {
      const key = ls.key(index)
      if (key === null || !key.startsWith(KEY_PREFIX)) continue
      const raw = ls.getItem(key)
      if (raw === null) continue
      try {
        const entry = parseEntry(raw)
        // Corrupted rows are dropped, not repaired: nothing else can reach a
        // half-written localStorage value, and the submit path already fails
        // open on a missing entry.
        if (entry !== undefined) memory.set(key, entry)
      } catch {
        // JSON.parse rejection on a foreign or corrupt row: same drop-and-continue.
      }
    }
  }

  const totalText = (): number => {
    let total = 0
    for (const entry of memory.values()) total += entry.text.length
    return total
  }

  const drop = (key: string): void => {
    memory.delete(key)
    if (ls !== undefined) {
      try { ls.removeItem(key) } catch { /* an orphan row re-reads harmlessly on the next load */ }
    }
  }

  const evict = (): void => {
    while (memory.size > MAX_ENTRIES || totalText() > MAX_TOTAL_BYTES) {
      let oldestKey: string | undefined
      let oldestAt = Number.POSITIVE_INFINITY
      for (const [key, entry] of memory) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at
          oldestKey = key
        }
      }
      // A single entry is always within budget (MAX_STAGED_BYTES < MAX_TOTAL_BYTES,
      // MAX_ENTRIES ≥ 1), so the loop always has an eviction candidate.
      if (oldestKey === undefined) return
      drop(oldestKey)
    }
  }

  const publish = (): void => {
    const grouped = new Map<SessionId, StoredEntry[]>()
    for (const entry of memory.values()) {
      const list = grouped.get(entry.sessionId)
      if (list === undefined) grouped.set(entry.sessionId, [entry])
      else list.push(entry)
    }
    store.update((draft) => {
      const next: Record<string, readonly StagedEntry[]> = {}
      for (const [sessionId, list] of grouped) {
        next[sessionId] = [...list].sort((a, b) => a.seq - b.seq).map(dockEntry)
      }
      draft.bySession = next
    })
  }

  const prune = (liveSessionIds: readonly SessionId[]): void => {
    const live = new Set(liveSessionIds)
    for (const [key, entry] of [...memory]) {
      if (!live.has(entry.sessionId)) drop(key)
    }
  }

  const nextSeq = (): number => {
    let max = 0
    if (ls !== undefined) {
      const raw = ls.getItem(SEQ_KEY)
      if (raw !== null) {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) max = parsed
      }
    }
    for (const entry of memory.values()) max = Math.max(max, entry.seq)
    return max + 1
  }

  publish()

  return {
    store,

    put(sessionId, text, liveSessionIds) {
      if (ls === undefined) throw new StagedStoreError('unavailable')
      if (text.length > MAX_STAGED_BYTES) throw new StagedStoreError('too-large')
      prune(liveSessionIds)
      const seq = nextSeq()
      const entry: StoredEntry = {
        sessionId,
        seq,
        text,
        lines: countLines(text),
        createdAt: Date.now(),
        at: Date.now(),
      }
      try { ls.setItem(SEQ_KEY, String(seq)) } catch { /* best-effort counter; nextSeq() derives from live entries on loss */ }
      try { ls.setItem(entryKey(sessionId, seq), JSON.stringify(entry)) } catch {
        // QuotaExceededError (or an exhausted origin budget): nothing was
        // durably staged, so the takeover must fail open rather than leave a
        // marker whose text cannot be restored at submit.
        throw new StagedStoreError('quota')
      }
      memory.set(entryKey(sessionId, seq), entry)
      evict()
      publish()
      return seq
    },

    text(sessionId, seq) {
      const key = entryKey(sessionId, seq)
      const entry = memory.get(key)
      if (entry === undefined) return undefined
      entry.at = Date.now()
      if (ls !== undefined) {
        try { ls.setItem(key, JSON.stringify(entry)) } catch { /* quota: recency stays memory-only until the next successful write */ }
      }
      return entry.text
    },

    remove(sessionId, seq) {
      const key = entryKey(sessionId, seq)
      if (!memory.has(key)) return
      drop(key)
      publish()
    },
  }
}
