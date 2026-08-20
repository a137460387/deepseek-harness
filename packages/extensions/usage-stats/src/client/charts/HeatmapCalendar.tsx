/**
 * GitHub-style token activity calendar: one column per week (Monday-first
 * rows), colored by the selected mode — the day's total, its week column's
 * total, or the cumulative total to date. Pure SVG over the shared theme
 * tokens; each cell's `title` is its accessible per-day figure.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/charts/HeatmapCalendar
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { DayKey, HeatmapMode } from '../aggregate.ts'
import { formatTokens, mondayIndex, shiftDay } from '../aggregate.ts'
import { HEATMAP_LEVELS } from './palette.ts'
import css from '../UsageStatsSection.module.css'

/** Cell geometry: 13px squares with 3px gaps; a label gutter and month row. */
const CELL = 13
const GAP = 3
const LABEL_WIDTH = 22
const MONTH_ROW = 14

/** Props of the activity calendar. */
export interface HeatmapCalendarProps {
  /** Day → token total over all history (the window reads a slice of it). */
  totals: ReadonlyMap<DayKey, number>
  /** Column count ending at the current week. */
  weeks: number
  /** Coloring mode. */
  mode: HeatmapMode
  /** Viewer-local today, anchoring the window's right edge. */
  today: DayKey
  /** Accessible summary of the whole calendar. */
  ariaLabel: string
  /** Weekday short labels, Monday-first, seven entries. */
  weekdayLabels: readonly string[]
  /** The `less`/`more` legend pair. */
  legend: { less: string; more: string }
}

/**
 * Render the activity calendar.
 * @param props - the day totals, window, mode, and labels.
 * @returns the calendar SVG.
 */
export function HeatmapCalendar(props: HeatmapCalendarProps): ReactNode {
  const { totals, weeks, mode, today, ariaLabel, weekdayLabels, legend } = props

  const cells = useMemo(() => {
    // The window ends at the current week's Sunday so a mid-week week still
    // renders whole; `weeks` columns reach back from there.
    const weekEnd = shiftDay(today, 6 - mondayIndex(today))
    const windowStart = shiftDay(weekEnd, -(weeks * 7 - 1))

    // Per-cell raw values by mode: the day total, its week column's total, or
    // the cumulative total to date (seeded by pre-window history so the first
    // window cell already carries earlier usage).
    const raw: number[] = []
    let running = 0
    for (const [day, value] of totals) {
      if (day < windowStart) running += value
    }
    for (let week = 0; week < weeks; week++) {
      let weekTotal = 0
      const weekDays: number[] = []
      for (let row = 0; row < 7; row++) {
        const day = shiftDay(windowStart, week * 7 + row)
        const value = totals.get(day) ?? 0
        weekTotal += value
        if (mode === 'daily') weekDays.push(value)
        else if (mode === 'cumulative') {
          running += value
          weekDays.push(running)
        }
      }
      if (mode === 'weekly') raw.push(...Array.from({ length: 7 }, () => weekTotal))
      else raw.push(...weekDays)
    }

    const max = raw.reduce((max, value) => Math.max(max, value), 0)
    return raw.map((value, index) => {
      const day = shiftDay(windowStart, index)
      const level = value <= 0 || max === 0
        ? 0
        : Math.min(4, Math.max(1, Math.ceil((value / max) * 4)))
      return { day, level, title: `${day} · ${formatTokens(value)}` }
    })
  }, [totals, weeks, mode, today])

  const width = LABEL_WIDTH + weeks * (CELL + GAP)
  const height = MONTH_ROW + 7 * (CELL + GAP)
  const visibleWeekdays = [0, 2, 4]
  const legendRight = LABEL_WIDTH + weeks * (CELL + GAP)

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
    >
      {cells.map((cell, index) => (
        <rect
          key={cell.day}
          x={LABEL_WIDTH + Math.floor(index / 7) * (CELL + GAP)}
          y={MONTH_ROW + (index % 7) * (CELL + GAP)}
          width={CELL}
          height={CELL}
          rx={2}
          fill={HEATMAP_LEVELS[cell.level]}
        >
          <title>{cell.title}</title>
        </rect>
      ))}
      {visibleWeekdays.map(row => (
        <text
          key={row}
          x={0}
          y={MONTH_ROW + row * (CELL + GAP) + CELL - 2}
          className={css.usageHeatmapLabel}
        >
          {weekdayLabels[row]}
        </text>
      ))}
      {/* Month label above the first column whose month differs from the
          previous column's; GitHub's calendar convention. */}
      {cells.map((cell, index) => {
        if (index % 7 !== 0) return null
        const week = Math.floor(index / 7)
        const month = cell.day.slice(5, 7)
        const previousCell = week > 0 ? cells[(week - 1) * 7] : undefined
        if (previousCell !== undefined && previousCell.day.slice(5, 7) === month) return null
        return (
          <text
            key={`m-${cell.day}`}
            x={LABEL_WIDTH + week * (CELL + GAP)}
            y={9}
            className={css.usageHeatmapLabel}
          >
            {month}
          </text>
        )
      })}
      {HEATMAP_LEVELS.map((fill, level) => (
        <rect
          key={level}
          x={legendRight - 5 * (CELL + GAP) + level * (CELL + GAP)}
          y={height - CELL - 1}
          width={CELL}
          height={CELL}
          rx={2}
          fill={fill}
        />
      ))}
      <text
        x={legendRight - 5 * (CELL + GAP) - 4}
        y={height - 2}
        textAnchor="end"
        className={css.usageHeatmapLabel}
      >
        {legend.less}
      </text>
      <text x={legendRight + 2} y={height - 2} className={css.usageHeatmapLabel}>
        {legend.more}
      </text>
    </svg>
  )
}
