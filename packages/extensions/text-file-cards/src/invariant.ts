/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-text-file-cards`.
 * @module @deepseek-ai/dsh-client-text-file-cards/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-text-file-cards'

/** Cordis companion plugin name. */
export const name = 'client-text-file-cards-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package mounts one document-level drop capture
 * listener through ctx.effect and one input-dock slot registration; both
 * disposals ride the plugin fiber (HMR safety), proven by the browser-half
 * spec. Staged files live in a registrant-owned observable, never a cordis
 * event or cross-plugin mutable structure.
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
