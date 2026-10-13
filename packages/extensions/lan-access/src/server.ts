/**
 * LAN-access webserver: `WebServer` subclass that binds the host's network
 * behind a token gate. `DSH_LAN_ENABLED=false` (the default) changes nothing —
 * the base `Service.init` runs alone and every byte of behavior stays the base
 * server's. `DSH_LAN_ENABLED=true` requires `DSH_LAN_TOKEN`, fails the load
 * loudly when it is missing, and otherwise re-wraps the bound `http.Server`'s
 * `request` and `upgrade` dispatch so every path — static assets and
 * `index.html` included — passes the gate before any registered handler runs.
 * The bind names one concrete interface: `DSH_LAN_BIND` when the deployment
 * sets it, otherwise this host's first non-loopback IPv4, because the base
 * webserver rejects the unspecified address, which would expose the port on
 * every interface at once. Discovery is this package's job rather than the
 * composition row's: the row's `!!js` expression runs against the Loader scope,
 * which carries no imports, so the row passes a loopback placeholder that
 * {@link resolveLanBind} replaces. A host with no non-loopback IPv4 fails the
 * load loudly instead of binding loopback — LAN mode that no LAN peer can reach
 * is a misconfiguration, never a silent downgrade. Setting
 * `DSH_LAN_TRUST_LOCALHOST=1` additionally exempts requests whose TCP
 * peer and Host header are both loopback from the token judgment; the peer
 * check reads the socket's real remote address, never forwarded headers, so a
 * public hostname riding a loopback peer (the reverse-tunnel shape) stays
 * gated. The composition's Connection row derives the browser trust fence from
 * the listener bind the application reads off this server, so this package
 * never fakes Host or Origin. A request already holding the valid gate cookie passes untouched
 * even when it carries a foreign `?token=`: since the 0.1.2-alpha.1 sync the
 * host's own browser auth guards index and `/api` with a separate process
 * launch token, and that two-stage entry (gate cookie first, then the launch
 * token through this gate) is the supported way through both layers.
 * @module @deepseek-ai/dsh-host-lan-access
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { Service, type Context } from '@deepseek-ai/cordis'
import { Config as BaseConfig, isWildcardHost, normalizeBindAddress, WebServer } from '@deepseek-ai/dsh-host-webserver'

/** Environment switch: any non-empty value enables the LAN mode. */
const DSH_LAN_ENABLED_ENV = 'DSH_LAN_ENABLED'
/** Explicit LAN bind address; overrides interface discovery while the switch is on. */
const DSH_LAN_BIND_ENV = 'DSH_LAN_BIND'
/** Shared-secret environment variable; required once the switch is on. */
const DSH_LAN_TOKEN_ENV = 'DSH_LAN_TOKEN'
/** Opt-in localhost exemption switch; only `1`/`true` (case-insensitive) enable it. */
const DSH_LAN_TRUST_LOCALHOST_ENV = 'DSH_LAN_TRUST_LOCALHOST'
/** Cookie carrying the shared secret, set by the `?token=` entry redirect and the /auth-set handshake. */
const DSH_LAN_COOKIE = 'dsh-lan-token'
/** Name the /auth-set handshake redirects back to. */
const ROOT_PATH = '/'
/** The token-exchange route: sets the cookie, then redirects with the query cleared. */
const AUTH_SET_PATH = '/auth-set'

/**
 * This host's first non-internal IPv4 address, in interface enumeration order,
 * or undefined when every interface is loopback. The base webserver rejects the
 * unspecified address at load — binding every interface at once would expose
 * remote code execution without a single named network — so a LAN deployment
 * names one concrete interface, and this is the value discovery picks when the
 * deployment sets no `DSH_LAN_BIND` of its own.
 * @returns one non-loopback IPv4 literal, or undefined when none exists.
 */
export function lanIpv4Of(): string | undefined {
  for (const entry of Object.values(networkInterfaces())) {
    for (const info of entry ?? []) {
      if (info.internal || info.family !== 'IPv4') continue
      return info.address
    }
  }
  return undefined
}

