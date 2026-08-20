/**
 * Usage-share donut: one SVG arc per series over the shared palette, the
 * total in the hole, and a legend row with each series' share. Pure SVG.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/charts/DonutChart
 */

import type { ReactNode } from 'react'
import { formatTokens } from '../aggregate.ts'
import { seriesColor } from './palette.ts'
import css from '../UsageStatsSection.module.css'

/** One donut share. */
export interface DonutShare {
  /** Series identity (provider or model name). */
  key: string
  /** The series' token total. */
  total: number
}

/** Props of the donut chart. */
export interface DonutChartProps {
  /** Shares, largest first; the assignment order fixes palette colors. */
  shares: readonly DonutShare[]
  /** Legend caption for the whole-usage row. */
  totalLabel: string
  /** Accessible summary of the chart. */
  ariaLabel: string
}

/** Ring geometry in viewBox units. */
const SIZE = 120
const CENTER = SIZE / 2
const RADIUS = 44
const STROKE = 16

/**
 * Render the donut chart.
 * @param props - shares and labels.
 * @returns the chart SVG plus its legend list.
 */
export function DonutChart(props: DonutChartProps): ReactNode {
  const { shares, totalLabel, ariaLabel } = props
  const total = shares.reduce((sum, share) => sum + share.total, 0)
  const circumference = 2 * Math.PI * RADIUS
  let offset = 0

  return (
    <div className={css.usageDonut}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
      >
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          className={css.usageDonutTrack}
        />
        {shares.map((share, index) => {
          const fraction = total === 0 ? 0 : share.total / total
          const dash = fraction * circumference
          const element = (
            <circle
              key={share.key}
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
              fill="none"
              stroke={seriesColor(index)}
              strokeWidth={STROKE}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${CENTER} ${CENTER})`}
            />
          )
          offset += dash
          return element
        })}
        <text x={CENTER} y={CENTER - 2} textAnchor="middle" className={css.usageDonutTotal}>
          {formatTokens(total)}
        </text>
        <text x={CENTER} y={CENTER + 14} textAnchor="middle" className={css.usageDonutCaption}>
          {totalLabel}
        </text>
      </svg>
      <ul className={css.usageDonutLegend}>
        {shares.map((share, index) => (
          <li key={share.key} className={css.usageDonutLegendRow}>
            <span
              className={css.usageDonutSwatch}
              style={{ background: seriesColor(index) }}
              aria-hidden="true"
            />
            <span className={css.usageDonutLegendKey}>{share.key}</span>
            <span className={css.usageDonutLegendValue}>
              {total === 0 ? '0%' : `${Math.round((share.total / total) * 100)}%`}
            </span>
            <span className={css.usageDonutLegendTokens}>{formatTokens(share.total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
