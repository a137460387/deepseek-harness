# Agent Note: Fork UI input extensions mirror the composer's session-level locks

Status: implemented

English | [中文](2026-08-19-fork-ui-composer-lock-mirroring.zh.md)

## Problem

The fork's Web UI input extensions route content into the current session's draft through the public `ctx.conversation.input` service: text-file-cards takes over document-level `drop` events on the capture phase, stages pure-text batches as cards, and expands a card on click; global-paste routes whole-page `Ctrl/Cmd+V` into the draft (text via `setDraft`, images via a re-dispatched paste onto the composer). Both guarded the input machine (`adjudicating`/`submitting` refuse) and composer visibility, but not the session-level conditions under which the composer itself renders read-only: a removed session, and a continuable subagent child whose exact parent is offline. In those states the composer refuses every edit, yet the plugins still wrote content into the draft via the input service — the service layer has no lock of its own — so a paste landed in a removed session's draft and staged files could never expand into a usable message.

## Decision

Both extensions mirror the composer's disabled predicate wherever a plugin can observe it. Each package carries `sessionAcceptsEdits(ctx, actx)`, which reads `ctx.sessions.sessionOf(actx).getSnapshot()` and requires the session face to resolve, `removed` to be false, and — when the snapshot carries a subagent — either a non-continuable address mode or `parentAvailable`. Call sites: text-file-cards' `resolveEditableInput` (the drop-takeover entry) rejects a locked session before staging, and its expand callback checks before the asynchronous `file.text()` read and again after it, because a submit may start or a lock may turn while the file is being read; global-paste's `resolveEditableInput` refuses to route a paste while any lock stands closed (the event is left to native handling — whatever element holds focus). The remaining composer lock reasons are owner-prop facts with no public signal — the inert no-workspace hero has no current session (the existing current-session guard covers it), and an owner block such as a missing model choice is composer-internal — so staging, expanding, and pasting deliberately stay available under an owner block, with the expanded draft unsubmitted until the user clears it.

## Verification

Both packages' suites run over the real cordis Context bench with a mutable session-snapshot fake behind `sessions.sessionOf`. text-file-cards: a drop on a removed session is left un-prevented and stages nothing; a drop while a continuable child's parent is offline behaves the same; an expand whose session turns removed after staging calls no `setDraft` and keeps the staged card. global-paste: a paste on a removed session is not prevented and calls no `setDraft`; the same holds while a continuable child's parent is offline. The bilingual READMEs' guard lists and known-limitation entries state the aligned conditions and the unobservable owner-prop gap.

## Alternatives considered

**Check only expand and paste, leave drop staging open.** The drop is still swallowed by the takeover, so the native intake never sees it, and the staged card outlives a session that can never accept it; refusing at both entrances is what matches the composer.

**Expose a single `composerLocked` signal from the runtime.** This would promote the composer's disabled predicate into a public service — core Web UI territory the fork deliberately avoids touching — and the owner-prop reasons it includes have no signal to expose anyway. The observable subset composes exactly from the existing session snapshot's `removed` and `subagent.parentAvailable`.

**Stage under a lock but disable the expand button.** This creates a visible card that is permanently unusable and still consumes the drop that native intake could have handled; leaving the event alone is simpler and keeps images' first-party path intact as the batch-pass-through rule already does.

## Consequences

Locked sessions now see drops pass to the composer's native intake and pastes fall to native handling instead of producing drafts or cards that cannot expand, and an expand racing a lock turn is abandoned with the card kept for later. Under an owner-prop block the extensions remain usable: content can enter the draft but not submit until the block clears — recorded as a known limitation rather than fixed, because the fork does not reach into the composer. The test benches gained a shared session-snapshot fake pattern behind `sessions.sessionOf`, which future lock-condition tests can turn the same way.