/**
 * Resolve the address the listener binds while the LAN switch is on.
 *
 * The composition row cannot discover an interface: its `!!js` expression runs
 * against the Loader scope, which carries no imports. So the row supplies a
 * loopback placeholder and this resolver owns the real bind, keeping one
 * authority for "which interface does LAN mode expose":
 *
 * - `DSH_LAN_BIND` set — the deployment named the interface. This value arrives
 *   from the environment, never through the row's schema, so the schema's own
 *   literal and wildcard checks have not seen it: {@link verifyBindLiteral}
 *   applies the same public checks here. A loopback value is a deliberate
 *   choice rather than a silent fallback, so it passes.
 * - `DSH_LAN_BIND` unset — discovery must produce a concrete non-loopback
 *   address. When every interface is loopback there is no LAN to serve, so this
 *   throws instead of binding loopback and reporting a LAN mode that no LAN
 *   peer can reach.
 * @param configuredHost - the row's configured host, used verbatim when the switch is off.
 * @param enabled - whether the LAN switch is on for this process.
 * @returns the address to bind.
 * @throws when the switch is on and `DSH_LAN_BIND` names no concrete non-wildcard literal,
 *   or when it is unset and no non-loopback IPv4 exists.
 */
export function resolveLanBind(configuredHost: string, enabled: boolean): string {
  if (!enabled) return configuredHost
  const explicit = process.env[DSH_LAN_BIND_ENV] ?? ''
  if (explicit !== '') return verifyBindLiteral(explicit)
  const discovered = lanIpv4Of()
  if (discovered === undefined) {
    throw new Error(
      `${DSH_LAN_ENABLED_ENV} is set but this host reports no non-loopback IPv4 interface to bind,`
      + ` and no ${DSH_LAN_BIND_ENV} names one; refusing to fall back to loopback, which no LAN peer could reach`,
    )
  }
  return discovered
}

/**
 * Apply the upstream bind contract to a `DSH_LAN_BIND` value.
 *
 * The row's configured host passes through `WebServer.Config`, which rejects a
 * non-literal and an unspecified address; a value read straight from the
 * environment does not. These are the same two rules, taken from the public
 * exports the schema itself uses rather than re-implemented:
 * `normalizeBindAddress` throws on anything that is not a concrete IPv4/IPv6
 * literal (a hostname, a bad address), and `isWildcardHost` catches every
 * unspecified form — IPv4 any, IPv6 any, and the IPv4-mapped spellings —
 * because binding them would expose the port on every interface at once.
 * Loopback is a legitimate explicit choice for a machine-local gated server and
 * is deliberately not rejected here.
 *
 * The value is returned unmodified, matching the schema, which validates and
 * then returns its input. Normalizing would strip a `%zone`, and that zone is
 * what `listen` needs to reach a link-local interface.
 * @param value - the `DSH_LAN_BIND` text.
 * @returns the value unchanged, once it is a concrete non-wildcard literal.
 * @throws when the text is no concrete address literal, or names the unspecified address.
 */
function verifyBindLiteral(value: string): string {
  try {
    normalizeBindAddress(value)
  } catch (_notLiteral) {
    throw new Error(
      `${DSH_LAN_BIND_ENV} ${JSON.stringify(value)} is not a concrete IPv4 or IPv6 address literal;`
      + ' name one local interface address, for example 192.168.1.10',
    )
  }
  if (isWildcardHost(value)) {
    throw new Error(
      `${DSH_LAN_BIND_ENV} ${JSON.stringify(value)} is an unspecified (wildcard) address,`
      + ' which is not supported: binding every interface would expose remote code execution to the network;'
      + ' bind one concrete IPv4 or IPv6 address of a local interface instead',
    )
  }
  return value
}

/** Gateway config: the listen address (same fields as the base webserver). */
export type Config = BaseConfig

/** The base schema object, re-declared so the subclass is its own plugin row. */
const lanAccessSchema = WebServer.Config

/**
 * Whether the request carries the valid secret on the gate cookie alone (the
 * cookie set by the `?token=` entry redirect or {@link AUTH_SET_PATH}).
 * Compares SHA-256 digests through `timingSafeEqual`.
 */
