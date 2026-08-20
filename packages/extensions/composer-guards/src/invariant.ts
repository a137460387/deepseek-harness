/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-composer-guards`.
 * @module @deepseek-ai/dsh-client-composer-guards/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-composer-guards'

/** Cordis companion plugin name. */
export const name = 'client-composer-guards-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package supplies pure guard helpers over public
 * client services and mounts no listeners, slots, or events of its own. The
 * helpers' behavior is proven by the browser-half spec.
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
