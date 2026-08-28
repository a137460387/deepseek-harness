/**
 * The section controller: the refreshed session-list baseline is the single
 * read path — rows whose host projection cache carries the key deliver their
 * value, rows lacking it deliver an empty value and count toward the
 * composition hint (the hint predicate is absentCount === sessionCount),
 * failedCount stays zero because the baseline is one synchronous snapshot
 * read, a rejected refresh surfaces as the error status, overlapping loads
 * collapse to one refresh, and a load that completes after a reset is
 * discarded. The pre-0.1.2-alpha.1 history-backfill lane retired with the
 * Connection-owned transport (fork sync ledger records the disposition).
 */

import { describe, expect, it } from 'vitest'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { UsageStatsController } from '../src/client/stats-store.ts'
import type { UsageStatsSectionState } from '../src/client/stats-store.ts'
import type { UsageStatsProjection } from '../src/types.ts'

/** One session row the fake list serves, shaped by its projection cache. */
interface Row {
  id: string
  usageStats?: UsageStatsProjection
}

/** A controllable sessions face counting refresh calls. */
function fakeSessions(options: {
  rows?: Row[]
  /** Reject the refresh with this message. */
  refreshError?: string
}): { sessions: Pick<ISessions, 'list' | 'refresh'>; refreshCalls: () => number } {
  let refreshCalls = 0
  const rows = options.rows ?? []
  const byId: Record<string, unknown> = {}
  for (const row of rows) {
    byId[row.id] = {
      projectionValues: row.usageStats === undefined ? {} : { usageStats: row.usageStats },
    }
  }
  const state = {
    ids: rows.map(row => row.id),
    byId,
    current: undefined,
    phase: {},
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
  const sessions = {
    list: { getSnapshot: () => state, subscribe: () => () => {} },
    async refresh() {
      refreshCalls += 1
      if (options.refreshError !== undefined) throw new Error(options.refreshError)
    },
  } as unknown as Pick<ISessions, 'list' | 'refresh'>
  return { sessions, refreshCalls: () => refreshCalls }
}

const VALUE: UsageStatsProjection = {
  quarters: { '2000000': { deepseek: { chat: {
    uncachedInputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0,
  } } } },
}

describe('UsageStatsController', () => {
  it('records baseline values from the list projection cache', async () => {
    const { sessions } = fakeSessions({
      rows: [
        { id: 'a', usageStats: VALUE },
        { id: 'b', usageStats: VALUE },
      ],
    })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.sessionCount).toBe(2)
    expect(state.absentCount).toBe(0)
    expect(state.values.a).toEqual(VALUE)
    expect(state.values.b).toEqual(VALUE)
  })

  it('counts a session absent when its cache row lacks the key', async () => {
    const { sessions } = fakeSessions({ rows: [{ id: 'a' }] })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.absentCount).toBe(1)
    expect(state.failedCount).toBe(0)
    expect(state.values.a).toEqual({ quarters: {} })
  })

  it('holds the unregistered-hint input when every baseline lacks the key', async () => {
    const { sessions } = fakeSessions({ rows: [{ id: 'a' }, { id: 'b' }] })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    const state = controller.store.getSnapshot()
    // absentCount === sessionCount is the section's unregistered predicate.
    expect(state.sessionCount).toBe(2)
    expect(state.absentCount).toBe(2)
    expect(state.failedCount).toBe(0)
  })

  it('keeps failedCount at zero — the baseline is one synchronous read', async () => {
    const { sessions } = fakeSessions({ rows: [{ id: 'a', usageStats: VALUE }, { id: 'b' }] })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    expect(controller.store.getSnapshot().failedCount).toBe(0)
  })

  it('surfaces a rejected refresh as the error status with the message', async () => {
    const { sessions } = fakeSessions({ rows: [], refreshError: 'boom' })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('collapses overlapping loads into one refresh', async () => {
    const { sessions, refreshCalls } = fakeSessions({ rows: [] })
    const controller = new UsageStatsController(sessions)
    await Promise.all([controller.load(), controller.load()])
    expect(refreshCalls()).toBe(1)
  })

  it('reset() drops back to the idle snapshot and a later load rescans', async () => {
    const { sessions, refreshCalls } = fakeSessions({ rows: [{ id: 'a', usageStats: VALUE }] })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    controller.reset()
    expect(controller.store.getSnapshot()).toEqual<UsageStatsSectionState>({
      status: 'idle',
      error: null,
      values: {},
      sessionCount: 0,
      absentCount: 0,
      failedCount: 0,
    })
    await controller.load()
    expect(refreshCalls()).toBe(2)
    expect(controller.store.getSnapshot().values.a).toEqual(VALUE)
  })

  it('discards a load whose refresh completes after a reset', async () => {
    let release: (() => void) | undefined
    const sessions = {
      list: { getSnapshot: () => ({ ids: ['a'], byId: { a: { projectionValues: { usageStats: VALUE } } } }), subscribe: () => () => {} },
      refresh: () => new Promise<void>((resolve) => {
        release = () => resolve()
      }),
    } as unknown as Pick<ISessions, 'list' | 'refresh'>
    const controller = new UsageStatsController(sessions)
    const pending = controller.load()
    // Let the refresh hang in flight, then reset and release it.
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.reset()
    release?.()
    await pending
    expect(controller.store.getSnapshot()).toEqual<UsageStatsSectionState>({
      status: 'idle',
      error: null,
      values: {},
      sessionCount: 0,
      absentCount: 0,
      failedCount: 0,
    })
  })

  it('marks the store loading while the refresh is in flight', async () => {
    let release: (() => void) | undefined
    const sessions = {
      list: { getSnapshot: () => ({ ids: [] }), subscribe: () => () => {} },
      refresh: () => new Promise<void>((resolve) => {
        release = () => resolve()
      }),
    } as unknown as Pick<ISessions, 'list' | 'refresh'>
    const controller = new UsageStatsController(sessions)
    const pending = controller.load()
    expect(controller.store.getSnapshot().status).toBe('loading')
    release?.()
    await pending
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('load is idempotent across a reset run', async () => {
    const { sessions } = fakeSessions({ rows: [] })
    const controller = new UsageStatsController(sessions)
    await controller.load()
    controller.reset()
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
})