function cookieCarriesToken(req: IncomingMessage, expectedDigest: Buffer): boolean {
  const cookieHeader = req.headers.cookie
  if (typeof cookieHeader !== 'string') return false
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === DSH_LAN_COOKIE && tokenMatches(part.slice(eq + 1).trim(), expectedDigest)) {
      return true
    }
  }
  return false
}

/**
 * Whether the request already carries the valid secret: the gate cookie, or a
 * `?token=` query on the entry path (the browser handoff form). Both compare
 * SHA-256 digests through `timingSafeEqual`.
 */
function requestCarriesToken(req: IncomingMessage, expectedDigest: Buffer): boolean {
  if (cookieCarriesToken(req, expectedDigest)) return true
  const url = req.url ?? '/'
  const queryAt = url.indexOf('?')
  if (queryAt !== -1) {
    for (const [key, value] of new URLSearchParams(url.slice(queryAt + 1))) {
      if (key === 'token' && tokenMatches(value, expectedDigest)) return true
    }
  }
  return false
}

/** Constant-time comparison of one presented secret against the expected digest. */
function tokenMatches(presented: string, expectedDigest: Buffer): boolean {
  const digest = createHash('sha256').update(presented).digest()
  return digest.length === expectedDigest.length && timingSafeEqual(digest, expectedDigest)
}

/**
 * Whether a TCP peer address is loopback: `127.0.0.0/8`, `::1`, or an
 * IPv4-mapped `::ffff:127.x.x.x` normalized to its IPv4 form. Anything else —
 * LAN addresses included — is not.
 * @param address The socket's real remote address; never a forwarded header value.
 * @returns Whether the address names the local machine's loopback interface.
 */
export function isLoopbackTcpPeer(address: string): boolean {
  const normalized = address.toLowerCase().startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  if (normalized === '::1') return true
  return isIPv4(normalized) && normalized.split('.')[0] === '127'
}

/**
 * Whether a Host header names loopback: `localhost`, an IPv4 address in
 * `127.0.0.0/8`, or bracketed `::1`, each optionally carrying a port. A public
 * hostname over a loopback TCP peer (the reverse-tunnel shape) fails here and
 * the token judgment stays in force.
 * @param host The raw Host header value, port included.
 * @returns Whether the header's host part names loopback.
 */
export function isLoopbackHostHeader(host: string): boolean {
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close === -1) return false
    return host.slice(1, close).toLowerCase() === '::1'
  }
  const colon = host.lastIndexOf(':')
  const port = colon === -1 ? '' : host.slice(colon + 1)
  const name = port !== '' && /^\d+$/.test(port) ? host.slice(0, colon) : host
  if (name.toLowerCase() === 'localhost') return true
  return isIPv4(name) && name.split('.')[0] === '127'
}

/**
 * Whether both halves of the opt-in localhost exemption hold for a request:
 * the socket's real TCP peer is loopback and the Host header names loopback.
 * Forwarded-for headers never enter the decision — only the socket address
 * does — so they cannot manufacture an exemption.
 * @param req The request under judgment.
 * @returns Whether the request qualifies for the `DSH_LAN_TRUST_LOCALHOST` exemption.
 */
function requestIsLocalLoopback(req: IncomingMessage): boolean {
  const remoteAddress = req.socket.remoteAddress
  const host = req.headers.host
  return remoteAddress !== undefined && isLoopbackTcpPeer(remoteAddress)
    && host !== undefined && isLoopbackHostHeader(host)
}

/** Whether `DSH_LAN_TRUST_LOCALHOST` is set to the one enabling value pair. */
function localhostBypassEnabled(): boolean {
  const value = process.env[DSH_LAN_TRUST_LOCALHOST_ENV]
  if (value === undefined) return false
  const normalized = value.toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/** Minimal 401 page: no script, no asset references, no dist path leaks. */
function unauthorizedPage(reason: string): string {
  const body = reason === 'invalid-token'
    ? 'Invalid access token.'
    : 'This dsh web server requires an access token. Append ?token=&lt;token&gt; to the URL once to sign in.'
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>401 Unauthorized</title></head>',
    `<body><h1>401 Unauthorized</h1><p>${body}</p></body>`,
    '</html>',
    '',
  ].join('\n')
}

