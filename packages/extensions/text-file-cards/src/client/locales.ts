/** `textFileCards` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'cards.group': '待插入的文本文件',
  'card.insert': '插入文件 {name} 到草稿',
  'card.remove': '移除文件 {name}',
  'error.tooLarge': '单个文件超过 {size}，未添加：{names}',
  'error.tooMany': '一次最多暂存 {count} 个文件，超出部分未添加',
} satisfies Record<string, string>

/** The textFileCards namespace key union. */
export type TextFileCardsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'cards.group': 'Text files waiting to insert',
  'card.insert': 'Insert file {name} into the draft',
  'card.remove': 'Remove file {name}',
  'error.tooLarge': 'Files over {size} were not added: {names}',
  'error.tooMany': 'At most {count} files per drop; the rest were not added',
} satisfies Record<TextFileCardsKey, string>
