/**
 * The find bar entry for the `shell.overlay` slot: a top-center floating
 * bar (the browser's own find-bar position, above every column and outside
 * their scroll containers) that renders only while the controller is open.
 * The view owns nothing but layout and focus — all keyboard, search, and
 * highlight behavior lives in the controller.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { FindController } from './find-controller.ts'
import css from './FindBar.module.css'

/** Full bar props: the shell.overlay runtime kit + the injected controller + the locale seat. */
export type FindBarProps =
  PropsRuntime<'shell.overlay'>
  & { /** The plugin's find controller, injected at slot registration. */ controller: FindController }
  & PropsLocale<'findInChat'>

/**
 * The shell.overlay entry: the open-state find bar, or nothing.
 * @param props - the composed overlay props.
 * @returns the bar, or null while closed.
 */
export function FindBar({ controller, t }: FindBarProps) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // A callback ref, not an effect: the bar renders nothing while closed, so
  // the input element appears only on open — the ref callback is exactly the
  // mount/unmount signal the controller's Enter/Escape gate needs.
  const bindInput = useCallback((element: HTMLInputElement | null): void => {
    inputRef.current = element
    controller.bindInput(element)
  }, [controller])

  useEffect(() => {
    if (!state.open) return
    const input = inputRef.current
    /* v8 ignore next -- the open render always attaches the input before effects run. */
    if (input === null) return
    input.focus({ preventScroll: true })
    input.select()
  }, [state.open, state.revision])

  if (!state.open) return null

  return (
    <div className={css.bar} data-find-in-chat-bar>
      <input
        ref={bindInput}
        type="text"
        className={state.total === 0 && state.query.trim() !== '' ? css.miss : css.input}
        placeholder={t('bar.placeholder')}
        aria-label={t('bar.placeholder')}
        spellCheck={false}
        value={state.query}
        onChange={(event) => {
          controller.setQuery(event.target.value)
        }}
      />
      <span className={css.count} aria-live="polite">
        {t('bar.count', { current: String(state.index + 1), total: String(state.total) })}
      </span>
      <span className={css.coverage}>
        {t('bar.searched', { rows: String(state.searchedRows) })}
        {state.earlierPages ? ` · ${t('bar.earlier')}` : ''}
      </span>
      <button
        type="button"
        className={css.step}
        aria-label={t('bar.previous')}
        onClick={() => {
          controller.step(-1)
        }}
      >
        ↑
      </button>
      <button
        type="button"
        className={css.step}
        aria-label={t('bar.next')}
        onClick={() => {
          controller.step(1)
        }}
      >
        ↓
      </button>
      <button
        type="button"
        className={css.step}
        aria-label={t('bar.close')}
        onClick={() => {
          controller.close()
        }}
      >
        ✕
      </button>
    </div>
  )
}
