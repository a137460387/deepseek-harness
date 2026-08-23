/**
 * Composer draft token budget, browser half: mounts one muted readout line
 * into the composer dock (the stats line's band) estimating the current
 * draft's token cost under the token-meter's own heuristic and, when the
 * provider reports context figures, the after-send window occupancy.
 *
 * The readout is a pure slot consumer: the live draft and the
 * `contextPressure` projection both arrive as the dock entry's standard
 * props, the estimator mirrors `token-meter/src/estimate.ts` for plain
 * text (pinned by a contract spec against the real `estimateMessage`), and
 * every surfaced figure carries a `~` — the heuristic underprices CJK and
 * JSON and has measured tens-of-percent divergence from provider usage in
 * long sessions, so the after-send baseline anchors on the provider-reported
 * projection and the heuristic prices only the draft increment. The
 * composer is never written: no input verbs, no module-table request, no
 * listener of any kind.
 * @module @deepseek-ai/dsh-client-draft-budget/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the composer.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the token-meter projection key merge ('contextPressure').
import type {} from '@deepseek-ai/dsh-token-meter/client'
// Type-only: pulls the locale service's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DraftBudgetReadout } from './DraftBudgetReadout.tsx'
import { en, zh, type DraftBudgetKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The draft-budget readout's copy. */
    draftBudget: DraftBudgetKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'draftBudget'

/** Required services: the slot registry (the dock entry) and locale. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries and mount the readout into
 * the composer dock beside the stats line.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'draft-budget: dictionaries')

  ctx.slots.inject(
    'conversation.composer.dock',
    () => ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: 'draft-budget',
        order: 10,
        locale: NS,
      },
      DraftBudgetReadout,
    ),
  )
}
