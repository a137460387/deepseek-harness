/**
 * Usage-stats browser half: the settings-section tab. The section aggregates
 * every session's `usageStats` projection value — the host-side fold this
 * package's node half registers — into headline cards, an activity calendar,
 * a range-scoped trend chart, and a route-share donut. Token counts only; no
 * pricing.
 *
 * @module @deepseek-ai/dsh-client-usage-stats/client
 */

// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the connection plugin's client event map (connection/reset).
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sessions service's Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { UsageStatsSection } from './UsageStatsSection.tsx'
import type { UsageStatsSectionInjected } from './UsageStatsSection.tsx'
import { UsageStatsController } from './stats-store.ts'
import { en, zh } from './locales.ts'
import type { UsageStatsKey } from './locales.ts'

export type {
  UsageStatsSectionInjected, UsageStatsSectionProps,
} from './UsageStatsSection.tsx'
export type { UsageStatsSectionState } from './stats-store.ts'
export type { UsageStatsKey } from './locales.ts'
// Pulls the `usageStats` SessionProjectionMap merge into every client program
// that imports this entry, the session-stats ./client precedent.
export type * from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage statistics settings-section copy. */
    usageStats: UsageStatsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'usageStats'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Mount the usage statistics settings section, ordered after Agent presets
 * (choosing an agent shapes a deployment; reading what it consumed follows).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stats: dictionaries')

  const controller = new UsageStatsController(ctx.sessions)

  // A reconnect can serve a different host composition; dropping to idle
  // makes the next section open rescan instead of trusting the old snapshot.
  ctx.on('connection/reset', () => { controller.reset() })

  const sectionInjected = (): UsageStatsSectionInjected => ({
    hooks: { usageStats: controller.store },
    load: () => controller.load(),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 25,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
    inject: sectionInjected,
  }, UsageStatsSection))
}
