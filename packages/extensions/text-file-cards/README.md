# @deepseek-ai/dsh-client-text-file-cards

English | [中文](README.zh.md)

Text-file drop staging cards for the Web UI: dropping a batch of pure text files anywhere over the window — the same zone the composer's own image intake covers — stages them as compact cards docked above the composer instead of inlining their content into the draft. Clicking a card expands `# <filename>` plus the file's content at the draft end and focuses the composer; the close button unstages a file without touching the draft. Long documents therefore never flood the draft — their content joins the message only on an explicit expand click.

The plugin mounts one document-level `drop` listener on the **capture phase** so it runs before the composer's own bubble-phase `onDrop`. A drop is taken over only when every guard below holds; otherwise the event is left to the composer's native whole-file intake:

- Every file in the batch is text — its extension matches a common text/code allowlist, or its MIME type starts with `text/`.
- A current session exists, the session-level composer locks stand open (the session is not removed; a continuable subagent child has its exact parent available), and the input machine is not `adjudicating`/`submitting`.
- The composer is mounted and visible (not masked by a takeover overlay).

Any image or other non-text file in the batch lets the whole batch pass through untouched (no splitting), so images keep the first-party intake path.

The composer's own whole-window `dragover` listener already allows file drops and sets the copy cursor, so the plugin adds no `dragover` handling; the text-vs-image decision is made at `drop`, when the files are readable.

Because the takeover stops the drop from reaching the composer's own handler and an OS file drag fires no `dragend`, the plugin dispatches a synthetic `dragend` on `window` to clear the composer's drag-active overlay.

## Ceilings

- **Per file**: a file over 100 KB is refused with an input notice — once expanded its content joins the draft and thus the model context verbatim, and beyond this size it crowds out the context window (100 KB ≈ 25k tokens).
- **Per batch**: a drop stages at most 20 files; the tail is reported as refused.

## Staging model

A staged file is held WHOLE (the `File` object, not its content), keyed by session id in a registrant-owned snapshot store that rides the dock registration's `hooks` compartment. The content is read only when the user expands a card; the read re-checks the input machine and the session-level locks afterwards and abandons the expansion if a submit began or a lock turned (removal, a lost parent) meanwhile. Additions prune entries of sessions that no longer exist.

## Model Experience

None, as the browser-side plugin stages dropped files in browser memory and expands them through the public `ctx.conversation.input` service; the expanded content rides the ordinary draft, and the package registers nothing model-facing of its own.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Expand-on-click, not send-time attachment** — the staged content can only enter the draft when the user clicks a card; there is no public submit hook a plugin could use to attach the content at send time, and intercepting the submit path is core territory the fork deliberately avoids. True send-time document attachments (Claude-style file chips that travel with the message) require a product-level attachment pipeline (host storage, a non-image attachment seam, model-side rendering, session logging) — an upstream feature, not a fork extension.
- **Text files only** — a drop stages only files whose extension matches the text/code allowlist or whose MIME type starts with `text/`; images and other files pass through to the composer's native file intake. A file with no extension and no MIME type is not treated as text.
- **Owner-prop lock reasons are unobservable** — the composer's remaining disabled reasons (an owner block such as a missing model choice) are owner-prop facts with no public signal, so staging and expanding stay available while the composer is owner-blocked; the expanded draft remains unsubmitted until the user clears the block. The inert no-workspace hero has no current session and is already covered by the current-session guard.
- **Image invitation overlay shows for text drags** — the composer's drag-active overlay is driven by its own `dragenter` listener and its copy is image-specific. The browser exposes neither file names nor contents before `drop`, so while dragging a text file the invitation still reads as the image one; the drop behavior itself is unaffected (a pure text batch stages as cards). Retitling the overlay would require changing the core `DropOverlay`, which the fork deliberately avoids.
- **Synthetic dragend is broadcast** — the synthetic `dragend` dispatched on a drop takeover is received by every `window` dragend listener, not only the composer's. This matches what a real drag's end would deliver and is harmless, but other listeners do observe it.
- **Staged files live in memory** — staged entries hold `File` references until expanded, removed, or pruned by a session-list change; a page reload discards them. Content bytes are not loaded until expansion.
- **Fixed ceilings** — the client-plugin loading chain carries no per-row `config`, so the 100 KB / 20-file ceilings are package constants, not deployment configuration.
