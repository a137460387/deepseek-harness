/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-long-text-fold`.
 * @module @deepseek-ai/dsh-client-long-text-fold/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-long-text-fold'

/** Cordis companion plugin name. */
export const name = 'client-long-text-fold-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package mounts document-level paste/keydown/click
 * capture listeners, session/input-state store subscriptions (the submit
 * cleanup watch), and slot registrations (input dock, chat-node keys,
 * overlay preview) through ctx.effect; every disposal rides the plugin fiber
 * (HMR safety), proven by the browser-half spec. Staged long texts live in
 * localStorage entries keyed per session, never a cordis event or cross-plugin
 * mutable structure.
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
