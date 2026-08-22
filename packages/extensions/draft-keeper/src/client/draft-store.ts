/**
 * localStorage-backed draft mirror for the draft-keeper plugin: one storage
 * key holds every session's unsent draft as `{ version, drafts }`. The read
 * path validates the payload shape at this durable boundary and discards the
 * whole record on mismatch (no migration — a future format bumps the version
 * and owns its own transition). Any storage failure (quota exhaustion,
 * private mode, storage disabled) latches the store off for its lifetime:
 * persistence disables silently and never breaks the composer, the same
 * contract the client runtime's own persistence follows.
 * @module @deepseek-ai/dsh-client-draft-keeper/client/draft-store
 */

/** The storage slice the store reads and writes. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** On-disk payload; the version gates the shape (a mismatch discards wholesale). */
interface DraftRecord {
  readonly version: 1
  readonly drafts: Record<string, string>
}

/** The persisted-draft mirror the browser half reads and writes. */
export interface DraftStore {
  /**
   * Read one session's stored draft.
   * @param sessionId - the session whose draft is wanted.
   * @returns the stored non-empty draft, or undefined when none is stored.
   */
  get(sessionId: string): string | undefined
  /**
   * Store one session's draft; an empty text removes the session's entry.
   * @param sessionId - the session owning the draft.
   * @param text - the draft text; empty clears the entry.
   */
  set(sessionId: string, text: string): void
  /**
   * Drop one session's entry unconditionally.
   * @param sessionId - the session whose entry goes.
   */
  remove(sessionId: string): void
  /**
   * Drop every entry whose session is absent from the live list.
   * @param liveSessionIds - the live session-id list.
   */
  prune(liveSessionIds: readonly string[]): void
}

/**
 * Validate and parse the on-disk payload. The record is accepted only
 * whole: any structural violation (wrong version, non-object drafts, a
 * non-string or empty entry) discards the entire record — partial data is
 * never resurrected from a malformed neighbor.
 * @param raw - the stored JSON text.
 * @returns the parsed entries; empty when the record is malformed.
 */
function parseRecord(raw: string): Map<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return new Map()
  }
  if (typeof parsed !== 'object' || parsed === null) return new Map()
  const { version, drafts: values } = parsed as Partial<DraftRecord>
  if (version !== 1 || typeof values !== 'object' || values === null) return new Map()
  const drafts = new Map<string, string>()
  for (const [sessionId, text] of Object.entries(values)) {
    if (typeof text !== 'string' || text === '') return new Map()
    drafts.set(sessionId, text)
  }
  return drafts
}

/**
 * Create the draft mirror over one storage key.
 * @param storage - the storage to read and write; undefined (no localStorage
 * in this environment) yields a store with persistence permanently off.
 * @param key - the single storage key the record lives under.
 * @returns the store.
 */
export function createDraftStore(storage: DraftStorage | undefined, key: string): DraftStore {
  if (storage === undefined) {
    // Every method is the disabled shape: reads see nothing, writes no-op.
    return {
      get: () => undefined,
      set: () => {},
      remove: () => {},
      prune: () => {},
    }
  }

  let disabled = false
  let loaded = false
  let drafts = new Map<string, string>()

  /** Load the record once; a failed read latches persistence off. */
  const load = (): void => {
    if (loaded) return
    loaded = true
    try {
      const raw = storage.getItem(key)
      if (raw !== null) drafts = parseRecord(raw)
    } catch {
      // Storage access threw (private mode, disabled storage): persistence
      // latches off silently for this store's lifetime. Nothing else can
      // reach here — load runs the store's first and only read.
      disabled = true
    }
  }

  /** Write the whole record; an empty record removes the key. */
  const persist = (): void => {
    try {
      if (drafts.size === 0) storage.removeItem(key)
      else storage.setItem(key, JSON.stringify({ version: 1, drafts: Object.fromEntries(drafts) } satisfies DraftRecord))
    } catch {
      // A failed write (quota exhaustion, private mode) latches persistence
      // off silently; the composer keeps working and the draft simply stops
      // surviving reloads.
      disabled = true
    }
  }

  return {
    get(sessionId) {
      if (disabled) return undefined
      load()
      return drafts.get(sessionId)
    },
    set(sessionId, text) {
      if (disabled) return
      load()
      if (text === '') {
        if (!drafts.delete(sessionId)) return
      } else if (drafts.get(sessionId) === text) {
        return
      } else {
        drafts.set(sessionId, text)
      }
      persist()
    },
    remove(sessionId) {
      if (disabled) return
      load()
      if (!drafts.delete(sessionId)) return
      persist()
    },
    prune(liveSessionIds) {
      if (disabled) return
      load()
      const live = new Set(liveSessionIds)
      let changed = false
      for (const sessionId of [...drafts.keys()]) {
        if (!live.has(sessionId)) {
          drafts.delete(sessionId)
          changed = true
        }
      }
      if (changed) persist()
    },
  }
}
