# Agent Note: Text-file staging mirrors the composer's session-level locks

Status: implemented

English | [中文](2026-08-19-text-file-cards-session-lock-alignment.zh.md)

## Problem

The text-file-cards fork extension takes over document-level `drop` events on the capture phase, stages pure-text batches as cards, and expands a card into the draft through the public `ctx.conversation.input` service. Its guards checked the input machine (`adjudicating`/`submitting` refuse) and composer visibility, but not the session-level conditions under which the composer itself renders read-only: a removed session, and a continuable subagent child whose exact parent is offline. In those states the composer refuses every edit, yet the plugin's expand path still wrote content into the draft via the input service — the service layer has no lock of its own — and drop staging kept accepting files that could never expand into a usable message. The plugin held a stricter machine lock than the composer on one axis and a looser session lock on another.

## Decision

Staging and expanding mirror the composer's disabled predicate wherever a plugin can observe it. `sessionAcceptsEdits(ctx, actx)` reads `ctx.sessions.sessionOf(actx).getSnapshot()` and requires the session face to resolve, `removed` to be false, and — when the snapshot carries a subagent — either a non-continuable address mode or `parentAvailable`. Two call sites: `resolveEditableInput` (the drop-takeover entry) rejects a locked session before staging, so the drop falls through to the composer's native whole-file intake; the expand callback checks before the asynchronous `file.text()` read and again after it, because a submit may start or a lock may turn while the file is being read. The remaining composer lock reasons are owner-prop facts with no public signal — the inert no-workspace hero has no current session (the existing current-session guard covers it), and an owner block such as a missing model choice is composer-internal — so staging and expanding deliberately stay available under an owner block, with the expanded draft unsubmitted until the user clears it.

## Verification

Three package tests over the real cordis Context bench: a drop on a removed session is left un-prevented and stages nothing; a drop while a continuable child's parent is offline behaves the same; and an expand whose session turns removed after staging calls no `setDraft` and keeps the staged card. The bilingual README guard list, staging-model section, and known-limitations entry state the aligned conditions and the unobservable owner-prop gap.

## Alternatives considered

**Check only expand, leave staging open.** The drop is still swallowed by the takeover, so the native intake never sees it, and the staged card outlives a session that can never accept it; refusing at both entrances is what matches the composer.

**Expose a single `composerLocked` signal from the runtime.** This would promote the composer's disabled predicate into a public service — core Web UI territory the fork deliberately avoids touching — and the owner-prop reasons it includes have no signal to expose anyway. The observable subset composes exactly from the existing session snapshot's `removed` and `subagent.parentAvailable`.

**Stage under a lock but disable the expand button.** This creates a visible card that is permanently unusable and still consumes the drop that native intake could have handled; leaving the event alone is simpler and keeps images' first-party path intact as the batch-pass-through rule already does.

## Consequences

Locked sessions now see drops pass to the composer's native intake instead of producing cards that cannot expand, and an expand racing a lock turn is abandoned with the card kept for later. Under an owner-prop block the plugin remains usable: content can enter the draft but not submit until the block clears — recorded as a known limitation rather than fixed, because the fork does not reach into the composer. The test bench gained a mutable session-snapshot fake behind `sessions.sessionOf`, which future lock-condition tests can turn the same way.
