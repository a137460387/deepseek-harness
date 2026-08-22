# Agent Note: In-conversation find as a fork browser plugin

Status: implemented

English | [中文](2026-08-22-chat-find-in-bar.zh.md)

## Problem

The Web UI has no in-conversation find: the command surface's entry points are the composer's `/` menu and the `+` launcher, the sidebar search is a cross-session title/content lookup, and Ctrl/Cmd+F falls through to the browser's native find — which cannot see past the loaded DOM window, ignores the app's session boundaries, and (in the chat's virtualized-predecessor future) would miss unmounted rows. The 2026-08-22 topic survey confirmed the double-source gap: no upstream surface (the command/keyboard domains hold no find entry), and no community plugin (the "Show Your Plugins!" corpus and both awesome lists carry command palettes and navigation rails, but no in-chat text find).

## Decision

`packages/extensions/find-in-chat` (`@deepseek-ai/dsh-client-find-in-chat`), a pure-browser package in the fork-extension tier (inert node half, `./invariant` companion, bilingual README, version pinned to root). Three layers, so the state machine is testable without React: `find-engine` (pure DOM matching and the coverage probes), `find-controller` (every listener, the state machine, highlight painting, and center scrolling), and a thin `FindBar` view over `subscribe`/`getSnapshot` mounted as one `shell.overlay` entry — a fresh id beside the shipped entries (list kind, root scope, click-through layer, `occupants: []`), not a takeover of any existing seat.

- **Interception follows the global-paste precedent**: a document-level capture-phase keydown that only ever takes Ctrl/Cmd+F without Shift/Alt, gated on a live `[data-chat-flow]` (the no-session hero and the trajectory tab both unmount the chat DOM — one probe covers all three declined states) and the absence of any open `[role="dialog"]`. Declined states keep the browser's native find untouched.
- **Matching is literal, case-insensitive, single-text-node** (a query spanning React-split nodes does not match, matching native find over split nodes), skipping `aria-hidden` decoration; code-block text matches like prose.
- **Highlights go through the CSS Custom Highlight API**: ranges over the existing DOM, zero React-tree mutation, re-collected on every mutation rescan. DOM wrapping (`<mark>` injection) was rejected — it breaks on the next React reconciliation. Platforms without the API (jsdom, old browsers) degrade to counting and scrolling without paint.
- **Coverage is honest, not exhaustive**: the search covers the chat flow's live DOM — exactly what native find sees — and the bar reports the settled-message count plus an "earlier messages not loaded" note. No automatic `loadOlder`: ChatView keeps every loaded message mounted (no windowing), so auto-paging would grow the DOM without bound; the view's own Load earlier button plus a rescan picks the older window up.
- **Everything closes through one path**: Escape from the bound find input, a current-session change (the runtime session-list store, draft-keeper's subscription pattern), or the flow unmounting (MutationObserver, 200 ms debounce, which also keeps streaming rescans live with index clamping). Close clears both highlight registers, restores the pre-open focus, and teardown removes the listener, observer, injected style, and registry entries — zero residue, proven by the spec.

## Testing

`tests/find-engine.client.spec.ts` pins the pure DOM semantics: document-order occurrences, case folding, the blank-query gate, code-block hits, no cross-node stitching, aria-hidden skipping, and the row/earlier-page probes. `tests/find-in-chat.client.spec.ts` boots the controller over a jsdom chat-flow document with a fake session list: every interception gate and chord exclusion, the already-open revision bump, query research with wrap-around stepping, the Enter/Escape family gated to the bound input, focus capture and restore, session-switch and mutation-driven closes and rescans, stubbed (registry present) and degraded (absent) highlight painting, both scrollport paths, and the zero-residue dispose; plus the inert node entry and the invariant companion. `tests/find-bar.client.spec.tsx` covers the view over a scriptable controller. `apps/web/tests/find-in-chat.e2e.ts` runs the real composition in a real browser keylessly over seeded long-chat fixtures: counts consistent with the real chromium highlight registry, code-block hits, scroll-center stepping, bidirectional wrap, Escape clear and reopen, session-switch auto-close, and composer coexistence.

## Alternatives considered

**A command-palette-style find (`dsh-spotlight` adjacency).** The community already ships a keyboard command palette; an in-chat text find is a different job (content search, not action dispatch), and the survey found no occupant for it. A palette integration would also force the query through the composer's trigger pipeline, which this plugin deliberately never touches.

**DOM wrapping (`<mark>` spans) for highlights.** Mutating the React-owned tree corrupts reconciliation: the next render either strips the marks or diffs against a mutated DOM. The Highlight API paints ranges without any DOM mutation; its only cost is the degraded no-paint path, which the coverage counting and scrolling already subsume.

**Automatic `loadOlder` while searching.** The runtime's page is 50 messages (`PAGE_MESSAGES`) with no windowing — every loaded message stays mounted — so search-triggered paging would pull the whole session into the DOM for a long history. The coverage note plus the view's own Load earlier button reach the same result at the user's pace.

**Tracking the active view through a store instead of the DOM probe.** The view ring swaps tabs in component state with no public projection; the `[data-chat-flow]` probe is the honest signal (it is exactly "a chat view is mounted") and it degrades to "find unavailable" for free when upstream changes the view set.

## Consequences

- Chat views gain a native-feeling find with session awareness (auto-close on switch, view-scoped matching, coverage honesty) at zero upstream-file cost; the browser's own find remains the fallback everywhere the plugin declines the key.
- find-in-chat is the fork's seventh extension package and the first consumer of `shell.overlay` — the entry proves the layer's additive promise (a fresh id beside zero shipped occupants, click-through preserved by opting back into pointer events on the bar only).
- The Ctrl/Cmd+F takeover is visible and debatable: users who prefer the native bar in chat views lose it there. The gates keep every non-chat context native; if upstream ever ships a first-party find, this plugin should retire rather than compete.
- The single-node match semantics inherit React's text splitting: occurrences split across nodes miss until a re-render rejoins them. This matches native find's behavior over the same DOM and is documented as the boundary, not papered over.
