# @deepseek-ai/dsh-client-global-paste

English | [中文](README.zh.md)

Whole-page text paste for the Web UI: pressing Ctrl/Cmd+V anywhere over the window routes the clipboard's plain text into the current session's composer draft, without first clicking the input. Mirrors Claude.ai's "paste anywhere" behavior.

The plugin mounts one document-level `paste` listener on the **capture phase** so it runs before the composer textarea's own React `onPaste`. Two routing paths:

- **Text** (`text/plain` present): appended to the draft end through the public `ctx.conversation.input` service (`setDraft(draft + text)`).
- **Files (images)**: re-dispatched as a paste event onto the composer textarea, so the composer's own `onPaste` runs the full image intake (format/limit pre-check, preview URL creation, attachment-rail rendering). This avoids duplicating the package-private draft-image creation path (`browserDraftAttachment` on `ConversationController`) and keeps first-party image behavior intact. Verified viable in Chromium: a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File items is honored by the target's `onPaste` (`clipboardData.items` and `getData` are both readable).
- **Mixed (text + images)**: split — text goes to `setDraft`, images forwarded to the composer. The forwarded event copies only file items (no `text/plain`), so the composer's `onPaste` does not double-insert the text.

The guards, evaluated in order before routing:

- No `text/plain` and no files → ignored.
- No current session → ignored.
- The input machine is `adjudicating` or `submitting` → ignored (a submit transaction is in flight).
- The composer textarea is already `document.activeElement` → ignored (let the native `onPaste` handle it; no double-insert). This also protects the re-dispatched image event: after `forwardImagePaste` focuses the composer and dispatches, the bubbling event re-enters the capture listener but hits this guard and returns.
- Focus is on another editable element (input/textarea/contenteditable) → ignored (honor that element's own paste).
- The composer is occluded by a takeover overlay (approval/user-question panel) → silently ignored.
- Otherwise → `preventDefault()` and route as above.

Text is appended to the draft **end**; an existing non-collapsed selection is not preserved (this matches the confirmed design choice). Existing reference chips (occurrences) in the draft are preserved — `setDraft` carries them as U+FFFC placeholders and only the new text is appended.

## Model Experience

None. This package touches only the browser's clipboard event and the public `ctx.conversation.input` service; it sends no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **No paste-upgrade** — the composer's own `onPaste` runs the text through the input machine's `pasteBegin` transaction, which can upgrade pasted text into slash reference chips. This plugin uses the public `setDraft` path instead (the machine's keyboard face is InputBar-private and never crosses a plugin boundary), so pasted URLs and paths stay as plain text rather than becoming chips. For whole-page paste this is the desired behavior. The image path is unaffected: it re-dispatches onto the composer, so the composer's own `onPaste` (including its paste-upgrade) runs for the image portion.
- **Browser support** — the image-forwarding path depends on the browser honoring a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File items. Verified in Chromium; Firefox and Safari may restrict this (the `clipboardData` of a synthetic event can be null). On such browsers, image paste would silently fall through to the no-file branch; text paste is unaffected.
- **Visibility probe** — the composer-occluded check uses `elementFromPoint` at the composer's center. An overlay that covers the composer but leaves the center uncovered (e.g. a thin side rail) would not be detected; the paste would route into a partially-visible composer, which is harmless.
