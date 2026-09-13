/**
 * Marker grammar, fold thresholds, and the submit-time expansion for staged
 * long texts.
 *
 * The marker is deliberately plain ASCII: it survives the input facade's
 * placeholder sanitizer (which strips only private-use and U+FFFC code
 * points), never trips the `/`-leading command adjudication, and reads as
 * ordinary text everywhere it can leak. The chat-side fold decision is the
 * joined text-block LENGTH, not marker presence: a hand-edited or stale
 * marker that reaches a sent message is too short to fold, so it renders
 * literally and the renderer needs neither marker trust nor storage access.
 */

/** Global scan form for marker occurrences (replacement scanning). */
export const MARKER_RE = /\[LongText#(\d+)\]/g
/** Non-global membership test (global regexes carry stateful lastIndex). */
const MARKER_TEST_RE = /\[LongText#\d+\]/

/** Character count that flips a pasted text into a staged card. */
export const PASTE_FOLD_CHARS = 2000
/** Line count that flips a pasted text into a staged card. */
export const PASTE_FOLD_LINES = 50
/** Character count that folds a sent user text block in the chat view. */
export const RENDER_FOLD_CHARS = 2000
/** Line count that folds a sent user text block in the chat view. */
export const RENDER_FOLD_LINES = 50
/** Single staged-entry ceiling in UTF-16 code units (≈250k tokens). */
export const MAX_STAGED_BYTES = 1_000_000
/** LRU entry cap across all sessions. */
export const MAX_ENTRIES = 50
/** LRU total-text budget across all sessions (UTF-16 code units). */
export const MAX_TOTAL_BYTES = 2_000_000

/**
 * The draft placeholder for one staged entry.
 * @param seq - the staging sequence number.
 * @returns the literal marker text inserted into the draft.
 */
export function markerOf(seq: number): string {
  return `[LongText#${String(seq)}]`
}

/**
 * Whether the draft contains at least one restorable marker.
 * @param draft - the current draft's clipboard projection.
 * @returns true when a submit-time expansion may have work to do.
 */
export function hasMarker(draft: string): boolean {
  return MARKER_TEST_RE.test(draft)
}

/**
 * Count newline-separated lines.
 * @param text - the text to measure.
 * @returns the line count (segments split on `\n`).
 */
export function countLines(text: string): number {
  return text.split('\n').length
}

/**
 * Whether a pasted text crosses a staging threshold.
 * @param text - the clipboard's plain text.
 * @returns true when the takeover should stage instead of inlining.
 */
export function overThreshold(text: string): boolean {
  return text.length >= PASTE_FOLD_CHARS || countLines(text) >= PASTE_FOLD_LINES
}

/**
 * The single-line card preview for one text.
 * @param text - the full text.
 * @returns the trimmed first line, ellipsized past 120 characters.
 */
export function firstLine(text: string): string {
  const cut = text.indexOf('\n')
  const line = (cut < 0 ? text : text.slice(0, cut)).trim()
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

/** Outcome of one submit-time expansion pass. */
export interface ExpansionResult {
  /** The draft with every staged marker replaced by its full text. */
  readonly draft: string
  /** Sequence numbers that were expanded. */
  readonly expanded: readonly number[]
  /** Sequence numbers whose staged entry was missing (left verbatim). */
  readonly missing: readonly number[]
}

/**
 * Replace every marker with its staged full text, preserving surrounding
 * draft text. Markers without a staged entry stay verbatim and land in
 * `missing` so the caller can notify; the sent shape for a missing marker is
 * the literal short text, which the chat side renders as-is (too short to
 * fold).
 * @param draft - the current draft's clipboard projection.
 * @param lookup - resolves one marker sequence number to its staged text.
 * @returns the expanded draft plus the expanded/missing sequence numbers.
 */
export function expandDraft(draft: string, lookup: (seq: number) => string | undefined): ExpansionResult {
  const expanded: number[] = []
  const missing: number[] = []
  const next = draft.replace(MARKER_RE, (marker: string, seqText: string) => {
    const seq = Number(seqText)
    const full = lookup(seq)
    if (full === undefined) {
      missing.push(seq)
      return marker
    }
    expanded.push(seq)
    return full
  })
  return { draft: next, expanded, missing }
}
