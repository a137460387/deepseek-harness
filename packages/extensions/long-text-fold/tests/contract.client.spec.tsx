// @vitest-environment jsdom
/**
 * Contract pins over the real upstream implementations (the fork's
 * anti-drift net): Lexical's discrete-update synchrony is the load-bearing
 * assumption behind submit-time expansion (a non-discrete update stays
 * invisible to the same-stack read, so the contrast is pinned too); the
 * upstream composer keymap routes a synthetic paste to `pasteText` and an
 * Enter keydown to `submit` (the chains the takeover rides); the mirrored
 * locale strings stay byte-equal to the upstream dictionaries; the upstream
 * primary-button keys exist; and the generated slot catalog carries this
 * package's three registrations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { registerComposerKeymap } from '@deepseek-ai/dsh-client-ui-conversation/src/client/input/editor/keymap.ts'
import { en as conversationEn, zh as conversationZh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { en as chatEn, zh as chatZh } from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts'
import { projectUserText } from '@deepseek-ai/dsh-client-ui-primitives'
import { CLIENT_SLOT_API } from '@deepseek-ai/dsh-cordis-client-runner/src/client/slot-catalog.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

describe('lexical discrete-update contract', () => {
  it('makes a discrete update visible to the same-stack read', () => {
    const editor = createEditor({ namespace: 'long-text-fold-contract', onError: (error) => { throw error } })
    const root = document.createElement('div')
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('hello'))
      $getRoot().append(paragraph)
    }, { discrete: true })
    // The submit path reads the projection right after setDraft; a discrete
    // update must already be committed here.
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('hello')
  })

  it('keeps a non-discrete update invisible to the same-stack read (contrast pin)', async () => {
    const editor = createEditor({ namespace: 'long-text-fold-contract-async', onError: (error) => { throw error } })
    const root = document.createElement('div')
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    editor.update(() => {
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('first'))
      $getRoot().append(paragraph)
    }, { discrete: true })
    editor.update(() => {
      $getRoot().clear()
      const paragraph = $createParagraphNode()
      paragraph.append($createTextNode('second'))
      $getRoot().append(paragraph)
    })
    // Without `discrete`, the commit lands in a later task — a synchronous
    // expansion would read the stale draft here.
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('first')
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe('second')
  })
})

describe('upstream composer keymap contract', () => {
  function keymapBench(): {
    root: HTMLDivElement
    handlers: {
      arbitrate: ReturnType<typeof vi.fn>
      space: ReturnType<typeof vi.fn>
      dismissPopup: ReturnType<typeof vi.fn>
      canSubmit: ReturnType<typeof vi.fn>
      submit: ReturnType<typeof vi.fn>
      intakeFiles: ReturnType<typeof vi.fn>
      pasteText: ReturnType<typeof vi.fn>
    }
  } {
    const editor = createEditor({ namespace: 'long-text-fold-keymap', onError: (error) => { throw error } })
    const root = document.createElement('div')
    root.setAttribute('data-dsh-composer', '')
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const handlers = {
      arbitrate: vi.fn(() => 'pass' as const),
      space: vi.fn(() => false),
      dismissPopup: vi.fn(),
      canSubmit: vi.fn(() => true),
      submit: vi.fn(),
      intakeFiles: vi.fn(),
      pasteText: vi.fn(),
    }
    registerComposerKeymap(editor, handlers)
    return { root, handlers }
  }

  function dispatchPaste(root: HTMLElement, text: string): void {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: (type: string) => type === 'text/plain' ? text : '',
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      },
      configurable: true,
    })
    root.dispatchEvent(event)
  }

  it('routes a synthetic paste into pasteText (the marker insertion path)', () => {
    const { root, handlers } = keymapBench()
    dispatchPaste(root, '[LongText#1]')
    expect(handlers.pasteText).toHaveBeenCalledWith('[LongText#1]')
    expect(handlers.intakeFiles).not.toHaveBeenCalled()
  })

  it('routes a file-bearing paste into intakeFiles', () => {
    const { root, handlers } = keymapBench()
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: () => '',
        items: [{ kind: 'file', type: 'text/plain', getAsFile: () => new File(['x'], 'a.txt', { type: 'text/plain' }) }],
      },
      configurable: true,
    })
    root.dispatchEvent(event)
    expect(handlers.intakeFiles).toHaveBeenCalledOnce()
    expect(handlers.pasteText).not.toHaveBeenCalled()
  })

  it('routes an Enter keydown into submit (the gesture the capture listener precedes)', () => {
    const { root, handlers } = keymapBench()
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(handlers.submit).toHaveBeenCalledWith(false)
  })
})

describe('upstream locale contract', () => {
  it('keeps the primary-button label keys present', () => {
    for (const key of ['input.send', 'input.send.steer', 'input.send.queue', 'input.commands', 'input.stop'] as const) {
      expect(conversationZh[key]).toBeTruthy()
      expect(conversationEn[key]).toBeTruthy()
    }
  })

  it('keeps the mirrored strings byte-equal to the upstream dictionaries', () => {
    // fold-view renders these through the longTextFold NS; a upstream reword
    // must trip here so the mirror is re-synced in the same change.
    expect(zh['reference.summary']).toBe(chatZh['message.referenceSummary'])
    expect(zh['reference.separator']).toBe(chatZh['message.referenceSeparator'])
    expect(zh['extra.block']).toBe(chatZh['message.extraBlock'])
    expect(zh['json.truncated']).toBe(chatZh['json.truncated'])
    expect(zh['clock.md']).toBe(chatZh['clock.md'])
    expect(zh['clock.ymd']).toBe(chatZh['clock.ymd'])
    expect(en['reference.summary']).toBe(chatEn['message.referenceSummary'])
    expect(en['reference.separator']).toBe(chatEn['message.referenceSeparator'])
    expect(en['extra.block']).toBe(chatEn['message.extraBlock'])
    expect(en['json.truncated']).toBe(chatEn['json.truncated'])
    expect(en['clock.md']).toBe(chatEn['clock.md'])
    expect(en['clock.ymd']).toBe(chatEn['clock.ymd'])
  })
})

describe('renderer primitive contract', () => {
  it('projectUserText renders plain text non-empty', () => {
    const rendered = projectUserText('plain long-text body', [], [], 'skill')
    expect(rendered).toBeTruthy()
  })
})

describe('slot catalog contract', () => {
  it('carries this package as the user/steering chat-node occupant', () => {
    const chatNode = CLIENT_SLOT_API.find(entry => entry.key === 'conversation.chat.node')
    expect(chatNode).toBeDefined()
    expect(chatNode!.occupants).toContain("client-long-text-fold LongTextFoldNodeView key 'user'")
    expect(chatNode!.occupants).toContain("client-long-text-fold LongTextFoldNodeView key 'steering'")
  })

  it("carries this package's dock and the overlay stays list-shaped", () => {
    const dock = CLIENT_SLOT_API.find(entry => entry.key === 'conversation.input.dock')
    expect(dock!.occupants).toContain("client-long-text-fold LongTextFoldDock id 'long-text-fold'")
    // shell.overlay is a root list slot declared by ui-layout.
    expect(CLIENT_SLOT_API.some(entry => entry.key === 'shell.overlay')).toBe(true)
  })
})
