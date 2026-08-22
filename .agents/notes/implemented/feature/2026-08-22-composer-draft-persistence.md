# Agent Note: Composer draft persistence as a fork browser plugin

Status: implemented

English | [中文](2026-08-22-composer-draft-persistence.zh.md)

## Problem

The Web UI composer's draft lives only in the input machine's in-memory state: a page reload or a browser crash loses whatever the user had typed but not sent. The machine (`InputMachine`) and its wiring are package-private inside `dsh-client-ui-conversation`, so a first-party persistence layer is an upstream change the fork cannot make without touching core files — the fork red line. The public seams, however, are enough to observe and restore a draft: the per-session input-state store (`ctx.conversation.input.for(actx).state`) publishes the draft, `setDraft` is the single public write path, and the shared `resolveEditableInput` resolution already answers "may a plugin write into the composer right now".

## Decision

`packages/extensions/draft-keeper` (`@deepseek-ai/dsh-client-draft-keeper`), a pure-browser package in the fork-extension tier (inert node half, `./invariant` companion, bilingual README, version pinned to root). It subscribes to the current session's input-state store and mirrors the draft into one localStorage record — `{ version: 1, drafts: Record<sessionId, string> }` under the single key `dsh.draft-keeper` — and restores it into the empty composer after a reload:

- **Writes debounce 300 ms; deletions are immediate.** An emptied draft (a send or a manual clear) deletes its entry at once so a reload can never resurrect text the user watched disappear. The exception: a draft that emptied because it moved into the steering queue holds its entry (the queue is transient, so a reload restores the text as an editable draft) until the queue drains, when the entry goes.
- **Forced-flush exits close the debounce window**: a session switch flushes before the old session's subscription ends, and `pagehide`, `beforeunload`, and plugin teardown flush synchronously — localStorage writes complete inline, so there is no asynchronous gap to lose.
- **The restore gate is the whole composer-safety checklist**: once per session per plugin lifetime, only as a session becomes current, and only when `resolveEditableInput` resolves (the composer-guards module row's fourth consumer), the phase is `plain`, the live draft is empty, the queue is empty, and a stored non-empty draft exists. The restore writes through `setDraft` and surfaces an info notice (`notify`) from the plugin's own locale namespace, following the text-file-cards dictionary pattern.
- **A draft that predates the subscription is baselined** like any edit (typed during the boot gap, or live at an HMR remount).
- **Entries prune against the live session list** on every list change, gated on the list's `ready` phase (the pending phase's empty id list is a load state, not a sessionless world).
- **Storage is validated and fails silent**: a wrong-version or malformed record discards wholesale (no migration — a future format bumps the version and owns its own transition), and any storage failure (quota, private mode) or a missing localStorage latches the mirror off for the plugin lifetime, the same contract the client runtime's own store persistence follows.

## Testing

`packages/extensions/draft-keeper/tests/draft-store.client.spec.ts` pins the storage layer (round-trip and on-disk shape, wholesale discard, silent-disable latch under write failure, first-read failure, and no storage). `tests/draft-keeper.client.spec.ts` boots the browser half over faked services with a real LocaleRuntime and jsdom localStorage: the debounce window, immediate empty-draft deletion, all forced-flush exits, every restore-gate condition and the once-per-lifetime guard, the steering-queue hold and drain deletion, ready-gated pruning, the history-recall traversal coexistence (a non-empty live draft is baselined, never overwritten), simulated reload and HMR remount paths, and mid-lifetime storage failure. `apps/web/tests/draft-keeper.e2e.ts` runs the real composition in a real browser keylessly: type → mirrored record, reload → restored composer with the info notice, clear → entry gone at once → second reload restores nothing. The send path shares the empty-draft store deletion with the manual clear and stays pinned by the unit spec, keeping the browser lane zero-model-call.

## Alternatives considered

**Upstream persistence inside the input machine.** The natural home — the machine already owns the draft — but it is package-private inside `dsh-client-ui-conversation`, and drafts are not model-visible so the session log has no seat for them. Fork-side this is a core-file patch; rejected on the fork red line.

**sessionStorage or IndexedDB instead of localStorage.** sessionStorage dies with the tab, and crash recovery is half the point. IndexedDB is asynchronous, so the `pagehide`/`beforeunload` flush could not guarantee completion before the page goes away — the zero-loss-window guarantee is what rules it out.

**One storage key per session.** Per-key storage needs per-key validation and N writes to prune; the single versioned record keeps validation and pruning atomic (one read, one write, one remove) at the cost of rewriting the whole record per debounce — a few hundred bytes for any realistic session count.

**Change-only mirroring (no baseline capture).** Text typed before the subscription exists (the boot gap, an HMR remount) would never persist until the next edit. The baseline capture closes that hole and makes the history-recall traversal coexistence fall out naturally: a live non-empty draft is the truth and mirrors forward; storage never overwrites the composer.

## Consequences

- Unsent drafts now survive reloads and crashes, restored as plain text with a visible notice. Slash command claims and @ reference chips are machine state beside the draft string and restore as nothing — a chip's display text survives as ordinary text; this is the documented MVP boundary, and the restore gate's `plain`-phase requirement keeps a claimed line from degrading into inert text behind the user's back mid-session.
- draft-keeper is the fourth consumer of the composer-guards module row; the web-app bundle now mounts the five rows together, and any custom composition mounting draft-keeper must mount composer-guards too or graph composition fails with a missing-request error.
- The restore runs once per session per plugin lifetime by design: clearing a restored draft and reloading again restores nothing in the same lifetime, and an HMR remount deliberately re-arms it (the in-memory guard resets while storage survives).
- The queue-hold keeps a queued message's text recoverable across a reload that kills the transient queue — a small behavioral promise the input machine itself does not make; if upstream ever persists drafts natively, this plugin should retire rather than grow a migration.
