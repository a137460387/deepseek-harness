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
import type { UsageStatsProjection } from '../types.ts'

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
   * Sessions where even the history backfill served no `usageStats` key —
   * the host composition does not register the unit when this equals
   * `sessionCount`.
   */
  absentCount: number
}

const INITIAL: UsageStatsSectionState = {
  status: 'idle',
  error: null,
  values: {},
  sessionCount: 0,
  absentCount: 0,
}

/**
 * Narrow one wire-side projection value. The projections block is
 * deliberately a wide record on the carrier (`values: z.unknown()`), so this
 * is the boundary check that keeps a malformed value out of chart math.
 * @param value - the raw block member.
 * @returns whether the value carries the usageStats shape.
 */
function isUsageStats(value: unknown): value is UsageStatsProjection {
  if (typeof value !== 'object' || value === null) return false
  const quarters = (value as { quarters?: unknown }).quarters
  if (typeof quarters !== 'object' || quarters === null) return false
  for (const byProvider of Object.values(quarters as Record<string, unknown>)) {
    if (typeof byProvider !== 'object' || byProvider === null) return false
    for (const byModel of Object.values(byProvider as Record<string, unknown>)) {
      if (typeof byModel !== 'object' || byModel === null) return false
      for (const bucket of Object.values(byModel as Record<string, unknown>)) {
        if (!isBucket(bucket)) return false
      }
    }
  }
  return true
}

/** Leaf check: all four buckets are non-negative integers. */
function isBucket(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
    value as Record<string, unknown>
  return [uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
    .every(field => typeof field === 'number' && Number.isSafeInteger(field) && field >= 0)
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
   * the key and no completed backfill is cached. A backfill that also lacks
   * the key counts toward `absentCount` — the host folds every registered
   * unit into the tail page, so an absent key there means the unit is not
   * composed. A single unreadable session contributes an empty value instead
   * of failing the page.
   */
  async load(): Promise<void> {
    if (this.running) return
    this.running = true
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
      await pool(missing, BACKFILL_CONCURRENCY, async (sessionId) => {
        try {
          const history = await this.api.history({ sessionId })
          const value = history.result.ok ? history.result.value.projections?.values.usageStats : undefined
          if (isUsageStats(value)) {
            this.backfilled.set(sessionId, value)
            values[sessionId] = value
          } else {
            values[sessionId] = { quarters: {} }
            absentCount += 1
          }
        } catch {
          values[sessionId] = { quarters: {} }
          absentCount += 1
        }
      })
      for (const sessionId of [...this.backfilled.keys()]) {
        if (!items.some(item => item.sessionId === sessionId)) this.backfilled.delete(sessionId)
      }
      this.store.set({
        status: 'ready',
        error: null,
        values,
        sessionCount: items.length,
        absentCount,
      })
    } catch (error) {
      this.store.set({
        status: 'error',
        error: messageOf(error),
        values: previous.values,
        sessionCount: previous.sessionCount,
        absentCount: previous.absentCount,
      })
    } finally {
      this.running = false
    }
  }

  /** Drop back to the idle snapshot (connection reset: rescan on next open). */
  reset(): void {
    this.running = false
    this.backfilled.clear()
    this.store.set(INITIAL)
  }
}
