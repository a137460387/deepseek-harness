/** `longTextFold` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'card.meta': '{chars} 字符 · {lines} 行',
  'card.expand': '展开长文本',
  'card.collapse': '收起长文本',
  'card.preview': '预览暂存的长文本',
  'card.remove': '移除暂存的长文本',
  'preview.title': '暂存长文本 #{seq}',
  'preview.close': '关闭预览',
  'copy': '复制',
  'copied': '已复制',
  'error.storage': '长文本暂存失败，本次按原文粘贴',
  'error.missing': '部分暂存长文本已不在本机存储，对应标记按原文发送',
  // Mirrored upstream copy (ui-chat `chat` NS); the contract spec pins these
  // strings against the upstream dictionaries.
  'reference.summary': '引用会话 · {labels}',
  'reference.separator': '、',
  'extra.block': '附加内容块',
  'json.truncated': '… 已截断，共 {total} 字符',
  'clock.md': '{m}月{d}日',
  'clock.ymd': '{y}年{m}月{d}日',
} satisfies Record<string, string>

/** The longTextFold namespace key union. */
export type LongTextFoldKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'card.meta': '{chars} characters · {lines} lines',
  'card.expand': 'Expand long text',
  'card.collapse': 'Collapse long text',
  'card.preview': 'Preview the staged long text',
  'card.remove': 'Remove the staged long text',
  'preview.title': 'Staged long text #{seq}',
  'preview.close': 'Close preview',
  'copy': 'Copy',
  'copied': 'Copied',
  'error.storage': 'Staging failed; the text was pasted as-is',
  'error.missing': 'Some staged texts are no longer stored locally; their markers were sent verbatim',
  'reference.summary': 'Referenced session · {labels}',
  'reference.separator': ', ',
  'extra.block': 'Extra content block',
  'json.truncated': '… truncated, {total} characters total',
  'clock.md': '{m}/{d}',
  'clock.ymd': '{y}-{m}-{d}',
} satisfies Record<LongTextFoldKey, string>
