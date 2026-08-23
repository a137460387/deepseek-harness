/**
 * The shape-contract spec (host plane so it can import projection.ts beside
 * the shared narrow): the usageStats value shape exists three times by
 * design — the wire viewSchema and the stateSchema's quarters member (both in
 * projection.ts, the projection's own validation) and the zod-free narrow
 * (types.ts, kept hand-written so the browser bundle carries no zod). Any one
 * copy drifting from the other two — a renamed bucket, a loosened check, a
 * lost nesting level — turns this spec red. The one intended divergence (the
 * narrow tolerates extra bucket keys the strict schemas refuse) is pinned
 * explicitly, not left implicit.
 */
import { describe, expect, it } from 'vitest'
import { usageStatsProjectionDefinition } from '../src/projection.ts'
import { isUsageStats, type UsageStatsProjection } from '../src/types.ts'

const wireQuarters = usageStatsProjectionDefinition.wire.viewSchema.shape.quarters
const stateQuarters = usageStatsProjectionDefinition.stateSchema.shape.quarters

/** Four well-formed buckets at a route slot. */
const buckets = (input: number, output: number, read = 0, write = 0) => ({
  uncachedInputTokens: input, outputTokens: output, cacheReadTokens: read, cacheWriteTokens: write,
})

/** Quarters records both schemas must accept alongside the narrow. */
const ACCEPTED_QUARTERS: unknown[] = [
  {},
  { '2000000': { deepseek: { chat: buckets(10, 4) } } },
  {
    '2000000': { deepseek: { chat: buckets(10, 4), reasoner: buckets(0, 0, 7, 2) } },
    '2000001': { 'other-provider': { 'model-id': buckets(1, 2, 3, 4) } },
  },
  { '0': { p: { m: buckets(0, 0, 0, 0) } } },
]

/** Quarters records every definition must refuse. */
const REFUSED_QUARTERS: unknown[] = [
  null,
  [],
  'quarters',
  { q: null },
  { q: [] },
  { q: { p: null } },
  { q: { p: { m: null } } },
  { q: { p: { m: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 1 } } } },
  { q: { p: { m: { ...buckets(1, 1), uncachedInputTokens: -1 } } } },
  { q: { p: { m: { ...buckets(1, 1), uncachedInputTokens: 1.5 } } } },
  { q: { p: { m: { ...buckets(1, 1), uncachedInputTokens: '3' } } } },
  { q: { p: { m: { ...buckets(1, 1), cacheReadTokens: Number.NaN } } } },
]

describe('usageStats shape contract', () => {
  it('accepts the same quarters records on the wire schema, the state schema, and the client narrow', () => {
    for (const quarters of ACCEPTED_QUARTERS) {
      const value = { quarters } as const
      expect(wireQuarters.safeParse(quarters).success).toBe(true)
      expect(stateQuarters.safeParse(quarters).success).toBe(true)
      expect(isUsageStats(value)).toBe(true)
    }
  })

  it('refuses the same malformed quarters records on all three definitions', () => {
    for (const quarters of REFUSED_QUARTERS) {
      const value = { quarters }
      expect(wireQuarters.safeParse(quarters).success).toBe(false)
      expect(stateQuarters.safeParse(quarters).success).toBe(false)
      expect(isUsageStats(value)).toBe(false)
    }
  })

  it('pins the one intended divergence: the narrow tolerates extra bucket keys the strict schemas refuse', () => {
    const quarters = { q: { p: { m: { ...buckets(1, 1), extra: true } } } }
    expect(wireQuarters.safeParse(quarters).success).toBe(false)
    expect(stateQuarters.safeParse(quarters).success).toBe(false)
    // The narrow is a read-guard for chart math, not a wire validator: keys
    // it never reads cannot corrupt the aggregates it protects.
    expect(isUsageStats({ quarters })).toBe(true)
  })

  it('keeps the state schema and the wire schema parsing the identical record', () => {
    for (const quarters of [...ACCEPTED_QUARTERS, ...REFUSED_QUARTERS]) {
      expect(stateQuarters.safeParse(quarters).success).toBe(wireQuarters.safeParse(quarters).success)
    }
  })

  it('types the wire value as the shared projection interface', () => {
    const value: UsageStatsProjection = { quarters: { '2000000': { deepseek: { chat: buckets(1, 1) } } } }
    expect(isUsageStats(value)).toBe(true)
  })
})
