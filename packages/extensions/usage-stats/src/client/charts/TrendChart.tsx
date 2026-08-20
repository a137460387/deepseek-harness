/**
 * Multi-series token trend: one polyline per series over the selected day
 * window, with the shared palette assigning colors and a legend row mapping
 * each line to its label. Pure SVG; scales from the window's own maximum.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/charts/TrendChart
 */

import type { ReactNode } from 'react'
import type { DayKey } from '../aggregate.ts'
import { formatTokens } from '../aggregate.ts'
import { seriesColor } from './palette.ts'
import css from '../UsageStatsSection.module.css'

/** One trend line. */
export interface TrendSeries {
  /** Series identity (provider or model name). */
  key: string
  /** Token total per x position, aligned with the chart's days. */
  points: number[]
}

/** Props of the trend chart. */
export interface TrendChartProps {
  /** The window's days, ascending (the x axis). */
  days: readonly DayKey[]
  /** The lines to draw, in palette assignment order. */
  series: readonly TrendSeries[]
  /** Accessible summary of the chart. */
  ariaLabel: string
}

/** Plot geometry in viewBox units. */
const WIDTH = 560
const HEIGHT = 180
const PAD_LEFT = 44
const PAD_RIGHT = 12
const PAD_TOP = 10
const PAD_BOTTOM = 22

/**
 * Render the trend chart.
 * @param props - days, series, and the accessible summary.
 * @returns the chart SVG.
 */
export function TrendChart(props: TrendChartProps): ReactNode {
  const { days, series, ariaLabel } = props
  const max = series.reduce(
    (max, line) => line.points.reduce((m, v) => Math.max(m, v), max),
    0,
  )
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM
  const x = (index: number): number =>
    days.length <= 1 ? PAD_LEFT + plotWidth / 2 : PAD_LEFT + (index / (days.length - 1)) * plotWidth
  const y = (value: number): number =>
    PAD_TOP + plotHeight - (max === 0 ? 0 : (value / max) * plotHeight)

  const labelIndices = days.length <= 1
    ? [0]
    : [0, Math.floor((days.length - 1) / 2), days.length - 1]
  const gridValues = [0, max / 2, max]

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    >
      {gridValues.map((value, index) => (
        <g key={index}>
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={y(value)}
            y2={y(value)}
            className={css.usageTrendGrid}
          />
          <text x={PAD_LEFT - 6} y={y(value) + 4} textAnchor="end" className={css.usageTrendLabel}>
            {formatTokens(Math.round(value))}
          </text>
        </g>
      ))}
      {series.map((line, seriesIndex) => {
        const points = line.points
          .map((value, index) => `${x(index)},${y(value)}`)
          .join(' ')
        return (
          <polyline
            key={line.key}
            points={points}
            fill="none"
            stroke={seriesColor(seriesIndex)}
            strokeWidth={1.5}
            className={css.usageTrendLine}
          />
        )
      })}
      {labelIndices.map(index => (
        <text key={index} x={x(index)} y={HEIGHT - 6} textAnchor="middle" className={css.usageTrendLabel}>
          {days[index]}
        </text>
      ))}
    </svg>
  )
}
