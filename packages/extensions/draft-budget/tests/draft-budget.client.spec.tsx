// @vitest-environment jsdom
/**
 * The draft-budget browser half: the dock readout's branch behavior over
 * scripted props (empty and whitespace drafts render nothing; the
 * tokens-only branch when no context figures exist; the full branch's
 * provider-anchored percentage with the projectedTokens preference, the
 * pressureTokens fallback, degenerate windows, and the 100% cap; the 250 ms
 * trailing debounce and its unmount cleanup; the aria readings), the locale
 * key parity, the plugin boot over a real Context with the real
 * SlotRegistry and LocaleRuntime, the inert node entry, and the invariant
 * companion's ownership reservation.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { act } from 'react'
import { DraftBudgetReadout, type DraftBudgetReadoutProps } from '../src/client/DraftBudgetReadout.tsx'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import { apply as applyNode } from '../src/index.ts'
import * as DraftBudgetInvariant from '../src/invariant.ts'

/** The replay-lane pressure shape probe established for the type. */
interface PressureShape {
  readonly pressureTokens?: number
  readonly projectedTokens?: number
  readonly contextWindow?: number
}

/** A test t(): interpolates {key} params like the locale service. */
const t = (key: string, params?: Record<string, string>): string => {
  const raw: Record<string, string> = {
    'chip.tokens': '~{count} tok',
    'chip.afterSend': 'after send ~{percent}%',
    'chip.aria': 'draft about {count} tokens, about {percent}% of context after sending',
    'chip.ariaTokens': 'draft about {count} tokens',
  }
  const text = raw[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

/** The readout's two data faces, scripted per test. */
function faces(draft: string, pressure: PressureShape | undefined) {
  const store = createSnapshotStore<{ readonly draft: string }>({ draft })
  const useInput = <T,>(selector: (state: { readonly draft: string }) => T): T => selector(store.getSnapshot())
  const useProjection = (): PressureShape | undefined => pressure
  return { store, props: { useInput, useProjection: useProjection as never, t } as unknown as DraftBudgetReadoutProps }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DraftBudgetReadout branches', () => {
  it('renders nothing for empty and whitespace-only drafts', () => {
    for (const draft of ['', '   ']) {
      const { props } = faces(draft, undefined)
      const { container } = render(<DraftBudgetReadout {...props} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('shows the tokens-only branch without context figures', () => {
    const { props } = faces('a'.repeat(40), undefined)
    const { container, getByLabelText } = render(<DraftBudgetReadout {...props} />)
    const chip = container.querySelector('[data-draft-budget]')!
    expect(chip.getAttribute('data-draft-budget')).toBe('tokens')
    expect(chip.textContent).toBe('~18 tok')
    expect(getByLabelText('draft about 18 tokens')).toBeTruthy()
  })

  it('computes the full branch from the provider-anchored projection', () => {
    const { props } = faces('a'.repeat(40), { projectedTokens: 1_000, contextWindow: 8_000 })
    const { container } = render(<DraftBudgetReadout {...props} />)
    const chip = container.querySelector('[data-draft-budget]')!
    expect(chip.getAttribute('data-draft-budget')).toBe('full')
    expect(chip.textContent).toBe('~18 tokafter send ~13%')
    expect(chip.getAttribute('aria-label')).toBe('draft about 18 tokens, about 13% of context after sending')
  })

  it('falls back to pressureTokens when projectedTokens is absent', () => {
    const { props } = faces('a'.repeat(40), { pressureTokens: 1_000, contextWindow: 8_000 })
    const { container } = render(<DraftBudgetReadout {...props} />)
    expect(container.querySelector('[data-draft-budget]')!.getAttribute('data-draft-budget')).toBe('full')
    expect(container.textContent).toContain('after send ~13%')
  })

  it('stays tokens-only without a usable window', () => {
    const noWindow = faces('a'.repeat(40), { projectedTokens: 1_000 })
    const { container } = render(<DraftBudgetReadout {...noWindow.props} />)
    expect(container.querySelector('[data-draft-budget]')!.getAttribute('data-draft-budget')).toBe('tokens')
    cleanup()
    const zeroWindow = faces('a'.repeat(40), { projectedTokens: 1_000, contextWindow: 0 })
    const second = render(<DraftBudgetReadout {...zeroWindow.props} />)
    expect(second.container.querySelector('[data-draft-budget]')!.getAttribute('data-draft-budget')).toBe('tokens')
  })

  it('caps the after-send reading at 100%', () => {
    const { props } = faces('a'.repeat(40), { projectedTokens: 7_990, contextWindow: 8_000 })
    const { container } = render(<DraftBudgetReadout {...props} />)
    expect(container.textContent).toContain('after send ~100%')
  })

  it('folds large drafts for display', () => {
    const { props } = faces('a'.repeat(6_000), undefined)
    const { container } = render(<DraftBudgetReadout {...props} />)
    expect(container.textContent).toBe('~1.5K tok')
  })
})

describe('DraftBudgetReadout debounce', () => {
  it('settles on the latest draft after the 250 ms window', () => {
    const { store, props } = faces('a'.repeat(40), undefined)
    const { container, rerender } = render(<DraftBudgetReadout {...props} />)
    expect(container.textContent).toBe('~18 tok')
    act(() => {
      store.set({ draft: 'b'.repeat(120) })
    })
    rerender(<DraftBudgetReadout {...props} />)
    expect(container.textContent).toBe('~18 tok')
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(container.textContent).toBe('~18 tok')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.textContent).toBe('~38 tok')
  })

  it('keeps coalescing while typing continues', () => {
    const { store, props } = faces('', undefined)
    const { container, rerender } = render(<DraftBudgetReadout {...props} />)
    expect(container.innerHTML).toBe('')
    for (let round = 1; round <= 3; round += 1) {
      act(() => {
        store.set({ draft: 'c'.repeat(40 * round) })
      })
      rerender(<DraftBudgetReadout {...props} />)
      act(() => {
        vi.advanceTimersByTime(200)
      })
    }
    act(() => {
      vi.advanceTimersByTime(50)
    })
    expect(container.textContent).toBe('~38 tok')
  })

  it('clears the pending timer on unmount', () => {
    const { store, props } = faces('a'.repeat(40), undefined)
    const { unmount } = render(<DraftBudgetReadout {...props} />)
    act(() => {
      store.set({ draft: 'b'.repeat(120) })
    })
    unmount()
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(300)
      })
    }).not.toThrow()
  })
})

describe('draft-budget dictionaries and halves', () => {
  it('keeps the en dictionary complete against the zh key set', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('contributes no host behavior', () => {
    expect(applyNode).not.toThrow()
  })

  it('boots the dictionaries and the dock entry over a real registry and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root', children: {
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
      },
    } as never, (() => null) as never)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const t = ctx.locale.bind('draftBudget')
    expect(t('chip.tokens', { count: '18' })).toBe('~18 tok')
    await fiber.dispose()
  })

  it('reserves package ownership under its declared companion name', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(DraftBudgetInvariant)
    await fiber.await()
    expect(DraftBudgetInvariant.name).toBe('client-draft-budget-invariant')
    expect(DraftBudgetInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
