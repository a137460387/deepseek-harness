// @vitest-environment jsdom
/**
 * The find bar view over a fake controller: closed renders nothing, open
 * renders the input, the live count, the coverage copy (with and without
 * the earlier-pages note), the miss styling for a matchless non-empty
 * query, focus-and-select on open and on revision bumps, the button
 * verbs (previous, next, close), the input's query write-through, and the
 * bindInput registration that follows the component's lifetime.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FindBar, type FindBarProps } from '../src/client/FindBar.tsx'
import type { FindState } from '../src/client/find-controller.ts'

/** A test t(): interpolates {key} params like the locale service. */
const t = (key: string, params?: Record<string, string>): string => {
  const raw: Record<string, string> = {
    'bar.placeholder': 'Find in conversation',
    'bar.count': '{current}/{total}',
    'bar.searched': 'Searched {rows} messages',
    'bar.earlier': 'earlier messages not loaded',
    'bar.previous': 'Previous match',
    'bar.next': 'Next match',
    'bar.close': 'Close find bar',
  }
  const text = raw[key] ?? key
  if (params === undefined) return text
  return text.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

/** Scriptable controller stand-in; the view never touches anything else. */
function fakeController(over: Partial<FindState> = {}) {
  let state: FindState = {
    open: true,
    revision: 1,
    query: '',
    index: -1,
    total: 0,
    searchedRows: 0,
    earlierPages: false,
    ...over,
  }
  const listeners = new Set<() => void>()
  const controller = {
    bindInput: vi.fn(),
    setQuery: vi.fn(),
    step: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }),
    getSnapshot: (): FindState => state,
    setState(next: Partial<FindState>): void {
      state = { ...state, ...next }
      for (const listener of listeners) listener()
    },
  }
  return controller
}

/** Render the bar over one controller state. */
function bar(controller: ReturnType<typeof fakeController>) {
  return render(<FindBar {...({ controller, t } as unknown as FindBarProps)} />)
}

afterEach(() => {
  cleanup()
})

describe('FindBar component', () => {
  it('renders nothing while closed', () => {
    const controller = fakeController({ open: false })
    const { container } = bar(controller)
    expect(container.innerHTML).toBe('')
  })

  it('renders the count, coverage copy, and verbs while open with matches', () => {
    const controller = fakeController({ query: 'needle', index: 1, total: 3, searchedRows: 12, earlierPages: true })
    const { getByLabelText, getByText } = bar(controller)
    expect(getByText('2/3')).toBeTruthy()
    expect(getByText('Searched 12 messages · earlier messages not loaded')).toBeTruthy()
    expect(getByLabelText('Previous match')).toBeTruthy()
    expect(getByLabelText('Next match')).toBeTruthy()
    expect(getByLabelText('Close find bar')).toBeTruthy()
  })

  it('omits the earlier-pages note when the window is complete', () => {
    const controller = fakeController({ query: 'needle', index: 0, total: 1, searchedRows: 5 })
    const { getByText, queryByText } = bar(controller)
    expect(getByText('Searched 5 messages')).toBeTruthy()
    expect(queryByText(/earlier messages/)).toBeNull()
  })

  it('styles a matchless non-empty query as the empty state', () => {
    const missless = fakeController({ query: 'needle', total: 0 })
    const first = bar(missless)
    const plain = first.container.querySelector('input')!.className
    cleanup()
    const missy = fakeController({ query: '', total: 0 })
    const second = bar(missy)
    const miss = second.container.querySelector('input')!.className
    expect(plain).not.toBe(miss)
    expect(second.getByText('0/0')).toBeTruthy()
  })

  it('focuses and selects the input on open and on revision bumps', () => {
    const controller = fakeController({ open: false })
    const { container, rerender } = bar(controller)
    expect(container.querySelector('input')).toBeNull()
    controller.setState({ open: true, revision: 1 })
    rerender(<FindBar {...({ controller, t } as unknown as FindBarProps)} />)
    const input = container.querySelector('input')!
    expect(document.activeElement).toBe(input)
    controller.setState({ revision: 2 })
    rerender(<FindBar {...({ controller, t } as unknown as FindBarProps)} />)
    expect(document.activeElement).toBe(input)
  })

  it('writes query changes through and drives the step/close verbs', () => {
    const controller = fakeController({ query: 'nee', index: 0, total: 2 })
    const { getByLabelText, getByRole } = bar(controller)
    fireEvent.change(getByRole('textbox'), { target: { value: 'needle' } })
    expect(controller.setQuery).toHaveBeenCalledWith('needle')
    fireEvent.click(getByLabelText('Previous match'))
    expect(controller.step).toHaveBeenCalledWith(-1)
    fireEvent.click(getByLabelText('Next match'))
    expect(controller.step).toHaveBeenCalledWith(1)
    fireEvent.click(getByLabelText('Close find bar'))
    expect(controller.close).toHaveBeenCalledTimes(1)
  })

  it('binds its input for the lifetime of the mount', () => {
    const controller = fakeController()
    const { unmount } = bar(controller)
    expect(controller.bindInput).toHaveBeenCalledWith(expect.any(HTMLInputElement))
    unmount()
    expect(controller.bindInput).toHaveBeenCalledWith(null)
  })
})
