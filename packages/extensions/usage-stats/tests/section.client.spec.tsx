// @vitest-environment jsdom
/**
 * The usage statistics section on direct props: a ready store renders the
 * headline cards, the activity calendar, the trend legend, and the donut
 * shares; the mode/dimension/range toggles move their aria-pressed seats; an
 * error status renders the failure row with a retry; the absent composition
 * surfaces its hint; and an empty history renders the empty placeholders.
 * Sample times sit at 12:00 UTC so every timezone offset within ±12 hours
 * maps them onto the same calendar date the assertions rely on.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { UsageStatsSection } from '../src/client/UsageStatsSection.tsx'
import type { UsageStatsSectionProps } from '../src/client/UsageStatsSection.tsx'
import type { UsageStatsSectionState } from '../src/client/stats-store.ts'
import type { UsageBuckets, UsageStatsProjection } from '../src/types.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)

const buckets = (n: number): UsageBuckets => ({
  uncachedInputTokens: n,
  outputTokens: n,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** One usage value whose single sample sits at 12:00 UTC of `date`. */
function valueAt(date: string, provider: string, model: string, amount: number): UsageStatsProjection {
  const ms = Date.parse(`${date}T12:00:00Z`)
  return { quarters: { [String(Math.floor(ms / 900_000))]: { [provider]: { [model]: buckets(amount) } } } }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** A useUsageStats stub bound to a snapshot store (the renderer's binding). */
function hookOf(store: SnapshotStore<UsageStatsSectionState>): (selector: (state: UsageStatsSectionState) => unknown) => unknown {
  const subscribe = (listener: () => void) => store.subscribe(listener)
  return selector => useSyncExternalStore(subscribe, () => selector(store.getSnapshot()))
}

/** Render the section against a prepared store and a load spy. */
function mount(
  state: UsageStatsSectionState,
): { load: ReturnType<typeof vi.fn> } {
  const store = createSnapshotStore(state)
  const load = vi.fn()
  const props = {
    close: () => {},
    t,
    load,
    useUsageStats: hookOf(store),
  } as unknown as UsageStatsSectionProps
  render(<UsageStatsSection {...props} />)
  return { load }
}

describe('UsageStatsSection', () => {
  it('renders the headline figures, calendar, trend, and donut from a ready store', () => {
    const today = todayUtc()
    mount({
      status: 'ready',
      error: null,
      values: { session: valueAt(today, 'deepseek', 'deepseek-chat', 1_000) },
      sessionCount: 1,
      absentCount: 0,
      failedCount: 0,
    })

    // buckets(1000) sums to 2000 tokens per sample; the figure surfaces on
    // the cards, the trend axis, and the donut alike.
    expect(screen.getAllByText('2K').length).toBeGreaterThanOrEqual(2)
    // Today's single active day: a one-day current and longest streak.
    expect(screen.getByText('当前连续')).toBeTruthy()
    expect(screen.getByText('最长连续')).toBeTruthy()
    // The calendar, trend, and donut blocks all carry their titles.
    expect(screen.getByRole('img', { name: '活动日历' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Token 趋势' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '用量占比' })).toBeTruthy()
    // The trend legend and the donut legend both name the only series; the
    // default dimension is model.
    expect(screen.getAllByText('deepseek-chat').length).toBe(2)
  })

  it('moves the aria-pressed seat when toggles switch', () => {
    mount({
      status: 'ready',
      error: null,
      values: { session: valueAt(todayUtc(), 'deepseek', 'deepseek-chat', 100) },
      sessionCount: 1,
      absentCount: 0,
      failedCount: 0,
    })

    const daily = screen.getByRole('button', { name: '每日' })
    const weekly = screen.getByRole('button', { name: '每周' })
    expect(daily.getAttribute('aria-pressed')).toBe('true')
    expect(weekly.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(weekly)
    expect(weekly.getAttribute('aria-pressed')).toBe('true')
    expect(daily.getAttribute('aria-pressed')).toBe('false')

    // The dimension toggle renders in both the trend and donut blocks; one
    // shared state moves both seats. The default dimension is model.
    const byModel = screen.getAllByRole('button', { name: '按模型' })
    expect(byModel.every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true)
    const byProvider = screen.getAllByRole('button', { name: '按提供方' })
    fireEvent.click(byProvider[0]!)
    expect(byModel.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true)

    const allTime = screen.getByRole('button', { name: '全部时间' })
    expect(allTime.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(allTime)
    expect(allTime.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the error row and retry when the load failed with nothing to show', () => {
    const { load } = mount({
      status: 'error',
      error: 'boom',
      values: {},
      sessionCount: 0,
      absentCount: 0,
      failedCount: 0,
    })
    expect(screen.getByText('读取用量失败：boom')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('surfaces the absent-composition hint when every session lacked the key', () => {
    mount({
      status: 'ready',
      error: null,
      values: { session: { quarters: {} } },
      sessionCount: 1,
      absentCount: 1,
      failedCount: 0,
    })
    expect(screen.getByText(/当前组合未注册 usageStats/)).toBeTruthy()
  })

  it('renders the empty placeholders for a ready store with no usage', () => {
    mount({
      status: 'ready',
      error: null,
      values: {},
      sessionCount: 0,
      absentCount: 0,
      failedCount: 0,
    })
    const placeholders = screen.getAllByText('还没有任何用量记录。')
    expect(placeholders.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('calls load once on mount', () => {
    const { load } = mount({
      status: 'idle',
      error: null,
      values: {},
      sessionCount: 0,
      absentCount: 0,
      failedCount: 0,
    })
    expect(load).toHaveBeenCalledTimes(1)
  })
})
