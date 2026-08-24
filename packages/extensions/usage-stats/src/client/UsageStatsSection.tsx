/**
 * The usage statistics settings section: headline cards (total, peak day,
 * streaks), a token activity calendar with daily/weekly/cumulative modes, a
 * range-scoped multi-series trend chart, and a route-share donut — all
 * aggregated client-side from every session's `usageStats` projection value
 * in the controller's snapshot store. Token counts only; no pricing.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/UsageStatsSection
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HeatmapMode, RouteDimension, StatsRange } from './aggregate.ts'
import {
  combineProjections, dailyStats, formatTokens, peakDay, rangeStartDay, seriesTotals, todayKey,
  usageStreaks,
} from './aggregate.ts'
import type { UsageStatsSectionState } from './stats-store.ts'
import { HeatmapCalendar } from './charts/HeatmapCalendar.tsx'
import { TrendChart } from './charts/TrendChart.tsx'
import type { TrendSeries } from './charts/TrendChart.tsx'
import { DonutChart } from './charts/DonutChart.tsx'
import { seriesColor } from './charts/palette.ts'
import type { UsageStatsKey } from './locales.ts'
import css from './UsageStatsSection.module.css'

/** Registration-side business face for the statistics section. */
export interface UsageStatsSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useUsageStats. */
    usageStats: SnapshotStore<UsageStatsSectionState>
  }
  /** Gather every session's usage value; called on mount and on refresh. */
  load: () => Promise<void>
}

/** Full component props. */
export type UsageStatsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'usageStats'>
  & InjectFace<UsageStatsSectionInjected>

const RANGE_OPTIONS: readonly { value: StatsRange; key: UsageStatsKey }[] = [
  { value: 'week', key: 'range.week' },
  { value: 'month30', key: 'range.month30' },
  { value: 'thisMonth', key: 'range.thisMonth' },
  { value: 'all', key: 'range.all' },
]

const DIMENSION_OPTIONS: readonly { value: RouteDimension; key: UsageStatsKey }[] = [
  { value: 'provider', key: 'trend.byProvider' },
  { value: 'model', key: 'trend.byModel' },
]

const MODE_OPTIONS: readonly { value: HeatmapMode; key: UsageStatsKey }[] = [
  { value: 'daily', key: 'heatmap.daily' },
  { value: 'weekly', key: 'heatmap.weekly' },
  { value: 'cumulative', key: 'heatmap.cumulative' },
]

const WEEKDAY_KEYS: readonly UsageStatsKey[] = [
  'weekday.mon', 'weekday.tue', 'weekday.wed', 'weekday.thu', 'weekday.fri', 'weekday.sat', 'weekday.sun',
]

/**
 * Render the usage statistics section content column.
 * @param props - composed slot props.
 * @returns the section with its cards, calendar, trend, and donut.
 */
