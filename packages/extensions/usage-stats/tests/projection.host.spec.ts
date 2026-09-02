/**
 * The `usageStats` projection unit: route attribution follows the nearest
 * `request/header`, chunk samples are replaced by their step's final usage
 * (with the replacement moving quarter buckets when the two land apart),
 * compaction summaries accumulate on their own route, and zero results prune
 * their buckets. Time-sensitive semantics run against the exported
 * definition directly (event times are controlled); registry integration —
 * the empty log, HMR key removal, and the JSON checkpoint — runs through the
 * composed Session + projection registry.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as UsageStatsPlugin from '../src/index.ts'
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
      shadowedRange: { start: SessionSeq(1), end: SessionSeq(2) },
      shadowedSeqs: [SessionSeq(1), SessionSeq(2)],
      shadowedTokenCount: 10,
      provider: 'summarizer',
      model: 'summarizer-model',
      ...usage === undefined ? {} : { usage },
    },
  })
}

/** Fold a list of events from the init state. */
function fold(events: readonly SessionEvent[]): { state: unknown; view: UsageStatsProjection } {
  let state = usageStatsProjectionDefinition.init()
  for (const item of events) {
    state = usageStatsProjectionDefinition.apply(state, item)
  }
  return { state, view: usageStatsProjectionDefinition.wire.view(state) }
}

/** The bucket a quarter/route slot carries, or undefined. */
function bucketAt(view: UsageStatsProjection, quarter: number, provider: string, model: string) {
  return view.quarters[String(quarter)]?.[provider]?.[model]
}

