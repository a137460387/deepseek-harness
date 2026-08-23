# Agent Note: Draft token budget as a fork browser plugin

Status: implemented

English | [中文](2026-08-23-composer-draft-budget.zh.md)

## Problem

The composer's context feedback shows only stock: the ContextMeter ring reads the `contextPressure` projection and reports how full the context already is — nothing warns what the half-written draft in the box will cost against that budget. The 2026-08-22 topic survey scored this the top-2 gap (double-source clean: no upstream surface — the meter has no draft increment — and no community plugin across the corpus), and the 2026-08-23 light recheck held: `draft budget` / `token estimate` / `prompt size` searches stay unoccupied, and the latest release (dsh-v0.1.1-rc.2) carries no signal.

## Decision

`packages/extensions/draft-budget` (`@deepseek-ai/dsh-client-draft-budget`), a pure-browser package in the fork-extension tier (inert node half, `./invariant` companion, bilingual README, version pinned to root). One readout line in `conversation.composer.dock` — the catalog's own seat for "an ambient readout about the conversation", the stats line's band — registered as a fresh list entry (`id 'draft-budget'`, order 10) beside the shipped stats entry.

- **The estimator mirrors the meter, not a private guess**: `ceil(length/4) + 8` is exactly what `token-meter/src/estimate.ts` charges a plain-text user message (CHARS_PER_TOKEN plus block and role framing). The mirror is three constants and one expression; a contract spec imports the real `estimateMessage` through the package's `./src/*` export and asserts equality over a representative corpus, so an upstream formula change fails the fork's own test at the next sync. The alternative — importing the meter's host face — was rejected: the client face exports types only, and the host face carries node-side service wiring no browser bundle should pull.
- **Everything arrives as slot props**: the dock's `useInput` share (live draft, behind a 250 ms trailing debounce so typing does not re-render per keystroke) and `useProjection('contextPressure')`. No subscription, no listener, no observer — the plugin's only registrations are the dictionary effect and a declaration-bound `slots.inject`, both disposable on the plugin fiber (the text-file-cards registration shape).
- **The percentage anchors on the provider**: after-send occupancy is `(projectedTokens ?? pressureTokens) + draft) / contextWindow`, capped at 100 — the provider-reported projection prices the large number and the heuristic prices only the draft increment. No capacity, no percentage: the readout degrades to tokens-only rather than inventing a window.
- **Approximation is disclosed, never implied**: every figure carries `~`. The heuristic underprices CJK and JSON and the community measured tens-of-percent divergence from provider usage in long sessions (discussion #3514); the README states the error band and the not-counted list (command claims, reference chips, queued rows, draft images).

## Testing

`tests/estimate.client.spec.ts` pins the mirror's arithmetic (framing-only empty draft, partial-unit rounding, UTF-16 counting, linear scaling), the folding convention's boundaries, and the contract against the real `estimateMessage` (one assertion site keeps the branded message fields out of this client package's imports). `tests/draft-budget.client.spec.tsx` covers the readout over scripted props: empty and whitespace drafts render nothing, the tokens-only branch without figures, the full branch's percentage math with the projectedTokens preference and pressureTokens fallback, degenerate windows, the 100% cap, large-draft folding, the debounce's settle/coalesce/unmount behavior, the locale key parity, a boot over a real SlotRegistry and LocaleRuntime with clean disposal, the inert node entry, and the invariant companion. `apps/web/tests/draft-budget.e2e.ts` pins the browser lane: the replay adapter reports no route capacity (probed: the chip settles at `data-draft-budget="tokens"`), so the lane asserts the exact folded estimates for deterministic drafts (`~18 tok` for 40 chars, `~38 tok` for 120), the debounced growth, and the clear-to-hidden transition. The full branch's percentage math is pinned by the unit spec over scripted projections.

## Alternatives considered

**Consume the meter's host face directly.** The estimator lives in the host package, but its client face exports types only and the root face is service wiring; pulling it into a browser bundle drags node-side dependencies. The local mirror plus a contract spec keeps the browser package pure and makes drift loud instead of silent.

**Depend on usage-stats via a module-table row.** The fork's sharing precedent (draft-keeper → composer-guards) fits shared *predicates*; context figures are not usage-stats' to share — `contextPressure` is token-meter's session projection, and the dock slot hands it over as a standard prop. A dependency edge would have coupled two plugins that read the same public projection independently.

**Exact tokenizer in the browser.** None exists on the client face, and shipping one is a new external dependency the fork rules out. The meter itself prices heuristically, so matching its price is the honest ceiling: the readout is right by construction whenever the meter is right, and wrong in the same direction whenever it is not.

**A clickable control in the tool row.** `conversation.input.right` hosts controls on the send path under a one-row height budget; a readout belongs in the dock band per the catalog's own routing. A future detail popover can move there without touching this seat's contract.

## Consequences

- Long-prompt authors see the cost of the draft as it grows and the after-send occupancy against the window — the exact number the next request's meter will report for the increment, with the approximation stated up front.
- draft-budget is the fork's eighth extension package and the second occupant of the composer dock; the entry proves the band's additive promise beside the stats line.
- The contract spec turns upstream formula drift into a visible test failure at sync time — the mirror must be consciously re-aligned, never silently divergent.
- The replay e2e lane runs the tokens-only branch by construction (no advertised capacity); the full branch's browser verification would need a capacity-reporting adapter and stays pinned by unit-level scripted projections for now. If upstream builds draft-increment display into the meter (the natural reading of #3514's transparency ask), this plugin should retire rather than compete.
