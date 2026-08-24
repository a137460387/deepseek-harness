/**
 * The usage-fold contract spec (host plane): `usageStats` intentionally
 * mirrors `tokenUsage`'s intake semantics — chunk/message samples with their
 * (turn, step) replacement rule, compaction summaries accumulated in full —
 * while re-splitting the same samples into quarter/route buckets. This spec
 * folds representative corpora through the real
 * `tokenUsageProjectionDefinition` (imported through token-meter's `./src/*`
 * subpath export) and through the fork's `usageStatsProjectionDefinition`,
 * and the summed bucket mass must agree at EVERY prefix of the log: either
 * fold drifting from the other turns this red on the next upstream sync. A
 * static import is safe on the host plane — unlike the client fixture
 * contract, this typecheck program already carries the cordis service merges.
 */
import { describe, expect, it } from 'vitest'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: the `compaction/summary` SessionEventMap merge (summarizer usage).
import type {} from '@deepseek-ai/dsh-compaction'
import { tokenUsageProjectionDefinition } from '@deepseek-ai/dsh-token-meter/src/usage-projection.ts'
import { usageStatsProjectionDefinition } from '../src/projection.ts'
import type { UsageStatsProjection } from '../src/types.ts'

/** A synthetic event at a controlled time. */
function event(time: number, body: Omit<SessionEvent, 'seq' | 'time'>): SessionEvent {
  return { ...body, seq: 0, time } as SessionEvent
}

/** A request/header event carrying a provider/model route. */
function headerEvent(time: number, provider: string, model: string): SessionEvent {
  return event(time, {
    type: 'request/header',
    data: {
      header: { config: { provider, model } },
      reason: 'initial',
    },
  })
}

/** A usage-chunk event for one step. */
function chunkEvent(time: number, turn: number, step: number, usage: TokenUsage): SessionEvent {
  return event(time, {
    type: 'assistant/chunk',
    data: { turn, step, chunk: { type: 'usage', usage } },
  })
}

/** A finalized assistant message for one step. */
function messageEvent(time: number, turn: number, step: number, usage?: TokenUsage): SessionEvent {
  return event(time, {
    type: 'assistant/message',
    data: {
      turn,
      step,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      ...usage === undefined ? {} : { usage },
    },
  })
}

/** A completed compaction summary with its own route. */
function summaryEvent(time: number, usage?: TokenUsage): SessionEvent {
  return event(time, {
    type: 'compaction/summary',
    data: {
      compactionId: 'compact-1' as never,
      summary: [{ type: 'text', text: 'summary' }],
      shadowedRange: { start: 1, end: 2 },
      shadowedSeqs: [1, 2],
      shadowedTokenCount: 10,
      provider: 'summarizer',
      model: 'summarizer-model',
      ...usage === undefined ? {} : { usage },
    },
  })
}

/** Sum every bucket in the quarters record into one aggregate. */
function totalOf(quarters: UsageStatsProjection['quarters']) {
  const total = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const byProvider of Object.values(quarters)) {
    for (const byModel of Object.values(byProvider)) {
      for (const bucket of Object.values(byModel)) {
        total.uncachedInputTokens += bucket.uncachedInputTokens
        total.outputTokens += bucket.outputTokens
        total.cacheReadTokens += bucket.cacheReadTokens
        total.cacheWriteTokens += bucket.cacheWriteTokens
      }
    }
  }
  return total
}

/** The real fold's wire totals; the only real-side surface this spec reads. */
interface BucketTotals {
  uncachedInputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/**
 * The fold members this spec drives on the real definition; unknown-typed so
 * no real state shape is mirrored here (its `init` infers a literal `last:
 * null` the reassignment below could not follow).
 */
interface UsageFold {
  init(): unknown
  apply(state: unknown, event: SessionEvent): unknown
  wire: { view(state: unknown): BucketTotals }
}

const realFold: UsageFold = tokenUsageProjectionDefinition

/** Fold both definitions over every prefix and compare the bucket mass. */
function agreeAtEveryPrefix(events: readonly SessionEvent[]): void {
  let usageStatsState = usageStatsProjectionDefinition.init()
  let realState: unknown = realFold.init()
  for (const item of events) {
    usageStatsState = usageStatsProjectionDefinition.apply(usageStatsState, item)
    realState = realFold.apply(realState, item)
    const forkView = usageStatsProjectionDefinition.wire.view(usageStatsState)
    expect(totalOf(forkView.quarters)).toEqual(realFold.wire.view(realState))
  }
}

describe('usageStats fold contract against token-meter', () => {
  const T0 = 1_800_000_000_000

  it('keeps the summed bucket mass equal to tokenUsage totals at every prefix', () => {
    const corpora: readonly (readonly SessionEvent[])[] = [
      // A chunk replaced by its step's final message.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        messageEvent(T0 + 2_000, 1, 1, { inputTokens: 14, outputTokens: 5 }),
      ],
      // The identical final sample after its chunk: no movement.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        messageEvent(T0 + 1_500, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      ],
      // A chunk-only sample survives without a final message.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 9, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 1 }),
      ],
      // Compaction summaries accumulate in full, with and without usage.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        summaryEvent(T0 + 2_000, { inputTokens: 40, outputTokens: 6, cacheWriteTokens: 2 }),
        summaryEvent(T0 + 3_000),
        messageEvent(T0 + 4_000, 1, 1, { inputTokens: 12, outputTokens: 3 }),
      ],
      // A route change mid-stream re-attributes later samples only.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        headerEvent(T0 + 2_000, 'openai', 'gpt'),
        chunkEvent(T0 + 3_000, 1, 2, { inputTokens: 7, outputTokens: 1 }),
      ],
      // The replacement crosses a quarter boundary and preserves its mass.
      [
        headerEvent(T0 - 1, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        messageEvent(T0 + 900_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      ],
      // A replacement down to zero empties the placement.
      [
        headerEvent(T0, 'deepseek', 'deepseek-chat'),
        chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
        messageEvent(T0 + 2_000, 1, 1, { inputTokens: 0, outputTokens: 0 }),
      ],
    ]
    for (const corpus of corpora) agreeAtEveryPrefix(corpus)
  })
})
