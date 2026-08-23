# Agent Note: Harden the fork extension batch against audit findings

Status: implemented

English | [中文](2026-08-23-fork-hardening-batch.zh.md)

## Problem

A repo audit verified three medium-severity defects and two coverage holes in the fork's own packages, each at file:line evidence: the text-file-cards expand handler awaited `entry.file.text()` with no guard (`packages/extensions/text-file-cards/src/client/index.ts`), so a rejected read threw through the slot inject path; the usage-stats backfill folded a refused history call, a transport throw, and a confirmed missing key into one `absentCount` (`packages/extensions/usage-stats/src/client/stats-store.ts`), so a failing transport could render the "unit not registered" hint about sessions whose status was unknown; and the usageStats value shape existed in three unsynchronized copies (wire viewSchema, stateSchema quarters, client hand-written narrow). Separately, the connection fixture's compaction-usage mirror branch had zero test coverage, and the drop/expand edge scenarios deleted with the b43d7a8648 global-paste split were never re-expressed against the staging semantics.

## Decision

The expand read follows global-paste's `forwardImagePaste` fail-soft precedent — the read isolated as the single throwing step, a rejection abandons the expansion silently, the card stays staged — rather than draft-keeper's lifetime latch, because a one-file read failure must not disable expanding other staged files.

The backfill outcomes split into `absentCount` (an ok tail page still lacking the key — confirmed unregistered, the only input the section hint trusts) and a new `failedCount` (a refused call or a transport throw — unknown, never cached, retried on the next load). The section's `absentCount === sessionCount` predicate is unchanged; it can now only hold with zero failures. Confirmed absence is itself re-checked on every load rather than cached, because host composition can change between opens. One failure counter serves both error kinds because no consumer distinguishes a server refusal from a transport throw.

The three shape copies stay three: reusing the zod schemas in the client would put the first zod bytes into the browser bundle, and no client-facing source imports zod today. Instead a shape-contract spec parses one corpus through all three definitions, pinning the single intended divergence (the narrow tolerates extra bucket keys — it is a read-guard for chart math, not a wire validator). On its first run that spec caught the narrow accepting arrays at every record level, which both schemas refuse; the narrow now refuses arrays too.

The fixture mirror carries a usage-contract spec that folds one corpus (chunks, a same-step replacement, an identical repeat, a new step, summaries with and without usage) through the real `tokenUsageProjectionDefinition` and the fixture's `tokenUsageOf`, requiring identical wire values at every prefix of the log, so either implementation drifting turns red on the next upstream sync. `tokenUsageOf` and `isUsageStats` are exported for their contract specs, beside the projection definition's own export-for-spec precedent.

The restored drop/expand scenarios are re-expressed for the staging semantics, not copied from the deleted global-paste specs: busy-during-read and composer-unmount move from drop time to expand time, and the e2e card-drop scenario asserts staging rather than inlining. The audit's suspected empty-file semantic reversal did not reproduce — the guard order and `TEXT_EXTENSIONS` are identical before and after the split — so the actual gap was coverage, pinned on both sides: a passthrough pin in global-paste (it mounts no drop listener) and empty-batch/empty-content pins in text-file-cards.

## Alternatives considered

**draft-keeper's catch+latch for the expand read.** Rejected: the latch disables a whole store after one storage failure, which is correct for persistence but would let one unreadable file block expanding every other staged file.

**Three public outcome counters (absent, refused, thrown).** Rejected: nothing downstream distinguishes a server refusal from a transport throw; two counters carry the full observable contract without an unused surface.

**zod schemas in the client narrow.** Rejected: the browser bundle currently imports no zod anywhere, and one narrow is not worth introducing it.

**Caching confirmed absence like a completed backfill.** Rejected: a completed value is immutable history, while absence is a composition fact the host can change by registering the unit later.

## Verification

`browser-plugin.client.spec.tsx` pins the fail-soft read, busy-during-read, unmount-during-read, dataTransfer-null, empty-batch, and empty-content behaviors; `global-paste.client.spec.ts` pins drop passthrough; `stats-store.client.spec.ts` pins the three-way outcome split and absence re-check; `shape-contract.client.spec.ts` contracts the three definitions; `fixture-token-usage-contract.client.spec.ts` contracts the fixture mirror prefix-by-prefix with a hand-checked arithmetic case; `text-file-cards.e2e.ts` stages a drop on the composer card in a real assembled browser.

## Consequences

A rejected expand read leaves the card in place with no notice — the retry affordance is the card itself. `UsageStatsSectionState` gains `failedCount`; the section renders nothing new for it, and the unregistered hint is now exact on confirmed absences only. The fixture and shape contracts run on every test pass, so the mirrors fail loudly at the drift site instead of silently diverging until a UI investigation.
