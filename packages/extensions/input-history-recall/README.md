# @deepseek-ai/dsh-client-input-history-recall

English | [中文](README.zh.md)

Composer history recall for the Web UI: with the caret at the very front of the composer (offset 0, no selection), pressing ArrowUp recalls the current session's most recently sent message into the draft; further presses walk older; ArrowDown walks forward, and walking past the newest entry restores the draft as it was before the traversal. Mirrors Claude.ai's composer behavior.

The plugin mounts one document-level `keydown` listener on the **capture phase** so it runs before the composer textarea's own React `onKeyDown`. A claimed key is both `preventDefault()`ed (no native caret move) and `stopPropagation()`ed (the composer's own handler never sees it); every unclaimed key reaches the composer untouched. InputBar and every `packages/client` file stay unmodified — the composer textarea is located read-only via the `textarea[data-dsh-composer]` selector that global-paste and text-file-cards already consume.

How the traversal works:

- **History source**: read fresh from the current session's conversation snapshot on each keypress — `user` and `steering` message nodes, text blocks concatenated. Image-only messages contribute nothing; non-text blocks are skipped. No second copy of the history exists.
- **Draft writes** go through the public `ctx.conversation.input` service (`setDraft`), so a recalled message is an ordinary draft edit: it persists through the machine's draft mirror and can be undone with Ctrl/Cmd-Z.
- **Draft stash**: the pre-traversal draft is held in one in-memory slot; ArrowDown past the newest entry writes it back (an empty pre-traversal draft restores as empty).
- **Traversal state** is that one in-memory slot: it survives no reload and is reset by session switches, by a cleared draft (a successful send), and by a user edit of the recalled text.

The guards, evaluated in order before a key is claimed:

- Not ArrowUp/ArrowDown → ignored.
- IME composition (`isComposing` or the legacy `keyCode` 229) → ignored; the candidate window owns the arrow keys.
- The composer textarea is absent from the document, or is not `document.activeElement` → ignored.
- No current session, scope, or session face → ignored.
- The session-level composer locks are closed (the session is removed; a continuable subagent child's exact parent is offline) → ignored, matching the composer's read-only states (the same alignment as global-paste).
- The input machine is not in the `plain` phase (`claimed` command line, `adjudicating`, `submitting`) → ignored: recall replaces the whole draft and must not overwrite a command line or an in-flight submission.
- The slash candidate menu is open → ignored: the input-trigger pipeline's own arrow arbitration wins, and the key passes through to the composer's React handler.
- ArrowUp while not traversing additionally requires `selectionStart === selectionEnd === 0`; ArrowDown while not traversing always passes through.
- At the oldest entry, ArrowUp is swallowed without changing the displayed content.
- While traversing, a draft that no longer matches the traversal's last written entry (the user edited the recalled text) ends the traversal and hands the key back to native handling.

While a traversal is live, ArrowUp/ArrowDown skip the caret recheck (the draft rewrite leaves the caret wherever the engine puts it), so edits made mid-traversal keep the cursor position. Editing the recalled text itself, however, ends the traversal: the slot records what the plugin last wrote, and a draft that differs from it on the next keypress means the user has taken over — the traversal ends, that key passes through, and later arrows behave as if no traversal had been started (a later ArrowUp re-enters through the caret-at-0 gate). An edit reverted back to the exact written text keeps the traversal alive (plain string comparison). The input-trigger service is read optionally through `ctx.get`, so compositions without the slash pipeline still get history recall.

## Model Experience

None, as the browser-side plugin only reads the session snapshot and routes draft writes through the public `ctx.conversation.input` service; it registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Serialization difference** — recalled text is the message's model-serialization form: inline references are already expanded to what the model saw, not the pre-send display draft. Acceptable per design; no display-form reconstruction exists.
- **Current session only** — no cross-session history recall.
- **Loaded window only** — messages outside the loaded event window (not yet pulled by `loadOlder`) are not recallable until loaded.
- **Text only** — images and other non-text blocks are dropped from recalled messages.
- **In-memory stash** — the stashed pre-traversal draft survives neither reload nor plugin fiber replacement; a reload while traversing leaves the recalled text as the persisted draft.
- **No paste-upgrade** — like global-paste's text path, `setDraft` does not run the input machine's paste-upgrade, so recalled text stays plain text instead of becoming reference chips.
