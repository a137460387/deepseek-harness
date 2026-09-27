# Agent Note: Reasoning-effort editing on the Models page model list

Status: implemented

English | [中文](2026-09-18-model-list-reasoning-efforts.zh.md)

## Problem

The pi-ai per-model `reasoningEfforts` field — the offered thinking levels and the wire value each dispatches — was reachable only by hand-editing `settings.yaml`. The Models page model editor covered id, display name, and the two token capacities, and the provider card deliberately carries no provider-scoped effort control because the capability is per-model and the models under one provider disagree about it. A provider whose models are not in the installed catalog (a relay gateway serving many vendors) therefore offered no reasoning levels anywhere: the adapter reports no capability for models without a declaration, and the composer's model picker reads exactly that metadata, so its effort pane stays empty.

## Decision

Each pi-ai model row on the Models page edits its own `reasoningEfforts` behind the row's disclosure, in three modes: follow the installed catalog (field absent), declare the model non-reasoning (`false`), or declare the offered levels as a level-keyed dict of wire spellings.

- **The level vocabulary is a schema read, not a client copy**: `reasoningLevels` walks the owning namespace's `Config` schema to the `reasoningEfforts` union's dict member and reads its key union — the same source the adapter validates against, mirroring how `protocolChoices` reads the wire protocols. `nodeAtPath` spends one segment per container, so the path names an (ignored) element position after `models` before the field key. A schema without the field, or an unreadable shape, yields an empty list and the control renders nothing rather than something the write would refuse.
- **Custom mode rebuilds the dict from the vocabulary on every edit** rather than spreading over the stored value: `off` stays declared (an empty field is stored as null, which the resolver reads as "supported, send nothing"; a stored spelling is kept), while keys outside the vocabulary and valueless non-off levels are shed — an edit through this editor is the moment to repair the hand-written drift (the YAML-1.1 `off:` → `false:` key rewrite that llm-pi-ai's registration test pins) the section schema would refuse wholesale.
- **The build-time invariants are mirrored client-side**: `validateDeepSeekModels` rejects a declaration naming no level beyond `off`, a null wire value on a non-off level, a non-string or empty wire value, or a non-dict, non-`false` field, so the refusal names the model row before any write instead of surfacing as a schema message at the section.
- **Stored shapes render faithfully**: `false` selects disable, a dict selects custom with its spellings in the fields (null renders empty), and a valueless stored declaration reads as custom and is refused at apply, which points the repair at the same control.
- The deepseek family's catalog rows render no control: its schema carries no such field and the editor receives no vocabulary.

The composer's picker keeps reading its levels from the directory metadata; nothing changes on that path.

## Alternatives considered

**A provider-scoped effort control on the card.** The standing rationale holds: one route-level value would be wrong for every model that disagrees, and the composer picker would offer levels the adapter refuses per model. Lost for the card; the per-model row is the home that matches the field's own shape.

**A hardcoded level list in the client.** It would drift from the set the adapter accepts exactly where the protocol list would have, which is why the page reads protocols from the schema too. Lost: one source of truth, and an introspection miss degrades to "no control" instead of "a control that writes refused values".

**Fixing only the affected deployment's `settings.yaml`.** It repairs one provider and leaves the authoring gap; the wire spellings are deployment knowledge the editor should collect rather than values this repo should invent as defaults.

## Consequences

Operators can enable reasoning levels on custom relays without hand-editing YAML, and the composer picker offers those levels through the existing metadata path. Editing a row through the editor normalizes a hand-written dict — out-of-vocabulary keys are dropped and `off` is materialized — so a deployment that wants "off unsupported while other levels are offered" stays YAML-only. The vocabulary read is one schema introspection per editor mount; a missing field hides the control rather than degrading the card.

## Testing

`provider-form.client.spec.tsx` pins the vocabulary introspection (fixture schema, undefined namespace, schema without the field), the custom-mode flow (off-only refusal, then the stored dict `{ off: null, high: 'high' }`), editing a stored declaration (spellings render, blur trims, a cleared level leaves the dict, the off spelling survives an unrelated edit), disable writing `false`, inherit removing the field, a valueless stored declaration reading as custom and refused, and the validator's shape matrix mirroring the resolver. `components.client.spec.tsx` pins that deepseek catalog rows render no control.
