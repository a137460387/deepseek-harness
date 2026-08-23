/**
 * The estimator mirror: hand-checked arithmetic for the local constants,
 * the folding boundaries the stats line's convention implies, and the
 * contract against the real token-meter estimator imported through the
 * package's `./src/*` export — the mirror must price a plain-text draft at
 * exactly what `estimateMessage` charges it as a sent user message, so an
 * upstream formula change turns this spec red on the next sync.
 */
import { describe, expect, it } from 'vitest'
import { estimateMessage } from '@deepseek-ai/dsh-token-meter/src/estimate.ts'
import { estimateDraftTokens, formatTokenCount } from '../src/client/estimate.ts'

describe('estimateDraftTokens', () => {
  it('prices the empty draft at the pure framing overhead', () => {
    expect(estimateDraftTokens('')).toBe(8)
  })

  it('rounds partial density units up', () => {
    expect(estimateDraftTokens('abcd')).toBe(9)
    expect(estimateDraftTokens('abc')).toBe(9)
    expect(estimateDraftTokens('abcde')).toBe(10)
  })

  it('counts UTF-16 code units like the meter does', () => {
    // Four CJK characters: length 4, same as four ASCII letters.
    expect(estimateDraftTokens('你好世界')).toBe(9)
  })

  it('scales linearly with long drafts', () => {
    expect(estimateDraftTokens('a'.repeat(100))).toBe(33)
    expect(estimateDraftTokens('a'.repeat(10_000))).toBe(2_508)
  })
})

describe('estimate mirror contract', () => {
  it('matches the real estimateMessage for representative drafts', () => {
    const corpus = [
      '',
      'abcd',
      'a'.repeat(100),
      '你好世界'.repeat(10),
      'mixed 你好 with ascii and 数字 123',
      'a'.repeat(10_000),
    ]
    for (const text of corpus) {
      // The estimator only reads content; one assertion site keeps the
      // branded id/source fields out of this client package's imports.
      const message = {
        id: 'contract-probe',
        role: 'user',
        content: [{ type: 'text', text }],
        source: { provider: 'contract', model: 'contract' },
      } as Parameters<typeof estimateMessage>[0]
      expect(estimateDraftTokens(text)).toBe(estimateMessage(message))
    }
  })
})

describe('formatTokenCount', () => {
  it('folds along the stats line convention', () => {
    expect(formatTokenCount(8)).toBe('8')
    expect(formatTokenCount(99)).toBe('99')
    expect(formatTokenCount(100)).toBe('100')
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1_000)).toBe('1K')
    expect(formatTokenCount(1_234)).toBe('1.2K')
    expect(formatTokenCount(999_999)).toBe('1000K')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
  })
})
