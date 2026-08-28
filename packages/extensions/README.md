---
description: "The extensions group map: model-facing tools and dual-half runners for defining, running, and removing dynamic Cordis packages, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/extensions

English | [中文](README.zh.md)

## Summary

The extensions group lets a running agent modify the runtime it runs inside: the model can inspect the plugins and services loaded in the current DSH process, define a dynamic Cordis package (with a host half, a browser half, or both), run it, stop it, and remove it, and a browser panel operates every definition. Packages evolve by plugin: a plugin holds immutable package versions and can run or update between them. Definitions live only in process memory, so a DSH restart clears them and nothing here writes repository files or configuration. Four packages form the subsystem: the model-facing tools plus the host runner, and the browser runner plus the browser UI.

This fork also hosts its Web UI input extensions here as self-contained browser-half plugin packages on official seams only ([placement Agent Note](../../.agents/notes/implemented/architecture/2026-08-19-fork-ui-extensions-placement.md)); they stay out of `packages/client/` to keep the upstream merge surface to this README.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`tool-cordis`](tool-cordis/README.md) | Seven model-facing tools: inspect the live runtime, define, run, stop, and remove dynamic packages | registers on `ctx.tools` |
| [`cordis-host-runner`](cordis-host-runner/README.md) | Host half: definition registry, sandboxed host-half lifecycle, and the inspect registry browser queries answer | provides `ctx.dynamicCordisRunner` and `ctx.cordisInspect` |
| [`cordis-client-runner`](cordis-client-runner/README.md) | Browser half: evaluates a browser-half source into a live plugin and answers run requests | client face; provides browser `ctx.dynamicCordisRunner` |
| [`ui-cordis`](ui-cordis/README.md) | Browser surfaces: the frame-wide panel, lifecycle tool cards, and the `@pluginId` input source | client face; registers slots |
| [`global-paste`](global-paste/README.md) | Fork: whole-page paste routing — text through the public input service, images forwarded onto the composer | client face; document capture listener |
| [`text-file-cards`](text-file-cards/README.md) | Fork: text-file drop staging cards over the composer, expanded on click | client face; registers the input dock slot |
| [`usage-stats`](usage-stats/README.md) | Fork: usage statistics settings tab over the `usageStats` session projection — token counts by route, day, and month | dual face; registers a projection unit and the settings-section slot |
| [`input-history-recall`](input-history-recall/README.md) | Fork: composer ArrowUp/ArrowDown history recall of the current session's sent messages, with the pre-traversal draft restored on exit | client face; document capture listener |
| [`draft-keeper`](draft-keeper/README.md) | Fork: per-session composer draft mirror into localStorage with reload restore of plain text | client face; input-state subscription |
| [`find-in-chat`](find-in-chat/README.md) | Fork: in-conversation Ctrl/Cmd+F find bar over the chat view's loaded window, with wrap-around stepping and range highlights | client face; registers a shell.overlay entry |
| [`draft-budget`](draft-budget/README.md) | Fork: composer-dock readout estimating the draft's token cost under the token-meter heuristic plus the after-send window occupancy | client face; registers a composer.dock entry |
| [`composer-guards`](composer-guards/README.md) | Fork: the shared composer predicates (visibility probe, session locks, editable-input resolution) the input plugins above request as a module-table row | client face; library row via `dsh.client.external` |
| [`lan-access`](lan-access/README.md) | Fork: LAN-access webserver — the stock server's subclass, binding all interfaces behind a token gate when `DSH_LAN_ENABLED` is set and byte-for-byte stock otherwise | host face; replaces the web-app bundle's `webserver` row |

-----

<a id="related-documentation"></a>
## Related documentation

- [Extensions subsystem](../../docs/subsystems/extensions.md) — the generated `ctx.cordisInspect` and `ctx.dynamicCordisRunner` service API.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-cordis) — the seven model-facing tool schemas.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-cordis-host-runner) — the runner's accepted config fields.
- [Self-referential Cordis toolset Agent Note](../../.agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md) — design home for sandbox semantics, lifecycle, and composition.
- [Client shells and dynamic packages Agent Note](../../.agents/notes/implemented/architecture/2026-08-15-client-shells-and-dynamic-packages.md) — package placement and build faces for the client halves.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The two browser-half packages live in this group rather than under `packages/client/` because they are halves of this subsystem's dual-half packages; the client face compiles them through the client program, while the host program references only the host runner.

</details>
