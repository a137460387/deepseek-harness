# Agent Note: Fork Web UI input extensions live in extensions/ as self-contained plugins

Status: implemented

English | [中文](2026-08-19-fork-ui-extensions-placement.zh.md)

## Problem

The fork adds Web UI input behaviors upstream does not ship: whole-page paste routing (global-paste) and text-file drop staging cards (text-file-cards). FORK_NOTES.md forbids touching official core or package-private files (the composer's own image intake, the InputBar-private input machine faces), so both must ride official plugin seams — but where the packages live was decided silently: `packages/client/` holds the upstream-owned Web GUI browser half and keeps evolving with it, and a new `fork-extensions/` group was never weighed. Meanwhile the `extensions/` group README described the group as runtime self-modification only, so two of its six packages were absent from its charter and package table, and no Agent Note recorded either package's introduction design (the paste-routing architecture and the image-forwarding mechanism foremost).

## Decision

Fork Web UI extensions are self-contained browser-half plugin packages under `packages/extensions/`, each reachable only through official seams:

- **global-paste** (`@deepseek-ai/dsh-client-global-paste`): one document-level capture-phase `paste` listener. Text is appended through the public `ctx.conversation.input` service (`setDraft`); images are forwarded by re-dispatching a synthetic `ClipboardEvent` carrying a `DataTransfer` with the file items onto the composer textarea, so the composer's own `onPaste` runs the full official image intake — duplicating the package-private `browserDraftAttachment` path would violate FORK_NOTES.md. Mixed pastes split: text via the service, images via the forward.
- **text-file-cards** (`@deepseek-ai/dsh-client-text-file-cards`): one document-level capture-phase `drop` listener takes over pure-text batches, stages them as `File` objects keyed by session id in a snapshot store, and renders cards through the official `conversation.input.dock` slot; expanding a card goes through the public input service. Images and mixed batches pass through to the composer's native intake.
- Both carry an `./invariant` companion reserving their package name, keep the host aggregate untouched, and mirror the composer's session-level locks (see the [lock-mirroring Agent Note](../bug-fix/2026-08-19-fork-ui-composer-lock-mirroring.md)).

Placement: `extensions/` rather than `packages/client/`. The group's charter is capabilities outside the product spine — it already hosts browser-half packages (`cordis-client-runner`, `ui-cordis`) excluded from the host aggregate — so fork browser plugins fit without inventing a group, and upstream's `client/` packages stay free of fork rows in their group README and references, keeping the merge surface to this group's README alone.

## Alternatives considered

**Place them under `packages/client/`.** They are browser plugins, but `client/` is upstream-owned and continuously evolving; fork rows in its group README, aggregates, and manifests would all become recurring merge-conflict surface. `extensions/` localizes that to one README table.

**Open a dedicated `fork-extensions/` group.** A group per origin adds navigation cost and a second place to look for browser plugins; the `extensions/` charter already covers out-of-spine capability packages regardless of who wrote them.

**Patch the official composer via `patches/`.** FORK_NOTES.md ranks patches below plugin-seam implementations and requires explicit confirmation for any core touch; both behaviors are reachable through public services and slots, so no patch is warranted.

## Consequences

`git merge upstream/master` touches fork UI extensions only through the `extensions/` group README package table and never through `client/` group files. Either fork package can be removed by deleting its directory, its `cordis.patch.yml` row, and its manifest reference. The group README now carries all six packages with the fork rows marked, closing the charter gap; FORK_NOTES.md records the placement rule so future fork extensions land here by default.
