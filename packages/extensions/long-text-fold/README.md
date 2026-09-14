---
description: "Stages pasted long text as a composer card, restores the full text at submit, and folds the sent message in place behind an expandable clamp."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-long-text-fold

English | [中文](README.zh.md)

## Summary

Long-text paste staging cards for the Web UI: pasting a plain-text clip past the character or line threshold stages it in localStorage under the current session and drops a short `[LongText#N]` marker into the draft instead of thousands of characters; a focused composer receives the marker at the caret through a marker-only re-dispatched paste. Submitting restores every staged marker to its full text synchronously before the composer's own send path reads the draft, and the chat side folds sent long texts in place behind an expandable clamp. The model receives the verbatim inline-paste text.

## Table of Contents

- [Details](#details)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Ceilings

- **Paste thresholds**: a paste stages as a card once it reaches 2,000 characters or 50 lines; shorter clips keep the native inline paste.
- **Per staged entry**: a text over 1,000,000 characters (≈250k tokens) is refused with an input notice and pasted natively — the expansion joins the model context verbatim, so a larger staging serves nobody.
- **Store budget**: the LRU holds at most 50 entries / 2,000,000 characters across all sessions; the oldest-recency entry is evicted and its marker then sends verbatim with a notice.

## Staging model

A staged text is persisted WHOLE in localStorage under `dsh-long-text-fold:v1:s:<sessionId>:<seq>`, mirrored into a registrant-owned snapshot store that rides the dock registration's `hooks` compartment. Recency is bumped at staging and again at submit-time expansion; additions prune entries of sessions that no longer exist. Staged entries also retire with the send: submit-time expansion arms the sequence numbers it consumed, and once the expanded draft clears — the input machine's commit-draft, read through the public `input.state` store — the armed entries are removed, so the dock card leaves with the message. The input paths that keep the draft (adjudication fallthrough, a failed command settlement, a release during the flight) never see the clear and keep their entries; a draft that moved onto other content without clearing disarms the arm instead. Entries no draft references fall to the LRU. Any storage refusal (oversized, quota, unavailable) propagates as a typed error and the takeover fails OPEN: the event flows on to the native paste — or global-paste — so the full text still lands in the draft, plus a visible error notice; nothing is staged, nothing is lost, nothing blocks. A page reload keeps staged texts (localStorage), and a reload-evicted marker degrades to the literal short text, which the chat side renders as-is because the fold decision is length-based.

-----

<a id="details"></a>
## Details

The plugin mounts one document-level `paste` listener on the **capture phase** so it runs before the composer's own paste path. A paste is taken over only when every guard below holds; otherwise the event is left to native handling:

- The clipboard carries no `File` items — images and mixed clips stay wholly with the composer's native intake (text-file drop staging is the companion `text-file-cards` package's territory).
- The text crosses a paste threshold.
- A current session exists, the session-level composer locks stand open (the session is not removed; a continuable subagent child has its exact parent available), and the input machine is not `adjudicating`/`submitting` — the shared `resolveEditableInput` predicate from `@deepseek-ai/dsh-client-composer-guards` answers all three.
- The composer is mounted and visible (not masked by a takeover overlay), and focus is not on a foreign editable element.

The marker is deliberately plain ASCII `[LongText#N]`: it survives the input facade's placeholder sanitizer (which strips only private-use and U+FFFC code points), never trips the `/`-leading command adjudication, and reads as ordinary text everywhere it can leak.

Insertion reuses the composer's own paste path. With the composer focused, the plugin stops the original event and re-dispatches a **marker-only synthetic `ClipboardEvent`** onto the composer — the same script-constructed forward global-paste uses for images — so the upstream `PASTE_COMMAND` inserts the marker at the caret with its own history boundary. Without focus, the marker is appended at the draft end through the public `setDraft` and the composer is focused. The composition mounts this row **before global-paste** so the unfocused takeover sees the document capture event first; the focused case is order-independent because global-paste yields to a focused composer.

