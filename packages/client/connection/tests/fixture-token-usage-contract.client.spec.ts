/**
 * The usage-mirror contract spec: the fixture's whole-log tokenUsage fold is
 * a parallel of token-meter's real projection, and the compaction-summary
 * branch both sides carry had no coverage on the fixture side. One corpus —
 * usage chunks, a same-step replacement, an identical repeat, a later step,
 * compaction summaries with and without usage — folds through the real
 * `tokenUsageProjectionDefinition` and the fixture's `tokenUsageOf`; the
 * wire values must agree at EVERY prefix of the log, so either
 * implementation drifting turns this red on the next sync.
 *
 * The real fold is reached through a dynamic import with a computed
 * specifier: token-meter's usage-projection.ts lives on the host plane, and
 * a static import would load its cordis service merges into this client
 * typecheck program (re-typing ctx.get('sessions') for every other spec).
 * The unknown-typed fold interface below is the only surface this spec
 * reads — no semantics are mirrored.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: the `compaction/summary` SessionEventMap merge (summarizer usage).
import type {} from '@deepseek-ai/dsh-compaction/types'
import { tokenUsageOf } from '../src/client/fixture.ts'

/** The fold members this spec drives; unknown-typed so nothing is mirrored. */
interface UsageFold {
  init(): unknown
  apply(state: unknown, event: SessionEvent): unknown
  wire: { view(state: unknown): unknown }
}

/** Load the real projection definition off the static typecheck path. */
async function loadRealFold(): Promise<UsageFold> {
  const specifier = '@deepseek-ai/dsh-token-meter/src/usage-projection.ts'
  const module = await import(/* @vite-ignore */ specifier) as { tokenUsageProjectionDefinition: UsageFold }
  return module.tokenUsageProjectionDefinition
}

/** One provider usage sample the way the wire reports it. */
interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Corpus rows carry only the fields the two folds read; the envelope is cast the way buildAlphaLog casts its own authored rows. */
function row(type: string, data: Record<string, unknown>, index: number): SessionEvent {
  return { seq: index, time: 1_000 + index * 800, type, data } as unknown as SessionEvent
}

/** The corpus both folds must agree on, in order. */
function corpus(): SessionEvent[] {
  const chunk = (turn: number, step: number, usage: Usage) => ({
    type: 'assistant/chunk',
    data: { turn, step, chunk: { type: 'usage', usage } },
  })
  const message = (turn: number, step: number, usage: Usage) => ({
    type: 'assistant/message',
    data: { turn, step, usage },
  })
  const summary = (usage: Usage | undefined) => ({
    type: 'compaction/summary',
    data: { provider: 'summarizer', model: 'summarizer', ...(usage === undefined ? {} : { usage }) },
  })
  const rows = [
    chunk(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 5 }),
    // The finalized message for the same step replaces the chunk's sample.
    message(1, 1, { inputTokens: 120, outputTokens: 12, cacheReadTokens: 5 }),
    // An identical repeat is no movement at all.
    message(1, 1, { inputTokens: 120, outputTokens: 12, cacheReadTokens: 5 }),
    chunk(1, 2, { inputTokens: 200, outputTokens: 20 }),
    // A summarizer that reported usage: accumulated in full, no turn/step.
    summary({ inputTokens: 31, outputTokens: 9, cacheReadTokens: 37, cacheWriteTokens: 6 }),
    // A summarizer that reported none: contributes nothing.
    summary(undefined),
    chunk(2, 1, { inputTokens: 400, outputTokens: 40, cacheWriteTokens: 3 }),
    message(2, 1, { inputTokens: 410, outputTokens: 41, cacheWriteTokens: 3 }),
  ]
  return rows.map(({ type, data }, index) => row(type, data, index))
}

/** Fold the real projection over a log prefix and read its wire value. */
function realWireValue(fold: UsageFold, log: readonly SessionEvent[]): unknown {
  let state = fold.init()
  for (const event of log) state = fold.apply(state, event)
  return fold.wire.view(state)
}

describe('fixture tokenUsage mirror contract', () => {
  it('matches the real projection at every prefix of the corpus', async () => {
    const fold = await loadRealFold()
    const log = corpus()
    for (let cut = 0; cut <= log.length; cut++) {
      const prefix = log.slice(0, cut)
      expect(tokenUsageOf(prefix)).toEqual(realWireValue(fold, prefix))
    }
  })

  it('pins the corpus arithmetic by hand: replacement, compaction in full, repeat at zero', () => {
    // step1: chunk 100/10/5 replaced by the final message 120/12/5 → 120/12/5/0
    // step2: a NEW step accumulates in full +200/20 → 320/32/5/0
    // summary: +31/9/37/6 in full → 351/41/42/6 (the summary without usage adds nothing)
    // turn2 step1: another new step, +400/40/0/3 → 751/81/42/9
    // final message for the same step replaces: 751-400+410 → 761/82/42/9
    expect(tokenUsageOf(corpus())).toEqual({
      uncachedInputTokens: 761,
      outputTokens: 82,
      cacheReadTokens: 42,
      cacheWriteTokens: 9,
    })
  })
})
