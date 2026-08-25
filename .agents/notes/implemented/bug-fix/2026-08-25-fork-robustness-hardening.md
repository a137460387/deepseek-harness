# Agent Note: Fork robustness closure — quota-latch clearing, export fail-soft, find debouncing

Status: implemented

English | [中文](2026-08-25-fork-robustness-hardening.zh.md)

## Problem

The 2026-08-25 read-only robustness inventory of the fork's extension packages found three gaps worth fixing:

- **draft-keeper's silent latch could resurrect cleared drafts.** Any storage failure (quota exhaustion first among them) latches the mirror off, and the latched `remove()` / empty `set()` returned early — so a clear or a send landing after the latch left the old entry in localStorage, and the next reload restored text the user had watched disappear, breaking the package's core contract. The existing mid-lifetime pin started from an empty store and never exercised the resurrection path.
- **usage-stats' CSV export ran a bare platform chain.** `Blob` → `URL.createObjectURL` → anchor → revoke had no failure handling; a blocked object URL (hardened privacy mode, an extension policy) left the click silent with only a console error.
- **find-in-chat researched on every keystroke.** Only the mutation rescan was debounced; the query path re-scanned the whole chat flow per key, which lags on very long sessions.

## Decision

Three minimal fixes on the fork-owned files only, each in the package's established idiom:

- **draft-keeper keeps one clearing effort after the latch** (`draft-store.ts`): a latched `remove()` / empty `set()` deletes the in-memory entry and retries one `persist()` — a shrinking rewrite or the key removal that a quota-blocked `setItem` usually still allows. A guard keeps the effort honest: only a map read cleanly from storage is rewritten, so a read-failed latch (which holds nothing) never guesses at the unreadable record. Growth writes stay dead for the lifetime, and the module doc states the duty.
- **usage-stats wraps the export chain** (`UsageStatsSection.tsx`): the handler catches any failure and surfaces it through the section's existing error-row idiom (`role="alert"`, `export.error` locale key) instead of leaving the click silent; a successful export clears the row.
- **find-in-chat debounces the query research** (`find-controller.ts`): the input still shows every keystroke at once; the scan trails the last keystroke by the same 200 ms the mutation rescan uses. Navigation flushes the pending research on demand (`step`, and the Enter path now routes through it) so keyboard stepping always acts on the current query; the timer path keeps the old scroll-to-head behavior, and close/dispose clear the timer.

## Testing

draft-keeper: the latch pin is rewritten around the new contract (growth dead, clearing best-effort), plus three new pins — a shrinking rewrite after a quota latch leaves the other session's entry intact, a read-failed latch leaves the record untouched, and the client-level end-to-end case (stored → quota failure → clear → simulated reload restores nothing). usage-stats: one new pin — object URL creation throwing renders the error row. find-in-chat: three new pins — rapid keystrokes research once (the intermediate query never hits the flow), stepping flushes the pending research and leaves no lingering timer, and close cancels a pending research; the seven immediate-read pins move to `vi.waitFor` around the debounce without changing what they pin. The three suites run 155/155.

## Alternatives considered

**Deleting the whole record on a latched clear.** The single-key record holds every session's draft, so a plain `removeItem` would destroy other sessions' stored drafts along with the cleared one; the shrinking rewrite keeps them.

**Re-enabling writes after the latch.** Retrying growth writes would hammer a storage that already refused them; the latch stays permanent for growth, and only the clearing duty survives it.

**The clipboard API for the CSV export.** A copy-to-clipboard path carries its own permission failures and leaves no file artifact; the anchor download is the established shape, and the error row now covers its failures.

**Keeping the find research synchronous.** Browser-native find scans per keystroke, but it is native; a whole-flow DOM scan per key is the cost the debounce removes, and the navigation flush keeps stepping exact.

## Consequences

- The core "never resurrect text the user watched disappear" contract now holds through the dominant storage-failure mode; a storage that fails reads and shrinking writes alike still cannot be cleaned, which no client-side code can fix.
- The find bar's counts trail the last keystroke by at most the 200 ms debounce; navigation is unaffected because it flushes.
- No composition surface, dependency, or upstream file changed; the `.github/` zero-touch invariant stands.
