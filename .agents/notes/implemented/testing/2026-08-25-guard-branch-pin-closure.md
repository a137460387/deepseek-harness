# Agent Note: Guard-branch pin closure for global-paste and composer-guards

Status: implemented

English | [中文](2026-08-25-guard-branch-pin-closure.zh.md)

## Problem

The 2026-08-25 read-only test-coverage inventory confirmed the four companion packages' behavior is robust, but found their pin density uneven: global-paste's listener guard chain carried four untested branches — one of them, the takeover-overlay occlusion guard, a user-perceptible path (a paste while an approval panel masks the composer is silently left to native handling) with zero pins — and composer-guards' four symmetric off-screen comparisons pinned only two (left and below). The inventory's own verdict: the guard matrix, not the behavior, was the gap.

## Decision

Test-only closure — zero source changes, both packages' implementations untouched:

- **global-paste gains four guard pins.** The bench grows two options (`occluded` mounts a masking overlay sibling that the `elementFromPoint` probe returns instead of the composer; `noComposer` removes the textarea after mounting), and the pins cover: a paste with no clipboard data (built with the browser's `null` shape, not jsdom's `undefined`), a paste with no mounted composer, a paste while a takeover overlay masks the composer, and a paste focused on a contenteditable region (the region's `isContentEditable` is stubbed, because jsdom leaves it unimplemented — the same platform-fact stubbing idiom the bench already uses for `elementFromPoint` and the clipboard constructors).
- **composer-guards gains the two missing symmetric viewport pins** (center above the viewport, center right of it), each isomorphic to the existing left/below cases.

## Alternatives considered

**Also pinning the low-value leaves the inventory listed elsewhere** (text-file-cards' expand-time scope failure, input-history-recall's duplicated parent-offline predicate and multi-block stitching). They stay unpinned: the inventory rated them theoretical with poor cost-to-signal, and this round closes only what it recommended.

**Rewriting the shared bench for the occlusion case instead of two bench options.** A separate bench builder would have duplicated the service-fake plumbing; two boolean options extend the existing idiom.

## Consequences

- global-paste reads 23 pins (19 + 4): every branch of the listener's guard chain now has a pin, including the only user-perceptible one. composer-guards reads 27 (25 + 2): all four off-screen comparisons closed.
- The jsdom platform-stub inventory grows one entry (the `isContentEditable` stub), named in-test as a platform fact, not a behavior shortcut.
- Zero source, dependency, composition, or upstream-file changes; the `.github/` zero-touch invariant and the zero-src-change boundary of this round both stand.