describe('usageStats fold (definition-direct, controlled times)', () => {
  const T0 = 1_800_000_000_000

  it('attributes samples to the nearest request header and quarter bucket', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 4 }),
    ])
    const quarter = Math.floor((T0 + 1_000) / 900_000)
    expect(bucketAt(view, quarter, 'deepseek', 'deepseek-chat')).toEqual({
      uncachedInputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(Object.keys(view.quarters)).toEqual([String(quarter)])
  })

  it('replaces a chunk sample with the final usage of the same step', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      messageEvent(T0 + 2_000, 1, 1, { inputTokens: 14, outputTokens: 5 }),
    ])
    const quarter = Math.floor((T0 + 2_000) / 900_000)
    expect(bucketAt(view, quarter, 'deepseek', 'deepseek-chat')).toEqual({
      uncachedInputTokens: 14,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('moves the value across quarters when the final message lands in a later quarter', () => {
    const chunkTime = T0
    const messageTime = T0 + 900_000
    const { view } = fold([
      headerEvent(chunkTime - 1, 'deepseek', 'deepseek-chat'),
      chunkEvent(chunkTime, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      messageEvent(messageTime, 1, 1, { inputTokens: 10, outputTokens: 2 }),
    ])
    expect(bucketAt(view, Math.floor(chunkTime / 900_000), 'deepseek', 'deepseek-chat')).toBeUndefined()
    expect(bucketAt(view, Math.floor(messageTime / 900_000), 'deepseek', 'deepseek-chat')).toBeDefined()
  })

  it('returns the same state for the identical final sample after its chunk', () => {
    const events = [
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
    ] as const
    let state = usageStatsProjectionDefinition.init()
    for (const item of events) state = usageStatsProjectionDefinition.apply(state, item)
    const afterChunk = state
    const afterMessage = usageStatsProjectionDefinition.apply(
      afterChunk,
      messageEvent(T0 + 1_500, 1, 1, { inputTokens: 10, outputTokens: 2 }),
    )
    expect(afterMessage).toBe(afterChunk)
  })

  it('follows a later header to the new route for later samples', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      headerEvent(T0 + 2_000, 'openai', 'gpt'),
      chunkEvent(T0 + 3_000, 1, 2, { inputTokens: 7, outputTokens: 1 }),
    ])
    const quarter = Math.floor((T0 + 3_000) / 900_000)
    expect(bucketAt(view, quarter, 'deepseek', 'deepseek-chat')).toBeDefined()
    expect(bucketAt(view, quarter, 'openai', 'gpt')).toEqual({
      uncachedInputTokens: 7,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('keeps an unchanged header on the same state reference', () => {
    let state = usageStatsProjectionDefinition.init()
    state = usageStatsProjectionDefinition.apply(state, headerEvent(T0, 'deepseek', 'deepseek-chat'))
    const afterFirst = state
    expect(usageStatsProjectionDefinition.apply(
      afterFirst,
      headerEvent(T0 + 1_000, 'deepseek', 'deepseek-chat'),
    )).toBe(afterFirst)
  })

  it('attributes pre-header usage to the unknown route', () => {
    const { view } = fold([
      chunkEvent(T0, 1, 1, { inputTokens: 5, outputTokens: 1 }),
    ])
    expect(bucketAt(view, Math.floor(T0 / 900_000), 'unknown', 'unknown')).toEqual({
      uncachedInputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('accumulates a compaction summary on its own route, apart from the folded header', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      summaryEvent(T0 + 1_000, { inputTokens: 40, outputTokens: 6, cacheWriteTokens: 2 }),
    ])
    const quarter = Math.floor((T0 + 1_000) / 900_000)
    expect(bucketAt(view, quarter, 'summarizer', 'summarizer-model')).toEqual({
      uncachedInputTokens: 40,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 2,
    })
    expect(bucketAt(view, quarter, 'deepseek', 'deepseek-chat')).toBeUndefined()
  })

  it('skips a summary without usage on the same state reference', () => {
    let state = usageStatsProjectionDefinition.init()
    state = usageStatsProjectionDefinition.apply(state, headerEvent(T0, 'deepseek', 'deepseek-chat'))
    expect(usageStatsProjectionDefinition.apply(state, summaryEvent(T0 + 1_000))).toBe(state)
  })

  it('prunes the bucket a replacement empties', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      chunkEvent(T0 + 1_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      messageEvent(T0 + 2_000, 1, 1, { inputTokens: 0, outputTokens: 0 }),
    ])
    expect(view.quarters).toEqual({})
  })

  it('keeps a summary independent of the last sample replacement', () => {
    const { view } = fold([
      headerEvent(T0, 'deepseek', 'deepseek-chat'),
      summaryEvent(T0 + 1_000, { inputTokens: 40, outputTokens: 6 }),
      chunkEvent(T0 + 2_000, 1, 1, { inputTokens: 10, outputTokens: 2 }),
      messageEvent(T0 + 3_000, 1, 1, { inputTokens: 12, outputTokens: 3 }),
    ])
    const quarter = Math.floor((T0 + 3_000) / 900_000)
    expect(bucketAt(view, quarter, 'summarizer', 'summarizer-model')).toEqual({
      uncachedInputTokens: 40,
      outputTokens: 6,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
    expect(bucketAt(view, quarter, 'deepseek', 'deepseek-chat')).toEqual({
      uncachedInputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })
})

async function harness(): Promise<{
  ctx: Context
  session: Session
  fiber: Awaited<ReturnType<Context['plugin']>>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const fiber = await ctx.plugin(UsageStatsPlugin)
  return { ctx, session: ctx.sessions.create(), fiber }
}

describe('usageStats projection unit (registry drive)', () => {
  it('serves empty quarters for an empty log', async () => {
    const { ctx, session } = await harness()
    expect(ctx.sessionProjections.snapshot(session).values.usageStats).toEqual({ quarters: {} })
  })

  it('registers under stateVersion 1 and unregisters with the plugin fiber', async () => {
    const { ctx, session, fiber } = await harness()
    session.append('request/header', {
      header: { config: { provider: 'deepseek', model: 'deepseek-chat' } },
      reason: 'initial',
    })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 2 } },
    })
    const checkpoint = JSON.parse(JSON.stringify(
      ctx.sessionProjections.checkpoint(session),
    )) as ReturnType<typeof ctx.sessionProjections.checkpoint>
    expect(checkpoint.usageStats?.ver).toBe(1)

    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty('usageStats')

    await ctx.plugin(UsageStatsPlugin)
    const restored = ctx.sessionProjections.viewCheckpoint(checkpoint).usageStats
    const quarter = String(Math.floor(Date.now() / 900_000))
    expect(restored?.quarters[quarter]?.deepseek?.['deepseek-chat']).toEqual({
      uncachedInputTokens: 9,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })
})
