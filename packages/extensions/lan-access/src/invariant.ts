/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-lan-access`.
 * @module @deepseek-ai/dsh-host-lan-access/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-lan-access'

/** Cordis companion plugin name. */
export const name = 'host-lan-access-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the subclass owns no registrations of its own — route,
 * upgrade, and fallback tables stay the base webserver's, and the request/
 * upgrade wrappers are plain server-event listeners whose lifetime rides the
 * base service's own teardown effect. The token digests are derived once in
 * init and never mutated afterwards.
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
