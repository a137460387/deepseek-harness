/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-input-history-recall`.
 * @module @deepseek-ai/dsh-client-input-history-recall/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-input-history-recall'

/** Cordis companion plugin name. */
export const name = 'client-input-history-recall-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package mounts one document-level keydown
 * capture listener through ctx.effect, holds its traversal state in the apply
 * closure, and emits no cordis events. The listener's disposal rides the
 * plugin fiber (HMR safety), proven by the browser-half spec.
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
