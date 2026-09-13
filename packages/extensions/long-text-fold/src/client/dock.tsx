/**
 * Input-dock card strip and the overlay preview popup for staged long texts.
 * Each card shows the staged text's first-line preview and size; clicking a
 * card opens the read-only preview, the close button unstages (the draft
 * marker stays until submit). A session with nothing staged renders nothing.
 */

import { useEffect, useRef, useState } from 'react'
import { IconCloseOutline16, IconPaperclipOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StagedEntry, StagedState } from './staged-store.ts'
import css from './Dock.module.css'

/** Dock actions (the inject face minus the hooks compartment). */
export interface LongTextFoldDockActions {
  /** Open the read-only preview for one staged entry. */
  preview: (seq: number) => void
  /** Unstage one entry; its marker stays in the draft until submit. */
  remove: (seq: number) => void
}

/** Full injected share: the actions plus the staged observable (hooks compartment). */
export interface LongTextFoldDockInjected extends LongTextFoldDockActions {
  hooks: {
    /** Staged entries keyed by session; the renderer binds it to `useStaged`. */
    staged: HostObservable<StagedState>
  }
}

/** Full dock props: InputZone owner share + session kit + actions + bound hook + locale seat. */
export type LongTextFoldDockProps =
  PropsRuntime<'conversation.input.dock'>
  & LongTextFoldDockActions
  & { /** Selector hook over the staged source bound by the renderer. */
    useStaged: SnapshotSelectorHook<StagedState> }
  & PropsLocale<'longTextFold'>

/** Selector fallback: a stable empty tuple for sessions with nothing staged. */
const EMPTY: readonly StagedEntry[] = []

/**
 * The dock entry: renders the current session's staged card row, or nothing
 * when the session has no staged texts.
 * @param props - the composed dock props.
 * @returns the card row or null.
 */
export function LongTextFoldDock({ sessionId, preview, remove, useStaged, t }: LongTextFoldDockProps) {
  const entries = useStaged(state => state.bySession[sessionId] ?? EMPTY)
  if (entries.length === 0) return null
  return (
    <div className={css.dock} data-long-text-fold-dock>
      <div className={css.row}>
        {entries.map(entry => (
          <div key={entry.seq} className={css.card}>
            <button
              type="button"
              className={css.cardMain}
              onClick={() => { preview(entry.seq) }}
              aria-label={t('card.preview')}
            >
              <span className={css.glyph}><IconPaperclipOutline16 size={14} /></span>
              <span className={css.name}>{entry.preview}</span>
              <span className={css.size}>{t('card.meta', { chars: entry.chars, lines: entry.lines })}</span>
            </button>
            <Tooltip label={t('card.remove')} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.removeBtn}
                onClick={() => { remove(entry.seq) }}
                aria-label={t('card.remove')}
              >
                <IconCloseOutline16 size={12} />
              </button>
            </Tooltip>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One pending preview request (session + seq), or none. */
export interface PreviewRequest {
  readonly sessionId: SessionId
  readonly seq: number
}

/** Overlay inject face minus the hooks compartment (the component seat). */
export interface PreviewActions {
  /** Close the open preview (outside click and the close button). */
  close: () => void
  /** Resolve one staged full text at render time. */
  text: (sessionId: SessionId, seq: number) => string | undefined
}

/** Overlay inject face: the actions plus the request observable (hooks compartment). */
export interface PreviewInjected extends PreviewActions {
  hooks: {
    /** The open preview request; the renderer binds it to `useRequest`. */
    request: HostObservable<PreviewRequest | null>
  }
}

/** Full preview props: overlay kit + actions + bound hook + locale seat. */
export type PreviewPopupProps =
  PropsRuntime<'shell.overlay'>
  & PreviewActions
  & { useRequest: SnapshotSelectorHook<PreviewRequest | null> }
  & PropsLocale<'longTextFold'>

const IDENTITY = (request: PreviewRequest | null): PreviewRequest | null => request

/**
 * The overlay preview: a read-only panel over the staged text, closed by the
 * close button, an outside pointer press, or the dock removing the entry.
 * @param props - the composed overlay props.
 * @returns the preview panel or null.
 */
export function PreviewPopup({ useRequest, text, close, t }: PreviewPopupProps) {
  const request = useRequest(IDENTITY)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [body, setBody] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (request === null) {
      setBody(undefined)
      return
    }
    setBody(text(request.sessionId, request.seq))
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current !== null && event.target instanceof Node && !panelRef.current.contains(event.target)) close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [request, text, close])
  if (request === null) return null
  return (
    <div
      ref={panelRef}
      className={css.preview}
      data-long-text-fold-preview
      role="dialog"
      aria-label={t('preview.title', { seq: request.seq })}
    >
      <div className={css.previewHead}>
        <span className={css.previewTitle}>{t('preview.title', { seq: request.seq })}</span>
        <Tooltip label={t('preview.close')} side="bottom">
          <button type="button" className={css.previewClose} aria-label={t('preview.close')} onClick={close}>
            <IconCloseOutline16 size={12} />
          </button>
        </Tooltip>
      </div>
      <div className={css.previewBody}>{body ?? ''}</div>
    </div>
  )
}
