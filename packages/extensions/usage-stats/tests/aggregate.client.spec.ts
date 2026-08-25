/**
 * Pure aggregation over `usageStats` values: merging sessions, route and
 * series splits, viewer-local day regrouping (including the half-hour
 * timezone offset that quarter buckets exist for), months, the CSV rendering
 * of day rows, streaks, the peak day, range starts, and the compact token
 * formatter.
 */

import { describe, expect, it } from 'vitest'
import type { UsageBuckets, UsageStatsProjection } from '../src/types.ts'
import {
  combineProjections, dailyStats, dailyStatsToCsv, formatTokens, monthlyStats, mondayIndex,
  peakDay, rangeStartDay, routeTotals, seriesTotals, shiftDay, usageStreaks,
} from '../src/client/aggregate.ts'
import { QUARTER_MS } from '../src/quarter.ts'

const buckets = (n: number): UsageBuckets => ({
  uncachedInputTokens: n,
  outputTokens: n,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** One projection value with a single sample at `ts`. */
function stats(ts: number, provider: string, model: string, value: UsageBuckets): UsageStatsProjection {
  return {
    quarters: {
      [String(Math.floor(ts / QUARTER_MS))]: { [provider]: { [model]: value } },
    },
  }
}

/** 2026-08-19T18:15:00Z — the half-hour-offset test's anchor. */
const T_IST = Date.UTC(2026, 7, 19, 18, 15)

describe('combineProjections', () => {
  it('merges sessions into summed quarter buckets', () => {
    const merged = combineProjections([
      stats(T_IST, 'deepseek', 'chat', buckets(10)),
      stats(T_IST, 'deepseek', 'chat', buckets(5)),
    ])
    const quarter = String(Math.floor(T_IST / QUARTER_MS))
    expect(merged.quarters[quarter]!.deepseek!.chat).toEqual(buckets(15))
  })
})

describe('routeTotals', () => {
  it('sums each route over every quarter, largest first', () => {
    const merged = combineProjections([
      stats(T_IST, 'deepseek', 'chat', buckets(10)),
      stats(T_IST + QUARTER_MS, 'deepseek', 'chat', buckets(5)),
      stats(T_IST, 'openai', 'gpt', buckets(20)),
    ])
    const routes = routeTotals(merged)
    expect(routes.map(route => [route.provider, route.model])).toEqual([
      ['openai', 'gpt'],
      ['deepseek', 'chat'],
    ])
    expect(routes[1]!.buckets).toEqual(buckets(15))
  })
})

describe('seriesTotals', () => {
  const merged = combineProjections([
    stats(T_IST, 'deepseek', 'chat', buckets(10)),
    stats(T_IST, 'deepseek', 'reasoner', buckets(5)),
    stats(T_IST, 'openai', 'chat', buckets(2)),
  ])

  it('groups the provider dimension one series per provider', () => {
    expect(seriesTotals(merged, 'provider')).toEqual([
      { key: 'deepseek', total: 30 },
      { key: 'openai', total: 4 },
    ])
  })

  it('groups the model dimension across providers', () => {
    expect(seriesTotals(merged, 'model')).toEqual([
      { key: 'chat', total: 24 },
      { key: 'reasoner', total: 10 },
    ])
  })
})

describe('dailyStats', () => {
  it('regroups quarter buckets into UTC calendar days with series splits', () => {
    const daily = dailyStats(
      combineProjections([
        stats(Date.UTC(2026, 7, 18, 10, 0), 'deepseek', 'chat', buckets(10)),
        stats(Date.UTC(2026, 7, 19, 9, 0), 'deepseek', 'chat', buckets(5)),
        stats(Date.UTC(2026, 7, 19, 9, 30), 'openai', 'gpt', buckets(2)),
      ]),
      'UTC',
      'provider',
    )
    expect(daily).toEqual([
      { day: '2026-08-18', total: 20, bySeries: new Map([['deepseek', 20]]) },
      { day: '2026-08-19', total: 14, bySeries: new Map([['deepseek', 10], ['openai', 4]]) },
    ])
  })

  it('splits half-hour-offset days exactly (Asia/Kolkata, UTC+5:30)', () => {
    // 18:15 UTC is 23:45 IST on the same calendar day; the next quarter,
    // 18:30 UTC, is already 00:00 IST on the following day. Hour buckets
    // could not make this cut; quarter buckets can.
    const daily = dailyStats(
      combineProjections([
        stats(Date.UTC(2026, 7, 19, 18, 15), 'deepseek', 'chat', buckets(10)),
        stats(Date.UTC(2026, 7, 19, 18, 30), 'deepseek', 'chat', buckets(5)),
      ]),
      'Asia/Kolkata',
      'provider',
    )
    expect(daily).toEqual([
      { day: '2026-08-19', total: 20, bySeries: new Map([['deepseek', 20]]) },
      { day: '2026-08-20', total: 10, bySeries: new Map([['deepseek', 10]]) },
    ])
  })
})

describe('monthlyStats', () => {
  it('folds days into calendar months', () => {
    const daily = [
      { day: '2026-07-31', total: 3, bySeries: new Map<string, number>() },
      { day: '2026-08-01', total: 4, bySeries: new Map<string, number>() },
      { day: '2026-08-19', total: 5, bySeries: new Map<string, number>() },
    ]
    expect(monthlyStats(daily)).toEqual([
      { month: '2026-07', total: 3 },
      { month: '2026-08', total: 9 },
    ])
  })
})

describe('dailyStatsToCsv', () => {
  const row = (day: string, total: number) => ({ day, total, bySeries: new Map<string, number>() })

  it('renders the header and one row per entry in input order', () => {
    expect(dailyStatsToCsv([row('2026-08-01', 10), row('2026-08-02', 20)]))
      .toBe('day,total\r\n2026-08-01,10\r\n2026-08-02,20\r\n')
  })

  it('keeps the header alone for an empty range', () => {
    expect(dailyStatsToCsv([])).toBe('day,total\r\n')
  })

  it('quotes fields carrying a comma, quote, or line break with doubled quotes', () => {
    expect(dailyStatsToCsv([row('a,b', 1)])).toBe('day,total\r\n"a,b",1\r\n')
    expect(dailyStatsToCsv([row('a"b', 1)])).toBe('day,total\r\n"a""b",1\r\n')
    expect(dailyStatsToCsv([row('a\nb', 1)])).toBe('day,total\r\n"a\nb",1\r\n')
  })
})

describe('usageStreaks', () => {
  it('counts the current run back from an active today', () => {
    expect(usageStreaks(['2026-08-17', '2026-08-18', '2026-08-19'], '2026-08-19'))
      .toEqual({ current: 3, longest: 3 })
  })

  it('keeps the current streak alive through yesterday when today has no usage yet', () => {
    expect(usageStreaks(['2026-08-17', '2026-08-18'], '2026-08-19'))
      .toEqual({ current: 2, longest: 2 })
  })

  it('ends the current streak at a two-day gap', () => {
    expect(usageStreaks(['2026-08-15', '2026-08-16'], '2026-08-19'))
      .toEqual({ current: 0, longest: 2 })
  })

  it('tracks the longest run across a gap', () => {
    expect(usageStreaks(['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-18', '2026-08-19'], '2026-08-19'))
      .toEqual({ current: 2, longest: 3 })
  })
})

describe('peakDay', () => {
  it('returns the highest-total day', () => {
    const daily = [
      { day: '2026-08-18', total: 4, bySeries: new Map<string, number>() },
      { day: '2026-08-19', total: 9, bySeries: new Map<string, number>() },
    ]
    expect(peakDay(daily)?.day).toBe('2026-08-19')
  })

  it('returns null over no days', () => {
    expect(peakDay([])).toBeNull()
  })
})

describe('rangeStartDay', () => {
  it('computes each window start from today', () => {
    expect(rangeStartDay('week', '2026-08-19')).toBe('2026-08-13')
    expect(rangeStartDay('month30', '2026-08-19')).toBe('2026-07-21')
    expect(rangeStartDay('thisMonth', '2026-08-19')).toBe('2026-08-01')
    expect(rangeStartDay('all', '2026-08-19')).toBeNull()
  })
})

describe('day helpers', () => {
  it('shifts days across month boundaries', () => {
    expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDay('2026-07-31', 1)).toBe('2026-08-01')
  })

  it('indexes weekdays Monday-first', () => {
    expect(mondayIndex('2026-08-17')).toBe(0)
    expect(mondayIndex('2026-08-19')).toBe(2)
    expect(mondayIndex('2026-08-23')).toBe(6)
  })
})

describe('formatTokens', () => {
  it('compacts magnitudes with one decimal under three digits', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_240)).toBe('12.2K')
    expect(formatTokens(1_234_567)).toBe('1.2M')
  })
})
