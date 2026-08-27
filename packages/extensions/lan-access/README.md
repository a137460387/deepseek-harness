# @deepseek-ai/dsh-host-lan-access

English | [中文](README.zh.md)

LAN-access webserver: a subclass of the plain webserver plugin that binds all interfaces behind a token gate when `DSH_LAN_ENABLED` is set, and behaves byte-for-byte like the stock server otherwise. The `web-app` bundle's `cordis.patch.yml` replaces the stock `webserver` row with this package's row; the stock row stays present but disabled, so re-enabling it and disabling this row restores the stock server exactly.

## Configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `DSH_LAN_ENABLED` | unset (off) | Any non-empty value enables LAN mode. `false`, empty, and unset are all off. |
| `DSH_LAN_BIND` | `0.0.0.0` | Bind host while enabled. The schema accepts only `127.0.0.1` or `0.0.0.0`; any other value falls back to `0.0.0.0`. |
| `DSH_LAN_TOKEN` | — | Required when enabled. The shared secret. Missing token fails the whole tree load loudly. |
| `DSH_LAN_EXTRA_AUTHORITIES` | unset | Optional comma-separated `host[:port]` list appended to the `/api` browser-trust fence's `trustedHosts`. |

With LAN mode off, the row's `host` expression is the stock `ctx.webStartup.host ?? '127.0.0.1'` — `--host`/`--port` flags behave exactly as before.

## Authentication flow (all paths gated)

Every request — static assets, `index.html`, `/api`, websocket upgrades — passes the token gate before any registered handler runs:

- No credential → 401 with an inline placeholder page (no script, no asset path; the real dist is never named).
- `?token=<secret>` on any path → 302 to the same path with the query cleared.
- `/auth-set?token=<secret>` → validates, sets `dsh-lan-token=<secret>` cookie (`HttpOnly; SameSite=Lax; Path=/`, no `Secure` — plain HTTP), 302 to `/`.
- Valid cookie → request passes through to the stock dispatch.
- Invalid token → 401.
- Websocket handshake without a credential → rejected with 401 before any protocol negotiation.

Token comparison is `crypto.timingSafeEqual` over SHA-256 digests, never plaintext. No log line prints a URL containing the token.

## Security warnings

- **Everything is plaintext on the wire.** Over plain HTTP both the `?token=` query and the session cookie travel unencrypted. Anyone able to sniff LAN traffic can recover the token. The trust boundary is the LAN itself.
- **Crossing untrusted networks needs a tunnel.** To reach the server over anything other than a trusted LAN, wrap the connection in an SSH tunnel (`ssh -L 3180:127.0.0.1:3180 <host>`) or an HTTPS reverse proxy. Do not expose the port to the internet directly.
- **The token authorizes remote code execution.** The web UI can create agent sessions that run shell commands. Treat the token with the same care as an SSH key for the machine.
- The stock `/api` browser-trust fence (DNS-rebinding and cross-site defense) stays fully active; this package adds authentication on top, never replaces it.

## Direct `.ts` source reference

The composition row mounts `@deepseek-ai/dsh-host-lan-access/src/server.ts` — a source-plane subpath, not a built entry. This relies on the dsh source launch running through the tsx ESM hook (and on the profile module-fallback symlinks, which resolve the subpath to this checkout's `src/`). If the composition ever runs from built artifacts only, this package needs a build step and the row's `name` moves to the bare package id.

## Verification

On the machine running dsh:

```sh
DSH_LAN_ENABLED=true DSH_LAN_TOKEN=<random> pnpm dsh --profile web --port 3180 --no-open
```

The startup line prints the LAN URL. From another device on the same LAN:

- `http://<LAN-IP>:3180/?token=<random>` should load the full UI (the token is exchanged for a cookie on first entry and the query is cleared).
- `curl -i http://<LAN-IP>:3180/api/session/list` without credentials should return `401`.

Tests: `packages/extensions/lan-access/tests/lan-access.spec.ts` (9 cases: the gate over `/api`, websocket rejection, the auth-set chain, placeholder-page opacity, disabled-mode byte-for-byte equivalence against the stock server — unset and explicit `false` — fail-loud missing token, and log hygiene).

## Model Experience

None, as the package is a Web dispatch wrapper between the browser and the routes the stock server already carries; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Plaintext transport** — the token query, the cookie, and all page traffic cross the LAN unencrypted; the token is recoverable by anyone who can sniff the segment. Crossing an untrusted network requires an SSH tunnel or an HTTPS reverse proxy (see Security warnings). A built-in TLS mode is deliberately out of scope for the fork.
- **One shared token, no revocation list** — the token authorizes every device that holds it, and revocation is rotating `DSH_LAN_TOKEN` and restarting. Per-device credentials are deferred until a deployment needs them.
- **No per-path policy** — the gate is all-or-nothing over every path. Restricting individual API methods to loopback while serving the UI to the LAN is the stock fence's job (privileged methods already stay loopback-only upstream), not this layer's.
- **Source-plane row name** — the composition row mounts `…/src/server.ts` directly, which works under the tsx source launch and breaks if the composition ever runs from built artifacts only; that day the package gains a build step and the row moves to the bare package id.
