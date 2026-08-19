/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-usage-stats`.
 * @module @deepseek-ai/dsh-client-usage-stats/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-usage-stats'

/** Cordis companion plugin name. */
export const name = 'usage-stats-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns one pure projection fold whose wire
 * payload is schema-validated by the projection registry at every snapshot
 * and change-feed emission, and the event relations the fold relies on
 * (same-step usage adjacency, the request/header envelope preceding its
 * samples) are owned and runtime-checked by dsh-agent-loop and the session
 * log, not here.
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
