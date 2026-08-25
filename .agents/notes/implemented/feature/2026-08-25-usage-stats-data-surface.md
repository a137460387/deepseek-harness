# Agent Note: Usage statistics data surface — monthly breakdown and CSV export

Status: implemented

English | [中文](2026-08-25-usage-stats-data-surface.zh.md)

## Problem

The usage statistics tab computes a monthly aggregate (`monthlyStats`) beside its daily figures, and the section intro promises aggregation "per day and per month" — but no monthly view ever renders: the monthly fold has no seat in the UI, so the promise is half kept. The surface also has no data exit: the numbers live only inside the tab, so a user who wants them in a spreadsheet (cost review, capacity planning, a report) has to copy figures by hand.

## Decision

Two additive features, both browser-half only, over the package's existing pure aggregation — no host-side change, no new dependency, no model-facing surface (the README's Model Experience entry stands):

- **Monthly breakdown block**: the whole history folds through `monthlyStats` and renders after the share donut as a compact month → total list, newest month first, totals through the same `formatTokens` face as every other figure. The block shares the standard block head and the empty placeholder.
- **CSV export**: `dailyStatsToCsv` renders the range's visible day rows as RFC 4180 text (`day,total` header, one row per day, total escaping); the head carries an Export CSV button beside Refresh, disabled while the range shows no rows. The download builds a `text/csv` Blob, takes an object URL through a transient anchor named `dsh-usage-<today>.csv`, and revokes the URL after the click.

Export-what-you-see: the button downloads exactly the range the trend chart scopes (default: the last seven days); all-time is one toggle away. The monthly block deliberately ignores the range — it answers "per month, ever", the way the donut answers "share, ever".

## Testing

`tests/aggregate.client.spec.ts` pins the CSV rendering: header plus one row per entry in input order, the header alone for an empty range, and RFC 4180 quoting (comma, doubled quote, line break). `tests/section.client.spec.tsx` pins the UI paths: the monthly list renders newest month first over a two-month history; clicking Export CSV downloads `dsh-usage-<today>.csv` whose blob text is exactly the expected CSV, and the object URL is revoked; the button stays disabled when no day rows are visible. The package suite runs 66/66.

## Alternatives considered

**Per-route CSV columns.** The series keys are open-ended (any provider or model name), so widened columns mean dynamic headers and a moving target for consumers; `day,total` is the honest minimum, and the per-route split stays in the tab. Recorded as the export's limitation in the README.

**Whole-history export ignoring the range selector.** Exporting what is on screen is predictable and keeps the button next to the data it names; a whole-history download remains reachable through the all-time range. Choosing the range first avoids surprise bulk downloads.

**A monthly chart instead of a list.** The trend chart already carries shape across days; the month question wants exact totals, and a list answers it without palette, axis, or legend machinery.

## Consequences

- `monthlyStats` now has a UI seat, so the intro copy ("aggregated per day and per month") is fully true; the former test-only aggregate is pinned by both the unit spec and the rendered block.
- Day-level totals leave the tab as CSV; the export covers the ranged `day,total` rows only (per-route splits stay in the tab), which the README limitations section now states.
- No composition surface changed: the settings section slot, the projection unit, and the module requests are untouched, so no bundle or supply-row adjustments were needed.
