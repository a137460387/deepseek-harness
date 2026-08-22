// @vitest-environment jsdom
/**
 * The find engine's pure DOM semantics: literal case-insensitive substring
 * matches in document order (one text node at a time — a query spanning
 * React-split nodes deliberately does not match), the blank-query gate,
 * decorative-text skipping, and the two coverage probes (settled-row count
 * and the earlier-page button detection).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { countSearchedRows, findChatMatches, hasEarlierPages, isSearchable } from '../src/client/find-engine.ts'

interface RowSpec {
  /** Plain prose for the row. */
  readonly text?: string
  /** A fenced-style code block's inner text, rendered inside <pre><code>. */
  readonly code?: string
  /** Extra html injected raw into the row (for split-node and hidden cases). */
  readonly html?: string
}

/**
 * Build one chat-flow document: a scrollport, the flow, and settled rows.
 * @param rows - row specs, rendered in order.
 * @param earlier - prepend the "Load earlier" button container.
 * @returns the flow element.
 */
function buildFlow(rows: readonly RowSpec[], earlier = false): HTMLElement {
  document.body.innerHTML = ''
  const scroll = document.createElement('div')
  scroll.dataset.conversationScroll = ''
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  scroll.append(flow)
  document.body.append(scroll)
  if (earlier) {
    const older = document.createElement('div')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Load earlier'
    older.append(button)
    flow.append(older)
  }
  for (const [index, spec] of rows.entries()) {
    const row = document.createElement('div')
    row.dataset.chatAnchorKey = `row-${String(index)}`
    if (spec.text !== undefined) row.append(document.createTextNode(spec.text))
    if (spec.code !== undefined) {
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.append(document.createTextNode(spec.code))
      pre.append(code)
      row.append(pre)
    }
    if (spec.html !== undefined) row.innerHTML = row.innerHTML + spec.html
    flow.append(row)
  }
  return flow
}

/** All match texts as `node-data[start:end]` for stable assertions. */
function texts(matches: readonly { readonly node: Text; readonly start: number; readonly end: number }[]): string[] {
  return matches.map(match => match.node.data.slice(match.start, match.end))
}

describe('isSearchable', () => {
  it('rejects empty and whitespace-only queries', () => {
    expect(isSearchable('')).toBe(false)
    expect(isSearchable('   ')).toBe(false)
    expect(isSearchable('\t\n')).toBe(false)
    expect(isSearchable(' x ')).toBe(true)
  })
})

describe('findChatMatches', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('finds occurrences in document order, several per node', () => {
    const flow = buildFlow([{ text: 'alpha beta' }, { text: 'beta alpha beta' }])
    expect(texts(findChatMatches(flow, 'beta'))).toEqual(['beta', 'beta', 'beta'])
    const matches = findChatMatches(flow, 'beta')
    expect(matches[0]!.node.parentElement?.dataset.chatAnchorKey).toBe('row-0')
    expect(matches[2]!.node.parentElement?.dataset.chatAnchorKey).toBe('row-1')
  })

  it('matches case-insensitively without folding the source', () => {
    const flow = buildFlow([{ text: 'Find The Needle here' }])
    expect(texts(findChatMatches(flow, 'THE needle'))).toEqual(['The Needle'])
    expect(texts(findChatMatches(flow, 'HERE'))).toEqual(['here'])
  })

  it('returns nothing for blank queries', () => {
    const flow = buildFlow([{ text: 'anything' }])
    expect(findChatMatches(flow, '')).toEqual([])
    expect(findChatMatches(flow, '  ')).toEqual([])
  })

  it('matches text inside code blocks', () => {
    const flow = buildFlow([{ text: 'prose' }, { code: 'const scroll_case_011_00 = 11' }])
    expect(texts(findChatMatches(flow, 'scroll_case_011_00'))).toEqual(['scroll_case_011_00'])
  })

  it('does not stitch a query across split text nodes', () => {
    const flow = buildFlow([{ html: '<span>ab</span><span>cd</span>' }])
    expect(findChatMatches(flow, 'bc')).toEqual([])
    expect(texts(findChatMatches(flow, 'cd'))).toEqual(['cd'])
  })

  it('skips aria-hidden decorative text', () => {
    const flow = buildFlow([{ text: 'visible' }, { html: '<span aria-hidden="true">hidden needle</span>' }])
    expect(findChatMatches(flow, 'needle')).toEqual([])
    expect(texts(findChatMatches(flow, 'visible'))).toEqual(['visible'])
  })
})

describe('countSearchedRows', () => {
  it('counts only settled anchor rows', () => {
    const flow = buildFlow([{ text: 'a' }, { text: 'b' }, { text: 'c' }])
    expect(countSearchedRows(flow)).toBe(3)
    const filler = document.createElement('div')
    filler.append(document.createTextNode('not a row'))
    flow.append(filler)
    expect(countSearchedRows(flow)).toBe(3)
  })

  it('counts zero for an empty flow', () => {
    const flow = buildFlow([])
    expect(countSearchedRows(flow)).toBe(0)
  })
})

describe('hasEarlierPages', () => {
  it('detects the load-earlier button above the first row', () => {
    const flow = buildFlow([{ text: 'a' }], true)
    expect(hasEarlierPages(flow)).toBe(true)
  })

  it('reports false without an earlier-pages button', () => {
    const flow = buildFlow([{ text: 'a' }])
    expect(hasEarlierPages(flow)).toBe(false)
  })

  it('reports false when the first button sits inside a settled row', () => {
    const flow = buildFlow([{ html: '<button type="button">copy</button>' }, { text: 'b' }])
    expect(hasEarlierPages(flow)).toBe(false)
  })

  it('reports false for an empty flow', () => {
    const flow = buildFlow([], true)
    expect(hasEarlierPages(flow)).toBe(false)
  })
})
