/**
 * Pure-marker unit pins: grammar round-trip, sanitizer/command adjudication
 * disjointness, threshold boundaries, and the submit-time expansion semantics.
 */

import { describe, expect, it } from 'vitest'
import {
  MARKER_RE, MAX_STAGED_BYTES, countLines, expandDraft, firstLine, hasMarker, markerOf, overThreshold,
} from '../src/client/markers.ts'

describe('long-text-fold marker grammar', () => {
  it('round-trips markerOf through the scan regex', () => {
    for (const seq of [1, 42, 999_999]) {
      const marker = markerOf(seq)
      expect(marker).toBe(`[LongText#${String(seq)}]`)
      const matches = [...marker.matchAll(MARKER_RE)]
      expect(matches).toHaveLength(1)
      expect(Number(matches[0]![1])).toBe(seq)
    }
  })

  it('never starts with a slash, so the command adjudication cannot claim it', () => {
    // The input machine adjudicates drafts whose trimmed text starts with '/'.
    expect(/^\s*\//.test(markerOf(1))).toBe(false)
  })

  it('is disjoint from the input facade placeholder sanitizer', () => {
    // Mirrors REFERENCE_PLACEHOLDER_RE (ui-conversation facade.ts:112): the
    // sanitizer strips private-use and U+FFFC code points; every marker
    // character is outside that set, so setDraft never eats a marker.
    const sanitizer = /[\uE100-\uE11D\uFFFC]/gu
    expect(sanitizer.test(markerOf(7))).toBe(false)
  })

  it('survives a draft that already carries sanitizer code points', () => {
    const draft = `before \uFFFC${markerOf(3)}`
    const result = expandDraft(draft, seq => seq === 3 ? 'full' : undefined)
    expect(result.draft).toBe('before \uFFFCfull')
  })

  it('reports marker membership without regex state leakage', () => {
    expect(hasMarker(`a ${markerOf(2)} b`)).toBe(true)
    expect(hasMarker('no markers here')).toBe(false)
    // Repeated calls must not drift through a global lastIndex.
    expect(hasMarker(markerOf(2))).toBe(true)
    expect(hasMarker(markerOf(2))).toBe(true)
  })
})

describe('long-text-fold thresholds', () => {
  it('flips on the 2000-character boundary', () => {
    expect(overThreshold('x'.repeat(1999))).toBe(false)
    expect(overThreshold('x'.repeat(2000))).toBe(true)
  })

  it('flips on the 50-line boundary (newline-separated)', () => {
    expect(overThreshold(Array.from({ length: 49 }, () => 'x').join('\n'))).toBe(false)
    expect(overThreshold(Array.from({ length: 50 }, () => 'x').join('\n'))).toBe(true)
  })

  it('counts lines by newline segments', () => {
    expect(countLines('')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\n')).toBe(2)
  })

  it('keeps empty and whitespace texts below the threshold', () => {
    expect(overThreshold('')).toBe(false)
    expect(overThreshold('   ')).toBe(false)
  })

  it('keeps the single-entry ceiling above the staging budget line', () => {
    // MAX_STAGED_BYTES is the per-entry refusal ceiling; it must sit below
    // the eviction budget so one accepted entry can never outsize the LRU.
    expect(MAX_STAGED_BYTES).toBeLessThan(2_000_000)
  })
})

describe('long-text-fold expansion', () => {
  const lookupOf = (entries: Record<number, string>) => (seq: number): string | undefined => entries[seq]

  it('expands a single marker', () => {
    const result = expandDraft(`a ${markerOf(1)} b`, lookupOf({ 1: 'FULL' }))
    expect(result.draft).toBe('a FULL b')
    expect(result.expanded).toEqual([1])
    expect(result.missing).toEqual([])
  })

  it('expands multiple markers in place', () => {
    const result = expandDraft(`${markerOf(1)} middle ${markerOf(2)}`, lookupOf({ 1: 'A', 2: 'B' }))
    expect(result.draft).toBe('A middle B')
    expect(result.expanded).toEqual([1, 2])
  })

  it('expands adjacent markers without separators', () => {
    const result = expandDraft(`${markerOf(1)}${markerOf(2)}`, lookupOf({ 1: 'A', 2: 'B' }))
    expect(result.draft).toBe('AB')
  })

  it('keeps missing markers verbatim and reports them', () => {
    const marker = markerOf(9)
    const result = expandDraft(`x ${marker} y`, lookupOf({}))
    expect(result.draft).toBe(`x ${marker} y`)
    expect(result.missing).toEqual([9])
    expect(result.expanded).toEqual([])
  })

  it('treats a corrupted marker as ordinary text', () => {
    const result = expandDraft('[LongText#1 ] and [LongText#x]', lookupOf({ 1: 'A' }))
    expect(result.draft).toBe('[LongText#1 ] and [LongText#x]')
    expect(result.missing).toEqual([])
  })

  it('is idempotent over an already-expanded draft', () => {
    const once = expandDraft(`a ${markerOf(1)} b`, lookupOf({ 1: 'FULL' }))
    const twice = expandDraft(once.draft, lookupOf({ 1: 'FULL' }))
    expect(twice.draft).toBe(once.draft)
    expect(twice.expanded).toEqual([])
    expect(twice.missing).toEqual([])
  })
})

describe('long-text-fold first-line preview', () => {
  it('returns the trimmed first line', () => {
    expect(firstLine('  hello \nworld')).toBe('hello')
  })

  it('ellipsizes past 120 characters', () => {
    const long = 'x'.repeat(200)
    expect(firstLine(long)).toBe(`${'x'.repeat(120)}…`)
  })
})
