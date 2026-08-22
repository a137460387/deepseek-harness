/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-draft-keeper`.
 * @module @deepseek-ai/dsh-client-draft-keeper/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-draft-keeper'

/** Cordis companion plugin name. */
export const name = 'client-draft-keeper-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package subscribes to the current session's input
 * state store through ctx.effect and emits no cordis events. Every
 * subscription's disposal rides the plugin fiber (HMR safety), proven by the
 * browser-half spec.
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
