/**
 * Pure types and the zod-free shape predicate of the usage-stats domain: the
 * ONE home of the `usageStats` projection-key declaration, free of this
 * package's host-side value imports (cordis context, zod). Host consumers
 * import `./types`; client aggregates import `./client`, which re-exports
 * this file with zero duplication.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Four disjoint provider usage buckets, the same vocabulary `tokenUsage`
 * serves: uncached input, output, cache reads, cache writes. Reasoning stays
 * an output subdivision and is never added again.
 */
export interface UsageBuckets {
  /** Uncached prompt tokens. */
  uncachedInputTokens: number
  /** Completion tokens, reasoning included. */
  outputTokens: number
  /** Cached prompt tokens read. */
  cacheReadTokens: number
  /** Prompt tokens written to the cache. */
  cacheWriteTokens: number
}

/**
 * One route bucket: provider and model pair with its accumulated buckets.
 * A pair is one row in every route-split view (trend lines, donut shares).
 */
export interface UsageRouteBucket {
  /** Registered provider route the usage is attributed to. */
  provider: string
  /** Provider-owned model id the usage is attributed to. */
  model: string
  /** Accumulated buckets for this route. */
  buckets: UsageBuckets
}

/**
 * Per-session usage statistics keyed by UTC quarter-hour and route, the value
 * the `usageStats` projection serves. Quarter-hour (not hour) buckets keep
 * every IANA timezone's local-day boundary — offsets of :00, :15, :30, and
 * :45 all fall on quarter boundaries — exactly re-composable into local days
 * and months client-side. The state carries only quarters with non-zero
 * activity, so an inactive session folds to `{ quarters: {} }`.
 */
export interface UsageStatsProjection {
  /**
   * UTC quarter-hour index (`Math.floor(eventTimeMs / 900000)`, stringified)
   * → provider → model → buckets.
   */
  quarters: Record<string, Record<string, Record<string, UsageBuckets>>>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Route- and quarter-hour-split provider usage; see {@link UsageStatsProjection}. */
    usageStats: UsageStatsProjection
  }
}

/** Leaf check: all four buckets are non-negative integers. */
function isBucket(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
    value as Record<string, unknown>
  return [uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]
    .every(field => typeof field === 'number' && Number.isSafeInteger(field) && field >= 0)
}

/**
 * Narrow one wire-side projection value (exported for the shape-contract
 * spec). The projections block is deliberately a wide record on the carrier
 * (`values: z.unknown()`), so this is the boundary check that keeps a
 * malformed value out of chart math. Deliberately zod-free — no client-facing
 * source imports zod, and the browser bundle stays that way — which is why
 * the shape lives here beside the projection's schemas; the contract spec
 * keeps the copies honest. Lives in this shared module so the host-plane
 * contract spec can reach it without crossing the package's host/client
 * tsconfig faces.
 * @param value - the raw block member.
 * @returns whether the value carries the usageStats shape.
 */
export function isUsageStats(value: unknown): value is UsageStatsProjection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const quarters = (value as { quarters?: unknown }).quarters
  if (typeof quarters !== 'object' || quarters === null || Array.isArray(quarters)) return false
  for (const byProvider of Object.values(quarters as Record<string, unknown>)) {
    if (typeof byProvider !== 'object' || byProvider === null || Array.isArray(byProvider)) return false
    for (const byModel of Object.values(byProvider as Record<string, unknown>)) {
      if (typeof byModel !== 'object' || byModel === null || Array.isArray(byModel)) return false
      for (const bucket of Object.values(byModel as Record<string, unknown>)) {
        if (!isBucket(bucket)) return false
      }
    }
  }
  return true
}
