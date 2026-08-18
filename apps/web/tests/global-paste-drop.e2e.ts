// Web e2e scenario: global-paste takes over a PURE text-file drop anywhere
// over the window — the composer card AND the conversation area users
// actually aim at (the composer's own image intake is whole-window, so a
// card-only takeover leaves text files dropped on the chat area to the image
// path and its "only images" toast). The paste half of the plugin is probed
// first so a dead plugin and a drop-path-only failure stay distinguishable.
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

/** Whether anything prevented each synthetic drag event's default. */
interface DropFlags {
  overPrevented: boolean
  dropPrevented: boolean
}

/**
 * Drop one text file onto the given selector the way the OS would: a
 * dragover-then-drop pair carrying a real `DataTransfer` with a `File` item.
 * Chromium honors script-built DataTransfers on synthetic drag events, so the
 * drop handler reads `files` exactly as it does for a trusted drop.
 * @param page - the page under test.
 * @param targetSelector - element the drop lands on.
 * @param name - dropped file name.
 * @param content - dropped file body.
 * @returns whether anything prevented each event's default.
 */
async function dropTextFile(page: Page, targetSelector: string, name: string, content: string): Promise<DropFlags> {
  return await page.evaluate(({ targetSelector, name, content }) => {
    const target = document.querySelector(targetSelector)
    if (target === null) throw new Error(`drop target not found: ${targetSelector}`)
    const dt = new DataTransfer()
    dt.items.add(new File([content], name, { type: 'text/plain' }))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(over)
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })
    target.dispatchEvent(drop)
    return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented }
  }, { targetSelector, name, content })
}

describe('web e2e: global-paste text-file drop', () => {
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
    await connectFreshWorkspace(page, scaffold.workspaceCwd, 'global-paste-drop')
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('routes a page-level text paste into the draft', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-global-paste-paste'))
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

  it('takes over a text-file drop on the conversation area (not the card)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-global-paste-drop-area'))
    const flags = await dropTextFile(page, '[data-conversation-scroll]', 'note.txt', 'hello from the dropped file')
    // The composer's own dragover allows the drop (copy cursor); the takeover
    // owns the drop itself.
    expect(flags.overPrevented).toBe(true)
    expect(flags.dropPrevented).toBe(true)
    await page.waitForFunction(() => {
      const composer = document.querySelector('textarea[data-dsh-composer]')
      return composer !== null && (composer as HTMLTextAreaElement).value.includes('# note.txt')
    }, undefined, { timeout: 5_000 })
    expect(await page.locator('textarea[data-dsh-composer]').inputValue())
      .toBe('pasted before the drop\n# note.txt\nhello from the dropped file')
    // The image intake never saw the batch: no format-rejection toast.
    expect(await page.getByText(IMAGE_TOAST).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('still takes over a text-file drop on the composer card itself', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-global-paste-drop-card'))
    const flags = await dropTextFile(page, '[data-composer-card]', 'second.md', 'more text')
    expect(flags.dropPrevented).toBe(true)
    await page.waitForFunction(() => {
      const composer = document.querySelector('textarea[data-dsh-composer]')
      return composer !== null && (composer as HTMLTextAreaElement).value.includes('# second.md')
    }, undefined, { timeout: 5_000 })
    expect(await page.locator('textarea[data-dsh-composer]').inputValue())
      .toBe('pasted before the drop\n# note.txt\nhello from the dropped file\n# second.md\nmore text')
    expect(await page.getByText(IMAGE_TOAST).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
