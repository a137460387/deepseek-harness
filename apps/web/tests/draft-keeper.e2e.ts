// Web e2e scenario: the composer draft survives a page reload (draft-keeper
// plugin). Typing mirrors into localStorage behind the debounce; a reload
// restores the stored text into the empty composer with an info notice;
// clearing the draft removes the entry at once, and a second reload restores
// nothing. The emptied-draft deletion is the same store path a send takes
// (empty draft, empty queue — immediate entry removal), pinned by the unit
// spec; this lane stays zero-model-call like the text-file-cards scenario,
// so the manual clear stands in for the send.
//
// Zero model calls: connecting a workspace and editing the draft are host RPCs
// with no model involvement; a stray stream would fail loud with NO_ADAPTER.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** The draft this scenario types, distinctive enough to grep in storage. */
const DRAFT = 'draft that must survive the reload'

/** The plugin's single localStorage key. */
const STORAGE_KEY = 'dsh.draft-keeper'

/** The restore notice copy (English surface). */
const RESTORE_NOTICE = 'Restored the unsent draft from before the reload'

/** The raw localStorage record (null when nothing is stored). */
function storedRecord(page: Page): Promise<string | null> {
  return page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
}

/** The stored drafts keyed by session id. */
function storedDrafts(page: Page): Promise<Record<string, string>> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw === null ? {} : (JSON.parse(raw) as { drafts: Record<string, string> }).drafts
  }, STORAGE_KEY)
}

describe('web e2e: composer draft persistence', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'draft-keeper')
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('mirrors a typed draft into localStorage behind the debounce', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-draft-keeper-mirror'))
    const composer = page.locator('textarea[data-dsh-composer]')
    await composer.waitFor({ timeout: 10_000 })
    await composer.fill(DRAFT)
    // One non-empty entry for the live session once the debounce window closes.
    await expect.poll(async () => Object.values(await storedDrafts(page)), { timeout: 5_000 })
      .toEqual([DRAFT])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('restores the stored draft with an info notice after a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-draft-keeper-restore'))
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    const composer = page.locator('textarea[data-dsh-composer]')
    await composer.waitFor({ timeout: 30_000 })
    await expect.poll(() => composer.inputValue(), { timeout: 15_000 }).toBe(DRAFT)
    await page.locator('[role="status"]').filter({ hasText: RESTORE_NOTICE }).waitFor({ timeout: 10_000 })
    // The restored text is the live draft now; the entry stays beneath it.
    await expect.poll(async () => Object.values(await storedDrafts(page)), { timeout: 5_000 })
      .toEqual([DRAFT])
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('clearing the draft drops the entry at once and a reload restores nothing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-draft-keeper-clear'))
    const composer = page.locator('textarea[data-dsh-composer]')
    await composer.fill('')
    // The deletion is immediate — no debounce window to wait out.
    await expect.poll(() => storedRecord(page), { timeout: 5_000 }).toBeNull()
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await composer.waitFor({ timeout: 30_000 })
    // The composer stays empty and no restore notice appears.
    await expect.poll(() => composer.inputValue(), { timeout: 3_000 }).toBe('')
    expect(await page.locator(`[role="status"]:has-text("${RESTORE_NOTICE}")`).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
