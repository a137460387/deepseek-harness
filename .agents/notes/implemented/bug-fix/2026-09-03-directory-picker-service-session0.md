# Agent Note: Web composition pins the browse directory-picker pair (session-0 service)

Status: implemented

English | [中文](2026-09-03-directory-picker-service-session0.zh.md)

## Problem

On the fork's production deployment — `dsh web` under NSSM as a Windows service — every "Add workspace…" click was fully silent: no chooser, no error dialog, nothing. The [adaptive default](../feature/2026-07-29-directory-picker-adaptive-default.md) resolves `native` for this host (loopback bind, `win32`, no SSH env), and the native backend spawns a child process whose `IFileOpenDialog` is created in the **session the parent lives in** — session 0 for a service. The dialog opens successfully on the invisible session-0 desktop, so nothing fails: the worker posts `showing` and blocks in `Show` forever, no `error` and no `exit` ever fires, the pick RPC never settles (the whole path is timeout-free by design), and the client shows nothing. The [adaptive-default note](../feature/2026-07-29-directory-picker-adaptive-default.md) expects a wrong `native` choice to "degrade to the backend's existing retryable failure dialog"; a session-0 host is the counterexample — the wrong choice does not fail, it hangs invisibly, so the prescribed "deployments in these shapes compose `-browse` directly" escape hatch is the only correct composition.

## Decision

`packages/bundle/web-app/cordis.patch.yml` pins the browse pair: the stock `directory-picker` row (`dsh-host-directory-picker-auto`) is disabled in place (stock name kept, same shape as the webserver rows), and two rows mount the dual-face browse backend — `directory-picker-browse` (`dsh-host-directory-picker-browse`, backend first) and `directory-picker-surface` (`dsh-client-ui-directory-picker-browse`). The in-app Select-Workspace-Directory dialog renders in the browser and drives `list`/`createDirectory` over the wire, so the interaction no longer depends on the host process owning a visible desktop. Revert is a three-row swap; the pin is retired once upstream's resolver learns to detect service/session-0 hosts and resolve `browse` itself. Both packages were already declared by the bundle manifest for the chooser gate, so the change touches no manifest.

## Verification

- `verify-cordis-config` reports exactly the pre-change error set (one environment item: `apps/cli/tests/profiles/acp/cordis.yml` is a git symlink materialized as text on this machine — the known no-symlink-privilege whitelist family).
- Boot smoke on an isolated `DSH_HOME`: clean boot, no loader diagnostics.
- Browser test through the real flow (New Session → Add workspace): the in-app dialog opens with a live home listing; `EnumWindows` finds no `Select Workspace Directory` window and the host has no dialog-worker child.
- Enabled LAN smoke after the edit: unauthenticated `GET /api/session/list` → 401 (the webserver replacement chain in the same file is intact).

## Alternatives considered

- **Fix the resolver** (session-0/service probe in `resolveDirectoryPickerBackend`). Rejected for this change: the resolver is package-private to the chooser, so the edit means a core-file patch or an upstream change — evaluated separately (see below), not a composition-level fix.
- **Deployment-side overlay** (`$DSH_HOME/cordis.patch.yml` on the service host). Rejected: the fork's web composition is version-controlled here and must not drift per deployment; the pin applies to every boot of this fork's web profile without extra state.
- **Keep native and add a pick timeout.** Rejected: no timeout makes an invisible dialog visible; a bounded wait would kill a dialog the operator may legitimately be studying and still misreport the failure. A pre-`showing` bound and a session-0 fail-loud check remain upstream-hardening candidates.
- **Switch the service to LAN mode** so `bindHost` becomes `0.0.0.0` and auto resolves `browse`. Rejected: flips the bind/auth topology for an unrelated reason; the pin achieves the same resolution without touching the gate.

## Consequences

- The workspace-add flow works on the NSSM service and through the tunnel; the native OS chooser is given up everywhere in this fork's web profile, including attended local runs — acceptable because the in-app dialog is fully capable (browse, create folder, hidden-file toggle).
- The pin is a fork delta on an upstream file: the directory-picker section's `git diff` against upstream must stay exactly the Fork comment, the `disabled: true`, and the two inserted rows; anything more means upstream touched the row and the pin needs re-reconciliation. Registered in FORK_NOTES.md accordingly.
- Restart discipline applies: the running NSSM service keeps its boot-frozen composition until restarted, and that restart also completes the still-pending alpha.4 switchover (FORK_NOTES.md, service note).
- The upstream-side evaluation (resolver probe vs feature request) is tracked separately and does not block this composition fix.
