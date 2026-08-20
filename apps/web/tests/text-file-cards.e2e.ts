// Web e2e scenario: text-file drops stage as cards over the composer instead
// of flooding the draft (text-file-cards plugin), while whole-page paste keeps
// routing into the draft (global-paste plugin). A card click expands `# name`
// plus the content at the draft end; the close button unstages without
// touching the draft; oversized files are refused with an input notice;
// images and mixed batches pass through to the composer's native intake.
//
// Zero model calls: connecting a workspace and editing the draft are host RPCs
// with no model involvement; a stray stream would fail loud with NO_ADAPTER.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

/** The composer's format-rejection toast copy (English surface). */
const IMAGE_TOAST = 'Only PNG, JPG, WebP, and GIF images are supported'

/** File size ceiling mirrored from the plugin (100 KB). */
const MAX_FILE_BYTES = 100 * 1024

/** A file to drop, as the synthetic DataTransfer builds it. */
interface DroppedFile {
  name: string
  content: string
  type: string
}

/** Whether anything prevented each synthetic drag event's default. */
interface DropFlags {
  overPrevented: boolean
  dropPrevented: boolean
}

/**
 * Drop one file onto the given selector the way the OS would: a
 * dragover-then-drop pair carrying a real `DataTransfer` with a `File` item.
 * Chromium honors script-built DataTransfers on synthetic drag events, so the
 * drop handler reads `files` exactly as it does for a trusted drop.
 * @param page - the page under test.
 * @param targetSelector - element the drop lands on.
 * @param file - the dropped file.
 * @returns whether anything prevented each event's default.
 */
async function dropFile(page: Page, targetSelector: string, file: DroppedFile): Promise<DropFlags> {
  return await page.evaluate(({ targetSelector, file }) => {
    const target = document.querySelector(targetSelector)
    if (target === null) throw new Error(`drop target not found: ${targetSelector}`)
    const dt = new DataTransfer()
    dt.items.add(new File([file.content], file.name, { type: file.type }))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(over)
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(drop)
    return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented }
  }, { targetSelector, file })
}

describe('web e2e: text-file drop staging cards', () => {
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
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'text-file-cards')
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('still routes a page-level text paste into the draft (global-paste alive)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-paste'))
    // Blur whatever holds focus so the document-level capture listener owns
    // the paste (a focused composer would take the native path instead).
    await page.evaluate(() => {
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      const data = new DataTransfer()
      data.setData('text/plain', 'pasted before the drop')
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await page.waitForFunction(() => {
      const composer = document.querySelector('textarea[data-dsh-composer]')
      return composer !== null && (composer as HTMLTextAreaElement).value === 'pasted before the drop'
    }, undefined, { timeout: 5_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('stages a text file dropped on the conversation area as a card, not draft text', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-stage'))
    const flags = await dropFile(page, '[data-conversation-scroll]', { name: 'note.txt', content: 'hello from the dropped file', type: 'text/plain' })
    expect(flags.overPrevented).toBe(true)
    expect(flags.dropPrevented).toBe(true)
    await page.locator('[data-text-file-cards]').waitFor({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Insert file note.txt into the draft' }).waitFor({ timeout: 5_000 })
    // The draft stays clean: staging never inlines the content.
    expect(await page.locator('textarea[data-dsh-composer]').inputValue()).toBe('pasted before the drop')
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('expands the card into the draft on click and removes it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-expand'))
    await page.getByRole('button', { name: 'Insert file note.txt into the draft' }).click()
    await page.waitForFunction(() => {
      const composer = document.querySelector('textarea[data-dsh-composer]')
      return composer !== null && (composer as HTMLTextAreaElement).value.includes('# note.txt')
    }, undefined, { timeout: 5_000 })
    expect(await page.locator('textarea[data-dsh-composer]').inputValue())
      .toBe('pasted before the drop\n# note.txt\nhello from the dropped file')
    await page.locator('[data-text-file-cards]').waitFor({ state: 'detached', timeout: 5_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('unstages a card through its close button without touching the draft', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-remove'))
    const before = await page.locator('textarea[data-dsh-composer]').inputValue()
    await dropFile(page, '[data-conversation-scroll]', { name: 'spare.md', content: 'discard me', type: 'text/markdown' })
    await page.locator('[data-text-file-cards]').waitFor({ timeout: 5_000 })
    await page.getByRole('button', { name: 'Remove file spare.md' }).click()
    await page.locator('[data-text-file-cards]').waitFor({ state: 'detached', timeout: 5_000 })
    expect(await page.locator('textarea[data-dsh-composer]').inputValue()).toBe(before)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('refuses an oversized file with an input notice and stages nothing', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-oversized'))
    const oversized = 'x'.repeat(MAX_FILE_BYTES + 1)
    await dropFile(page, '[data-conversation-scroll]', { name: 'big.txt', content: oversized, type: 'text/plain' })
    // Error notices render as Toast banners (role=alert) since rc.8.
    await page.getByRole('alert').filter({ hasText: 'were not added' }).waitFor({ timeout: 5_000 })
    expect(await page.locator('[data-text-file-cards]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('leaves an image drop to the native intake (no card, no takeover)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-text-cards-image'))
    const before = await page.locator('textarea[data-dsh-composer]').inputValue()
    const pngBytes = String.fromCharCode(137, 80, 78, 71)
    await dropFile(page, '[data-conversation-scroll]', { name: 'pixel.png', content: pngBytes, type: 'image/png' })
    // The native intake owns the batch: the card row never appears, and the
    // image lands in the attachment rail instead of the draft.
    await page.getByAltText('pixel.png').waitFor({ timeout: 5_000 })
    expect(await page.locator('[data-text-file-cards]').count()).toBe(0)
    expect(await page.locator('textarea[data-dsh-composer]').inputValue()).toBe(before)
    expect(await page.getByText(IMAGE_TOAST).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
