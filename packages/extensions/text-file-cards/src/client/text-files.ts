/**
 * Text-file classification and staged-file accounting for the drop cards.
 *
 * A dropped text file is staged WHOLE (the File object, not its content) so
 * the draft stays clean; the content is read only when the user expands a
 * card. Staged entries are keyed by session id and pruned against the live
 * session list on every addition, so a removed session cannot strand its
 * staged files in memory.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * File extensions treated as plain text/code for drop intake. A dropped file is
 * text if its extension is listed here or its MIME type starts with `text/`;
 * anything else (images, binaries, unrecognized) is left to the composer's
 * native image intake.
 */
export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log',
  'json', 'yaml', 'toml', 'ini', 'xml', 'csv', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cs', 'swift', 'php', 'sh', 'ps1', 'sql',
  'html', 'css', 'scss', 'vue', 'svelte',
])

/**
 * Per-file staging ceiling. The expanded content joins the draft and thus the
 * model context verbatim; beyond this size it crowds out the context window
 * (100 KB ≈ 25k tokens), so oversized files are refused with a notice instead
 * of staged.
 */
export const MAX_FILE_BYTES = 100 * 1024

/** Per-drop batch ceiling: a larger batch stages its head and reports the rest as refused. */
export const MAX_BATCH_FILES = 20

/**
 * Whether a dropped file is plain text: its MIME type starts with `text/`, or
 * its extension is in TEXT_EXTENSIONS. A file with neither signal (no extension
 * and an empty MIME type) is NOT treated as text and is left to the composer's
 * native intake.
 * @param file - the dropped file to classify.
 * @returns true when the file is recognized as text.
 */
export function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return false
  return TEXT_EXTENSIONS.has(file.name.slice(dot + 1).toLowerCase())
}

/**
 * Compact human file size (B / KB / MB, one decimal past the unit step).
 * @param bytes - size in bytes.
 * @returns the display string.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** One staged text file awaiting the user's expand click. */
export interface StagedTextFile {
  /** Stable identity minted at staging time. */
  readonly id: string
  readonly name: string
  readonly size: number
  /** The dropped file itself; content is read lazily on expand. */
  readonly file: File
}

/** Staged files keyed by session id (the dock renders one session's row). */
export interface StagedFilesState {
  bySession: Record<string, readonly StagedTextFile[]>
}

/**
 * The registrant-owned staged-file source: one snapshot store plus the three
 * mutation verbs the drop listener and the dock cards drive. Created once per
 * apply; the store reference rides the slot registration's hooks compartment.
 */
export interface StagedFilesSource {
  readonly store: SnapshotStore<StagedFilesState>
  /**
   * Stage files under a session, pruning entries of sessions that no longer
   * exist. The caller has already applied the size/batch ceilings.
   * @param sessionId - session that owns the staged files.
   * @param files - accepted files, in drop order.
   * @param liveSessionIds - current session list; other keys are dropped.
   */
  add(sessionId: string, files: readonly File[], liveSessionIds: readonly string[]): void
  /** Drop one staged file; a missing id is a no-op. */
  remove(sessionId: string, fileId: string): void
  /** The staged entry, or undefined once expanded/removed. */
  get(sessionId: string, fileId: string): StagedTextFile | undefined
}

/**
 * Create a fresh staged-file source.
 * @returns the source with an empty state.
 */
export function createStagedFilesSource(): StagedFilesSource {
  const store = createSnapshotStore<StagedFilesState>({ bySession: {} })
  let nextId = 1
  return {
    store,
    add(sessionId, files, liveSessionIds) {
      if (files.length === 0) return
      const live = new Set(liveSessionIds)
      const minted = files.map((file): StagedTextFile => ({
        id: `staged-${String(nextId++)}`,
        name: file.name,
        size: file.size,
        file,
      }))
      store.update((draft) => {
        // Rebuild the map so dead sessions drop out without a dynamic delete.
        const next: typeof draft.bySession = {}
        for (const key of Object.keys(draft.bySession)) {
          const value = draft.bySession[key]
          if (live.has(key) && value !== undefined) next[key] = value
        }
        const existing = next[sessionId]
        next[sessionId] = existing === undefined ? minted : [...existing, ...minted]
        draft.bySession = next
      })
    },
    remove(sessionId, fileId) {
      store.update((draft) => {
        const existing = draft.bySession[sessionId]
        if (existing === undefined) return
        const kept = existing.filter(entry => entry.id !== fileId)
        if (kept.length === existing.length) return
        if (kept.length === 0) {
          draft.bySession = Object.fromEntries(Object.entries(draft.bySession).filter(([key]) => key !== sessionId))
        } else {
          draft.bySession[sessionId] = kept
        }
      })
    },
    get(sessionId, fileId) {
      return store.getSnapshot().bySession[sessionId]?.find(entry => entry.id === fileId)
    },
  }
}
