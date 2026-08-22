// Web e2e scenario: the in-conversation find bar (find-in-chat plugin).
// Ctrl+F opens the top bar over a seeded long session; matching runs over
// the loaded window (code-block text included), Enter/Shift+Enter wrap
// around with the count live, the active match centers in the scrollport
// and paints CSS Custom Highlights (asserted through the real chromium
// registry, not jsdom), the coverage note reports the unloaded earlier
// pages, Esc closes and clears, a session switch auto-closes, and the
// composer stays visible and editable while the bar is open.
// Zero model calls: the seeded fixtures are closed recordings; a stray
// stream would fail loud with NO_ADAPTER.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture, type ChatScrollFixture } from './chat-scroll-fixture.ts'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

/** 30 closed turns = 60 messages: one message over the 50-message first page. */
const HISTORY = createChatScrollFixture({ markerPrefix: 'FIND', title: 'FIND_IN_CHAT long session', turns: 30 })
/** 4 closed turns: fully inside the first page, for the switch-close case. */
const SWITCH = createChatScrollFixture({ markerPrefix: 'SWITCH', title: 'FIND_IN_CHAT switch session', turns: 4 })
const HISTORY_ID = 'find-in-chat-history-e2e'
const SWITCH_ID = 'find-in-chat-switch-e2e'

/** The bar and its input, addressed through the plugin's stable markers. */
const bar = (page: Page) => page.locator('[data-find-in-chat-bar]')
const findInput = (page: Page) => bar(page).locator('input')
const count = (page: Page) => bar(page).locator('[aria-live="polite"]')

/** Open the bar with the interception chord. */
async function openFind(page: Page): Promise<void> {
  await page.keyboard.press('Control+f')
  await bar(page).waitFor({ timeout: 10_000 })
}

/** Open one seeded session through the sidebar search flow. */
async function openSession(page: Page, fixture: ChatScrollFixture): Promise<void> {
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(fixture.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(async () => results.count(), { timeout: 60_000 }).toBe(1)
  await results.click()
  await page.getByText(fixture.markers.assistant(fixture.turns)).waitFor({ timeout: 30_000 })
}

/** The size of one highlight register in the live chromium registry. */
function highlightSize(page: Page, name: string): Promise<number> {
  return page.evaluate((key: string) => {
    const group = CSS.highlights?.get(key)
    return group === undefined ? 0 : group.size
  }, name)
}

describe('web e2e: in-conversation find bar', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, HISTORY.log, HISTORY_ID)
    await seedSession(scaffold, SWITCH.log, SWITCH_ID)
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

  /** The bar's n/m pair as numbers. */
  async function readCount(page: Page): Promise<{ readonly current: number; readonly total: number }> {
    const text = await count(page).textContent()
    const parts = (text ?? '').split('/')
    return { current: Number(parts[0]), total: Number(parts[1]) }
  }

  it('finds, counts, highlights, and scrolls to matches in the loaded window', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-find-in-chat-search'))
    await openSession(page, HISTORY)
    await openFind(page)
    // The marker head prefixes many turns; the exact count is the bar's to
    // say — the assertions check consistency against the live registry.
    await findInput(page).fill('CHAT_SCROLL_FIND_ASSISTANT_0')
    await expect.poll(async () => (await readCount(page)).current).toBe(1)
    const head = await readCount(page)
    expect(head.total).toBeGreaterThan(1)
    // 60 seeded messages exceed the 50-message first page.
    await bar(page).getByText(/earlier messages not loaded/).waitFor({ timeout: 5_000 })
    expect(await highlightSize(page, 'dsh-find-in-chat-all')).toBe(head.total)
    expect(await highlightSize(page, 'dsh-find-in-chat-active')).toBe(1)
    // Code-block text matches like any prose, uniquely.
    await findInput(page).fill('scroll_case_022_00')
    await expect.poll(async () => (await readCount(page)).total).toBe(1)
    // Stepping centers the next match in the conversation scrollport.
    await findInput(page).fill('CHAT_SCROLL_FIND_ASSISTANT_0')
    await expect.poll(async () => (await readCount(page)).current).toBe(1)
    const port = page.locator('[data-conversation-scroll]')
    const before = await port.evaluate(el => el.scrollTop)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readCount(page)).current).toBe(2)
    await expect.poll(async () => port.evaluate(el => el.scrollTop), { timeout: 5_000 }).not.toBe(before)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('wraps around in both directions', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-find-in-chat-wrap'))
    // The previous case leaves the bar open mid-list; close for a fresh head.
    if (await bar(page).isVisible()) {
      await page.keyboard.press('Escape')
      await bar(page).waitFor({ state: 'hidden', timeout: 5_000 })
    }
    await openFind(page)
    await findInput(page).fill('CHAT_SCROLL_FIND_ASSISTANT_0')
    await expect.poll(async () => (await readCount(page)).current).toBe(1)
    const { total } = await readCount(page)
    await page.keyboard.press('Shift+Enter')
    await expect.poll(async () => (await readCount(page)).current).toBe(total)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await readCount(page)).current).toBe(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('closes on Escape, clears the highlights, and reopens on the chord', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-find-in-chat-escape'))
    await openFind(page)
    await findInput(page).fill('CHAT_SCROLL_FIND_ASSISTANT_0')
    await expect.poll(async () => (await readCount(page)).total).toBeGreaterThan(1)
    const { total } = await readCount(page)
    expect(await highlightSize(page, 'dsh-find-in-chat-all')).toBe(total)
    await page.keyboard.press('Escape')
    await bar(page).waitFor({ state: 'hidden', timeout: 5_000 })
    expect(await highlightSize(page, 'dsh-find-in-chat-all')).toBe(0)
    expect(await highlightSize(page, 'dsh-find-in-chat-active')).toBe(0)
    await openFind(page)
    await bar(page).waitFor({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('closes when the current session switches', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-find-in-chat-switch'))
    await openFind(page)
    await findInput(page).fill('CHAT_SCROLL')
    await bar(page).waitFor({ timeout: 5_000 })
    await openSession(page, SWITCH)
    await bar(page).waitFor({ state: 'hidden', timeout: 5_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the composer visible and editable while open', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-find-in-chat-composer'))
    await openFind(page)
    await findInput(page).fill('CHAT_SCROLL')
    const composer = page.locator('textarea[data-dsh-composer]')
    await composer.waitFor({ timeout: 10_000 })
    const box = await composer.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeLessThan(page.viewportSize()!.height)
    await composer.fill('still typing while finding')
    await expect.poll(() => composer.inputValue()).toBe('still typing while finding')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
