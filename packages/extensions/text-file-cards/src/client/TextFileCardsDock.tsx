/**
 * Text-file staging cards docked above the composer (input dock strip). Each
 * card is one staged text file: the main button expands the file's content
 * into the draft and unstages it; the close button unstages without touching
 * the draft. No staged files renders nothing.
 */

import { IconCloseOutline16, IconPaperclipOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, PropsLocale, PropsRuntime, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { formatBytes, type StagedFilesState, type StagedTextFile } from './text-files.ts'
import css from './TextFileCardsDock.module.css'

/** Host actions the cards drive (the inject face minus the hooks compartment). */
export interface TextFileCardsActions {
  /** Expand one staged file into the draft and unstage it. */
  expand: (fileId: string) => Promise<void>
  /** Unstage one file without touching the draft. */
  remove: (fileId: string) => void
}

/** Full injected share: the actions plus the staged-files observable (reserved hooks compartment). */
export interface TextFileCardsInjected extends TextFileCardsActions {
  hooks: {
    /** Staged files keyed by session; the renderer binds it to `useStagedFiles`. */
    stagedFiles: HostObservable<StagedFilesState>
  }
}

/** Full dock props: InputZone owner share + session kit + actions + bound hook + locale seat. */
export type TextFileCardsDockProps =
  PropsRuntime<'conversation.input.dock'>
  & TextFileCardsActions
  & { /** Selector hook over the staged-files source bound by the renderer. */
    useStagedFiles: SnapshotSelectorHook<StagedFilesState> }
  & PropsLocale<'textFileCards'>

/** Selector fallback: a stable empty tuple for sessions with nothing staged. */
const EMPTY: readonly StagedTextFile[] = []

/**
 * The dock entry: renders the current session's staged-file chip row, or
 * nothing when the session has no staged files.
 * @param props - the composed dock props.
 * @returns the chip row or null.
 */
export function TextFileCardsDock({ sessionId, expand, remove, useStagedFiles, t }: TextFileCardsDockProps) {
  const files = useStagedFiles(state => state.bySession[sessionId] ?? EMPTY)
  if (files.length === 0) return null
  return (
    <div className={css.dock} data-text-file-cards>
      <div className={css.row} aria-label={t('cards.group')}>
        {files.map(entry => (
          <div key={entry.id} className={css.card}>
            <button
              type="button"
              className={css.cardMain}
              onClick={() => { void expand(entry.id) }}
              aria-label={t('card.insert', { name: entry.name })}
            >
              <span className={css.glyph}><IconPaperclipOutline16 size={14} /></span>
              <span className={css.name}>{entry.name}</span>
              <span className={css.size}>{formatBytes(entry.size)}</span>
            </button>
            <Tooltip label={t('card.remove', { name: entry.name })} side="bottom" delayMs={500}>
              <button
                type="button"
                className={css.removeBtn}
                onClick={() => { remove(entry.id) }}
                aria-label={t('card.remove', { name: entry.name })}
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
