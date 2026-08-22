/**
 * In-conversation find bar, browser half: Ctrl/Cmd+F opens a top-center
 * find bar over the active chat view (the browser's own find-bar position),
 * matching the loaded window's text case-insensitively with wrap-around
 * navigation, center scrolling, and CSS Custom Highlight ranges.
 *
 * The interception is a document-level capture-phase keydown listener (the
 * global-paste pattern) that only ever takes Ctrl/Cmd+F without
 * Shift/Alt, only while a chat flow is mounted (no session hero and the
 * trajectory tab both leave the DOM, and with it the interception) and no
 * dialog owns the page — every other state keeps the browser's native
 * find. The search scans the chat flow's live DOM: exactly what the
 * native find can see, with an honest "searched N messages, earlier pages
 * not loaded" coverage note instead of unbounded `loadOlder` paging.
 *
 * Mounting: one `shell.overlay` entry (a fresh id beside the shipped
 * entries, order 100) whose component is a thin view over the find
 * controller; the controller owns every listener and disposes them from
 * this plugin's fiber. The composer is never touched — no
 * `conversation.input` consumption, no composer-guards request.
 * @module @deepseek-ai/dsh-client-find-in-chat/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-slots SlotMap merge (the shell.overlay entry).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the locale service's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { FindBar } from './FindBar.tsx'
import { createFindController } from './find-controller.ts'
import { en, zh, type FindInChatKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The find bar's copy. */
    findInChat: FindInChatKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'findInChat'

/**
 * Required services: the slot registry (the shell.overlay entry), the
 * locale dictionaries, and the session list (auto-close on switches).
 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: register the dictionaries, create the controller on
 * this plugin's fiber, and mount the bar entry into the overlay layer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'find-in-chat: dictionaries')

  ctx.effect(() => {
    const controller = createFindController({ sessions: ctx.sessions.list })
    const offSlot = ctx.slots.inject(
      'shell.overlay',
      () => ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'find-in-chat',
          order: 100,
          locale: NS,
          inject: () => ({ controller }),
        },
        FindBar,
      ),
    )
    return () => {
      offSlot()
      controller.dispose()
    }
  }, 'find-in-chat: find bar')
}
