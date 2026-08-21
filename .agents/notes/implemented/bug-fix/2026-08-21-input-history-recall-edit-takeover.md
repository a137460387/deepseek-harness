# Agent Note: History recall yields to a user-edited draft

Status: implemented

English | [中文](2026-08-21-input-history-recall-edit-takeover.zh.md)

## Problem

Once an ArrowUp/ArrowDown history traversal was live, every subsequent arrow key was claimed unconditionally: the plugin overwrote the whole draft with the next history entry regardless of what the user had done in between. A user who recalled a message, clicked into the recalled text, and edited it would lose the edit on the next arrow keypress — the draft was replaced wholesale, and the edit never reached the stash (which holds only the pre-traversal draft). The traversal had four exits (session switch, cleared draft, ArrowDown past the newest entry, fiber teardown) but none for "the user has taken over editing".

The original design deliberately skipped the caret recheck mid-traversal (the feature note's refinement 2): after `setDraft`, React's controlled re-render places the caret wherever the engine puts it, which the plugin cannot observe stably. That rationale covers only the keypress immediately following a plugin write. It says nothing about the keypress following a *user* edit — at that point the draft content is exactly what the user left it, fully observable — but the implementation extended the exemption to that case too, silently. Nothing in the feature note, the README, the code comments, or the tests recorded this consequence; it was an implementation gap, not a decision.

## Decision

The traversal slot (`RecallSlot`) now records `written`, the text the plugin last wrote into the draft — seeded from the entry draft (the first history write happens in the same keypress that opens the traversal) and updated at every traversal write. In the keydown handler, right after the existing emptied-draft reset and before the ArrowUp/ArrowDown branches, one check ends the traversal when the live draft no longer matches `written`:

- The mismatch check compares plain strings. An edit reverted back to the exact written text keeps the traversal alive — a deliberate simplification; no dirty-value tracking.
- Ending the traversal also hands the triggering key back (`return` without claiming): overwriting the edit *or* merely swallowing the key would each surprise a user who just typed.
- The emptied-draft reset keeps its place ahead of the edit check and keeps its existing semantics (reset, then continue processing the key): a cleared draft means a send, and "press ArrowUp right after sending" must still recall the newest entry through the caret-at-0 gate, which the early-return shape would have broken.
- The check sits after the IME/focus/session/phase/menu guards, so a key those guards would ignore never mutates the traversal state (an arrow pressed into an open candidate menu must not end it).

This is a different dimension from the skipped caret recheck, and the code comment says so: the caret after a plugin write is engine-placed and not stably observable, but the written *content* is exactly known, so any divergence is the user's own edit. One exemption was about what cannot be observed; this check is about what can.

## Testing

`packages/extensions/input-history-recall/tests/input-history-recall.client.spec.ts` gains two cases: a user edit (written through the input machine's state, bypassing the plugin's `setDraft` path) makes the next ArrowUp pass through unclaimed with the edit intact and the traversal gone (a following ArrowDown also passes through); an edit reverted back to the exact written text keeps the traversal (the next ArrowUp still walks older). The 33 pre-existing cases — including the unedited multi-press round trip — pass unchanged, pinning that the common no-edit path is untouched.

## Alternatives considered

**Listen to `selectionchange` or input events for takeover detection.** Adds a listener with its own lifecycle and cleanup for a signal the draft comparison already provides; also fires on caret moves the user did not intend as takeover.

**Treat a caret move alone as takeover.** A click into the middle of the recalled text to read it does not mean the user wants the arrows back; content change is the honest signal.

**End the traversal on edit but still process the triggering key.** Ends in the same double surprise the bug produced: the key right after an edit would still claim or rewrite.

**Fold the check into the emptied-draft reset.** The two resets differ in what happens to the triggering key (continue processing vs hand back); merging them would break the recall-right-after-send path the emptied-draft reset enables.

**Dirty-value tracking instead of string equality.** Would distinguish "edited away and back" from "never edited" at the cost of a second piece of traversal state; the distinction buys nothing observable for the gesture.

## Consequences

A live traversal is now bounded by the user's own editing: recall yields the moment the draft diverges from what the plugin wrote, and the arrows return to native behavior until the caret-at-0 gate re-opens a traversal. The stash semantics are unchanged (it still holds the pre-traversal draft), so an edit followed by a deliberate re-entry through ArrowUp stashes the *edited* draft. The reverted-edit corner (type and undo back to the written text) keeps the traversal alive — accepted as a plain-comparison artifact.
