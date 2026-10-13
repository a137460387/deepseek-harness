---
description: "LAN-access webserver: the stock WebServer subclass that binds one concrete LAN interface behind a token gate when enabled and stays byte-for-byte stock otherwise."
kind: "package-reference"
---
# @deepseek-ai/dsh-host-lan-access

English | [中文](README.zh.md)

## Summary

LAN-access webserver: a subclass of the plain webserver plugin that binds one concrete local interface behind a token gate, and behaves byte-for-byte like the stock server otherwise. The `web-app` bundle ships it **disabled** and keeps the stock `webserver` row active, so a deployment enables it with a two-line patch overlay that disables the stock row and enables this one — see Enabling LAN mode. Setting `DSH_LAN_ENABLED=true` alone changes nothing: the row is not mounted until that overlay applies.

## Table of Contents

- [Enabling LAN mode](#enabling-lan-mode)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Configuration

| Environment variable | Default | Meaning |
|---|---|---|
| `DSH_LAN_ENABLED` | unset (off) | Any non-empty value enables LAN mode. `false`, empty, and unset are all off. It only takes effect once the row is mounted: the shipped composition disables it, so the deployment must also apply the overlay in [Enabling LAN mode](#enabling-lan-mode). |
| `DSH_LAN_BIND` | first non-loopback IPv4 | Bind host while enabled. Must be one concrete IPv4 or IPv6 literal of a local interface; a hostname, a malformed address, or a wildcard (`0.0.0.0`, `::`, and their IPv4-mapped spellings) fails the load loudly. A loopback literal is accepted when serving only this machine is intended. Unset means discovery: the subclass binds this host's first non-loopback IPv4, because the base webserver rejects a bind that would expose the port on every interface at once. A host with no non-loopback IPv4 fails the load loudly rather than binding loopback too. |
| `DSH_LAN_TOKEN` | — | Required when enabled. The shared secret. Missing token fails the whole tree load loudly. |
| `DSH_LAN_TRUST_LOCALHOST` | unset (off) | Opt-in localhost token exemption. Only `1`/`true` (case-insensitive) enable it; every other value and unset are equally off. See Security warnings for the boundary and cost once enabled. |
| `DSH_LAN_EXTRA_AUTHORITIES` | unset | Optional comma-separated `host[:port]` list appended to the `/api` browser-trust fence's `trustedHosts`. |

With LAN mode off, the row's `host` expression is the stock `ctx.webStartup.host ?? '127.0.0.1'` — `--host`/`--port` flags behave exactly as before. With it on, `DSH_LAN_BIND` is the bind knob: the row passes a schema-valid loopback placeholder because its `!!js` expression runs against the Loader scope, which carries no imports and so cannot enumerate interfaces, and the subclass replaces that placeholder before listening. **`--host` does not select the LAN bind**: it feeds `webStartup.host`, which is the row expression LAN mode replaces.

## Enabling LAN mode

The bundle ships the stock `webserver` row active and this package's row disabled. Enabling LAN mode therefore takes two changes at once — an environment pair for the gate, and a patch overlay that mounts this row in place of the stock one. `DSH_LAN_ENABLED` on its own enables nothing: with the row still disabled the stock server keeps serving, binding loopback and carrying no gate.

Write an overlay outside the checkout (one file, two rows — disable the stock row, enable this one):

```yaml
# lan-enable.overlay.yml
- id: webserver
  disabled: true
- id: lan-access-webserver
  disabled: false
```

Then launch with `--patch` **before** the first Web-app flag:

```sh
DSH_LAN_ENABLED=true \
DSH_LAN_TOKEN=<random> \
DSH_LAN_BIND=<LAN-IP> \
  pnpm dsh --profile web --patch ./lan-enable.overlay.yml --port 3180 --no-open
```

`--patch` is a launcher flag, and the launcher stops reading its own options at the first token it does not own. Placed after `--port` — or any other Web-app flag — it is forwarded to the Web app instead and the boot dies with `error: unknown option '--patch'`. Keep it ahead of the app flags.

`DSH_LAN_BIND` selects the interface:

- **Set** — the server binds that address verbatim, after checking it the way the base webserver checks a configured bind: it must be one concrete IPv4 or IPv6 literal. A hostname, a malformed address, or a wildcard — `0.0.0.0`, `::`, or an IPv4-mapped spelling of IPv4 any — fails the load loudly, because binding it would expose the port on every interface at once. A loopback literal is accepted, when serving only this machine is the intent. This is the value to set for a deployment other devices must reach.
- **Unset** — the subclass discovers the host's first non-loopback IPv4. Discovery walks `os.networkInterfaces()` in enumeration order and does not rank by usefulness, so on a host with virtual adapters it can equally pick a WSL vEthernet, VMware host-only, or VPN interface rather than the physical LAN address. When the server must be reachable from another physical device, set `DSH_LAN_BIND` to that device-facing IPv4 instead of relying on discovery. A host reporting no non-loopback IPv4 fails the load loudly rather than binding loopback.

Verify the deployment:

```sh
# The startup line names the address actually bound; confirm it against the OS.
netstat -ano | grep 3180        # Windows
ss -ltnp | grep 3180            # Linux

curl -i http://<LAN-IP>:3180/api/session/list   # 401 + inline placeholder page, no credential
curl -i http://127.0.0.1:3180/                  # connection refused: the gate binds the named interface, not loopback
```

- The startup line prints the LAN URL and the host process's own launch token. When `DSH_LAN_BIND` is unset and the printed address is not the one you meant, that is discovery picking another adapter — set `DSH_LAN_BIND` explicitly.
- No credential, on any path → `401` with the inline placeholder page. That page is this gate's; the host's own browser auth answers `401` with a different body (`dsh web authentication required…`), so the two layers stay distinguishable.
- Browsing needs the two-stage entry: open `http://<LAN-IP>:3180/?token=<DSH_LAN_TOKEN>` first (this gate sets the `dsh-lan-token` cookie), then open `http://<LAN-IP>:3180/?token=<launch token>` from the startup line (the host's own exchange mints the browser cookie and the app loads). See the authentication flow below.
- `curl -i http://LAN-IP:3180/` from another device on the same LAN should reach the gate; a refused connection there means the bind named an interface that device cannot route to.

## Authentication flow (all paths gated)

Every request — static assets, `index.html`, `/api`, websocket upgrades — passes the token gate before any registered handler runs:

- No credential → 401 with an inline placeholder page (no script, no asset path; the real dist is never named). Denials, the `?token=` redirect, and `/auth-set` are marked `Cache-Control: no-store`.
- `?token=<secret>` on any path → validates, sets the session cookie (same attributes as `/auth-set`), 302 to the same path with the query cleared.
- `/auth-set?token=<secret>` → validates, sets `dsh-lan-token=<secret>` cookie (`HttpOnly; SameSite=Lax; Path=/`, no `Secure` — plain HTTP), 302 to `/`.
- Valid cookie → request passes through to the stock dispatch. Document paths (the dist root and `*.html`, GET/HEAD) additionally carry `Cache-Control: no-store`: the rendered index embeds live Host state (the boot theme and font size), so a cache sitting in front — a Cloudflare tunnel with cache rules, say — must never store the shell. Hashed assets and writes are untouched.
- Valid cookie plus a foreign `?token=` → passes through untouched (no redirect, no gate cookie): see the two-stage entry below.
- With `DSH_LAN_TRUST_LOCALHOST=1/true`, requests whose TCP peer and Host header are both loopback forms skip the token judgment and pass directly (pages and websocket upgrades share one decision point); the `/auth-set` and `?token=` cookie-exchange flows are unchanged.
- Invalid token → 401 (with or without a foreign `?token=`, unless the valid gate cookie is present).
- Websocket handshake without a credential → rejected with 401 before any protocol negotiation.

Token comparison is `crypto.timingSafeEqual` over SHA-256 digests, never plaintext. No log line prints a URL containing the token.

Since the 0.1.2-alpha.1 sync the host also runs its own browser authentication (the Connection's BrowserAuth): it guards `index.html` and `/api` with a per-process launch token and authority-bound cookies, independently of this gate. Browser entry therefore takes two stages:

1. Open `/?token=<DSH_LAN_TOKEN>` — this gate sets the `dsh-lan-token` cookie and redirects to `/`.
2. Open `/?token=<launch token>` — the launch token is printed by `dsh web` at boot (and lands in the service log of a supervised deployment); bearing the gate cookie, this request passes the gate untouched, and the host's own exchange mints its browser cookie so the app loads.

A request without the gate cookie never reaches the second stage: a foreign `?token=` stays refused. The second token grants nothing on its own against this gate; the gate token remains the outer boundary.

## Security warnings

- **Everything is plaintext on the wire.** Over plain HTTP both the `?token=` query and the session cookie travel unencrypted. Anyone able to sniff LAN traffic can recover the token. The trust boundary is the LAN itself.
- **Crossing untrusted networks needs a tunnel.** To reach the server over anything other than a trusted LAN, wrap the connection in an SSH tunnel (`ssh -L 3180:127.0.0.1:3180 <host>`) or an HTTPS reverse proxy. Do not expose the port to the internet directly.
- **The token authorizes remote code execution.** The web UI can create agent sessions that run shell commands. Treat the token with the same care as an SSH key for the machine.
- **The localhost exemption is off by default; enabling it trusts every local process.** With `DSH_LAN_TRUST_LOCALHOST=1/true` explicitly enabled, requests whose TCP peer and Host header are both loopback forms (localhost / 127.0.0.0/8 / `[::1]`, each with an optional port) skip the token judgment and pass directly, for pages and websocket upgrades alike. The decision reads only the socket's real peer address and the Host header — never `X-Forwarded-For` or any other forgeable forwarded header — so the reverse-tunnel shape (loopback peer, public Host, e.g. a cloudflared ingress) and the LAN shape (non-loopback peer) stay gated. The cost: any local process or local user able to connect to the port gains the full agent authorization, exactly as if it held the token — which is why the switch defaults to off.
- **`DSH_LAN_BIND` is validated, not trusted.** The value comes from the environment, so it never passes through the webserver's schema. The subclass applies the same two checks the schema applies — a concrete IPv4/IPv6 literal, and no unspecified address — before binding, so a wildcard cannot be smuggled past the rule that keeps the port off every interface at once. A refused value fails the load; no listener is created.
- The stock `/api` browser-trust fence (DNS-rebinding and cross-site defense) stays fully active; this package adds authentication on top, never replaces it.

## Direct `.ts` source reference

The composition row mounts `@deepseek-ai/dsh-host-lan-access/src/server.ts` — a source-plane subpath, not a built entry. This relies on the dsh source launch running through the tsx ESM hook (and on the profile module-fallback symlinks, which resolve the subpath to this checkout's `src/`). If the composition ever runs from built artifacts only, this package needs a build step and the row's `name` moves to the bare package id.

## Verification

Enabling, the overlay, the launch command, and the probes are in [Enabling LAN mode](#enabling-lan-mode). In short: apply the two-line overlay, pass `DSH_LAN_ENABLED`/`DSH_LAN_TOKEN`/`DSH_LAN_BIND`, confirm the bound address against the OS, and check that a no-credential request answers the gate's `401` while loopback refuses the connection.

Tests: `packages/extensions/lan-access/tests/lan-access.spec.ts` (29 cases: the gate over `/api`, websocket rejection, the auth-set chain, the `?token=` dead-loop closure, placeholder-page opacity, document `no-store` marking — documents, denials, and exchanges carry it; assets and writes do not — disabled-mode byte-for-byte equivalence against the stock server — unset and explicit `false`, headers included — fail-loud missing token, log hygiene, the localhost exemption's loopback peer + loopback Host double for pages and websocket upgrades, the reverse-tunnel and LAN shape denials, the exemption switch parsing, the loopback classification predicates, and the LAN bind resolution: switch-off passthrough, legal IPv4 and IPv6 literals including a zone-bearing one, an explicit loopback, every wildcard spelling the upstream detector recognises rejected through the real resolver with no listener left bound, hostnames and malformed addresses rejected, non-loopback discovery over the row placeholder, a listener proven to answer on the discovered interface and not on loopback, and the fail-loud refusal when no non-loopback IPv4 exists).

<a id="model-experience"></a>
## Model Experience

None, as the package is a Web dispatch wrapper between the browser and the routes the stock server already carries; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Plaintext transport** — the token query, the cookie, and all page traffic cross the LAN unencrypted; the token is recoverable by anyone who can sniff the segment. Crossing an untrusted network requires an SSH tunnel or an HTTPS reverse proxy (see Security warnings). A built-in TLS mode is deliberately out of scope for the fork.
- **One shared token, no revocation list** — the token authorizes every device that holds it, and revocation is rotating `DSH_LAN_TOKEN` and restarting. Per-device credentials are deferred until a deployment needs them.
- **No per-path policy** — the gate is all-or-nothing over every path. Restricting individual API methods to loopback while serving the UI to the LAN is the stock fence's job (privileged methods already stay loopback-only upstream), not this layer's.
- **Source-plane row name** — the composition row mounts `…/src/server.ts` directly, which works under the tsx source launch and breaks if the composition ever runs from built artifacts only; that day the package gains a build step and the row moves to the bare package id.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
