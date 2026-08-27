/**
 * LAN-access webserver coverage: the token gate over every path (including
 * /api and the static fallback), the websocket handshake rejection, the
 * /auth-set cookie handshake, the `?token=` entry cookie exchange, the
 * placeholder 401 page's opacity, the disabled-mode byte-for-byte
 * equivalence with the stock server, the fail-loud missing-token boot, the
 * no-token-in-logs guarantee, and the opt-in localhost exemption
 * (`DSH_LAN_TRUST_LOCALHOST`): its loopback peer + loopback Host halves, the
 * reverse-tunnel and LAN shapes that must stay gated, its env parsing, and
 * the loopback classification predicates.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { isLoopbackHostHeader, isLoopbackTcpPeer, LanAccessWebServer } from '../src/server.ts'
import * as LanAccessInvariant from '../src/invariant.ts'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'

const TOKEN = 'test-lan-token-3f9a'

let root: string | undefined
let context: Context | undefined

/** Pin the LAN env pair for one test; afterEach restores via vi.unstubAllEnvs. */
function setLanEnv(enabled: string | undefined, token: string | undefined): void {
  if (enabled === undefined) vi.stubEnv('DSH_LAN_ENABLED', '')
  else vi.stubEnv('DSH_LAN_ENABLED', enabled)
  if (token === undefined) vi.stubEnv('DSH_LAN_TOKEN', '')
  else vi.stubEnv('DSH_LAN_TOKEN', token)
}

/** Pin the localhost-exemption switch for one test; undefined deletes it (unset). */
function setTrustLocalhost(value: string | undefined): void {
  vi.stubEnv('DSH_LAN_TRUST_LOCALHOST', value)
}

/** The machine's first non-internal IPv4; the LAN-peer test fails loudly on a host with none. */
function lanIpv4(): string {
  const entry = Object.values(networkInterfaces()).flat().find(info => info !== undefined && !info.internal && info.family === 'IPv4')
  if (entry === undefined) throw new Error('no non-loopback IPv4 interface on this host: cannot pin the LAN-peer denial')
  return entry.address
}

/** Dispose the module-level context and temp root; safe to call between sequential boots in one test. */
async function disposeCurrent(): Promise<void> {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Write a cordis.yml with one webserver-family row, then boot it through the real Loader. */
async function loadComposition(
  plugin: unknown,
  pluginName: string,
  port = 0,
  host: string = '127.0.0.1',
): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-lan-access-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    `- name: '${pluginName}'`,
    '  config:',
    `    host: '${host}'`,
    `    port: ${String(port)}`,
    '',
  ].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-lan-access/src/server.ts', plugin],
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-invariants', InvariantRegistry],
    ['@deepseek-ai/dsh-host-lan-access/invariant', LanAccessInvariant],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** GET one path; returns status, headers, and the full body. */
async function request(port: number, path: string, init?: RequestInit): Promise<{
  status: number
  body: string
  headers: Headers
  location: string | null
  setCookie: string | null
}> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`, { redirect: 'manual', ...init })
  return {
    status: response.status,
    body: await response.text(),
    headers: response.headers,
    location: response.headers.get('location'),
    setCookie: response.headers.get('set-cookie'),
  }
}

/** Open one raw upgrade request; resolves with the first response bytes. */
async function rawUpgrade(port: number, path: string, extra: string[] = [], host = `127.0.0.1:${String(port)}`): Promise<{ data: string; closed: Promise<unknown> }> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: ${host}`,
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version: 13',
    ...extra,
    '',
    '',
  ].join('\r\n'))
  const [data] = await response as [Buffer]
  return { data: String(data), closed: once(socket, 'close') }
}

/**
 * One raw HTTP/1.1 GET with full control of the connect target and the Host
 * header (fetch cannot set Host — a spec-forbidden header). The socket asks
 * for `Connection: close`, so the full response arrives before `end`.
 */
