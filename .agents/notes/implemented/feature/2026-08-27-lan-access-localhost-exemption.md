# Agent Note: opt-in localhost token exemption for the lan-access gate

Status: implemented

English | [中文](2026-08-27-lan-access-localhost-exemption.zh.md)

## Problem

Using the gate from the machine running dsh web itself (a local browser, self-check scripts) must first exchange `?token=` or `/auth-set` for a cookie — pure overhead for local processes, since the token exists for network peers. But the same machine runs cloudflared: tunnel ingress traffic arrives over TCP from 127.0.0.1, so any exemption keyed on "loopback peer" alone would exempt the public internet too. The exemption must make local use convenient without loosening either the public or the LAN shape.

## Decision

`packages/extensions/lan-access/src/server.ts` gains the `DSH_LAN_TRUST_LOCALHOST` switch and the two-condition exemption:

- **Off by default, strict value set.** Only `1`/`true` (case-insensitive) enable it; unset or any other value is off, and off stays byte-for-byte identical to the pre-exemption behavior (the switch only short-circuits the token-judgment branch).
- **Both conditions hold or nothing is exempt.** (a) The TCP peer is loopback — `127.0.0.0/8`, `::1`, or an IPv4-mapped `::ffff:127.x.x.x` normalized to its IPv4 form; (b) the Host header names loopback — `localhost`, `127.0.0.0/8`, or `[::1]`, each with an optional port. A missing or unparseable Host fails the check.
- **The reverse-tunnel shape stays out.** A cloudflared request has a loopback TCP peer but carries the public hostname as Host (e.g. `dsh.lgyu.cloud`), so the Host half fails and the token judgment stays in force — this is the whole reason the exemption is two-condition. The LAN shape (non-loopback peer) fails the peer half.
- **Only the socket peer counts.** `req.socket.remoteAddress` is the sole peer evidence; `X-Forwarded-For` and every other forwarded header never enter the decision — headers are attacker-controlled text and cannot participate in an exemption.
- **One decision point.** The request wrapper and the upgrade wrapper each insert the exemption at the existing `requestCarriesToken` judgment, so pages and websocket upgrades share one predicate; exempted requests still pass the stock Host fence afterwards, and the cookie-session flows (`/auth-set`, `?token=` exchange) are untouched.
- **Read once at boot.** `Service.init` snapshots `localhostBypassEnabled()` into an instance field, matching the `DSH_LAN_ENABLED`/`DSH_LAN_TOKEN` semantics: changing the value needs a restart.

## Testing

`packages/extensions/lan-access/tests/lan-access.spec.ts` gains six cases (existing assertions untouched): the exemption passing pages and websocket upgrades (loopback peer with `localhost` / 127-form / `[::1]`-form Host); the reverse-tunnel shape (`127.0.0.1` peer, public Host), a forged `X-Forwarded-For`, and a credential-less websocket upgrade all denied 401 while a valid cookie still passes; a LAN peer with its own address as Host still 401 (with a loopback-exempt positive control that attributes the 401 to the peer); the switch enabling only `1`/`true` case-insensitively while unset/`yes`/`2` leave the gate unchanged; and two predicate cases pinning the accept/reject sets of `isLoopbackTcpPeer` / `isLoopbackHostHeader`. No end-to-end case connects a real `::1` peer: the bind schema accepts only the two literals `127.0.0.1` and `0.0.0.0`, both IPv4 binds, so no composition admits an `::1` peer — the predicate cases pin that half of the classification, and the end-to-end cases pin the `[::1]` Host form.

## Alternatives considered

**Peer-only exemption.** Not viable on this deployment: cloudflared connects to `http://localhost:3080`, so tunnel traffic arrives with a 127.0.0.1 peer — exempting by peer alone exempts the public internet. This is the founding constraint of the feature.

**Trusting a loopback Origin header, or whitelisting localhost through `DSH_LAN_EXTRA_AUTHORITIES`.** Origin is browser-controllable (some clients send none at all), and that whitelist governs Host-fence trust, not who may skip the token. The exemption's trust anchor must be the transport-layer fact (socket peer) plus the request-line declaration (Host).

**Default-on.** The LAN mode stance is "an all-interfaces bind must authenticate"; a default exemption would silently narrow that stance for every deployment that enables the switch, and local processes would become unaccountable. Off by default keeps the enabled semantics unchanged.

## Consequences

- Enabling grants every process on the machine the full agent authorization (RCE-equivalent) — the price of local convenience, spelled out in the lan-access README's Security warnings section.
- Deployment acceptance criteria follow the switch: once enabled, a credential-less local loopback probe answers 200 instead of 401, while the public-tunnel and LAN criteria are unchanged (recorded under the lan-access entry of FORK_NOTES.md's known local patches).
- The NSSM `dsh-web` service does not enable the switch; doing so is a human-approved deployment change.
