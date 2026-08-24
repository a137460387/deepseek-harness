/**
 * The `usageStats` projection unit: a pure fold of durable usage samples into
 * UTC quarter-hour buckets split by provider route, mirroring `tokenUsage`'s
 * scope — main-loop chunk/message samples with their (turn, step) replacement
 * semantics, plus compaction summarizer usage accumulated in full.
 *
 * Route attribution follows the durable request envelope: chunk/message
 * samples are attributed to the provider/model of the nearest preceding
 * `request/header`; a `compaction/summary` names its own route. Usage before
 * any header (a legal log never produces one) lands in the `unknown` route.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/projection
 */

import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
// Type-only: the `compaction/summary` SessionEventMap merge (summarizer usage).
import type {} from '@deepseek-ai/dsh-compaction'
import { QUARTER_MS } from './quarter.ts'
import type { UsageBuckets, UsageStatsProjection } from './types.ts'

/** Route attribution for samples that precede every `request/header`. */
const UNKNOWN_ROUTE = { provider: 'unknown', model: 'unknown' } as const

/* jscpd:ignore-start */
// 有意镜像 token-meter 公式做契约对拍，勿去重（对拍防护见 tests/fold-contract.host.spec.ts）。
const bucketsSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()
/* jscpd:ignore-end */

const usageStatsSchema = z.object({
  quarters: z.record(z.string(), z.record(z.string(), z.record(z.string(), bucketsSchema))),
}).strict()

/**
 * The usageStats unit's state schema — the one definition of the state
 * shape; the state type is inferred from it.
 */
const usageStatsStateSchema = z.object({
  quarters: z.record(z.string(), z.record(z.string(), z.record(z.string(), bucketsSchema))),
  /** Nearest preceding `request/header` route; null before one lands. */
  route: z.object({
    provider: z.string(),
    model: z.string(),
  }).strict().nullable(),
  /** The last (turn, step) sample with its bucket placement, for replacement. */
  last: z.object({
    turn: z.number().int().nonnegative(),
    step: z.number().int().nonnegative(),
    quarter: z.number().int().nonnegative(),
    provider: z.string(),
    model: z.string(),
    buckets: bucketsSchema,
  }).strict().nullable(),
}).strict()

type UsageStatsState = z.infer<typeof usageStatsStateSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    usageStats: UsageStatsState
  }
}

const bucketsFrom = (usage: TokenUsage): UsageBuckets => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: UsageBuckets, right: UsageBuckets): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

/** Copy a record without one key; undefined when nothing remains. */
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> | undefined {
  const entries = Object.entries(record).filter(([entryKey]) => entryKey !== key)
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

/**
 * Add one signed bucket delta at a quarter/route slot, pruning the slot when
 * it zeroes out so inactive quarters never accumulate. Structural sharing
 * keeps untouched branches by reference.
 * @param quarters - the quarter record to derive from.
 * @param quarter - UTC quarter-hour index.
 * @param provider - route provider.
 * @param model - route model.
 * @param delta - signed bucket delta.
 * @returns the next quarter record.
 */
function applyBucketDelta(
  quarters: UsageStatsProjection['quarters'],
  quarter: number,
  provider: string,
  model: string,
  delta: UsageBuckets,
): UsageStatsProjection['quarters'] {
  const key = String(quarter)
  const byProvider = quarters[key]
  const byModel = byProvider?.[provider]
  const current = byModel?.[model]
  const next: UsageBuckets = {
    uncachedInputTokens: (current?.uncachedInputTokens ?? 0) + delta.uncachedInputTokens,
    outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens,
    cacheReadTokens: (current?.cacheReadTokens ?? 0) + delta.cacheReadTokens,
    cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + delta.cacheWriteTokens,
  }
  const empty = next.uncachedInputTokens === 0
    && next.outputTokens === 0
    && next.cacheReadTokens === 0
    && next.cacheWriteTokens === 0
  if (empty) {
    // The slot existed for a delta that cancels it; prune the emptied levels.
    if (byModel === undefined) return quarters
    const nextByModel = omitKey(byModel, model)
    if (nextByModel === undefined) {
      if (byProvider === undefined) return quarters
      const nextByProvider = omitKey(byProvider, provider)
      if (nextByProvider === undefined) {
        const nextQuarters = omitKey(quarters, key)
        return nextQuarters === undefined ? {} : nextQuarters
      }
      return { ...quarters, [key]: nextByProvider }
    }
    return { ...quarters, [key]: { ...byProvider, [provider]: nextByModel } }
  }
  return {
    ...quarters,
    [key]: {
      ...byProvider,
      [provider]: { ...byModel, [model]: next },
    },
  }
}

/** The `usageStats` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const usageStatsProjectionDefinition = {
  key: 'usageStats',
  stateVersion: 1,
  stateSchema: usageStatsStateSchema,
  init: (): UsageStatsState => ({ quarters: {}, route: null, last: null }),
  apply: (state, event) => {
    if (event.type === 'request/header') {
      const { provider, model } = event.data.header.config
      if (state.route?.provider === provider && state.route.model === model) return state
      return { ...state, route: { provider, model } }
    }

    if (event.type === 'compaction/summary') {
      const usage = event.data.usage
      if (usage === undefined) return state
      const { provider, model } = event.data
      const quarter = Math.floor(event.time / QUARTER_MS)
      return {
        ...state,
        quarters: applyBucketDelta(state.quarters, quarter, provider, model, bucketsFrom(usage)),
      }
    }

    /* jscpd:ignore-start */
    // 有意镜像 token-meter 公式做契约对拍，勿去重（对拍防护见 tests/fold-contract.host.spec.ts）。
    let turn: number
    let step: number
    let usage: TokenUsage
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
      ;({ turn, step } = event.data)
      usage = event.data.chunk.usage
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      ;({ turn, step, usage } = event.data)
    } else {
      return state
    }
    /* jscpd:ignore-end */

    const route = state.route ?? UNKNOWN_ROUTE
    const quarter = Math.floor(event.time / QUARTER_MS)
    const buckets = bucketsFrom(usage)
    const previous = state.last !== null
      && state.last.turn === turn
      && state.last.step === step
      ? state.last
      : undefined
    // The identical final sample after its own chunk: no movement at all.
    if (previous !== undefined
      && previous.quarter === quarter
      && previous.provider === route.provider
      && previous.model === route.model
      && bucketsEqual(previous.buckets, buckets)) return state

    let quarters = state.quarters
    if (previous !== undefined) {
      quarters = applyBucketDelta(
        quarters,
        previous.quarter,
        previous.provider,
        previous.model,
        negate(previous.buckets),
      )
    }
    quarters = applyBucketDelta(quarters, quarter, route.provider, route.model, buckets)
    return {
      ...state,
      quarters,
      last: { turn, step, quarter, provider: route.provider, model: route.model, buckets },
    }
  },
  wire: { viewSchema: usageStatsSchema, view: state => ({ quarters: state.quarters }) },
} satisfies ProjectionDefinition<'usageStats', UsageStatsState>

/** Pointwise negation for reversing a previous sample's placement. */
function negate(buckets: UsageBuckets): UsageBuckets {
  return {
    uncachedInputTokens: -buckets.uncachedInputTokens,
    outputTokens: -buckets.outputTokens,
    cacheReadTokens: -buckets.cacheReadTokens,
    cacheWriteTokens: -buckets.cacheWriteTokens,
  }
}
