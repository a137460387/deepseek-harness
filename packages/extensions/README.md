# extensions/ — the agent modifies its own runtime, plus fork UI extensions

English | [中文](README.zh.md)

Model-facing tools over the live cordis runtime the agent itself runs inside: inspect the loaded plugins and service API, define and run model-written dynamic packages, and retract them again — plus the restricted repository Plugin runtime. Both browser-half packages live here rather than under `packages/client/` because they are halves of this subsystem's dual-half packages; the host aggregate excludes them so each face keeps its own compiler program. Design home: [the toolset Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md).

The group also hosts the fork's Web UI input extensions as self-contained browser-half plugin packages on official seams only ([placement Agent Note](../../.agents/notes/implemented/architecture/2026-08-19-fork-ui-extensions-placement.md)); they stay out of `packages/client/` to keep upstream merge surface to this README.

| Package | Role | ctx key |
|---|---|---|
| [`tool-cordis/`](tool-cordis/README.md) | Model-facing runtime inspection and dynamic-package tools | registers on `ctx.tools` |
| [`cordis-host-runner/`](cordis-host-runner/README.md) | Definition registry, the `node:vm` sandbox for host halves, and the request-run round trip | provides `ctx.dynamicCordisRunner` |
| [`cordis-client-runner/`](cordis-client-runner/README.md) | Browser half of a dual-half package: evaluates the definition into a live browser plugin and answers the run request | client face; provides the browser `ctx.dynamicCordisRunner` |
| [`ui-cordis/`](ui-cordis/README.md) | Browser surfaces: the frame-wide panel that operates every definition, and the read-only define card | client face; registers slots |
| [`global-paste/`](global-paste/README.md) | Fork: whole-page paste routing — text through the public input service, images forwarded onto the composer | client face; document capture listener |
| [`text-file-cards/`](text-file-cards/README.md) | Fork: text-file drop staging cards over the composer, expanded on click | client face; registers the input dock slot |
| [`usage-stats/`](usage-stats/README.md) | Fork: usage statistics settings tab over the `usageStats` session projection — token counts by route, day, and month | dual face; registers a projection unit and the settings-section slot |
| [`input-history-recall/`](input-history-recall/README.md) | Fork: composer ArrowUp/ArrowDown history recall of the current session's sent messages, with the pre-traversal draft restored on exit | client face; document capture listener |
| [`draft-keeper/`](draft-keeper/README.md) | Fork: per-session composer draft mirror into localStorage with reload restore of plain text | client face; input-state subscription |
| [`find-in-chat/`](find-in-chat/README.md) | Fork: in-conversation Ctrl/Cmd+F find bar over the chat view's loaded window, with wrap-around stepping and range highlights | client face; registers a shell.overlay entry |
| [`draft-budget/`](draft-budget/README.md) | Fork: composer-dock readout estimating the draft's token cost under the token-meter heuristic plus the after-send window occupancy | client face; registers a composer.dock entry |
| [`composer-guards/`](composer-guards/README.md) | Fork: the shared composer predicates (visibility probe, session locks, editable-input resolution) the input plugins above request as a module-table row | client face; library row via `dsh.client.external` |
