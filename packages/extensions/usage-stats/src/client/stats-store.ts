/**
 * Usage-stats section controller: gathers every session's `usageStats`
 * projection value into one snapshot store. The session-list baseline is the
 * single read path — every row carries the host-computed projection cache
 * (attached sessions read the live registry, cold sessions the persisted
 * projection cache). Sessions whose cache predates the unit — recorded
 * before the plugin existed, so no cache row carries the key — report an
 * empty value and count toward `absentCount`. The pre-0.1.2-alpha.1
 * controller additionally backfilled predating sessions through a one-shot
 * history RPC; the Connection-owned transport retired that call surface, so
 * the backfill lane retired with the sync (fork sync ledger records the
 * disposition).
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/stats-store
 */

import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
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
   * Sessions whose list baseline lacks the `usageStats` key (a cache row
   * predating the unit, or a host composition that does not register it) —
   * the unregistered hint fires when this equals `sessionCount`.
   */
  absentCount: number
  /**
   * Per-session read failures. The list baseline is one synchronous snapshot
   * read, so individual sessions cannot fail; the field stays for the
   * section's hint contract and is always zero.
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

/**
 * Section controller over the sessions service face.
 */
export class UsageStatsController {
  /** The section's snapshot store (the inject hooks compartment seat). */
  readonly store: SnapshotStore<UsageStatsSectionState> = createSnapshotStore(INITIAL)
  private running = false
  /**
   * Connection-lifetime generation: reset() advances it, and a load that
   * completes on a stale generation discards its result instead of
   * overwriting the reset snapshot or releasing a newer load's running flag.
   */
  private generation = 0

  constructor(private readonly sessions: Pick<ISessions, 'list' | 'refresh'>) {}

  /**
   * Gather every session's usage value from the refreshed host-authoritative
   * list baseline. A reset landing while the refresh is in flight discards
   * the stale result.
   */
  async load(): Promise<void> {
    if (this.running) return
    this.running = true
    const generation = this.generation
    const previous = this.store.getSnapshot()
    this.store.set({ ...previous, status: 'loading', error: null })
    try {
      await this.sessions.refresh()
      // A reset landed while the refresh was in flight: its result belongs
      // to the dead connection and must not overwrite the reset snapshot.
      if (this.generation !== generation) return
      const list = this.sessions.list.getSnapshot()
      const values: Record<string, UsageStatsProjection> = {}
      let absentCount = 0
      for (const sessionId of list.ids) {
        const value = list.byId[sessionId]?.projectionValues?.usageStats
        if (isUsageStats(value)) {
          values[sessionId] = value
        } else {
          values[sessionId] = { quarters: {} }
          absentCount += 1
        }
      }
      if (this.generation !== generation) return
      this.store.set({
        status: 'ready',
        error: null,
        values,
        sessionCount: list.ids.length,
        absentCount,
        failedCount: 0,
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
   * completion cannot overwrite this snapshot.
   */
  reset(): void {
    this.generation += 1
    this.running = false
    this.store.set(INITIAL)
  }
}
