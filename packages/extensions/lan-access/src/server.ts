/**
 * LAN-access webserver: `WebServer` subclass that binds all interfaces behind
 * a token gate. `DSH_LAN_ENABLED=false` (the default) changes nothing — the
 * base `Service.init` runs alone and every byte of behavior stays the base
 * server's. `DSH_LAN_ENABLED=true` requires `DSH_LAN_TOKEN`, fails the load
 * loudly when it is missing, and otherwise re-wraps the bound `http.Server`'s
 * `request` and `upgrade` dispatch so every path — static assets and
 * `index.html` included — passes the gate before any registered handler runs.
 * The composition's web-app runtime derives the LAN trust fence from the real
 * bind (`resolveLanTrust`), so this package never fakes Host or Origin.
 * @module @deepseek-ai/dsh-host-lan-access
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Service } from '@deepseek-ai/cordis'
import { Config as BaseConfig, WebServer } from '@deepseek-ai/dsh-host-webserver'

/** Environment switch: any non-empty value enables the LAN mode. */
const DSH_LAN_ENABLED_ENV = 'DSH_LAN_ENABLED'
/** Shared-secret environment variable; required once the switch is on. */
const DSH_LAN_TOKEN_ENV = 'DSH_LAN_TOKEN'
/** Cookie carrying the shared secret, set by the `?token=` entry redirect and the /auth-set handshake. */
const DSH_LAN_COOKIE = 'dsh-lan-token'
/** Name the /auth-set handshake redirects back to. */
const ROOT_PATH = '/'
/** The token-exchange route: sets the cookie, then redirects with the query cleared. */
const AUTH_SET_PATH = '/auth-set'

/** Gateway config: the listen address (same fields as the base webserver). */
export type Config = BaseConfig

/** The base schema object, re-declared so the subclass is its own plugin row. */
const lanAccessSchema = WebServer.Config

/**
 * Whether the request already carries the valid secret: the cookie set by
 * the `?token=` entry redirect or {@link AUTH_SET_PATH}, or a `?token=` query
 * on the entry path (the browser handoff form). Both compare SHA-256 digests
 * through `timingSafeEqual`.
 */
function requestCarriesToken(req: IncomingMessage, expectedDigest: Buffer): boolean {
  const cookieHeader = req.headers.cookie
  if (typeof cookieHeader === 'string') {
    for (const part of cookieHeader.split(';')) {
      const eq = part.indexOf('=')
      if (eq === -1) continue
      if (part.slice(0, eq).trim() === DSH_LAN_COOKIE && tokenMatches(part.slice(eq + 1).trim(), expectedDigest)) {
        return true
      }
    }
  }
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

/** Respond 401 with the placeholder page. */
function deny(res: ServerResponse, reason: string): void {
  const body = unauthorizedPage(reason)
  res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(body)) })
  res.end(body)
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

  /** Digest of the configured token; set once, before any request is served. */
  private tokenDigest: Buffer | undefined

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
        // A ?token= on any path clears it by redirecting to the same path
        // without the query; a valid cookie (or a valid ?token= on a non-entry
        // request) passes straight through.
        const queryAt = url.indexOf('?')
        if (queryAt !== -1 && new URLSearchParams(url.slice(queryAt + 1)).has('token')) {
          const presented = new URLSearchParams(url.slice(queryAt + 1)).get('token') ?? ''
          if (tokenMatches(presented, digest)) {
            const pathname = url.slice(0, queryAt)
            res.writeHead(302, {
              'set-cookie': `${DSH_LAN_COOKIE}=${presented}; HttpOnly; SameSite=Lax; Path=/`,
              location: pathname === '' ? ROOT_PATH : pathname,
            })
            res.end()
            return
          }
          deny(res, 'invalid-token')
          return
        }
        if (!requestCarriesToken(req, digest)) {
          deny(res, 'no-token')
          return
        }
      } catch (error) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        deny(res, 'no-token')
        return
      }
      for (const handler of originalRequest) handler(req, res)
    })
    server.on('upgrade', (req, socket, head) => {
      const digest = this.tokenDigest
      if (digest === undefined || !requestCarriesToken(req, digest)) {
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
      'set-cookie': `${DSH_LAN_COOKIE}=${presented}; HttpOnly; SameSite=Lax; Path=/`,
      location: ROOT_PATH,
    })
    res.end()
  }
}

export default LanAccessWebServer
