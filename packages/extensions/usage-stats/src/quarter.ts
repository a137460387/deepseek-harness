/**
 * The quarter-hour bucket width shared by both package faces: the projection
 * keys usage by `Math.floor(eventTimeMs / QUARTER_MS)` and the client
 * aggregates buckets back into local days by multiplying the key again.
 * Quarter-hour (not hour) granularity keeps every IANA timezone's local-day
 * boundary — offsets of :00, :15, :30, and :45 all fall on quarter
 * boundaries — exactly re-composable client-side.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/quarter
 */

/** One quarter-hour in milliseconds. */
export const QUARTER_MS = 900_000
