// Trusted non-loopback Web access persists settings through the authenticated
// API — Host persistence no longer exempts remote pages — so the welcome
// acknowledgement advances durably and stays dismissed after reload.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, webSnapshotMode,
  WELCOME_NOTICE_COPY,
  type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

const MODE = webSnapshotMode()

// Windows Node cannot resolve *.localhost (Chromium maps it itself, which is
// what the scaffold's non-loopback authority relies on); rewrite Node-side
// fetches to the loopback socket the Host fence always trusts.
const REMOTE_AUTHORITY = 'remote.localhost'
const nodeFetch = globalThis.fetch
globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const rewritten = typeof input === 'string'
    ? input.replaceAll(REMOTE_AUTHORITY, '127.0.0.1')
    : input instanceof URL
      ? new URL(input.href.replaceAll(REMOTE_AUTHORITY, '127.0.0.1'))
      : input
  return nodeFetch(rewritten, init)
}

describe.skipIf(MODE === 'record')('web e2e: remote welcome notice', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      remoteAuthority: 'remote.localhost',
      welcomeNoticePending: true,
    })
    browser = await chromium.launch()
    page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('#root', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('advances durably and stays dismissed after reload', async () => {
    const welcome = page.getByRole('dialog', { name: WELCOME_NOTICE_COPY.zh.title })
    await welcome.waitFor({ timeout: 15_000 })
    expect(await page.locator('#root').evaluate(root => (root as HTMLElement).inert)).toBe(true)

    await welcome.getByRole('button', { name: WELCOME_NOTICE_COPY.zh.continueLabel }).click()
    await welcome.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(
      () => page.locator('#root').evaluate(root => (root as HTMLElement).inert),
      { timeout: 15_000 },
    ).toBe(false)

    const reloadWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, reloadWarnings)
    await page.waitForSelector('#root', { timeout: 30_000 })
    await page.waitForFunction(() => {
      const root = document.querySelector('#root')
      return root !== null && !(root as HTMLElement).inert
    }, undefined, { timeout: 15_000 })
    // The acknowledgement survived the reload through the Host settings write.
    await expect.poll(() => welcome.count(), { timeout: 15_000 }).toBe(0)
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
