/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-find-in-chat`.
 * @module @deepseek-ai/dsh-client-find-in-chat/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-find-in-chat'

/** Cordis companion plugin name. */
export const name = 'client-find-in-chat-invariant'

/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the find controller is created inside a ctx.effect
 * whose disposer removes the keydown listener, the MutationObserver, the
 * injected style, and every CSS Custom Highlight registry entry, and the bar
 * entry rides a declaration-bound slots injection that folds with the same
 * fiber. An explained empty companion is the correct shape here.
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
