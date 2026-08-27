# Agent Note: LAN-access acceptance smoke evidence (three states)

Status: implemented

English | [中文](2026-08-27-lan-access-e2e-evidence.zh.md)

## Problem

The lan-access plugin was delivered on another machine; the acceptance handoff required real-process evidence that all three switch states behave to spec (enabled gate chain, disabled transparency against the stock server, enabled-without-token fail-loud) on this machine, with the stale-process hazard the fork has hit twice (a long-lived `dsh web` started before a host-layer replacement keeps serving the old tree) ruled out first.

## Decision

Evidence collected 2026-08-27 on this Windows host, port 3180, after `netstat` located and `taskkill` terminated a stale `dsh web` (PID 24428, started 08-26 14:45, listening on 3080) that predated the change. Full logs of each run are in the delivery session; the tables below are the recorded outputs.

**S1 — `DSH_LAN_ENABLED=true` with token.** Boot line prints the LAN URL (`resolveLanTrust` samples from the real all-interfaces bind). No-credential `/api/session/list` → `401` + `text/html` inline placeholder page. Entry `/?token=<t>` → `302` to `/` with the query cleared. `/auth-set?token=<t>` → `302` + `set-cookie: dsh-lan-token=<t>; HttpOnly; SameSite=Lax; Path=/`. A real RPC envelope (`POST /api/settings.describe`, `application/json`) with the cookie → `200` + JSON `server-response`; the same POST without the cookie → `401`. (A GET on an unknown method with the cookie returns the API layer's own `404 text/plain` — the gate-passed signal is the content-type and status divergence from the no-cookie `401` HTML page.)

**S2 — switch unset.** Boot line has no LAN suffix. `GET /` → `200 text/html` (dist served); `GET /api/session/list` → `404 text/plain`; `GET /?token=anything` → `200` (no gate, no redirect); `POST /api/settings.describe` → `200`.

**S2b — stock-server cross-check.** The same four requests against the upstream `webserver` row re-enabled through a two-row-swap `--patch` overlay: all four responses identical to S2. This run also exposed and accepted the row-shape fix: the delivered patch had reduced the stock row to `disabled: true` alone, so the swap overlay failed at boot with `Cannot read properties of undefined (reading 'startsWith')`; the committed row keeps the stock `name`/`inject`/`config` beside `disabled: true`, and the overlay boots and matches.

**S3 — enabled without token.** Process exits `1` with the labelled diagnostic: `dsh: plugin tree failed to load: ... DSH_LAN_TOKEN is required when DSH_LAN_ENABLED is set; refusing to bind all interfaces without an access token`. No port is left listening.

## Alternatives considered

**Accept the unit tests as the acceptance evidence.** They pin the same behaviors through the real vendored Loader, but the handoff asked for real-process smoke (profile boot, tsx launch, actual curl responses) because the disabled-mode byte-for-byte claim and the stale-process hazard only manifest at the composed-process level.

**Skip the stock-server cross-check.** The unit tests compare the subclass against the stock class in one process; the overlay run additionally proves the bundle's two rows can be swapped by an external patch — the exact rollback path the patch file's comment promises.

## Consequences

- The three-state acceptance is complete with recorded outputs; the row-shape fix (stock fields retained on the disabled row) is folded into the scaffold commit of the four-commit series.
- Future webserver/host-layer changes should repeat the netstat-stale-process check before any smoke run; this note records the third occurrence of the pattern being caught before it bit.
