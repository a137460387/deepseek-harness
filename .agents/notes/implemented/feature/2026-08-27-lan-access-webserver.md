# Agent Note: LAN-access webserver as a gated WebServer subclass

Status: implemented

English | [中文](2026-08-27-lan-access-webserver.zh.md)

## Problem

The stock web composition binds loopback only, and the web startup flags deliberately refuse `--host 0.0.0.0` (an unauthenticated all-interfaces bind would expose remote code execution to the network). Reaching dsh web from another device on the LAN therefore required an SSH tunnel every time. A safe LAN mode needs an authentication layer that the upstream webserver does not have, applied to every path — static assets and websocket upgrades included — without touching upstream-owned files (FORK_NOTES.md forbids both core edits and package-private rewrites).

## Decision

`packages/extensions/lan-access` (`@deepseek-ai/dsh-host-lan-access`) ships `LanAccessWebServer`, a subclass of the stock `WebServer` plugin, mounted by the web-app bundle's `cordis.patch.yml` as a replacement row:

- **Row surgery, not a patch file.** The stock `webserver` row is disabled and a sibling `lan-access-webserver` row inserted directly in `packages/bundle/web-app/cordis.patch.yml`, with the config field-by-field commentary inline (host/port are the schema's only fields; port is unchanged, host gains the LAN expression). The row's `name` is the source-plane subpath `@deepseek-ai/dsh-host-lan-access/src/server.ts`, resolved by the tsx source launch through the profile module-fallback symlinks — the bare package id would load the built entry and miss the subclass, and a `./src/...` relative name would resolve against the profile directory, not the package.
- **Transparent when off.** `DSH_LAN_ENABLED` unset/false runs the base `Service.init` alone — no listener stripping, no validation, no throw. The disabled-mode test boots the stock server and the subclass with identical rows and compares status, body, and headers byte-for-byte across ordinary, POST, 404, malformed-URL, and upgrade scenarios.
- **Fail-loud when half-configured.** Enabled without `DSH_LAN_TOKEN` throws from `Service.init`; the Loader surfaces it as a labelled tree-load failure and the process exits 1 (verified end to end).
- **Exclusive dispatch takeover.** Enabled mode reads the base-owned `http.Server` through a controlled assertion (the base field is private; ownership stays with the base's own teardown effect), then `removeAllListeners('request'|'upgrade')` and re-adds wrappers that call the captured originals — `prependListener` could not stop an already-registered async handler from running. The wrapper gates every path before any original listener: no credential → inline 401 placeholder page (no script, no dist path); `?token=` → validates, sets the session cookie (same attributes as `/auth-set`), 302 to the same path with the query cleared; `/auth-set?token=` → validates, sets `dsh-lan-token` cookie (`HttpOnly; SameSite=Lax; Path=/`), 302 to `/`; valid cookie → passthrough; websocket handshake without a credential → 401 before any protocol negotiation.
- **Constant-time comparison, log hygiene.** Token checks compare SHA-256 digests with `crypto.timingSafeEqual`; no log line prints a URL containing the token (pinned by a test that exercises success, denial, and error paths under spied consoles).
- **No fence tampering.** The stock `resolveLanTrust` LAN sampling and the `/api` browser-trust fence stay exactly as upstream wrote them — the real bind does the work. `DSH_LAN_EXTRA_AUTHORITIES` only appends entries to the connection row's `trustedHosts` expression, the documented composition seam for extra authorities.
- **Composition follows every fork-extension convention:** `packages/extensions/` placement, `./invariant` companion, bilingual README with i18n sidecar, version aligned to root, `tsconfig.base.json` paths entries, host-aggregate project reference, and the bundle manifest `dependencies` entry the `verify-cordis-config` gate requires.

The class declares no `static inject` — matching the base class, whose `webStartup` injection comes from the composition row. A class-level `inject` made the fiber PENDING in any context that does not provide `webStartup` (hand-built test contexts), which the first test run caught.

## Testing

`packages/extensions/lan-access/tests/lan-access.spec.ts` — 10 cases through the real vendored Loader (same boot shape as the webserver package's own spec): `/api` 401 without a token with the handler never invoked (spy), websocket handshake rejected without a token and completed with one, the `?token=` → 302 → `/auth-set` → Set-Cookie → authenticated API/page chain, the `?token=` dead-loop closure, the placeholder 401 page's opacity across four paths, disabled-mode byte-for-byte equivalence (unset and explicit `false`), the fail-loud missing-token boot, log hygiene across a full gated session, and the invariant companion's registration. End-to-end, the real profile boot verified all three modes on port 3180: enabled (401 / 302 / cookie / authorized pass-through, LAN URL printed), disabled (stock behavior, no LAN line), and enabled-without-token (exit 1 with the labelled diagnostic).

## Alternatives considered

**An external reverse proxy or SSH tunnel only.** Correct for untrusted networks and still the recommendation there, but the LAN case deserves a first-class switch: the tunnel adds a per-device setup step for a trust boundary the LAN already provides.

**A standalone proxy process in front of the stock server.** Doubles the process surface, needs its own lifecycle, and cannot gate the websocket upgrade path without re-implementing the route table.

**Patching the upstream webserver package.** FORK_NOTES.md ranks patches below plugin-seam implementations; subclassing the exported `WebServer` reaches every needed seam (the `http.Server` is reachable from the instance after init) with zero upstream-file diffs.

**A `prependListener` gate.** Node runs every registered `request` listener; prepending cannot stop the already-registered base handler from serving the request. The takeover must remove and re-wrap.

## Consequences

- The web-app bundle now boots `lan-access-webserver` in every composition; with the switch off it is the stock server by another row id. Reverting is two rows in one patch file.
- The token is a shared secret for the whole LAN segment — revocation is rotating `DSH_LAN_TOKEN` and restarting. The README's security section states the plaintext-transport and tunnel requirements.
- The source-plane subpath row depends on the tsx source launch; if the composition ever runs from built artifacts only, the package gains a build step and the row moves to the bare package id (recorded in the README).
