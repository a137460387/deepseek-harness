# Agent Note: Web e2e seed fixtures splice paths in JSON-literal form

Status: implemented

English | [中文](2026-08-20-web-e2e-scaffold-cwd-json-escaping.zh.md)

## Problem

The Web e2e scaffold's seed-fixture machinery substitutes `{{sessionId}}`/`{{cwd}}` placeholders by bare string `split().join()` directly on the fixture's JSONL text. The committed fixtures carry the placeholders inside JSON string values (`"cwd":"{{cwd}}/workspace"`), so the substituted value must arrive in JSON string-literal form. On Windows the scaffold's workspace cwd is a backslash path (`C:\Users\...\dsh-web-e2e-ws-xxxx`); splicing it raw produces `"cwd":"C:\Users\..."`, where `\U`, `\A`, and every other path segment start is an illegal JSON escape, and the first-line `JSON.parse` in `realizeSeedFixture` throws `SyntaxError: Bad escaped character in JSON`. Every suite that seeds a recorded session failed whole-file on Windows this way — 25 files in the last full replay run — while CI stays green because POSIX paths contain no character JSON escapes (the splice is the identity there), which is also why the bug survived since the scaffold's introduction. Two sibling defects shared the same root: `recordFixture` split on the raw cwd while the harvested JSONL text carries the escaped form (Windows recordings never tokenized the cwd), and `normalizeAria` missed Windows paths twice over — its basename split on `'/'` yields the whole backslash path, and its cwd tokenization matched only the raw spelling while tool args and results render as raw JSON text carrying the escaped one — silently disabling both the `{{workspace}}` and the `{{cwd}}` golden normalization.

## Decision

All substitutions that touch fixture JSON text now go through one helper: `jsonLiteral(value)` returns `JSON.stringify(value).slice(1, -1)` — the literal body JSON writes between the quotes. `realizeSeedFixture` joins both placeholder values in escaped form (`{{sessionId}}`, `{{cwd}}`) and applies the same form to the second-pass rewrite of the recorded cwd (split key and join value, since that pass also operates on JSON text). `recordFixture` splits on the escaped cwd — the only form a `JSON.stringify`-produced log line can contain. `normalizeAria` tokenizes the cwd in both spellings an aria snapshot carries — raw in plain-text regions and JSON-escaped inside tool args/results, which render as raw JSON text — and derives the workspace basename with a separator class covering both platforms (`/[\\/]/`). On POSIX every one of these transforms is the identity, so committed fixtures, goldens, and record-mode output are byte-identical to before; only the Windows runs change behavior.

## Verification

A full `DSH_SNAPSHOT=replay pnpm run test:web` on Windows: zero `Bad escaped character` occurrences remain (29 in the run before the fix), and the failing-file count drops from 42 to 19 with no file that was green before turning red. Of the 25 whole-file JSON-escape casualties, 21 turn green outright — including the `{{workspace}}`-dependent `stats-paged-history` golden and the two newest casualties, `message-feedback-layout` and `reference-composer` (whose goldens also needed the escaped-spelling split in `normalizeAria`). The remaining four progress past seeding into failures this change does not touch: `background-job-list` and `chat-long-interactions` reach the Windows shell-tool composition (seeded `bash` rows render without terminal cards, and `unknown tool "bash"` where the scenario executes the tool — the class of the pre-existing `minimal-preset.snapshot` and `turn-tail-actions` goldens), `chat-scroll-contract` hits scroll-geometry timeouts on its 88-turn history, and `navigation-panes` keeps two bash-terminal-card timeouts while its trajectory golden passes. Two further baseline failures (`models-settings`, `onboarding-deepseek-config`) also passed this run; they are load-order timeout flakes that pass in isolation and touch none of the changed functions.

## Alternatives considered

**Parse each fixture line, substitute on the decoded object, re-serialize.** The placeholders sit at arbitrary depths of event payloads, so the substitution would need a full-tree walk, and re-serialization changes whitespace and escape spellings that `stabilizeFixtureMessageIds` and the committed goldens compare against — a large diff for zero behavioral gain over escaping the spliced values.

**Escape only backslashes (`replace(/\\/g, '\\\\')`).** Correct for the observed paths but hand-rolls a subset of JSON string escaping; `JSON.stringify`-derived literals also cover quotes and control characters for free at the same cost.

**Skip the second-pass cwd rewrite and the record-direction fix as unreachable today.** The record path needs an API key and the second pass mostly no-ops on tokenized fixtures, but both are the same one-line symmetric correction; leaving them raw would preserve known-broken Windows behavior in code this change already understands.

**Add Windows skip-lists to the affected suites.** The defect is in the test infrastructure, not the scenarios; skipping would hide a one-file fix behind per-suite waivers and diverge the Windows lane from CI coverage permanently.

## Consequences

Windows replay runs now parse seeded fixtures identically to CI, restoring the local lane's value as a pre-push signal; the JSON-escape failure class disappears entirely rather than growing with every new seed-based suite (message-feedback-layout and reference-composer were the latest two casualties). Record mode on Windows now tokenizes the cwd correctly, so a future Windows-recorded fixture commits in the same shape as the POSIX-recorded ones. The remaining Windows-only failures are genuine platform differences in scenario content — tool availability and path spellings inside real tool output — and stay visible instead of being masked by an earlier crash.
