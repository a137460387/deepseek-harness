/**
 * The draft's token estimate: a local mirror of the token-meter's fixed
 * density heuristic for one plain-text user message, so the readout prices
 * a draft at exactly what the meter will charge it when sent. The mirror is
 * deliberately three constants and one expression — the contract spec pins
 * it against the real `estimateMessage` from
 * `@deepseek-ai/dsh-token-meter/src/estimate.ts`, so an upstream formula
 * change turns this fork's own test red on the next sync.
 *
 * Precision honesty: the heuristic itself is approximate — upstream
 * documents systematic underpricing of CJK text and JSON schemas, and the
 * community has measured tens-of-percent divergence from provider-reported
 * usage in long sessions (discussion #3514). Every surfaced figure carries
 * a `~`; the after-send occupancy anchors its baseline on the
 * provider-reported projection and lets the heuristic price only the draft
 * increment.
 * @module @deepseek-ai/dsh-client-draft-budget/client/estimate
 */

/** Text density: characters per token, mirroring the meter's CHARS_PER_TOKEN. */
export const DRAFT_CHARS_PER_TOKEN = 4

/** Per-block framing overhead, mirroring the meter's BLOCK_OVERHEAD. */
export const DRAFT_BLOCK_OVERHEAD = 4

/** Role-field framing overhead, mirroring the meter's ROLE_OVERHEAD. */
export const DRAFT_ROLE_OVERHEAD = 4

/**
 * Estimate the token cost of one plain-text draft as it will be sent.
 * @param text - the draft string (the sent message's single text block).
 * @returns heuristic tokens including block and role framing.
 */
export function estimateDraftTokens(text: string): number {
  return Math.ceil(text.length / DRAFT_CHARS_PER_TOKEN) + DRAFT_BLOCK_OVERHEAD + DRAFT_ROLE_OVERHEAD
}

/**
 * Fold a token count for display, matching the stats line's convention.
 * @param tokens - the raw count.
 * @returns the folded figure: plain integers under a thousand, one-decimal
 * `K` up to a million, `M` beyond.
 */
export function formatTokenCount(tokens: number): string {
  const scaled = (value: number): string =>
    value >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
  if (tokens < 1_000) return String(tokens)
  if (tokens < 1_000_000) return `${scaled(tokens / 1_000)}K`
  return `${scaled(tokens / 1_000_000)}M`
}
