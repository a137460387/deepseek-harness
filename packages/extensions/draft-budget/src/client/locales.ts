/** `draftBudget` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.tokens': '~{count} tok',
  'chip.afterSend': '发送后 ~{percent}%',
  'chip.aria': '草稿约 {count} token，发送后约占用 {percent}%',
  'chip.ariaTokens': '草稿约 {count} token',
} satisfies Record<string, string>

/** The draftBudget namespace key union. */
export type DraftBudgetKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.tokens': '~{count} tok',
  'chip.afterSend': 'after send ~{percent}%',
  'chip.aria': 'draft about {count} tokens, about {percent}% of context after sending',
  'chip.ariaTokens': 'draft about {count} tokens',
} satisfies Record<DraftBudgetKey, string>