/** Respond 401 with the placeholder page. The denial is dynamic (it names the gate state), never cacheable. */
function deny(res: ServerResponse, reason: string): void {
  const body = unauthorizedPage(reason)
  res.writeHead(401, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  })
  res.end(body)
}

/**
 * Mark the response uncacheable before the base handlers run. LAN deployments
 * front the server with reverse proxies and tunnels whose edge may cache HTML
 * under an explicit cache rule, and the rendered index embeds live Host state
 * (the boot theme and content font size), so a cached document would serve
 * stale preferences to every reader. Assets are content-hashed and keep their
 * caching. `setHeader` merges with the handlers' own `writeHead` headers, and
 * the name never collides with a base header key.
 * @param req The gated request about to reach the base dispatch.
 * @param res The response the base handlers will write.
 */
function markDocumentUncacheable(req: IncomingMessage, res: ServerResponse): void {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') return
  let pathname = req.url ?? '/'
  const queryAt = pathname.indexOf('?')
  if (queryAt !== -1) pathname = pathname.slice(0, queryAt)
  try {
    pathname = decodeURIComponent(pathname)
  } catch (_malformedEscape) {
    // A path with an invalid escape sequence cannot name the index; judge the raw form below.
  }
  if (pathname === '/' || pathname.toLowerCase().endsWith('.html')) {
    res.setHeader('cache-control', 'no-store')
  }
}

/**
 * The LAN-gated webserver. One composition row replaces the base `webserver`
 * row with this class; the row id stays distinct (`lan-access-webserver`) so
 * the base row is disabled rather than rewritten. Like the base class, the
 * class itself declares no `inject` — the composition row injects
 * `webStartup`, and a hand-built context can construct the class directly.
 */
export class LanAccessWebServer extends WebServer {
  static override Config = lanAccessSchema

  /**
   * Resolve the real bind before the base class snapshots it. The base reads
   * `config.host` for both its `host` getter and `listen`, so the corrected
   * value must reach it through this one object; the Loader hands each
   * activation a freshly interpolated config, so rewriting it here cannot
   * mutate another row's config.
   * @param ctx - the owning context.
   * @param config - the row's resolved config, with the LAN switch already read.
   */
  constructor(ctx: Context, config: Config) {
    config.host = resolveLanBind(config.host, (process.env[DSH_LAN_ENABLED_ENV] ?? '') !== '')
    super(ctx, config)
  }

  /** Digest of the configured token; set once, before any request is served. */
  private tokenDigest: Buffer | undefined

  /** Whether the opt-in localhost exemption (`DSH_LAN_TRUST_LOCALHOST`) is active. */
  private trustLocalhost = false

  /** Whether this instance has wrapped the base dispatch. */
  private gateInstalled = false

  /** Bind through the base, then install the gate when the LAN switch is on. */
  override async [Service.init](): Promise<void> {
    const enabled = (process.env[DSH_LAN_ENABLED_ENV] ?? '') !== ''
    const token = process.env[DSH_LAN_TOKEN_ENV] ?? ''
    if (!enabled) {
      // Fully transparent: no listener stripping, no validation, no throw —
      // the base init alone runs and behavior stays byte-for-byte identical.
      await super[Service.init]()
      return
    }
    if (token === '') {
      // Fail loud: an open all-interfaces bind without a secret must stop the
      // whole tree, not serve one request. installFailLoud reports this.
      throw new Error(`${DSH_LAN_TOKEN_ENV} is required when ${DSH_LAN_ENABLED_ENV} is set; refusing to bind all interfaces without an access token`)
    }
    this.tokenDigest = createHash('sha256').update(token).digest()
    this.trustLocalhost = localhostBypassEnabled()
    await super[Service.init]()
    this.installGate()
  }