The plugin also mounts document-level capture `keydown`/`click` listeners ahead of the composer's own gestures. An Enter keydown on the composer — or on the primary submit button, identified by its `aria-label` against the upstream `input.send` / `input.send.steer` / `input.send.queue` labels resolved through the public locale service — runs one synchronous expansion pass: every staged marker in the draft is replaced by its full text through the public `setDraft`, whose discrete update commits before the gesture reaches the composer's submit path, so the sent message carries the exact inline-paste shape. A marker whose entry was evicted notifies without blocking (the literal short text sends); Shift+Enter and IME composition never expand; the pass is idempotent, so the keydown+click pair of one gesture expands once.

The chat side replaces the `conversation.chat.node` keyed renderers for the `'user'` and `'steering'` keys. The fold decision is the joined text-block **length** at or above the render threshold — not the marker: a hand-edited or stale marker that reaches a sent message is too short to fold and renders literally, so the renderer needs neither marker trust nor storage access, and long texts from typing or other clients fold identically. A folded text block renders its real content in place: the bubble clamps under a CSS max-height behind a bottom fade mask with a floating expand button, and expanding drops the clamp and mask and offers a collapse button below the bubble; the body projects the message's own full text through the same `projectUserText` primitive the shipped bubble uses, and short texts mirror the shipped bubble shape (attachments row, reference summary, a copy+clock actions row) through this package's own CSS module. The input dock lists the session's staged entries with a read-only preview popup (`shell.overlay`).

-----

<a id="model-experience"></a>
## Model Experience

None. The expanded text rides the ordinary draft as one verbatim text block inside `user/message` — no new session event, no content-block vocabulary change, no model-facing registration. What the model sees is byte-identical to an inline paste.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Chat-node renderer replacement tracks upstream** — replacing the `'user'`/`'steering'` keys shadows the shipped `UserMessageNodeView`; every upstream change to the user bubble's mirror surface (content parting, attachment row, reference summary) needs a diff against this package's `fold-view.tsx` at sync time (FORK_NOTES carries the checklist item).
- **Submission echo shows full text** — the local pending-submission echo is not routed through the keyed slot, so between the submit click and the durable `user/message` the echo bubble briefly shows the full text before the fold card appears.
- **Length-based folding is universal** — a long text the user typed by hand folds exactly like a staged paste; this is the intended consistent behavior, not an accident.
- **Marker forgery is possible** — a hand-typed `[LongText#N]` without a staged entry sends verbatim (too short to fold, self-healing); one colliding with a live entry expands that entry. The seq space and the marker's specificity make this negligible; no runtime anti-spoof exists.
- **Plaintext staging** — staged texts sit unencrypted in localStorage, the same privacy class as the draft-keeper draft mirror.
- **Simplified actions row and clock** — the shipped actions component is package-internal, so the fold view ships its own copy+clock row; the clock uses a simplified date-aware format, not the upstream message-chrome templates.
- **Mixed clips pass through** — a clipboard carrying files together with long text is not taken over; the files keep the first-party intake and the text inlines natively.
- **Fixed ceilings** — the client-plugin loading chain carries no per-row `config`, so the thresholds and store budgets are package constants, not deployment configuration.
- **Staged-entry loss degrades to verbatim markers** — LRU eviction, a cleared origin store, or a different browser leaves the marker unrestorable; the submit notifies and sends the literal marker rather than blocking the draft.
- **Cleanup follows any draft clear** — the submit cleanup fires when the expanded draft clears, whatever cleared it: a draft that retained the submitted text through a failed command path and was then cleared by hand retires its staged entries too. Entries whose draft never clears (a swallowed submit gesture, a diverging edit) stay staged until the LRU retires them.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`fold-view.tsx` mirrors the shipped `UserMessageNodeView` (`packages/client/ui-chat/src/client/chat/MessageItem.tsx`) — content parting, the attachment row, the reference summary — because the upstream component and its CSS module are package-internal; the mirrored locale strings are pinned byte-equal to the upstream dictionaries by the contract spec. The `discrete` `setDraft` synchrony the submit interception relies on is pinned against real Lexical by the contract spec, together with the upstream keymap's paste→`pasteText` and Enter→`submit` routing.

</details>