export function UsageStatsSection(props: UsageStatsSectionProps): ReactNode {
  const { useUsageStats, t, load } = props
  const state = useUsageStats(snapshot => snapshot)
  const [range, setRange] = useState<StatsRange>('week')
  const [dimension, setDimension] = useState<RouteDimension>('model')
  const [mode, setMode] = useState<HeatmapMode>('daily')

  useEffect(() => {
    void load()
  }, [load])

  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const today = useMemo(() => todayKey(timeZone), [timeZone])

  const combined = useMemo(
    () => combineProjections(Object.values(state.values)),
    [state.values],
  )
  const daily = useMemo(
    () => dailyStats(combined, timeZone, dimension),
    [combined, timeZone, dimension],
  )
  const totals = useMemo(
    () => new Map(daily.map(entry => [entry.day, entry.total])),
    [daily],
  )
  const totalTokens = useMemo(
    () => daily.reduce((sum, entry) => sum + entry.total, 0),
    [daily],
  )
  const streaks = useMemo(
    () => usageStreaks(daily.filter(entry => entry.total > 0).map(entry => entry.day), today),
    [daily, today],
  )
  const peak = useMemo(() => peakDay(daily), [daily])

  const visible = useMemo(() => {
    const start = rangeStartDay(range, today)
    return start === null ? daily : daily.filter(entry => entry.day >= start)
  }, [daily, range, today])

  const trend = useMemo(() => {
    const windowTotals = new Map<string, number>()
    for (const entry of visible) {
      for (const [key, value] of entry.bySeries) {
        windowTotals.set(key, (windowTotals.get(key) ?? 0) + value)
      }
    }
    const keys = [...windowTotals.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([key]) => key)
    const series: TrendSeries[] = keys.map(key => ({
      key,
      points: visible.map(entry => entry.bySeries.get(key) ?? 0),
    }))
    return { days: visible.map(entry => entry.day), series }
  }, [visible])

  const shares = useMemo(() => seriesTotals(combined, dimension), [combined, dimension])

  // The calendar covers everything up to a year: enough columns for the
  // first active day (at least four so a fresh install is not one lonely
  // column), never more than 53.
  const weeks = useMemo(() => {
    const first = daily.find(entry => entry.total > 0)?.day
    if (first === undefined) return 4
    const spanDays = Math.ceil((Date.parse(today) - Date.parse(first)) / 86_400_000) + 7
    return Math.min(53, Math.max(4, Math.ceil(spanDays / 7)))
  }, [daily, today])

  const absent = state.status === 'ready'
    && state.sessionCount > 0
    && state.absentCount === state.sessionCount

  // The trend block and the donut block share one dimension toggle.
  const dimensionToggle = (ariaLabel: string): ReactNode => (
    <div className={css.toggle} role="group" aria-label={ariaLabel}>
      {DIMENSION_OPTIONS.map(option => (
        <button
          key={option.value}
          type="button"
          className={dimension === option.value ? css.toggleOn : css.toggleOff}
          aria-pressed={dimension === option.value}
          onClick={() => { setDimension(option.value) }}
        >
          {t(option.key)}
        </button>
      ))}
    </div>
  )

  return (
    <div className={css.section}>
      <div className={css.head}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.intro}>{t('intro')}</p>
        </div>
        <button type="button" className={css.refresh} onClick={() => { void load() }}>
          {t('refresh')}
        </button>
      </div>

      {state.error === null ? null : (
        <p className={css.error} role="alert">{t('error', { message: state.error })}</p>
      )}
      {state.status === 'loading' && Object.keys(state.values).length === 0
        ? <p className={css.placeholder}>{t('loading')}</p>
        : null}
      {absent ? <p className={css.error}>{t('absent')}</p> : null}

      {state.status === 'error' && Object.keys(state.values).length === 0 ? (
        <button type="button" className={css.refresh} onClick={() => { void load() }}>
          {t('retry')}
        </button>
      ) : (
        <>
          <div className={css.cards}>
            <div className={css.card}>
              <span className={css.cardLabel}>{t('card.total')}</span>
              <span className={css.cardValue}>{formatTokens(totalTokens)}</span>
            </div>
            <div className={css.card}>
              <span className={css.cardLabel}>{t('card.peak')}</span>
              <span className={css.cardValue}>
                {peak === null || peak.total === 0 ? t('card.noPeak') : formatTokens(peak.total)}
              </span>
              {peak === null || peak.total === 0 ? null : (
                <span className={css.cardSub}>{peak.day}</span>
              )}
            </div>
            <div className={css.card}>
              <span className={css.cardLabel}>{t('card.currentStreak')}</span>
              <span className={css.cardValue}>{streaks.current}</span>
              <span className={css.cardSub}>{t('card.dayUnit')}</span>
            </div>
            <div className={css.card}>
              <span className={css.cardLabel}>{t('card.longestStreak')}</span>
              <span className={css.cardValue}>{streaks.longest}</span>
              <span className={css.cardSub}>{t('card.dayUnit')}</span>
            </div>
          </div>

          <section className={css.block}>
            <div className={css.blockHead}>
              <h3 className={css.blockTitle}>{t('heatmap.title')}</h3>
              <div className={css.toggle} role="group" aria-label={t('heatmap.title')}>
                {MODE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    className={mode === option.value ? css.toggleOn : css.toggleOff}
                    aria-pressed={mode === option.value}
                    onClick={() => { setMode(option.value) }}
                  >
                    {t(option.key)}
                  </button>
                ))}
              </div>
            </div>
            <div className={css.heatmapWrap}>
              <HeatmapCalendar
                totals={totals}
                weeks={weeks}
                mode={mode}
                today={today}
                ariaLabel={t('heatmap.title')}
                weekdayLabels={WEEKDAY_KEYS.map(key => t(key))}
                legend={{ less: t('heatmap.less'), more: t('heatmap.more') }}
              />
            </div>
          </section>

          <section className={css.block}>
            <div className={css.blockHead}>
              <h3 className={css.blockTitle}>{t('trend.title')}</h3>
              <div className={css.controls}>
                {dimensionToggle(t('trend.title'))}
                <div className={css.toggle} role="group" aria-label={t('range.all')}>
                  {RANGE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={range === option.value ? css.toggleOn : css.toggleOff}
                      aria-pressed={range === option.value}
                      onClick={() => { setRange(option.value) }}
                    >
                      {t(option.key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {trend.days.length === 0
              ? <p className={css.placeholder}>{t('empty')}</p>
              : (
                <>
                  <div className={css.chartWrap}>
                    <TrendChart
                      days={trend.days}
                      series={trend.series}
                      ariaLabel={t('trend.title')}
                    />
                  </div>
                  <ul className={css.legend}>
                    {trend.series.map((line, index) => (
                      <li key={line.key} className={css.legendRow}>
                        <span
                          className={css.legendSwatch}
                          style={{ background: seriesColor(index) }}
                          aria-hidden="true"
                        />
                        {line.key}
                      </li>
                    ))}
                  </ul>
                </>
              )}
          </section>

          <section className={css.block}>
            <div className={css.blockHead}>
              <h3 className={css.blockTitle}>{t('donut.title')}</h3>
              {dimensionToggle(t('donut.title'))}
            </div>
            {shares.length === 0
              ? <p className={css.placeholder}>{t('empty')}</p>
              : (
                <div className={css.chartWrap}>
                  <DonutChart
                    shares={shares}
                    totalLabel={t('card.total')}
                    ariaLabel={t('donut.title')}
                  />
                </div>
              )}
          </section>
        </>
      )}
    </div>
  )
}
