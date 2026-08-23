/**
 * The draft-budget readout: one muted line in the composer dock (the stats
 * line's neighborhood) estimating the current draft's token cost and, when
 * the provider has reported context figures, the after-send occupancy.
 * Everything arrives as slot props — the live draft through the dock's
 * InputZone share, the context baseline through the session projection —
 * so the component owns no subscription beyond a 250 ms trailing debounce
 * that keeps the estimate from re-rendering per keystroke.
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { estimateDraftTokens, formatTokenCount } from './estimate.ts'
import css from './DraftBudgetReadout.module.css'

/** The debounce window between a draft edit and the re-estimate, in ms. */
const SETTLE_DEBOUNCE_MS = 250

/** Full dock props: the composer.dock runtime kit (useInput/useProjection) + the locale seat. */
export type DraftBudgetReadoutProps =
  PropsRuntime<'conversation.composer.dock'>
  & PropsLocale<'draftBudget'>

/**
 * The dock entry: the estimate line, or nothing for an empty draft.
 * @param props - the composed dock props.
 * @returns the readout line, or null.
 */
export function DraftBudgetReadout({ useInput, useProjection, t }: DraftBudgetReadoutProps) {
  const draft = useInput(state => state.draft)
  const pressure = useProjection('contextPressure')
  const [settled, setSettled] = useState(draft)

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(draft)
    }, SETTLE_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [draft])

  if (settled.trim() === '') return null

  const tokens = estimateDraftTokens(settled)
  const folded = formatTokenCount(tokens)
  // The occupancy baseline prefers the provider-anchored projection (real
  // usage plus the meter's repriced delta); only the draft increment below
  // is heuristic. Both figures must exist for a percentage at all.
  const baseline = pressure?.projectedTokens ?? pressure?.pressureTokens
  const windowTokens = pressure?.contextWindow
  const afterSend = baseline === undefined || windowTokens === undefined || windowTokens <= 0
    ? undefined
    : Math.min(100, Math.round((baseline + tokens) / windowTokens * 100))

  return (
    <div
      className={css.readout}
      data-draft-budget={afterSend === undefined ? 'tokens' : 'full'}
      aria-label={afterSend === undefined
        ? t('chip.ariaTokens', { count: folded })
        : t('chip.aria', { count: folded, percent: String(afterSend) })}
    >
      <span className={css.tokens}>{t('chip.tokens', { count: folded })}</span>
      {afterSend !== undefined && (
        <span className={css.afterSend}>{t('chip.afterSend', { percent: String(afterSend) })}</span>
      )}
    </div>
  )
}
