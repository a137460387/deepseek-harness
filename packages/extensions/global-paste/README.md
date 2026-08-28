---
description: "Whole-page paste routing for the Web UI composer: plain text into the draft through the public input service, image files forwarded to the composer's own paste intake."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-global-paste

English | [中文](README.zh.md)

## Summary

Whole-page text paste for the Web UI: pressing Ctrl/Cmd+V anywhere over the window routes the clipboard's plain text into the current session's composer draft, without first clicking the input. Mirrors Claude.ai's "paste anywhere" behavior.

The plugin mounts one document-level `paste` listener on the **capture phase** so it runs before the composer textarea's own React `onPaste`. Two routing paths:

- **Text** (`text/plain` present): appended to the draft end through the public `ctx.conversation.input` service (`setDraft(draft + text)`).
- **Files (images)**: re-dispatched as a paste event onto the composer textarea, so the composer's own `onPaste` runs the full image intake (format/limit pre-check, preview URL creation, attachment-rail rendering). This avoids duplicating the package-private draft-image creation path (`browserDraftAttachment` on `ConversationController`) and keeps first-party image behavior intact. Verified viable in Chromium: a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File items is honored by the target's `onPaste` (`clipboardData.items` and `getData` are both readable).
- **Mixed (text + images)**: split — text goes to `setDraft`, images forwarded to the composer. The forwarded event copies only file items (no `text/plain`), so the composer's `onPaste` does not double-insert the text.

The guards, evaluated in order before routing:

- No `text/plain` and no files → ignored.
- No current session → ignored.
- The session-level composer locks are closed (the session is removed; a continuable subagent child's exact parent is offline) → ignored, matching the composer's read-only states.
- The input machine is `adjudicating` or `submitting` → ignored (a submit transaction is in flight).
- The composer textarea is already `document.activeElement` → ignored (let the native `onPaste` handle it; no double-insert). This also protects the re-dispatched image event: after `forwardImagePaste` focuses the composer and dispatches, the bubbling event re-enters the capture listener but hits this guard and returns.
- Focus is on another editable element (input/textarea/contenteditable) → ignored (honor that element's own paste).
- The composer is occluded by a takeover overlay (approval/user-question panel) → silently ignored.
- Otherwise → `preventDefault()` and route as above.

Text is appended to the draft **end**; an existing non-collapsed selection is not preserved (this matches the confirmed design choice). Existing reference chips (occurrences) in the draft are preserved — `setDraft` carries them as U+FFFC placeholders and only the new text is appended.

Text-file DROPS are owned by the companion plugin `@deepseek-ai/dsh-client-text-file-cards`, which stages dropped text files as cards over the composer instead of inlining them into the draft.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as the browser-side plugin only routes clipboard paste events through the public `ctx.conversation.input` service and registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No paste-upgrade** — the composer's own `onPaste` runs the text through the input machine's `pasteBegin` transaction, which can upgrade pasted text into slash reference chips. This plugin uses the public `setDraft` path instead (the machine's keyboard face is InputBar-private and never crosses a plugin boundary), so pasted URLs and paths stay as plain text rather than becoming chips. For whole-page paste this is the desired behavior. The image path is unaffected: it re-dispatches onto the composer, so the composer's own `onPaste` (including its paste-upgrade) runs for the image portion.
- **Browser support** — the image-forwarding path depends on the browser honoring a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File items. Verified in Chromium; other engines may restrict this (a synthetic event's `clipboardData` can be null, and old Safari throws TypeError constructing the `DataTransfer`). Constructor failures fail soft: a mixed paste still routes its text half and focuses the composer, and an image-only paste is left to native handling instead of half-swallowing the event. On browsers that construct but ignore the forward, image paste silently does nothing; text paste is unaffected.
- **Visibility probe** — the composer-occluded check uses `elementFromPoint` at the composer's center. An overlay that covers the composer but leaves the center uncovered (e.g. a thin side rail) would not be detected; the paste would route into a partially-visible composer, which is harmless.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
