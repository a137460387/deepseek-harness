/**
 * The section controller: the list baseline is the fast path, sessions whose
 * baseline predates the unit are backfilled through the history tail page,
 * an absent key even there counts toward the composition hint, single-session
 * failures degrade to empty values instead of failing the page, list failures
 * surface as the error status, and overlapping loads collapse to one run.
 */

import { describe, expect, it } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { UsageStatsController } from '../src/client/stats-store.ts'
import type { UsageStatsSectionState } from '../src/client/stats-store.ts'
import type { UsageStatsProjection } from '../src/types.ts'

/** One session row as the sessions wire face shapes it. */
interface Row {
  sessionId: string
  projections?: { asOfSeq: number; values: Record<string, unknown> }
}

type SessionsApi = Pick<IApiClient['sessions'], 'list' | 'history'>

/** A controllable sessions wire face recording every call. */
function fakeApi(options: {
  rows: Row[]
  historyValues?: Record<string, Record<string, unknown>>
  historyThrow?: string[]
  listError?: string
  listThrow?: boolean
}): { api: SessionsApi; listCalls: () => number; historyCalls: () => string[] } {
  let listCalls = 0
  const historyCalls: string[] = []
  const api = {
    async list() {
      listCalls += 1
      if (options.listThrow) throw new Error('transport down')
      if (options.listError !== undefined) {
        return { rpcId: 'r', result: { ok: false as const, error: { code: 'internal', message: options.listError, details: {} } } }
      }
      return { rpcId: 'r', result: { ok: true as const, value: { items: options.rows } } }
    },
    async history(payload: { sessionId: string }) {
      historyCalls.push(payload.sessionId)
      if (options.historyThrow?.includes(payload.sessionId)) throw new Error('history failed')
      const values = options.historyValues?.[payload.sessionId] ?? {}
      return { rpcId: 'r', result: { ok: true as const, value: { events: [], hasMore: false, projections: { asOfSeq: 0, values } } } }
    },
  } as unknown as SessionsApi
  return { api, listCalls: () => listCalls, historyCalls: () => historyCalls }
}

const VALUE: UsageStatsProjection = {
  quarters: { '2000000': { deepseek: { chat: {
    uncachedInputTokens: 10, outputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0,
  } } } },
}

describe('UsageStatsController', () => {
  it('records baseline values and backfills sessions whose baseline lacks the key', async () => {
    const { api, historyCalls } = fakeApi({
      rows: [
        { sessionId: 'a', projections: { asOfSeq: 3, values: { usageStats: VALUE } } },
        { sessionId: 'b', projections: { asOfSeq: 1, values: {} } },
      ],
      historyValues: { b: { usageStats: VALUE } },
    })
    const controller = new UsageStatsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.sessionCount).toBe(2)
    expect(state.absentCount).toBe(0)
    expect(Object.keys(state.values)).toEqual(['a', 'b'])
    expect(state.values.b).toEqual(VALUE)
    expect(historyCalls()).toEqual(['b'])
  })

  it('counts a session absent when even the history backfill serves no key', async () => {
    const { api } = fakeApi({
      rows: [{ sessionId: 'a', projections: { asOfSeq: 1, values: {} } }],
      historyValues: { a: {} },
    })
    const controller = new UsageStatsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.absentCount).toBe(1)
    expect(state.values.a).toEqual({ quarters: {} })
  })

  it('degrades a failing history backfill to an empty value instead of failing the page', async () => {
    const { api } = fakeApi({
      rows: [
        { sessionId: 'a', projections: { asOfSeq: 1, values: {} } },
        { sessionId: 'b', projections: { asOfSeq: 1, values: {} } },
      ],
      historyThrow: ['a'],
      historyValues: { b: { usageStats: VALUE } },
    })
    const controller = new UsageStatsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.values.a).toEqual({ quarters: {} })
    expect(state.values.b).toEqual(VALUE)
  })

  it('surfaces a refused list call as the error status with the host message', async () => {
    const { api } = fakeApi({ rows: [], listError: 'boom' })
    const controller = new UsageStatsController(api)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('surfaces a rejected list transport as the error status', async () => {
    const { api } = fakeApi({ rows: [], listThrow: true })
    const controller = new UsageStatsController(api)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('error')
  })

  it('collapses overlapping loads into one run', async () => {
    const { api, listCalls } = fakeApi({ rows: [] })
    const controller = new UsageStatsController(api)
    await Promise.all([controller.load(), controller.load()])
    expect(listCalls()).toBe(1)
  })

  it('reset() drops back to the idle snapshot', async () => {
    const { api } = fakeApi({ rows: [] })
    const controller = new UsageStatsController(api)
    await controller.load()
    controller.reset()
    expect(controller.store.getSnapshot()).toEqual<UsageStatsSectionState>({
      status: 'idle',
      error: null,
      values: {},
      sessionCount: 0,
      absentCount: 0,
    })
  })

  it('marks the store loading while a read is in flight', async () => {
    let release: (() => void) | undefined
    const api = {
      list: () => new Promise((resolve) => {
        release = () => {
          resolve({ rpcId: 'r', result: { ok: true, value: { items: [] } } })
        }
      }),
      history: async () => ({ rpcId: 'r', result: { ok: true, value: { events: [], hasMore: false } } }),
    } as unknown as SessionsApi
    const controller = new UsageStatsController(api)
    const pending = controller.load()
    expect(controller.store.getSnapshot().status).toBe('loading')
    release?.()
    await pending
    expect(controller.store.getSnapshot().status).toBe('ready')
  })

  it('load is idempotent across a reset run', async () => {
    const { api } = fakeApi({ rows: [] })
    const controller = new UsageStatsController(api)
    await controller.load()
    controller.reset()
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('ready')
  })
})