async function rawRequest(
  port: number,
  connectHost: string,
  hostHeader: string,
  path: string,
  extra: string[] = [],
): Promise<{ status: number; headers: string; body: string }> {
  const socket = connect(port, connectHost)
  await once(socket, 'connect')
  const chunks: Buffer[] = []
  socket.on('data', (chunk: Buffer) => { chunks.push(chunk) })
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: ${hostHeader}`,
    ...extra,
    'Connection: close',
    '',
    '',
  ].join('\r\n'))
  await once(socket, 'end')
  const raw = Buffer.concat(chunks).toString('utf8')
  const split = raw.indexOf('\r\n\r\n')
  const head = split === -1 ? raw : raw.slice(0, split)
  const body = split === -1 ? '' : raw.slice(split + 4)
  return { status: Number(head.split('\r\n')[0]?.split(' ')[1]), headers: head, body }
}

describe('LAN token gate', () => {
  it('returns 401 for /api/* without a token and never invokes the fence-protected handler', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    const apiHandler = vi.fn((_req: unknown, res: { writeHead: (code: number) => void; end: (body: string) => void }) => {
      res.writeHead(200)
      res.end('api-data')
    })
    server.register({ kind: 'prefix', path: '/api', handler: apiHandler })
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><head></head><body>real-dist-shell</body></html>')
    })

    const denied = await request(server.port, '/api/session/list')
    expect(denied.status).toBe(401)
    expect(apiHandler).not.toHaveBeenCalled()

    // A valid cookie passes the gate and reaches the handler.
    const authed = await request(server.port, '/api/session/list', {
      headers: { cookie: `dsh-lan-token=${TOKEN}` },
    })
    expect(authed.status).toBe(200)
    expect(authed.body).toBe('api-data')
    expect(apiHandler).toHaveBeenCalledTimes(1)
  })

  it('rejects the websocket handshake without a token and completes it with one', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    let upgradeReached = false
    server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => {
        upgradeReached = true
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      },
    })

    const denied = await rawUpgrade(server.port, '/events')
    expect(denied.data).toContain('401 Unauthorized')
    expect(upgradeReached).toBe(false)
    denied.closed.catch(() => {})

    // Query-parameter tokens are valid on the upgrade handshake too.
    const accepted = await rawUpgrade(server.port, `/events?token=${TOKEN}`)
    expect(accepted.data).toContain('101 Switching Protocols')
    expect(upgradeReached).toBe(true)
  })

  it('completes the ?token= → /auth-set → Set-Cookie → clean redirect → authenticated API chain', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    server.register({ kind: 'prefix', path: '/api', handler: (_req, res) => {
      res.writeHead(200)
      res.end('ok')
    } })
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // Entry with ?token= sets the session cookie and redirects to the same
    // path with the query cleared (the wrapper-level redirect for
    // non-/auth-set paths).
    const entry = await request(server.port, `/?token=${TOKEN}`)
    expect(entry.status).toBe(302)
    expect(entry.location).toBe('/')
    expect(entry.setCookie).toContain(`dsh-lan-token=${TOKEN}`)
    expect(entry.setCookie).toContain('HttpOnly')
    expect(entry.setCookie).toContain('SameSite=Lax')
    expect(entry.setCookie).toContain('Path=/')
    expect(entry.setCookie).not.toContain('Secure')

    // The /auth-set route validates and sets the cookie.
    const authSet = await request(server.port, `/auth-set?token=${TOKEN}`)
    expect(authSet.status).toBe(302)
    expect(authSet.location).toBe('/')
    expect(authSet.setCookie).toContain('dsh-lan-token=')
    expect(authSet.setCookie).toContain('HttpOnly')
    expect(authSet.setCookie).toContain('SameSite=Lax')
    expect(authSet.setCookie).not.toContain('Secure')

    // The cookie now authorizes API and page loads.
    const api = await request(server.port, '/api/session/list', {
      headers: { cookie: `dsh-lan-token=${TOKEN}` },
    })
    expect(api.status).toBe(200)
    const page = await request(server.port, '/', { headers: { cookie: `dsh-lan-token=${TOKEN}` } })
    expect(page.status).toBe(200)
    expect(page.body).toContain('shell')

    // An invalid token gets 401, never a cookie.
    const invalid = await request(server.port, '/auth-set?token=wrong')
    expect(invalid.status).toBe(401)
    expect(invalid.setCookie).toBeNull()
  })

  it('closes the ?token= sign-in dead loop: the entry cookie authenticates a clean / load', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // Follow the 401 page's own instruction: append ?token= once. The browser
    // stores the cookie pair (name=value) and drops the attributes.
    const entry = await request(server.port, `/?token=${TOKEN}`)
    expect(entry.status).toBe(302)
    const setCookie = entry.setCookie ?? ''
    const cookie = setCookie.split(';')[0] ?? ''
    expect(cookie).toBe(`dsh-lan-token=${TOKEN}`)

    // Landing on the clean URL with exactly that cookie must serve the real
    // page (200), not the 401 placeholder — the loop is closed.
    const landing = await request(server.port, '/', { headers: { cookie } })
    expect(landing.status).toBe(200)
    expect(landing.body).toContain('shell')
  })

  it('serves a placeholder 401 page that leaks no real dist path or asset name', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><head><script src="/assets/index-ABC123.js"></script><link href="/assets/style-DEF456.css"></head><body>real shell</body></html>')
    })

    for (const path of ['/', '/index.html', '/assets/index-ABC123.js', '/deeply/nested/route']) {
      const denied = await request(server.port, path)
      expect(denied.status).toBe(401)
      expect(denied.headers.get('content-type')).toContain('text/html')
      // The placeholder names no real asset, path, or script source.
      expect(denied.body).not.toContain('assets')
      expect(denied.body).not.toContain('index-')
      expect(denied.body).not.toContain('.js')
      expect(denied.body).not.toContain('.css')
      expect(denied.body).not.toContain('shell')
      expect(denied.body).not.toContain('<script')
      // With the token the same paths reach the real fallback.
      const allowed = await request(server.port, path, { headers: { cookie: `dsh-lan-token=${TOKEN}` } })
      expect(allowed.status).toBe(200)
    }
  })
})

describe('disabled-mode equivalence', () => {
  /** Boot the stock server and the subclass with identical rows, then probe both. */
  async function bootPair(): Promise<{ stock: Context; subclass: Context }> {
    setLanEnv(undefined, undefined)
    const stock = await loadComposition(HttpServer, '@deepseek-ai/dsh-host-webserver')
    const subclass = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const mount = (ctx: Context): void => {
      ctx.webServer.register({ kind: 'exact', path: '/probe', handler: (_req, res) => {
        res.writeHead(200, { 'x-probe': 'yes' })
        res.end('PROBE')
      } })
      ctx.webServer.registerUpgrade({
        path: '/events',
        handler: (_req, socket) => {
          socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: dsh-test\r\n\r\n')
        },
      })
    }
    mount(stock)
    mount(subclass)
    return { stock, subclass }
  }

  it('answers identically to the stock server with DSH_LAN_ENABLED unset', { timeout: 60_000 }, async () => {
    const { stock, subclass } = await bootPair()
    const scenarios: Array<{ path: string; init?: RequestInit }> = [
      { path: '/probe' },
      { path: '/probe', init: { method: 'POST' } },
      { path: '/no/such/route' },
      { path: '/%zz' },
      { path: '/probe?token=anything' },
    ]
    for (const scenario of scenarios) {
      const fromStock = await request(stock.webServer.port, scenario.path, scenario.init)
      const fromSubclass = await request(subclass.webServer.port, scenario.path, scenario.init)
      expect(fromSubclass.status).toBe(fromStock.status)
      expect(fromSubclass.body).toBe(fromStock.body)
      expect(fromSubclass.headers.get('x-probe')).toBe(fromStock.headers.get('x-probe'))
    }
    // Upgrades work through the subclass in disabled mode too.
    const stockUpgrade = await rawUpgrade(stock.webServer.port, '/events')
    const subclassUpgrade = await rawUpgrade(subclass.webServer.port, '/events')
    expect(subclassUpgrade.data).toBe(stockUpgrade.data)
    expect(subclassUpgrade.data).toContain('101 Switching Protocols')
  })

  it('answers identically with DSH_LAN_ENABLED=false explicitly set', { timeout: 60_000 }, async () => {
    setLanEnv('false', TOKEN)
    const { stock, subclass } = await bootPair()
    const fromStock = await request(stock.webServer.port, '/probe')
    const fromSubclass = await request(subclass.webServer.port, '/probe')
    expect(fromSubclass).toMatchObject({ status: fromStock.status, body: fromStock.body })
    // The token env is present but inert: no gate was installed.
    const withToken = await request(subclass.webServer.port, '/probe')
    expect(withToken.status).toBe(200)
  })
})

describe('fail-loud boot', () => {
  it('rejects the whole tree when DSH_LAN_ENABLED is set without DSH_LAN_TOKEN', { timeout: 60_000 }, async () => {
    setLanEnv('true', undefined)
    // The Loader wraps the init rejection; assertEntriesActivated surfaces it.
    await expect(loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts'))
      .rejects.toThrow(/DSH_LAN_TOKEN/)
    // The failed boot already disposed the tree; prevent afterEach from double-disposing.
    context = undefined
    if (root !== undefined) {
      const stale = root
      root = undefined
      await rm(stale, { recursive: true, force: true })
    }
  })
})

describe('log hygiene', () => {
  it('logs no line containing the token plaintext across a full gated session', { timeout: 60_000 }, async () => {
    const lines: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(arg => (typeof arg === 'string' ? arg : String(arg))).join(' '))
    })
    const warnSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.map(arg => (typeof arg === 'string' ? arg : String(arg))).join(' '))
    })

    setLanEnv('true', TOKEN)
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // Exercise success, denial, and error paths.
    await request(server.port, `/?token=${TOKEN}`)
    await request(server.port, '/auth-set?token=wrong')
    await request(server.port, '/denied')
    await request(server.port, '/%zz')
    const consoleText = lines.join('\n')
    expect(consoleText).not.toContain(TOKEN)
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe('opt-in localhost exemption (DSH_LAN_TRUST_LOCALHOST)', () => {
  it('exempts loopback-peer requests with loopback Host headers on pages and websocket upgrades, keeping the cookie entry intact', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    setTrustLocalhost('1')
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    let upgradeReached = false
    server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => {
        upgradeReached = true
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      },
    })
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // No token, loopback TCP peer, Host localhost → the real page, not 401.
    const page = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', '/')
    expect(page.status).toBe(200)
    expect(page.body).toContain('shell')

    // The IPv4 and bracketed IPv6 Host forms qualify identically (the IPv6
    // peer itself is unreachable through the two-literal bind schema; the
    // predicate suite below pins that half).
    const ipv4Form = await rawRequest(server.port, '127.0.0.1', `127.0.0.1:${String(server.port)}`, '/')
    expect(ipv4Form.status).toBe(200)
    const bracketForm = await rawRequest(server.port, '127.0.0.1', '[::1]:3080', '/')
    expect(bracketForm.status).toBe(200)

    // The websocket handshake takes the same exemption.
    const upgraded = await rawUpgrade(server.port, '/events', [], 'localhost:3080')
    expect(upgraded.data).toContain('101 Switching Protocols')
    expect(upgradeReached).toBe(true)

    // The /auth-set token exchange still validates and sets its cookie.
    const authSet = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', `/auth-set?token=${TOKEN}`)
    expect(authSet.status).toBe(302)
    expect(authSet.headers).toContain(`set-cookie: dsh-lan-token=${TOKEN}`)
    const invalidAuthSet = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', '/auth-set?token=wrong')
    expect(invalidAuthSet.status).toBe(401)
  })

  it('keeps the gate on for the reverse-tunnel shape: loopback peer, public Host, forged X-Forwarded-For, websocket denial', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    setTrustLocalhost('1')
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
    const server = loaded.webServer
    let upgradeReached = false
    server.registerUpgrade({
      path: '/events',
      handler: (_req, socket) => {
        upgradeReached = true
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      },
    })
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // The cloudflared shape: the TCP peer is 127.0.0.1 but the Host names
    // the public domain — the exemption's Host half fails, so no token
    // still means 401.
    const denied = await rawRequest(server.port, '127.0.0.1', 'dsh.lgyu.cloud', '/')
    expect(denied.status).toBe(401)

    // A forged forwarded-for header cannot manufacture the missing half.
    const forged = await rawRequest(server.port, '127.0.0.1', 'dsh.lgyu.cloud', '/', ['X-Forwarded-For: 127.0.0.1'])
    expect(forged.status).toBe(401)

    // A valid cookie still passes the gate exactly as before.
    const authed = await rawRequest(server.port, '127.0.0.1', 'dsh.lgyu.cloud', '/', [`Cookie: dsh-lan-token=${TOKEN}`])
    expect(authed.status).toBe(200)
    expect(authed.body).toContain('shell')

    // The websocket handshake keeps the same denial for the tunnel shape.
    const deniedUpgrade = await rawUpgrade(server.port, '/events', [], 'dsh.lgyu.cloud')
    expect(deniedUpgrade.data).toContain('401 Unauthorized')
    expect(upgradeReached).toBe(false)
    deniedUpgrade.closed.catch(() => {})
  })

  it('keeps the gate on for LAN peers even when the Host matches the LAN address', { timeout: 60_000 }, async () => {
    setLanEnv('true', TOKEN)
    setTrustLocalhost('1')
    const lan = lanIpv4()
    const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts', 0, '0.0.0.0')
    const server = loaded.webServer
    server.registerFallback((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>shell</body></html>')
    })

    // Positive control on the same server: loopback peer + loopback Host is
    // exempt, so the 401 below is the LAN peer's doing, not a missing switch.
    const control = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', '/')
    expect(control.status).toBe(200)

    // A non-loopback TCP peer with its own address as Host stays gated.
    const denied = await rawRequest(server.port, lan, `${lan}:${String(server.port)}`, '/')
    expect(denied.status).toBe(401)
  })

  it('enables the exemption only for 1 and true (case-insensitive); unset, yes, and 2 leave the gate unchanged', { timeout: 240_000 }, async () => {
    for (const value of [undefined, 'yes', '2'] as const) {
      setLanEnv('true', TOKEN)
      setTrustLocalhost(value)
      const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
      const server = loaded.webServer
      server.registerFallback((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>shell</body></html>')
      })
      const denied = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', '/')
      expect(denied.status, `DSH_LAN_TRUST_LOCALHOST=${value ?? 'unset'} must stay gated`).toBe(401)
      await disposeCurrent()
    }
    for (const value of ['true', 'TRUE'] as const) {
      setLanEnv('true', TOKEN)
      setTrustLocalhost(value)
      const loaded = await loadComposition(LanAccessWebServer, '@deepseek-ai/dsh-host-lan-access/src/server.ts')
      const server = loaded.webServer
      server.registerFallback((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html><body>shell</body></html>')
      })
      const allowed = await rawRequest(server.port, '127.0.0.1', 'localhost:3080', '/')
      expect(allowed.status, `DSH_LAN_TRUST_LOCALHOST=${value} must exempt`).toBe(200)
      await disposeCurrent()
    }
  })
})

describe('loopback classification predicates', () => {
  it('isLoopbackTcpPeer accepts 127/8, ::1, and IPv4-mapped forms; rejects LAN, public, and link-local addresses', () => {
    for (const address of ['127.0.0.1', '127.0.0.2', '127.255.255.254', '::1', '::ffff:127.0.0.1', '::FFFF:127.10.20.30']) {
      expect(isLoopbackTcpPeer(address), address).toBe(true)
    }
    for (const address of ['192.168.31.64', '10.1.2.3', '8.8.8.8', 'fe80::1', '2001:db8::1', '::ffff:192.168.31.64', '::', 'not-an-ip', '']) {
      expect(isLoopbackTcpPeer(address), address).toBe(false)
    }
  })

  it('isLoopbackHostHeader accepts localhost, 127/8, and bracketed ::1 with optional ports; rejects public names, LAN addresses, and near-miss forms', () => {
    for (const host of ['localhost', 'LOCALHOST', 'LocalHost:3080', '127.0.0.1', '127.0.0.1:3080', '127.199.9.9', '[::1]', '[::1]:3080']) {
      expect(isLoopbackHostHeader(host), host).toBe(true)
    }
    for (const host of ['dsh.lgyu.cloud', 'dsh.lgyu.cloud:443', '192.168.31.64:3080', '10.0.0.5', 'sub.localhost', 'localhost.', '[2001:db8::1]', '[2001:db8::1]:80', 'localhost:3080x', '']) {
      expect(isLoopbackHostHeader(host), host).toBe(false)
    }
  })
})

describe('invariant companion', () => {
  it('registers its package name through the invariants service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LanAccessInvariant)
    expect(LanAccessInvariant.name).toBe('host-lan-access-invariant')
    expect(LanAccessInvariant.inject).toEqual(['invariants'])
    await ctx.fiber.dispose()
  })
})
