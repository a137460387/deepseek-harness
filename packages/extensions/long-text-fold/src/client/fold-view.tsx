/**
 * Chat-side fold for sent user long texts: the 'user' and 'steering' keyed
 * renderers of `conversation.chat.node`.
 *
 * The fold decision is the joined text-block LENGTH, not the staged marker: a
 * hand-edited or stale marker that reaches a sent message is too short to
 * fold and renders literally, so the renderer needs neither marker trust nor
 * storage access — the expanded view reads the message's own text block.
 *
 * The short-text branch mirrors the shipped user bubble (attachments row,
 * `projectUserText` bubble, reference summary, actions row) with this
 * package's own CSS module and a copy+clock actions row (the shipped actions
 * component is package-internal).
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FileTypeIcon, IconCheckOutline16, IconCopyOutline16, JsonBlock, Tooltip,
  fileExtension, fileSizeText, projectUserText, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { UserMessageNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RENDER_FOLD_CHARS, countLines, firstLine } from './markers.ts'
import css from './FoldView.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>
type UserFile = Extract<UserMessageNode['content'][number], { type: 'file' }>

type PresentedAttachment =
  | { readonly type: 'image'; readonly image: MessageImageSource }
  | { readonly type: 'file'; readonly file: UserFile['attachment'] }

interface ContentParts {
  readonly text: string
  readonly attachments: readonly PresentedAttachment[]
  readonly rest: readonly unknown[]
}

function contentParts(content: readonly unknown[]): ContentParts {
  const texts: string[] = []
  const attachments: PresentedAttachment[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const typed = block as { type?: string; text?: string; attachment?: unknown }
    if (typed.type === 'text' && typeof typed.text === 'string') texts.push(typed.text)
    else if (typed.type === 'image' && typed.attachment !== undefined) {
      attachments.push({ type: 'image', image: { attachment: (block as UserImage).attachment } })
    } else if (typed.type === 'file' && typed.attachment !== undefined) {
      attachments.push({ type: 'file', file: (block as UserFile).attachment })
    } else rest.push(block)
  }
  return { text: texts.join(''), attachments, rest }
}

/** The locale seat this package's components render with. */
type FoldT = PropsLocale<'longTextFold'>['t']

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Date-aware clock mirroring the shipped message chrome: HH:mm on the same
 * day, otherwise a date prefix from the mirrored templates.
 * @param time - Unix epoch ms.
 * @param t - locale seat supplying the `clock.md` / `clock.ymd` templates.
 * @param now - reference instant for the day/year cut.
 * @returns the formatted clock string.
 */
function formatClock(time: number, t: FoldT, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) {
    return clock
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}

/**
 * The collapsed card: first-line preview, size meta, and the expand toggle.
 * The expanded body renders lazily so a collapsed long text never builds its
 * React tree.
 */
function FoldCard({ text, renderExpanded, t }: {
  text: string
  renderExpanded: () => ReactNode
  t: FoldT
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={css.foldCard} data-long-text-fold={open ? 'expanded' : 'card'}>
      <button
        type="button"
        className={css.foldToggle}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.foldPreview}>{firstLine(text)}</span>
        <span className={css.foldMeta}>{t('card.meta', { chars: text.length, lines: countLines(text) })}</span>
        <span className={css.foldAction}>{open ? t('card.collapse') : t('card.expand')}</span>
      </button>
      {open && <div className={css.foldBody}><div className={css.bubble}>{renderExpanded()}</div></div>}
    </div>
  )
}

/** Copy + clock actions row (the shipped actions component is package-internal). */
function LongTextFoldActions({ text, time, t }: {
  text: string
  time?: number | undefined
  t: FoldT
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current)
  }, [])
  const onCopy = (): void => {
    if (copied) return
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => { setCopied(false) }, 1000)
    })
  }
  return (
    <div className={css.actions}>
      {time !== undefined && <span className={css.time}>{formatClock(time, t)}</span>}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
        </button>
      </Tooltip>
    </div>
  )
}

/** Full props of the fold renderer (upstream owner share + this NS locale). */
export type LongTextFoldNodeProps =
  PropsRuntime<'conversation.chat.node', 'user' | 'steering'>
  & PropsLocale<'longTextFold'>

/**
 * The keyed Chat renderer replacing the shipped user/steering bubble: short
 * texts render the shipped shape; a text at or above the render threshold
 * folds into the expandable card.
 * @param props - the composed chat-node props.
 * @returns the user bubble or the folded card.
 */
export function LongTextFoldNodeView({ node, renderMessageImages, openFile, openSkill, t }: LongTextFoldNodeProps) {
  const data = node.data
  const parts = contentParts(data.content)
  const referenceLabels = data.referenceLabels ?? []
  const skillNames = data.skillNames ?? []
  const fold = parts.text.length >= RENDER_FOLD_CHARS
  const bubble = (): ReactNode => (
    <>
      {projectUserText(parts.text, referenceLabels, skillNames, 'skill', { openFile, openSkill })}
      {parts.rest.map((block, index) => (
        <JsonBlock
          key={index}
          label={t('extra.block')}
          payload={block}
          truncatedLabel={total => t('json.truncated', { total })}
        />
      ))}
    </>
  )
  return (
    <div className={css.userRow}>
      <div className={css.userStack}>
        {parts.attachments.length > 0 && (
          <div className={css.attachmentRow} data-message-attachments>
            {parts.attachments.map((attachment, index) => attachment.type === 'image'
              ? (
                <Fragment key={`image:${index}`}>
                  {renderMessageImages({
                    images: [attachment.image],
                    align: 'end',
                    compact: parts.attachments.length > 1,
                  })}
                </Fragment>
              )
              : (
                <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                  <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                  <span className={css.fileContent}>
                    <span className={css.fileName}>{attachment.file.name}</span>
                    <span className={css.fileMeta}>
                      {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                        .filter(Boolean).join(' ')}
                    </span>
                  </span>
                </span>
              ))}
          </div>
        )}
        {(parts.text !== '' || parts.rest.length > 0) && (fold
          ? <FoldCard text={parts.text} renderExpanded={bubble} t={t} />
          : <div className={css.bubble}>{bubble()}</div>)}
        {referenceLabels.length > 0 && (
          <div className={css.referenceSummary}>
            {t('reference.summary', { labels: referenceLabels.join(t('reference.separator')) })}
          </div>
        )}
      </div>
      <LongTextFoldActions text={parts.text} time={data.time} t={t} />
    </div>
  )
}
