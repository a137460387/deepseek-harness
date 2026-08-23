/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-draft-budget`.
 * @module @deepseek-ai/dsh-client-draft-budget/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-draft-budget'

/** Cordis companion plugin name. */
export const name = 'client-draft-budget-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every observable the readout consumes arrives as
 * slot props (the dock's InputZone share and the session projection hook),
 * so the plugin registers no listener, observer, or subscription — its two
 * ctx.effect registrations (dictionaries and the dock entry) both return
 * their disposers and nothing else outlives the plugin fiber. An explained
 * empty companion is the correct shape here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
