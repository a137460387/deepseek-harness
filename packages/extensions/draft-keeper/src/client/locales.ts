/** `draftKeeper` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'restore.notice': '已恢复重载前未发送的草稿',
} satisfies Record<string, string>

/** The draftKeeper namespace key union. */
export type DraftKeeperKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'restore.notice': 'Restored the unsent draft from before the reload',
} satisfies Record<DraftKeeperKey, string>
