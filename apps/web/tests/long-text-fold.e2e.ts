// Web e2e scenario: the long-text fold (long-text-fold plugin). A seeded
// session carries one user message over the render threshold and one short
// one: the long message folds into the probe-marked expandable card and the
// short one keeps the shipped bubble, the expand toggle reveals the full
// text in place, and the composer dock lists the staged entries only after a
// real staging (which this replay lane cannot produce — staging rides live
// paste, so the dock half is pinned by the browser spec and the demo GIF).
// Zero model calls: the seeded fixture is a closed recording.
//
// Suite-wide note: apps/web e2e currently skips at scaffold startup on the
// registered directory-picker double-registration issue (FORK_NOTES), so the
// visual proof for this plugin rides the showcase demo GIF until that fix.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SESSION_FORMAT_VERSION, Session, SessionId, createUserMessage, createSystemMessage, createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-title'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SESSION_ID = 'long-text-fold-e2e'
const LONG_MARKER = 'LONG_TEXT_FOLD_E2E_LONG'
const SHORT_MARKER = 'LONG_TEXT_FOLD_E2E_SHORT'
const LONG_BODY = `${LONG_MARKER} ${'filler prose for the fold threshold '.repeat(120)}`

function text(value: string): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: value }]
}

/** Minimal closed two-turn session: one long user text, one short one. */
function buildLog(): string {
  const session = Session.create(SessionId('long-text-fold-e2e-template'))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('system/message', {
    turn: 1,
    step: 1,
    message: createSystemMessage('Synthetic long-text-fold system prompt.', '@deepseek-ai/dsh-system-prompt'),
  }, { surfaceOp: 'append' })
  const user = session.append('user/message', createUserMessage({
    content: text(LONG_BODY),
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'long-text-fold e2e session',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('request/header', {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    reason: 'initial',
  })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: text('Acknowledged.'),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    usage: { inputTokens: 2_000, outputTokens: 8 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  session.append('step/start', { turn: 2, step: 1 })
  session.append('user/message', createUserMessage({
    content: text(`${SHORT_MARKER} and a short closing line.`),
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('request/header', {
    header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    reason: 'change',
  })
  session.append('assistant/message', {
    stream: [],
    turn: 2,
    step: 1,
    message: createAssistantMessage({
      content: text('Short reply.'),
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
    usage: { inputTokens: 2_000, outputTokens: 4 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: Date.now() - 60_000,
      cwd: '{{cwd}}',
      isSeeded: false,
      delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

/** The collapsed fold wrap, addressed through the plugin's stable probe. */
const foldCard = (page: Page) => page.locator('[data-long-text-fold="collapsed"]')

describe('web e2e: long-text-fold chat fold', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, buildLog(), SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
  })

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('folds the long user message and expands it in place', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'long-text-fold') })
    await page.getByText(SHORT_MARKER).waitFor({ timeout: 30_000 })
    // One text block ≥ the render threshold folds; the collapsed wrap clamps
    // the real bubble behind the bottom fade mask.
    const card = foldCard(page)
    await expect(card).toHaveCount(1)
    const cardText = await card.textContent()
    expect(cardText).toContain('filler prose for the fold threshold')
    // Expand reveals the full text in place, then collapse restores the card.
    await card.locator('button').first().click()
    await expect(page.locator('[data-long-text-fold="expanded"]')).toHaveCount(1)
    await expect(page.getByText(LONG_BODY)).toBeVisible()
    await page.locator('[data-long-text-fold="expanded"] button').first().click()
    await expect(foldCard(page)).toHaveCount(1)
  })

  it('keeps the short user message on the shipped bubble', async () => {
    onTestFailed(async () => { await saveFailureShot(page, 'long-text-fold-short') })
    const short = page.getByText(SHORT_MARKER)
    await expect(short).toBeVisible()
    // The short marker's row must not sit inside a fold card.
    const cardText = await foldCard(page).textContent()
    expect(cardText).not.toContain(SHORT_MARKER)
  })
})