  /**
   * Take exclusive dispatch on the base-owned `http.Server`. Ownership note:
   * the base class creates the server in its `Service.init` and registers the
   * teardown effect there; this read reaches the exact same instance through
   * a controlled assertion (the base field is private, and the server exists
   * because `super[Service.init]()` just resolved).
   */
  private installGate(): void {
    if (this.gateInstalled) return
    this.gateInstalled = true
    // The base's only `request` listener is the createServer callback and its
    // only `upgrade` listener is the on('upgrade') registration from the same
    // init; removeAllListeners + re-add is the takeover. A prependListener
    // could not stop an already-registered async handler from running.
    const server = (this as unknown as { server: import('node:http').Server }).server
    const originalRequest = server.listeners('request') as [(req: IncomingMessage, res: ServerResponse) => void]
    const originalUpgrade = server.listeners('upgrade') as [(req: IncomingMessage, socket: Duplex, head: Buffer) => void]
    server.removeAllListeners('request')
    server.removeAllListeners('upgrade')
    server.on('request', (req, res) => {
      try {
        const url = req.url ?? '/'
        if (url === AUTH_SET_PATH || url.startsWith(`${AUTH_SET_PATH}?`)) {
          this.handleAuthSet(req, res)
          return
        }
        const digest = this.tokenDigest
        if (digest === undefined) {
          deny(res, 'no-token')
          return
        }
        // A matching ?token= clears itself by redirecting to the same path
        // without the query. A foreign ?token= on a request already carrying
        // the valid gate cookie falls through untouched: that is stage two of
        // the two-stage entry, handing the host process's own launch token to
        // the upstream browser-auth exchange behind this gate. Without the
        // cookie a foreign token stays refused.
        const queryAt = url.indexOf('?')
        if (queryAt !== -1 && new URLSearchParams(url.slice(queryAt + 1)).has('token')) {
          const presented = new URLSearchParams(url.slice(queryAt + 1)).get('token') ?? ''
          if (tokenMatches(presented, digest)) {
            const pathname = url.slice(0, queryAt)
            res.writeHead(302, {
              'cache-control': 'no-store',
              'set-cookie': `${DSH_LAN_COOKIE}=${presented}; HttpOnly; SameSite=Lax; Path=/`,
              location: pathname === '' ? ROOT_PATH : pathname,
            })
            res.end()
            return
          }
          if (!cookieCarriesToken(req, digest)) {
            deny(res, 'invalid-token')
            return
          }
        }
        // The opt-in localhost exemption skips only this judgment: both the
        // TCP peer and the Host header must be loopback, so the reverse-tunnel
        // shape (loopback peer, public Host) and the LAN shape stay gated. The
        // cookie-entry flows above and the base handlers' Host fence stay in
        // force.
        const localhostExempt = this.trustLocalhost && requestIsLocalLoopback(req)
        if (!localhostExempt && !requestCarriesToken(req, digest)) {
          deny(res, 'no-token')
          return
        }
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        deny(res, 'no-token')
        return
      }
      markDocumentUncacheable(req, res)
      for (const handler of originalRequest) handler(req, res)
    })
    server.on('upgrade', (req, socket, head) => {
      const digest = this.tokenDigest
      const localhostExempt = this.trustLocalhost && requestIsLocalLoopback(req)
      if (digest === undefined || (!localhostExempt && !requestCarriesToken(req, digest))) {
        // Reject before any protocol negotiation: an unauthenticated socket
        // never reaches the registered upgrade handler.
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        socket.destroy()
        return
      }
      for (const handler of originalUpgrade) handler(req, socket, head)
    })
  }

  /**
   * The token-exchange route: validate `?token=`, set the cookie, redirect to
   * `/` with the query cleared. An invalid token answers 401 instead.
   * The response never echoes the token or any URL containing it.
   */
  private handleAuthSet(req: IncomingMessage, res: ServerResponse): void {
    const digest = this.tokenDigest
    const url = req.url ?? '/'
    const queryAt = url.indexOf('?')
    const presented = queryAt === -1
      ? undefined
      : new URLSearchParams(url.slice(queryAt + 1)).get('token') ?? undefined
    if (digest === undefined || presented === undefined) {
      deny(res, 'no-token')
      return
    }
    if (!tokenMatches(presented, digest)) {
      deny(res, 'invalid-token')
      return
    }
    res.writeHead(302, {
      'cache-control': 'no-store',
      'set-cookie': `${DSH_LAN_COOKIE}=${presented}; HttpOnly; SameSite=Lax; Path=/`,
      location: ROOT_PATH,
    })
    res.end()
  }
}

export default LanAccessWebServer
