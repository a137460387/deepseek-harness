// Web e2e scenario: the draft-budget dock readout (draft-budget plugin).
// The replay lane's pressure projection carries no route capacity (probed
// 2026-08-23: the chip reports data-draft-budget="tokens" with no window
// figures), so this lane pins the tokens-only branch — the exact folded
// estimate for deterministic drafts, the debounced growth while typing,
// the disappearance on clear, and the composer value staying intact. The
// full branch's percentage math is pinned by the unit spec over scripted
// projections. Zero model calls: the seeded fixture is a closed recording.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = createChatScrollFixture({ markerPrefix: 'BUDGET', title: 'DRAFT_BUDGET readout session', turns: 6 })
const SESSION_ID = 'draft-budget-readout-e2e'

/** The chip and its state, addressed through the plugin's stable marker. */
const chip = (page: Page) => page.locator('[data-draft-budget]')

/** Open the seeded session through the sidebar search flow. */
async function openSession(page: Page): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(async () => results.count(), { timeout: 60_000 }).toBe(1)
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(6)).waitFor({ timeout: 30_000 })
}

describe('web e2e: draft-budget dock readout', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('estimates the typed draft in the tokens-only branch', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-draft-budget-tokens'))
    await openSession(page)
    const composer = page.locator('textarea[data-dsh-composer]')
    await composer.waitFor({ timeout: 10_000 })
    // 40 chars: ceil(40/4) + 8 = 18.
    await composer.fill('a'.repeat(40))
    await chip(page).waitFor({ timeout: 5_000 })
    await expect.poll(async () => chip(page).getAttribute('data-draft-budget')).toBe('tokens')
    expect(await chip(page).textContent()).toBe('~18 tok')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('grows with the draft behind the debounce and clears with it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-draft-budget-grow'))
    const composer = page.locator('textarea[data-dsh-composer]')
    // 120 chars: ceil(120/4) + 8 = 38.
    await composer.fill('b'.repeat(120))
    await expect.poll(async () => chip(page).textContent(), { timeout: 5_000 }).toBe('~38 tok')
    await composer.fill('')
    await chip(page).waitFor({ state: 'hidden', timeout: 5_000 })
    expect(await composer.inputValue()).toBe('')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
