# @deepseek-ai/dsh-client-composer-guards

English | [中文](README.zh.md)

Shared composer guards for the fork's browser input plugins (`global-paste`, `text-file-cards`, `input-history-recall`, `draft-keeper`): the three predicates each of them needs before a plugin-side write may reach the composer.

- **`composerVisible(composer)`** — the composer textarea is visible and not occluded by a takeover overlay (probed with `elementFromPoint` at the composer's center).
- **`sessionAcceptsEdits(session)`** — every session-level composer lock stands open: the session is not removed, and a continuable subagent child still has its exact parent available.
- **`resolveEditableInput(ctx)`** — the current session's input facade can accept a draft edit right now (a current session exists, its scope resolves, every lock stands open, and the input machine is not in a submit/adjudication transaction); returns the facade with its state snapshot, the session id, and the live session-id list.

The package is a library row, not a feature plugin: both halves' `apply` are inert and it provides no services or slots. It exists as a dynamic `dsh.client` row so consumers can share this code — each consumer declares `@deepseek-ai/dsh-client-composer-guards/client` in `dsh.client.external`, the boot-graph composer orders this row before its consumers, and the browser module table resolves the request to this package's `lib/client.js` exports. A composition that mounts a consumer must mount this row too, or graph composition rejects the missing request.

The helpers stay pure over public seams only: DOM probes and the `sessions` / `conversation` services every consumer already injects. The owner-prop composer lock reasons (the inert no-workspace hero, an owner block) have no public signal and stay out of reach, so every consumer keeps its own current-session guard around them.

## Model Experience

None, as the package only supplies guard predicates to other browser-half plugins and registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **Roster coupling** — consumers reach this package through `dsh.client.external`, so a composition mounting any consumer must also mount this row. The web-app bundle mounts the five together; a custom composition omitting the supplier fails graph composition with a missing-request error rather than at runtime.
- **Visibility probe precision** — the occluded check uses `elementFromPoint` at the composer's center. An overlay that covers the composer but leaves the center uncovered would not be detected; callers route into a partially-visible composer, which is harmless.
