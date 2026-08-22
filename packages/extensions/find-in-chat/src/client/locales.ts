/** `findInChat` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'bar.placeholder': '在会话中查找',
  'bar.count': '{current}/{total}',
  'bar.searched': '已搜索 {rows} 条消息',
  'bar.earlier': '更早消息未加载',
  'bar.previous': '上一个匹配',
  'bar.next': '下一个匹配',
  'bar.close': '关闭查找栏',
} satisfies Record<string, string>

/** The findInChat namespace key union. */
export type FindInChatKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'bar.placeholder': 'Find in conversation',
  'bar.count': '{current}/{total}',
  'bar.searched': 'Searched {rows} messages',
  'bar.earlier': 'earlier messages not loaded',
  'bar.previous': 'Previous match',
  'bar.next': 'Next match',
  'bar.close': 'Close find bar',
} satisfies Record<FindInChatKey, string>
