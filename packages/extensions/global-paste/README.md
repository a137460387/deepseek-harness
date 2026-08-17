# @deepseek-ai/dsh-client-global-paste

English | [中文](README.zh.md)

Whole-page text paste for the Web UI: pressing Ctrl/Cmd+V anywhere over the window routes the clipboard's plain text into the current session's composer draft, without first clicking the input. Mirrors Claude.ai's "paste anywhere" behavior.

The plugin mounts one document-level `paste` listener on the **capture phase** so it runs before the composer textarea's own React `onPaste`. The decision tree, evaluated in order:

- No `text/plain` on the clipboard → ignored (image/file paste stays with the composer's own intake).
- No current session → ignored.
- The input machine is `adjudicating` or `submitting` → ignored (a submit transaction is in flight).
- The composer textarea is already `document.activeElement` → ignored (let the native `onPaste` handle it; no double-insert).
- Focus is on another editable element (input/textarea/contenteditable) → ignored (honor that element's own paste).
- The composer is occluded by a takeover overlay (approval/user-question panel) → silently ignored.
- Otherwise → `preventDefault()`, append the text to the draft end through `ctx.conversation.input.for(actx).setDraft(draft + text)`, and focus the composer with `preventScroll`.

Text is appended to the draft **end**; an existing non-collapsed selection is not preserved (this matches the confirmed design choice). Existing reference chips (occurrences) in the draft are preserved — `setDraft` carries them as U+FFFC placeholders and only the new text is appended.

## Model Experience

None. This package touches only the browser's clipboard event and the public `ctx.conversation.input` service; it sends no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Text-only** — clipboard images and files are not routed here. The draft-image creation service (`browserDraftAttachment`) is package-private on `ConversationController` and not exposed to plugins. Image paste therefore still requires focusing the composer first. A future version could expose a draft-image intake path and extend this listener.
- **No paste-upgrade** — the composer's own `onPaste` runs the text through the input machine's `pasteBegin` transaction, which can upgrade pasted text into slash reference chips. This plugin uses the public `setDraft` path instead (the machine's keyboard face is InputBar-private and never crosses a plugin boundary), so pasted URLs and paths stay as plain text rather than becoming chips. For whole-page paste this is the desired behavior.
- **Visibility probe** — the composer-occluded check uses `elementFromPoint` at the composer's center. An overlay that covers the composer but leaves the center uncovered (e.g. a thin side rail) would not be detected; the paste would route into a partially-visible composer, which is harmless.
