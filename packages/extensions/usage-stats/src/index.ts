/**
 * Usage-stats node half: a function plugin registering the `usageStats`
 * session-projection unit (route-split quarter-hour usage buckets) on the
 * host, in the exact shape `dsh-session-stats` set for whole-log projection
 * plugins. The browser half — the settings tab that aggregates across
 * sessions — ships via exports["./client"], discovered through the
 * package.json `dsh.client` declaration.
 *
 * @module @deepseek-ai/dsh-client-usage-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import { usageStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'usage-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `usageStats` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(usageStatsProjectionDefinition)
}
