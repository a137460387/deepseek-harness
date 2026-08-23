/**
 * Usage-stats section controller: gathers every session's `usageStats`
 * projection value into one snapshot store. The session-list baseline is the
 * fast path (attached sessions read the live registry, cold sessions the
 * persisted projection cache); sessions whose baseline predates the unit —
 * recorded before the plugin existed, so no cache row carries the key — are
 * backfilled through the history tail page, whose `projections` block folds
 * the whole log through every registered unit, at a bounded in-flight cap,
 * and a completed backfill is reused on later refreshes while the baseline
 * still lacks the key.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/stats-store
 */

import type { IApiClient, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { isUsageStats, type UsageStatsProjection } from '../types.ts'

/** The section's whole view state. */
export interface UsageStatsSectionState {
  /** Load lifecycle: idle before the first load, error after a failed list read. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Failure text for the error status; null otherwise. */
  error: string | null
  /** Per-session values gathered at the last completed load. */
  values: Record<string, UsageStatsProjection>
  /** Sessions the last load observed. */
  sessionCount: number
  /**
   * Sessions the history backfill CONFIRMED without the `usageStats` key (an
   * ok tail page folds every registered unit) — the host composition does not
   * register the unit when this equals `sessionCount`.
   */
  absentCount: number
  /**
   * Sessions whose history backfill errored instead (a refused call or a
   * transport throw): their registration status is unknown, they never enter
   * the backfill cache, and a later load retries them.
   */
  failedCount: number
}

const INITIAL: UsageStatsSectionState = {
  status: 'idle',
  error: null,
  values: {},
  sessionCount: 0,
  absentCount: 0,
  failedCount: 0,
}

/**
 * Human text for a rejected wire call.
 * @param error - the rejection value.
 * @returns the message to show.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** History backfill calls allowed in flight at once. */
const BACKFILL_CONCURRENCY = 8

/**
 * Run one task per item with at most `limit` tasks in flight.
 * @param items - the work queue.
 * @param limit - the in-flight cap.
 * @param worker - one item's task.
 */
async function pool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) return
      await worker(item)
    }
  }))
}

/**
 * Section controller over the sessions wire face.
 */
export class UsageStatsController {
  /** The section's snapshot store (the inject hooks compartment seat). */
  readonly store: SnapshotStore<UsageStatsSectionState> = createSnapshotStore(INITIAL)
  private running = false
  /**
   * Connection-lifetime generation: reset() advances it, and a load that
   * completes on a stale generation discards its result instead of
   * overwriting the reset snapshot, repopulating the cleared backfill cache,
   * or releasing a newer load's running flag.
   */
  private generation = 0
  /**
   * Completed history backfills, keyed by session. A later load reuses one
   * while the list baseline still lacks the key; a session absent from the
   * list drops its entry. Failed backfills are not cached, so a refresh
   * retries them.
   */
  private readonly backfilled = new Map<SessionId, UsageStatsProjection>()

  constructor(private readonly api: Pick<IApiClient['sessions'], 'list' | 'history'>) {}

  /**
   * Gather every session's usage value: the list baseline first, then a
   * bounded-concurrency history backfill for sessions whose baseline lacked
   * the key and no completed backfill is cached. An ok backfill that still
   * lacks the key counts toward `absentCount` — the host folds every
   * registered unit into the tail page, so an absent key there means the unit
   * is not composed. An errored backfill (a refused call or a transport
   * throw) counts toward `failedCount` instead: its registration status is
   * unknown, so it must not feed the unregistered hint, and it is retried on
   * the next load. A single unreadable session contributes an empty value
   * instead of failing the page.
   */
  async load(): Promise<void> {
    if (this.running) return
    this.running = true
    const generation = this.generation
    const previous = this.store.getSnapshot()
    this.store.set({ ...previous, status: 'loading', error: null })
    try {
      const list = await this.api.list({})
      if (!list.result.ok) throw new Error(list.result.error.message)
      const items = list.result.value.items
      const values: Record<string, UsageStatsProjection> = {}
      const missing: SessionId[] = []
      for (const item of items) {
        const value = item.projections?.values.usageStats
        const cached = this.backfilled.get(item.sessionId)
        if (isUsageStats(value)) values[item.sessionId] = value
        else if (cached !== undefined) values[item.sessionId] = cached
        else missing.push(item.sessionId)
      }
      let absentCount = 0
      let failedCount = 0
      await pool(missing, BACKFILL_CONCURRENCY, async (sessionId) => {
        try {
          const history = await this.api.history({ sessionId })
          if (!history.result.ok) {
            // A refused call says nothing about registration; keep it out of
            // absentCount so the unregistered hint cannot fire on errors.
            values[sessionId] = { quarters: {} }
            failedCount += 1
            return
          }
          const value = history.result.value.projections?.values.usageStats
          if (isUsageStats(value)) {
            // Only the load's own generation may repopulate the cache reset()
            // cleared; after a reset the entry belongs to the dead connection.
            if (this.generation === generation) this.backfilled.set(sessionId, value)
            values[sessionId] = value
          } else {
            // An ok tail page folds every registered unit, so a missing key
            // there means the unit is not composed for the session.
            values[sessionId] = { quarters: {} }
            absentCount += 1
          }
        } catch {
          values[sessionId] = { quarters: {} }
          failedCount += 1
        }
      })
      // A reset landed while this load was in flight: its result belongs to
      // the dead connection and must not overwrite the reset snapshot or
      // prune the cache the reset cleared.
      if (this.generation !== generation) return
      for (const sessionId of [...this.backfilled.keys()]) {
        if (!items.some(item => item.sessionId === sessionId)) this.backfilled.delete(sessionId)
      }
      this.store.set({
        status: 'ready',
        error: null,
        values,
        sessionCount: items.length,
        absentCount,
        failedCount,
      })
    } catch (error) {
      // A stale load reports nothing: the reset already owns the snapshot.
      if (this.generation !== generation) return
      this.store.set({
        status: 'error',
        error: messageOf(error),
        values: previous.values,
        sessionCount: previous.sessionCount,
        absentCount: previous.absentCount,
        failedCount: previous.failedCount,
      })
    } finally {
      // A stale load must not release a newer load's running flag.
      if (this.generation === generation) this.running = false
    }
  }

  /**
   * Drop back to the idle snapshot (connection reset: rescan on next open).
   * The generation advance discards any load still in flight: its late
   * completion neither overwrites this snapshot nor repopulates the cache.
   */
  reset(): void {
    this.generation += 1
    this.running = false
    this.backfilled.clear()
    this.store.set(INITIAL)
  }
}
