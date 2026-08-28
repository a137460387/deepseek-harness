---
description: "Usage statistics settings tab over the usageStats session projection — token counts by route, day, and month."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-usage-stats

English | [中文](README.zh.md)

## Summary

Usage statistics for the Web UI, as a settings tab: token totals split by provider and model, aggregated per day and per month, with headline cards (total, peak day, current and longest streaks), a GitHub-style activity calendar, a range-scoped trend chart, a route-share donut, a monthly breakdown list, and a CSV export of the ranged daily rows. Token counts only — no pricing, ever (provider billing varies; this surface never converts tokens into money).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Data flow

The package is dual-face over one projection key:

- **Node half** (`exports["."]`) registers the `usageStats` session-projection unit, folding the durable log the same way `tokenUsage` does — chunk samples with their `(turn, step)` replacement semantics plus compaction summarizer usage — but keyed by UTC quarter-hour and provider route (`request/header` attribution; a `compaction/summary` names its own route).
- Delivery rides the standard projection machinery: live `session/projection` push frames, the persisted projection cache, and the session-list baseline row — nothing in this package owns a channel.
- **Browser half** (`exports["./client"]`) mounts the settings section through the `settings.section` slot (order 25, after Agent presets). Its controller reads every session's value from the list baseline and backfills sessions whose baseline predates the unit through the history tail page, whose `projections` block folds the whole log through every registered unit.

## Aggregation

Quarter-hour buckets (not hours) mean every IANA timezone offset — :00, :15, :30, :45 — falls on a bucket boundary, so the client can regroup buckets into exact local days and months. All calendar math runs client-side against the browser timezone; the host never learns one. Day/month/streak/peak figures and the range windows (last 7 days / last 30 days / this month / all time) are pure re-groupings of the same buckets.

<a id="model-experience"></a>
## Model Experience

None, as the plugin computes read models of already-logged usage and registers nothing model-facing: no prompt, message, schema, tool, or model call.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No live streaming into the tab** — the controller gathers values when the section opens and on Refresh; usage accrued while the tab stays open appears only after a refresh. The dominant content is historical totals, so the staleness is cosmetic.
- **Counts inherit the `tokenUsage` scope** — main-loop requests and compaction summarizer calls; auxiliary title generation (`session-title-llm`) logs no usage and stays uncounted (see the token-meter README's limitation).
- **The donut is whole-history** — the range selector scopes the trend chart only; the share view answers "which route dominates overall".
- **The CSV export covers the ranged day totals only** — the download carries one `day,total` row per visible day; the per-route split stays in the tab.
- **The activity calendar caps at 53 weeks** — usage older than a year still counts toward every headline figure; it just leaves the calendar grid.
- **Backfill is bounded and cached** — sessions whose list baseline predates the unit are refolded through the history tail page at most eight calls in flight; a completed backfill is reused on later refreshes while the baseline still lacks the key (failed backfills are retried), so only the first open pays the fold cost.
- **The composition hint is exact on confirmed absences only** — the absent hint fires when every observed session's history tail returned ok and also lacked the key, which is precisely "the host composition does not register the unit"; an errored backfill (refused call or transport throw) leaves the session's status unknown and never feeds the hint.
- **Chart palette is five hues** — the sixth and later series share a neutral color; the legend keeps them distinguishable by name.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
