# @deepseek-ai/dsh-client-draft-keeper

English | [中文](README.zh.md)

Composer draft persistence for the Web UI: each session's unsent draft is mirrored into localStorage, and after a reload or crash the stored text is restored into the empty composer with an info notice. Plain text only.

The plugin subscribes to the current session's input-state store (`ctx.conversation.input.for(actx).state`, the public InputZone currency) and writes back through the public single write path (`setDraft`) — InputBar and every `packages/client` file stay untouched. The shared `resolveEditableInput` resolution from `@deepseek-ai/dsh-client-composer-guards` (requested as a module-table row through `dsh.client.external`) gates every restore write.

How the mirror works:

- **Save**: draft edits debounce into one localStorage record (`{ version: 1, drafts }`, keyed by session id) after 300 ms. A draft that predates the subscription (typed during the boot gap, or already live at an HMR remount) is baselined like any edit.
- **Delete**: an emptied draft deletes its entry immediately — a send or a manual clear must never resurrect on reload. The one exception: a draft that emptied because it moved into the steering queue holds its entry (the queue is transient; a reload then restores the text as an editable draft), and the entry goes when the queue drains.
- **Flush**: a session switch (before the old session's subscription ends), `pagehide`, `beforeunload`, and plugin teardown all write the pending debounced draft synchronously, so the debounce never widens the loss window.
- **Restore**: once per session per plugin lifetime, only as a session becomes current, and only when the composer is safely writable — the `resolveEditableInput` resolution succeeds (session locks open, no submit or adjudication in flight), the phase is `plain` (a claimed command line must not turn into plain text), the live draft is empty, the queue is empty (pending steering rows own the "empty" draft), and a stored non-empty draft exists. The restore writes through `setDraft` and surfaces `notify('info', …)` in the composer's own copy namespace.
- **Prune**: entries whose sessions left the live session list are dropped on every list change, once the list has arrived (the pending phase carries an empty id list by construction).
- **Storage failures**: a record with a different version or a malformed shape is discarded wholesale — no migration. Any storage failure (quota, private mode) or a missing localStorage latches the mirror off silently for the plugin lifetime; the composer never notices. This is the same contract the client runtime's own store persistence follows.

## Model Experience

None, as the browser-side plugin only mirrors the composer draft through the public input service into localStorage; it registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Plain text only** — slash command claims and @ reference chips are machine state beside the draft string and restore as nothing: the composer comes back in the plain phase, and a chip's inline display text survives as ordinary draft text without the chip. A claim token restores as its literal text.
- **Single record** — one localStorage key holds every session's draft; the only size cap is the storage quota, and exhausting it silently disables persistence (drafts then stop surviving reloads until storage frees up and the page remounts the plugin).
- **Once per lifetime** — restore runs once per session per plugin lifetime. Clearing a restored draft and reloading within one lifetime restores nothing; an HMR remount re-arms the restore because the in-memory guard resets while storage survives.
- **Steering queue drained while away** — the queue-hold deletion only runs while the session is current (the subscription is the signal); a queue that drains while another session is current leaves the held entry until that session is revisited or pruned.
- **No cross-session restore** — a stored draft restores only into its own session.
