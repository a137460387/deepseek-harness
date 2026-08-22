/**
 * Pure DOM search engine for the find bar: literal case-insensitive
 * substring matches over the chat flow's text nodes, plus the two probes
 * the bar's coverage copy reads (searched-row count and whether an earlier
 * page remains unloaded). No React, no services, no listeners — the
 * controller owns mutation and the bar owns painting decisions that need
 * ranges.
 *
 * Match semantics: one text node at a time. A query spanning two adjacent
 * text nodes (how React splits rendered prose) deliberately does not match —
 * the browser's own find behaves the same way over split text nodes, and
 * joining them would build ranges that the next React render invalidates.
 * @module @deepseek-ai/dsh-client-find-in-chat/client/find-engine
 */

/** One substring occurrence inside a single text node. */
export interface ChatTextMatch {
  /** The text node containing the occurrence. */
  readonly node: Text
  /** Occurrence start offset inside the node's data. */
  readonly start: number
  /** Occurrence end offset inside the node's data. */
  readonly end: number
}

/**
 * Whether a query is searchable: non-empty after trimming.
 * @param query - the raw query text.
 * @returns true when the query contains any non-whitespace character.
 */
export function isSearchable(query: string): boolean {
  return query.trim() !== ''
}

/**
 * Find every literal, case-insensitive occurrence of the query under the
 * chat flow, in document order.
 * @param flow - the `[data-chat-flow]` element (or any subtree to search).
 * @param query - the raw query text; blank queries match nothing.
 * @returns the occurrences, document-ordered.
 */
export function findChatMatches(flow: ParentNode, query: string): readonly ChatTextMatch[] {
  if (!isSearchable(query)) return []
  const needle = query.toLowerCase()
  const matches: ChatTextMatch[] = []
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (parent === null) return NodeFilter.FILTER_REJECT
      // Decorative and live-region text is not conversation content.
      if (parent.closest('[aria-hidden="true"]') !== null) return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text
    const haystack = text.data.toLowerCase()
    let at = haystack.indexOf(needle)
    while (at !== -1) {
      matches.push({ node: text, start: at, end: at + needle.length })
      at = haystack.indexOf(needle, at + needle.length)
    }
  }
  return matches
}

/**
 * Count the settled chat rows currently in the DOM — the honest "how much
 * did we search" figure for the coverage copy.
 * @param flow - the `[data-chat-flow]` element.
 * @returns the number of `[data-chat-anchor-key]` rows.
 */
export function countSearchedRows(flow: ParentNode): number {
  return flow.querySelectorAll('[data-chat-anchor-key]').length
}

/**
 * Whether an earlier history page remains unloaded: the ChatView renders
 * its "Load earlier" button above every settled row whenever `hasMore`
 * stands, so a button that precedes the first row in document order can
 * only be that control.
 * @param flow - the `[data-chat-flow]` element.
 * @returns true when the loaded window does not reach the session's head.
 */
export function hasEarlierPages(flow: ParentNode): boolean {
  const button = flow.querySelector('button')
  const firstRow = flow.querySelector('[data-chat-anchor-key]')
  if (button === null || firstRow === null) return false
  // The button must sit before the first settled row in document order.
  return (button.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}
