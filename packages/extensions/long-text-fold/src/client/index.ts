/**
 * Long-text paste staging cards, browser half. Scaffold shell: the behavior
 * (paste takeover, submit interception, input dock, and the chat fold) lands
 * with the feat commit; this apply exists so the plugin loads in the Web boot
 * graph without error.
 * @module @deepseek-ai/dsh-client-long-text-fold/client
 */

// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the conversation service's Context merge (ctx.conversation)
// and the ui-conversation SlotMap merges (the input.dock and chat.node entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale service's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** Client plugin body — no behavior yet; lands with the feat commit. */
export function apply(): void {}
