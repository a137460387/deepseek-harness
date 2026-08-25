/**
 * Pure client-side aggregation of `usageStats` projection values: merging
 * sessions, regrouping UTC quarter buckets into viewer-local calendar days
 * and months, and deriving the headline figures (streaks, peak day, route
 * shares). All calendar math runs through `Intl` against an explicit timezone
 * so the functions stay deterministic under test; the host never learns a
 * timezone.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/aggregate
 */

import { QUARTER_MS } from '../quarter.ts'
import type { UsageBuckets, UsageRouteBucket, UsageStatsProjection } from '../types.ts'

/** A calendar day in the viewer timezone, as `YYYY-MM-DD`. */
export type DayKey = string

/** Which route field splits a series: by provider, or by model. */
export type RouteDimension = 'provider' | 'model'

/** One selectable statistics window for the trend chart. */
export type StatsRange = 'week' | 'month30' | 'thisMonth' | 'all'

/** Heatmap coloring mode: per-day, per-week column, or cumulative to date. */
export type HeatmapMode = 'daily' | 'weekly' | 'cumulative'

/** One day's totals: the all-routes sum plus per-series splits. */
export interface DailyStats {
  /** Viewer-local calendar day (`YYYY-MM-DD`). */
  day: DayKey
  /** Total tokens across every route this day. */
  total: number
  /** Series key (provider or model name) → that series' tokens this day. */
  bySeries: Map<string, number>
}

/** One month's total over the daily entries that fall inside it. */
export interface MonthlyStats {
  /** Viewer-local calendar month (`YYYY-MM`). */
  month: string
  /** Total tokens across the month's days. */
  total: number
}

/**
 * Sum the four buckets into one token count.
 * @param buckets - the buckets to sum.
 * @returns the total token count.
 */
