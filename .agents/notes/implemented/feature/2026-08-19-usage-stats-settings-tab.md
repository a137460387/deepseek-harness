# Agent Note: Usage statistics as a fork projection plus settings tab

Status: implemented

English | [中文](2026-08-19-usage-stats-settings-tab.zh.md)

## Problem

The Web UI shows per-session token totals (the stats strip, the subagent catalog) but answers none of "how much did this deployment consume per provider/model, per day, or per month": `tokenUsage` is one unsplit whole per session, no projection carries route or time dimensions, and nothing aggregates across sessions. The fork needed that cross-session view without touching any `packages/client/` shared file.

## Decision

A dual-face fork package, [`packages/extensions/usage-stats/`](../../../../packages/extensions/usage-stats/README.md) (`@deepseek-ai/dsh-client-usage-stats`):

- **Node half** registers the `usageStats` session-projection unit on `ctx.sessionProjections` (the `dsh-session-stats` shape). The fold mirrors `tokenUsage`'s scope exactly — chunk samples with their `(turn, step)` replacement semantics, compaction summarizer usage accumulated in full — but keys results by UTC quarter-hour and route. Route attribution reads the nearest preceding `request/header`'s provider/model; a summary names its own route; pre-header usage (illegal in practice) lands in an `unknown` route. Zeroed slots are pruned, so an inactive session folds to `{ quarters: {} }`.
- **Delivery rides the standard projection machinery** — live `session/projection` frames, the persisted projection cache, the session-list baseline — with no channel of the package's own.
- **Browser half** registers the settings section through the `settings.section` slot (id `usage-stats`, order 25 after Agent presets, default gear icon). Its controller reads every session's value from the list baseline and backfills sessions whose baseline predates the unit through the history tail page, whose `projections` block folds the whole log through every registered unit; an absent key even there counts toward the exact "host composition lacks the unit" hint.

Buckets are **quarter-hours** (15 minutes), not hours: every IANA timezone offset — :00, :15, :30, :45 — falls on a quarter boundary, so the browser can regroup buckets into exact viewer-local days and months (including half-hour offsets like `Asia/Kolkata`); all calendar math runs client-side and the host never learns a timezone. The page renders headline cards (total, peak day, current and longest streaks), a GitHub-style activity calendar with daily/weekly/cumulative coloring, a range-scoped multi-series trend chart, and a route-share donut — token counts only, never pricing.

Wiring is the established fork append surface: one `cordis.patch.yml` row, one web-app `package.json` dependency, one reference in each root tsconfig aggregate (the package splits `tsconfig.host.json`/`tsconfig.client.json` the `api/gateway` way, because its node half carries host-side imports its client half must not), the extensions group README row, and a `verify-package-readme-model-experience` audit entry. No `packages/client/` file changed.

## Development findings

Two real defects surfaced while building the package, both fixed in the same change:

- **The prune path lost the emptied quarter.** `applyBucketDelta`'s delete branch originally read `omitKey(quarters, key) ?? quarters` — an empty record (nothing survives the key's removal) is `undefined`, so the `??` restored the pre-delete object and the quarter kept the value the replacement was supposed to remove. The `(turn, step)` replacement tests caught it (a chunk sample followed by a different final usage left both counted); the fix distinguishes "pruned to empty" (`{}`) from "key absent" (`undefined`). The lesson generalizes: `??` on a function that legitimately returns "empty" is a silent-failure seat.
- **The chart scroll containers rode the base-surface scrollbar.** The heatmap and trend wrappers set `overflow-x: auto` while sitting on the card elevation (`--dsw-alias-bg-layer-3`); `scrollbar-styles.client.spec.ts` requires every elevated scroll container to rebind `--dsh-scrollbar-thumb`/`--dsh-scrollbar-thumb-hover` to the l2 pair. Fixed by rebinding the two indirections in `UsageStatsSection.module.css` — the contract test, not review, caught it.

## Alternatives considered

**Aggregate purely in the browser over raw `session.history` pages.** Every page would ship tool-output-sized events for figures the projection computes in O(1) state; the first open would stall on the wire. The projection keeps the wire at one value per session.

**A host-side TypertRemoteService with its own namespace.** Cross-session aggregation server-side would need an api-remotes mount, generated `/remote` artifacts, and a new endpoint per question; the projection path reaches the browser through carriers that already exist and already persist checkpoints.

**Extending `tokenUsage` itself with route/time keys.** One unit serving both the stats strip and the analytics page would force the strip's consumers to read around the new dimensions, and the two folds have different identity semantics (last-sample replacement vs. quarter bucketing). A separate key leaves `tokenUsage` and its consumers untouched.

**Hour buckets.** Half-hour timezone offsets would straddle hour boundaries and force the host to know each viewer's timezone to split correctly. Quarter buckets make every offset exact and keep the timezone question entirely client-side.

## Consequences

The settings dialog gains a fifth nav row ("Usage"/使用统计) rendering figures over every session the host lists, including sessions recorded before the plugin existed (history-tail backfill, sequential — a large pre-plugin history makes the first open slower). The donut is whole-history (the range selector scopes the trend chart only); the activity calendar caps at 53 weeks while every headline figure still counts the full history; usage accrued while the tab stays open appears on the next refresh. The counts inherit `tokenUsage`'s scope, so auxiliary title generation (`session-title-llm`) stays uncounted — recorded in the package README's Known Limitations alongside the five-hue chart palette.

The first fork extension with a real node half: the placement rule's "not in the host aggregate" wording now means "the host aggregate references the package's host face" rather than "no host code", which FORK_NOTES records.
