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

## Text-file drop

The plugin also mounts capture-phase `dragover`/`drop` listeners on the document. Dropping a batch of pure text files onto the composer card (`[data-composer-card]`) reads them asynchronously and appends them to the draft end — one `# <filename>` header per file, files joined by a blank line — then focuses the composer. The drop is taken over only when every guard below holds; otherwise the event is left to the composer's native whole-file intake:

- The drop point is inside the composer card.
- Every file in the batch is text — its extension matches a common text/code allowlist, or its MIME type starts with `text/`.
- A current session exists and the input machine is not `adjudicating`/`submitting`.

Any image or other non-text file in the batch lets the whole batch pass through untouched (no splitting), so images keep the first-party intake path. After the async read the input machine is re-checked; if a submit began meanwhile, the injection is abandoned.

Because the takeover stops the drop from reaching the composer's own handler and an OS file drag fires no `dragend`, the plugin dispatches a synthetic `dragend` on `window` to clear the composer's drag-active overlay.

## Model Experience

None. This package touches only the browser's clipboard event and the public `ctx.conversation.input` service; it sends no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **No paste-upgrade** — the composer's own `onPaste` runs the text through the input machine's `pasteBegin` transaction, which can upgrade pasted text into slash reference chips. This plugin uses the public `setDraft` path instead (the machine's keyboard face is InputBar-private and never crosses a plugin boundary), so pasted URLs and paths stay as plain text rather than becoming chips. For whole-page paste this is the desired behavior. The image path is unaffected: it re-dispatches onto the composer, so the composer's own `onPaste` (including its paste-upgrade) runs for the image portion.
- **Browser support** — the image-forwarding path depends on the browser honoring a script-constructed `ClipboardEvent` with a `DataTransfer` carrying File items. Verified in Chromium; Firefox and Safari may restrict this (the `clipboardData` of a synthetic event can be null). On such browsers, image paste would silently fall through to the no-file branch; text paste is unaffected.
- **Visibility probe** — the composer-occluded check uses `elementFromPoint` at the composer's center. An overlay that covers the composer but leaves the center uncovered (e.g. a thin side rail) would not be detected; the paste would route into a partially-visible composer, which is harmless.
- **Text files only on drop** — a drop injects only files whose extension matches the text/code allowlist or whose MIME type starts with `text/`; images and other files pass through to the composer's native file intake. A file with no extension and no MIME type is not treated as text.
- **dragover feedback** — `dragover` cannot inspect file contents (only the `Files` type), so the drop cursor shown while dragging over the composer card may not match the eventual takeover decision, which is made at `drop`.
- **Single composer card** — the drop zone assumes exactly one composer card on the page.
- **Synthetic dragend is broadcast** — the synthetic `dragend` dispatched on a drop takeover is received by every `window` dragend listener, not only the composer's. This matches what a real drag's end would deliver and is harmless, but other listeners do observe it.
