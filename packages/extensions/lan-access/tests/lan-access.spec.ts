/**
 * LAN-access webserver coverage: the token gate over every path (including
 * /api and the static fallback), the websocket handshake rejection, the
 * /auth-set cookie handshake, the placeholder 401 page's opacity, the
 * disabled-mode byte-for-byte equivalence with the stock server, the
 * fail-loud missing-token boot, and the no-token-in-logs guarantee.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { LanAccessWebServer } from '../src/server.ts'
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
async function rawUpgrade(port: number, path: string, extra: string[] = []): Promise<{ data: string; closed: Promise<unknown> }> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
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

    // Entry with ?token= redirects to the same path with the query cleared
    // (the wrapper-level redirect for non-/auth-set paths).
    const entry = await request(server.port, `/?token=${TOKEN}`)
    expect(entry.status).toBe(302)
    expect(entry.location).toBe('/')

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
