# Agent Note: Composer history recall as a pure browser plugin

Status: implemented

English | [中文](2026-08-20-web-input-history-recall.zh.md)

## Problem

The fork wants Claude.ai's composer gesture: with the caret at offset 0 and no selection, ArrowUp recalls the current session's previously sent message into the draft; repeated presses walk older; ArrowDown walks forward; walking past the newest entry restores the pre-traversal draft. FORK_NOTES.md forbids touching official core or package-private files, and the composer's keyboard surface is exactly that: the `ComposerKeyboard` face (arbitrate, track, pasteBegin) is InputBar-private and never crosses a plugin boundary, while InputBar's own `onKeyDown` owns every existing key claim. The feature therefore needs a path through public seams alone, or it becomes an upstream merge liability.

## Decision

The feature ships as `packages/extensions/input-history-recall` (`@deepseek-ai/dsh-client-input-history-recall`), a self-contained browser-half plugin in the placement the [fork UI extensions note](../architecture/2026-08-19-fork-ui-extensions-placement.md) established. Every input and output rides a public seam:

- **Key capture**: one document-level `keydown` listener on the capture phase, so it runs before InputBar's React `onKeyDown`. A claimed key is `preventDefault()`ed (no native caret move) and `stopPropagation()`ed (the composer's own handler never sees it — InputBar's menu arbitration is untouched). The composer is located read-only via `textarea[data-dsh-composer]`, the selector global-paste and text-file-cards already consume.
- **History source**: `ctx.sessions.sessionOf(actx).getSnapshot().nodes`, filtered to `user` and `steering` nodes with text blocks concatenated, read fresh on each keypress. No second history copy exists and no new event or service was minted.
- **Draft writes**: the public `ctx.conversation.input` service (`setDraft`), so a recall is an ordinary draft edit — persisted through the machine's draft mirror, undoable, and refused by the same lock alignment global-paste mirrors (removed session, offline continuable parent).
- **Menu deference**: the slash candidate menu's arrow arbitration wins while it is open, read through `ctx.get('inputTriggers')` — optional, so compositions without the input-trigger pipeline still get recall.

Four implementation refinements beyond the base design:

1. `inputTriggers` is read via `ctx.get`, not hard-injected: a hard service dependency would leave the plugin fiber PENDING forever in compositions without the pipeline, while the menu check only needs "open or absent".
2. Mid-traversal presses skip the caret recheck: after `setDraft`, React's controlled re-render leaves the caret wherever the engine puts it, which the plugin cannot observe stably; only traversal *entry* requires offset 0 with no selection.
3. ArrowUp at the oldest entry swallows the key without changing content (Claude.ai's behavior), and an empty history read mid-traversal holds position the same way.
4. The recall gate accepts the `plain` input phase only — stricter than global-paste's paste routing, because recall replaces the whole draft and must not overwrite a claimed command line or an in-flight submission.

The traversal state is one in-memory slot (session id, cursor index, stashed draft). Session switches reset it through a `ctx.sessions.list` subscriber — the list store's default synchronous flush means a keypress can never observe a stale slot, so no defensive recheck exists in the keydown path. A cleared draft resets it lazily on the next keypress: every traversal write is non-empty text, so an empty draft means the message was sent or the draft cleared.

## Testing

`packages/extensions/input-history-recall/tests/input-history-recall.client.spec.ts` covers the traversal round trip with a stateful draft fake (recall order, stash restore, empty-draft restore), the oldest-entry hold, the mid-traversal empty-history hold, session-switch and send-clear resets, the full guard matrix (IME via `isComposing` and legacy `keyCode` 229, unfocused/absent composer, no session/scope/face, removed session, offline continuable parent, submit/adjudicate/claim phases, open candidate menu with pass-through to the composer's own handler), stopPropagation isolation, fiber teardown (HMR safety), the inert node half, and the invariant companion's ownership reservation.

## Alternatives considered

**Embed the gesture in InputBar.tsx.** Rejected: a `packages/client` core-file change against FORK_NOTES.md, a recurring upstream merge surface, and duplication of state the public seams already expose. Unlike paste routing — which needs to know focus and takeover-panel occlusion the composer keeps private — every fact this gesture needs (composer focus, session locks, input phase, menu state, sent history, draft writes) is observable from outside, so the core-file coupling argument does not apply.

**Hard-inject `inputTriggers` as a service dependency.** Rejected: the recall feature degrades gracefully without the slash pipeline (menu treated as closed), and a hard inject would leave the plugin fiber permanently PENDING in pipeline-less compositions. `ctx.get` matches the hub's own optional-resolution pattern.

**Subscribe to the input state store to detect the send-clear reset.** Rejected: a subscription would fire on every draft change to catch one transition; the lazy keypress-side check (empty draft while traversing) is behaviorally identical because every traversal write is non-empty.

**Keep a defensive stale-session recheck inside the keydown handler.** Rejected as unreachable: the sessions list store notifies synchronously (default flush), so the subscriber has already reset the slot before any later keypress; defending a same-process typed guarantee would add an uncoverable branch to the per-file 100% coverage gate.

**Anchor the cursor by message identity (seq) instead of array index.** Rejected: within a live session the node list only grows, and the index cursor's only race (an older page prepended by `loadOlder` while traversing) shifts which message one more keypress lands on — still a previously sent message, at the cost of identity bookkeeping the gesture does not need.

## Consequences

- InputBar.tsx, the input machine, and every `packages/client` package are untouched; the upstream merge surface is the three composition lists (`cordis.patch.yml`, the web-app manifest, the tsconfig paths/aggregates), the `extensions/` group README row, and FORK_NOTES.md's precedent count.
- InputBar's own ArrowUp/ArrowDown handling is unchanged: when the candidate menu is open the key passes through untouched, and when it is closed InputBar's arbitrate returns `pass` for a key this plugin already claimed — no double claim exists in either direction.
- The recall is current-session and loaded-window only, recalls the model-serialization text (references expanded, images dropped), and keeps the pre-traversal draft in memory only; these limits are recorded in the package README's Known Limitations rather than papered over.
