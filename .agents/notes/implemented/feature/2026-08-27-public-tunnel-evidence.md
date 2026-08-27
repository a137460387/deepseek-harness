# Agent Note: Public tunnel exposure evidence for the stock and gated web stacks

Status: implemented

English | [中文](2026-08-27-public-tunnel-evidence.zh.md)

## Problem

Before exposing `dsh web` through a public HTTPS tunnel, two questions needed real-process evidence on this machine: does the stock deployment posture already present an unauthenticated public reachability surface through a Cloudflare quick tunnel, and does the fork's lan-access token gate cover tunnel traffic end to end (page loads, RPC, websocket upgrade) without breaking the privileged-pin loopback exemption? A secondary question was whether the `crypto.randomUUID` concern from the rc.2 browser audit applies to the tunnel context.

## Decision

Evidence collected 2026-08-27 on this Windows host at commit `723b224297` (`pnpm install` and `pnpm run build` both exit 0), port 3180, stock and fork stacks probed in separate runs. All probe outputs below are the recorded responses; token and cookie values are redacted.

**Stock-stack discrimination — outcome: fenced but unusable, not exposed.** A stock `dsh web` (no `--trusted-host`) behind a quick tunnel answered every `/api` probe with `403`:

| Probe | Request | Status | Body |
|---|---|---|---|
| 0 | local `POST http://127.0.0.1:3180/api/settings.describe`, no forged headers | `200` | full settings JSON |
| a | tunnel domain, no forged headers | `403` | `forbidden` |
| b | tunnel + `Origin: http://127.0.0.1:3180` | `403` | `forbidden` |
| c | tunnel + Origin + `Host: 127.0.0.1:3180` | `403` | Cloudflare edge HTML error page (`Server: cloudflare`) |

Probe 0 versus probes a/b isolates the causal chain to the Host header layer: the same request succeeds locally and fails through the tunnel, and the only difference is the Host the request arrives with. Code attribution: `isTrustedApiRequest` ([api-request-trust.ts](../../../../packages/client/connection/src/api-request-trust.ts)) runs the Host fence on **every** `/api` request — loopback hostname or a declared `trustedHosts` entry only — and a stock boot declares none, while cloudflared forwards the tunnel hostname as Host by default, so the fence rejects everything. Probe c shows the remaining forgery route is closed one layer earlier: rewriting Host to a loopback authority makes the Cloudflare edge itself refuse the request (`Server: cloudflare` HTML page), so it never reaches the origin. Conclusion: the stock posture through a quick tunnel is H1 — no unauthenticated public API surface, but no usable one either.

**Fork-stack recipe.** Startup order is a hard dependency: the quick tunnel hostname changes on every cloudflared restart, so the sequence is (1) start cloudflared against `http://127.0.0.1:3180` and harvest the hostname from the registration line, (2) start `dsh web --port 3180 --no-open --trusted-host <tunnel-hostname>` with `DSH_LAN_ENABLED=true` and a fresh `DSH_LAN_TOKEN` injected as process environment only. `--trusted-host` is required because the fork binds all interfaces and `resolveLanTrust` derives LAN IP trust automatically, leaving the tunnel hostname undeclared. Five probes through the tunnel domain (curl with a cookie jar walking the full handshake):

| Probe | Request | Expected | Actual |
|---|---|---|---|
| a | `GET /` no credentials | `401` | `401` gate placeholder page |
| b | `GET /?token=<t>` | recorded | `302` to `/`, no `Set-Cookie` |
| b2 | `GET /auth-set?token=<t>` | `302` + cookie | `302` + `set-cookie: dsh-lan-token=<t>; HttpOnly; SameSite=Lax; Path=/` |
| c | cookie `POST /api/session.list` | `200` | `200` + real session JSON |
| d | cookie `POST /api/settings.describe` | `403` | `403` `forbidden` |

Local self-check first established the same chain without `--trusted-host`: bare `/` → `401`, `/auth-set?token=` → `302` + cookie, cookie `POST /api/session.list` → `200`, and cookie `POST /api/settings.describe` over loopback → `200` — the privileged pin keeps its loopback exemption with the gate installed, evidence that the gate does not over-block the native privileged semantics.

**Browser flow, two legs.** The main leg entered at `/auth-set?token=<t>`: the cookie landed, the SPA fully rendered (workspace tree, real session sidebar matching the `session.list` data, model selector populated), 54 plugin bundles and 30+ RPCs succeeded, a diagnostic `wss://…/api/events.mux` connection completed its upgrade and received real mux frames, and the console showed zero `crypto.randomUUID`/`SecurityError` failures — the client RPC uses a `getRandomValues`-based UUID helper that does not depend on a secure context, and the HTTPS tunnel is one anyway. The record leg entered at bare `/?token=<t>` from a cookie-less context: the server answers `302` stripping the query without setting a cookie, the browser lands on `/` and receives `401` — a dead loop in which the 401 page's own instruction ("append ?token= to sign in") leads back to itself. The only working entry is `/auth-set?token=`.

## Alternatives considered

**Accept the stock 403 as sufficient without the local control probe.** Without probe 0 the tunnel 403s could in principle be a server-side failure to serve anything at all; the local `200` pins the rejection to the Host layer specifically, so the stock posture is provably "fenced," not "broken."

**Judge the gate only through curl probes.** The browser legs add what curl cannot observe: the websocket upgrade succeeds through the trusted-host fence (curl does not speak the WS handshake here), the SPA actually composes against tunnel latency, and the `/?token=` dead loop manifests as a user-visible failure rather than a header observation.

**Fix the `/?token=` cookie gap as part of this evidence pass.** The README's "token exchanged for a cookie on first entry" description does not match the implementation — `/?token=` only strips the query; only `/auth-set` sets the cookie. The task was evidence, read-only; the fix is deferred to its own change and recorded below as a known limitation.

## Consequences

- The stock stack behind a quick tunnel is confirmed fenced-but-unusable (H1); the fork stack with `--trusted-host` plus the token gate is the supported public-tunnel posture, with the gate answering before the Host fence (`401`, not `403`, without credentials — the gate covers tunnel traffic including static assets and upgrades).
- Known limitations, recorded not worked around: (a) privileged domains (`settings.*`, `credentials.*`) answer `403` remotely — the privileged pin is loopback-only by design and `--trusted-host` does not exempt it; (b) a quick tunnel hostname changes on every restart, so `--trusted-host` must be re-declared each time; (c) the `/?token=` dead loop — README wording promises a cookie exchange the implementation does not perform; `/auth-set?token=` is the only working entry, and the fix is deliberately deferred to a separate change; (d) the `crypto.randomUUID` concern does not apply to the tunnel context (zero errors, `getRandomValues` implementation), but the plain-HTTP LAN case remains untested.
- Security posture of a public quick tunnel on the fork stack: single-factor protection by the token gate plus privileged-pin defense in depth; every token and cookie value in this note and in the archived probe transcripts is redacted — no plaintext secret is recorded.
