/**
 * Chart series colors and heatmap intensity steps, all through the shared
 * theme tokens: series hues come from the static palette seats, intensities
 * from the DeepSeek blue scale, and anything beyond the palette falls back to
 * a neutral so a fifteenth model never invents a color.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client/charts/palette
 */

/** Distinct series hues in assignment order. */
export const SERIES_COLORS: readonly string[] = [
  'var(--dsw-static-deepseek-500)',
  'var(--dsw-static-green-500)',
  'var(--dsw-static-amber-500)',
  'var(--dsw-static-blue-500)',
  'var(--dsw-static-red-500)',
]

/** Hue for a series beyond the palette. */
export const SERIES_FALLBACK_COLOR = 'var(--dsw-static-neutral-bluish-500)'

/**
 * The color for one series by its assignment index.
 * @param index - zero-based series order.
 * @returns a CSS color value.
 */
export function seriesColor(index: number): string {
  const color = SERIES_COLORS[index]
  return color !== undefined ? color : SERIES_FALLBACK_COLOR
}

/** Heatmap cell fills from empty (level 0) to busiest (level 4). */
export const HEATMAP_LEVELS: readonly string[] = [
  'var(--dsw-static-neutral-bluish-100)',
  'var(--dsw-static-deepseek-100)',
  'var(--dsw-static-deepseek-300)',
  'var(--dsw-static-deepseek-400)',
  'var(--dsw-static-deepseek-600)',
]
