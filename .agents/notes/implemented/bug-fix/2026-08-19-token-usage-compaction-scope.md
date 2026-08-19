# Agent Note: tokenUsage counts compaction summarizer usage

Status: implemented

English | [中文](2026-08-19-token-usage-compaction-scope.zh.md)

## Problem

The `compaction/summary` session event carries the summarization call's own provider usage (`provider`, `model`, `usage?`) alongside its shadow price, but the `tokenUsage` projection folded only `assistant/chunk`(usage) and `assistant/message` samples. Every summarization call therefore vanished from the session's durable usage totals — the Web stats strip (input/output/cache-hit) and the subagent catalog's token totals undercounted exactly the sessions that compacted, while the complete data sat in the log the projection replays.

## Decision

`tokenUsageProjectionDefinition.apply` gained a `compaction/summary` branch in [`packages/llm/token-meter/src/usage-projection.ts`](../../../../packages/llm/token-meter/src/usage-projection.ts): when the event's `usage` is present its four buckets accumulate in full through `addReplacing(totals, undefined, buckets)`; when absent (a template or remote summarizer that reported none) the event is a no-op that returns the same state reference, so the change feed stays silent. The summary usage never touches the `last` sample slot — the event carries no turn/step, and the (turn, step) replacement logic stays exactly as it was.

`stateVersion` bumped 1 → 2. Persisted projection-cache rows stamped ver 1 are discarded on read and refolded from the log (the cache's designed discard-never-migrate path), so cold sessions converge on the widened scope without a migration step.

The package README (both languages) now states the scope as main-loop requests plus compaction summarization calls, records the no-usage summarizer and session-title-llm gaps under Known Limitations, and the stale claim that compaction "appends no usage of its own" (written before `compaction/summary` grew its usage field) is corrected to name the log-only event as a carrier outside `pressureTokens`' request-path samples. The Web fixture's `tokenUsageOf` mirrors the branch and `projectionFramesOf` pushes a `tokenUsage` frame for a summary carrying usage (never `contextPressure` — that unit samples request paths exclusively).

## Alternatives considered

**A separate projection key (e.g. `compactionUsage`).** Every current consumer (StatsLine, SubagentCatalogAction) reads `tokenUsage` as the session's total and would need a second read plus addition, and "what did this session cost in tokens" is one fact. The single key keeps one home for the total; the fold branch is four lines.

**Consumers scanning `compaction/summary` themselves.** The same accumulation would be copied into each client, and neither the push frames nor the persisted checkpoint fast path would carry the merged figure.

**Fitting the summary into the (turn, step) replacement logic.** The event belongs to no step; inventing coordinates would violate the adjacency invariant the `last` slot relies on and risk double counting on replay.

## Consequences

Session usage totals grow by every summarization call that reported usage — the expected correction, not a regression. No shipped snapshot changed: the fixture logs and seeded-history scenario carry no `compaction/summary` with `usage`, verified before landing. Totals are no longer monotone-across-restarts for sessions whose old checkpoint predates the bump: the discarded ver-1 row refolds to a larger value, which is the scope change arriving, not drift. `session-title-llm` still logs no usage; its calls remain outside every usage fold and the gap is documented in the README's Known Limitations as deferred work.
