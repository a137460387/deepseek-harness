# Agent Note: Shared composer guards as the first module-request row

Status: implemented

English | [中文](2026-08-21-composer-guards-shared-module-row.zh.md)

## Problem

Three fork browser plugins — global-paste, text-file-cards, input-history-recall — each carried its own copy of the composer predicates: the `composerVisible` occlusion probe, the `sessionAcceptsEdits` session-lock check, and the `resolveEditableInput` facade resolution. The duplication gate flagged three clones between global-paste and text-file-cards, and input-history-recall carried a third `sessionAcceptsEdits` over the same logic. A lock-alignment fix applied to one copy would silently miss the others, and every new composer plugin would re-copy the set. Sharing the code, however, runs into the client bundle purity gate: cross-plugin value imports are forbidden unless the importer declares a module-table request (`dsh.client.external`) or the code moves behind cordis services.

## Decision

The predicates moved to `packages/extensions/composer-guards` (`@deepseek-ai/dsh-client-composer-guards`), the repository's first supplier-only dynamic row. The package follows every fork-extension convention from the [placement note](2026-08-19-fork-ui-extensions-placement.md) — self-contained under `packages/extensions/`, inert node half, `./invariant` companion, bilingual README, version pinned to root — plus the module-request mechanics the [client shell layering note](2026-08-15-client-shells-and-dynamic-packages.md) defines:

- The browser half exports the three predicates and an inert `apply`; it provides no services or slots. Each consumer declares `@deepseek-ai/dsh-client-composer-guards/client` in its `dsh.client.external` and keeps that package as matching peer and dev dependency; the boot-graph composer orders the supplier row before its consumers, and the browser module table resolves the request to the row's exports (`<id>/client` and the bare id normalize to the same row).
- `sessionAcceptsEdits` takes the `SessionFace` directly — input-history-recall's signature. The `(ctx, actx)` shape the other two copies inlined is one `ctx.sessions.sessionOf(actx)` call at each call site, and the SessionFace form is the shared core.
- `resolveEditableInput` returns the superset `{ input, state, sessionId, liveSessionIds }`: global-paste consumes `state`, text-file-cards consumes `sessionId`/`liveSessionIds` (its staged-files prune currency), and the extra fields cost each consumer nothing.
- Deployment coupling is explicit and load-time loud: a composition mounting any consumer must mount the supplier row or graph composition rejects the missing request; the web-app bundle mounts the five together.

## Testing

`packages/extensions/composer-guards/tests/composer-guards.client.spec.ts` covers the visibility probe's every branch (zero-size, offscreen center, null probe hit, direct/descendant/ancestor hit), the session-lock matrix (removed, plain, continuable with parent available and offline, one-shot), the editable-input guard order (no session, no scope, no face, removed, offline parent, adjudicating, submitting, claimed-accepts), the live session-id list, both inert halves, and the invariant companion's ownership reservation. The three consumers' existing specs run unchanged over the shared implementations (117 tests across the four packages), and the client build exercises the declared external edge through the bundle purity gate.

## Alternatives considered

**A cordis service instead of a module row.** The predicates are stateless functions, not a capability with lifecycle or replaceable identity; a service would add the full Service Definition / Provider / Consumer seam, make every consumer's fiber PENDING on the provider, and still need a shared home for the code.

**jscpd ignore markers.** The repository marks duplication that belongs to its subject with ignore blocks (the invariant companions are the precedent), but three copies of lock-alignment logic are a maintenance hazard, not a contract: the clones were accidental, and an ignore marker would freeze them.

**Extraction across the fork/upstream boundary.** The usage-stats ↔ token-meter clones stay red deliberately: token-meter is upstream-held, and a shared abstraction crossing that boundary is a merge liability out of proportion to roughly twenty duplicated lines.

**Inlining into one consumer and importing it from the others.** That is exactly the undeclared cross-plugin value import the purity gate rejects; a library row is the sanctioned shape for shared code with no service identity.

## Consequences

- The duplication gate's remaining red is exactly the three recorded usage-stats clones (usage-stats internal ×1, usage-stats ↔ token-meter ×2), which stay as accepted legacy.
- composer-guards is the first exercised `dsh.client.external` supplier. The mechanism was designed for this shape — package rows and exact static keys are the only suppliers — but this is its first live consumer set; a second user should confirm the path against this precedent.
- The four consumers (draft-keeper, the composer draft-persistence plugin, joined as the fourth) now hard-require the supplier row at composition time. Within the fork's single shipped composition (the web-app bundle) this is invisible, but a downstream composition that mounts, say, global-paste without composer-guards fails at graph composition with a missing-request error rather than at runtime.
- A future composer plugin should request the same row instead of re-copying the predicates, as draft-keeper did; the consumers' module docs and the extensions README name the supplier.