export function bucketsTotal(buckets: UsageBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

/**
 * Merge several sessions' `usageStats` values into one.
 * @param values - per-session projection values.
 * @returns the combined projection (fresh objects; inputs untouched).
 */
export function combineProjections(values: Iterable<UsageStatsProjection>): UsageStatsProjection {
  const quarters: UsageStatsProjection['quarters'] = {}
  for (const value of values) {
    for (const [key, byProvider] of Object.entries(value.quarters)) {
      const target = quarters[key] ?? (quarters[key] = {})
      for (const [provider, byModel] of Object.entries(byProvider)) {
        const targetModels = target[provider] ?? (target[provider] = {})
        for (const [model, buckets] of Object.entries(byModel)) {
          const current = targetModels[model]
          targetModels[model] = {
            uncachedInputTokens: (current?.uncachedInputTokens ?? 0) + buckets.uncachedInputTokens,
            outputTokens: (current?.outputTokens ?? 0) + buckets.outputTokens,
            cacheReadTokens: (current?.cacheReadTokens ?? 0) + buckets.cacheReadTokens,
            cacheWriteTokens: (current?.cacheWriteTokens ?? 0) + buckets.cacheWriteTokens,
          }
        }
      }
    }
  }
  return { quarters }
}

/**
 * Whole-history route totals, largest first.
 * @param value - the combined projection.
 * @returns one bucket row per provider/model pair.
 */
export function routeTotals(value: UsageStatsProjection): UsageRouteBucket[] {
  const routes = new Map<string, UsageRouteBucket>()
  for (const byProvider of Object.values(value.quarters)) {
    for (const [provider, byModel] of Object.entries(byProvider)) {
      for (const [model, buckets] of Object.entries(byModel)) {
        const key = `${provider}\u0000${model}`
        const current = routes.get(key)
        if (current === undefined) {
          routes.set(key, { provider, model, buckets: { ...buckets } })
          continue
        }
        current.buckets.uncachedInputTokens += buckets.uncachedInputTokens
        current.buckets.outputTokens += buckets.outputTokens
        current.buckets.cacheReadTokens += buckets.cacheReadTokens
        current.buckets.cacheWriteTokens += buckets.cacheWriteTokens
      }
    }
  }
  return [...routes.values()].sort((a, b) => bucketsTotal(b.buckets) - bucketsTotal(a.buckets))
}

/**
 * Split whole-history totals into chart series by the chosen dimension.
 * Provider dimension yields one series per provider; model dimension merges
 * same-named models across providers (the user-facing "by model" question).
 * @param value - the combined projection.
 * @param dimension - the split field.
 * @returns series rows, largest total first; `key` is the series identity.
 */
export function seriesTotals(
  value: UsageStatsProjection,
  dimension: RouteDimension,
): { key: string; total: number }[] {
  const totals = new Map<string, number>()
  for (const route of routeTotals(value)) {
    const key = dimension === 'provider' ? route.provider : route.model
    totals.set(key, (totals.get(key) ?? 0) + bucketsTotal(route.buckets))
  }
  return [...totals.entries()]
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Regroup quarter buckets into viewer-local days.
 * @param value - the combined projection.
 * @param timeZone - viewer IANA timezone.
 * @param dimension - the series split for `bySeries`.
 * @returns day entries in ascending day order.
 */
export function dailyStats(
  value: UsageStatsProjection,
  timeZone: string,
  dimension: RouteDimension,
): DailyStats[] {
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const byDay = new Map<DayKey, { total: number; bySeries: Map<string, number> }>()
  for (const [key, byProvider] of Object.entries(value.quarters)) {
    const day = dayFormatter.format(Number(key) * QUARTER_MS)
    let entry = byDay.get(day)
    if (entry === undefined) {
      entry = { total: 0, bySeries: new Map() }
      byDay.set(day, entry)
    }
    for (const [provider, models] of Object.entries(byProvider)) {
      for (const [model, buckets] of Object.entries(models)) {
        const total = bucketsTotal(buckets)
        entry.total += total
        const seriesKey = dimension === 'provider' ? provider : model
        entry.bySeries.set(seriesKey, (entry.bySeries.get(seriesKey) ?? 0) + total)
      }
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, { total, bySeries }]) => ({ day, total, bySeries }))
}

/**
 * Fold daily entries into calendar-month totals.
 * @param daily - ascending daily entries.
 * @returns month entries in ascending month order.
 */
export function monthlyStats(daily: readonly DailyStats[]): MonthlyStats[] {
  const byMonth = new Map<string, number>()
  for (const entry of daily) {
    const month = entry.day.slice(0, 7)
    byMonth.set(month, (byMonth.get(month) ?? 0) + entry.total)
  }
  return [...byMonth.entries()].map(([month, total]) => ({ month, total }))
}

/**
 * Render daily entries as RFC 4180 CSV: one `day,total` header row plus one
 * row per entry in input order. A field carrying a comma, quote, or line
 * break is quoted with inner quotes doubled; day keys and totals never do,
 * but the escaping is total so the text stays valid under any later column.
 * @param daily - the daily entries to render.
 * @returns the CSV text, every row terminated with CRLF.
 */
export function dailyStatsToCsv(daily: readonly DailyStats[]): string {
  const escape = (field: string): string =>
    /[",\n\r]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field
  const rows = daily.map(entry => `${escape(entry.day)},${entry.total}`)
  return `${['day,total', ...rows].join('\r\n')}\r\n`
}

/**
 * Current and longest usage streaks over the active days.
 *
 * The current streak counts back from `today`; a today without usage yet
 * keeps the streak alive through yesterday (GitHub-contribution semantics),
 * and a gap of both today and yesterday ends it.
 * @param activeDays - the days carrying any usage, any order.
 * @param today - the viewer-local today as `YYYY-MM-DD`.
 * @returns the two streak lengths in days.
 */
export function usageStreaks(activeDays: readonly DayKey[], today: DayKey): { current: number; longest: number } {
  const days = [...new Set(activeDays)].sort()
  let longest = 0
  let run = 0
  let previous: DayKey | undefined
  for (const day of days) {
    run = previous !== undefined && nextDay(previous) === day ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = day
  }
  let current = 0
  let cursor = days.includes(today) ? today : previousDay(today)
  while (days.includes(cursor)) {
    current += 1
    cursor = previousDay(cursor)
  }
  return { current, longest }
}

/**
 * The highest-total day.
 * @param daily - daily entries.
 * @returns the peak entry, or null when no day carries usage.
 */
export function peakDay(daily: readonly DailyStats[]): DailyStats | null {
  let peak: DailyStats | null = null
  for (const entry of daily) {
    if (peak === null || entry.total > peak.total) peak = entry
  }
  return peak
}

/**
 * The first day inside a statistics range.
 * @param range - the selected window.
 * @param today - viewer-local today as `YYYY-MM-DD`.
 * @returns the inclusive first day, or null for the all-time window.
 */
export function rangeStartDay(range: StatsRange, today: DayKey): DayKey | null {
  switch (range) {
    case 'week':
      return shiftDay(today, -6)
    case 'month30':
      return shiftDay(today, -29)
    case 'thisMonth':
      return `${today.slice(0, 7)}-01`
    case 'all':
      return null
  }
}

/** Day-key arithmetic helper: `YYYY-MM-DD` ↔ UTC epoch ms. */
function dayKeyToMs(day: DayKey): number {
  const parts = day.split('-').map(Number)
  const year = parts[0] ?? 1970
  const month = parts[1] ?? 1
  const date = parts[2] ?? 1
  return Date.UTC(year, month - 1, date)
}

/** The day after `day`, as a day key. */
function nextDay(day: DayKey): DayKey {
  return msToDayKey(dayKeyToMs(day) + 86_400_000)
}

/** The day before `day`, as a day key. */
function previousDay(day: DayKey): DayKey {
  return msToDayKey(dayKeyToMs(day) - 86_400_000)
}

/**
 * Shift `day` by `delta` calendar days.
 * @param day - the day key to shift.
 * @param delta - signed day count.
 * @returns the shifted day key.
 */
export function shiftDay(day: DayKey, delta: number): DayKey {
  return msToDayKey(dayKeyToMs(day) + delta * 86_400_000)
}

/**
 * Monday-first weekday index of a day key (Monday = 0 … Sunday = 6).
 * @param day - the day key.
 * @returns the weekday index.
 */
export function mondayIndex(day: DayKey): number {
  return (new Date(dayKeyToMs(day)).getUTCDay() + 6) % 7
}

/** UTC epoch ms → `YYYY-MM-DD` (pure calendar projection, no timezone shift). */
function msToDayKey(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The viewer-local today.
 * @param timeZone - viewer IANA timezone.
 * @returns today as `YYYY-MM-DD`.
 */
export function todayKey(timeZone: string): DayKey {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(Date.now())
}

/**
 * Compact token count: 517 / 12.2K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}
