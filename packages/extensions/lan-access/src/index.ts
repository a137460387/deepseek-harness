/**
 * Public entry: re-exports the LAN-gated webserver subclass so the composition
 * row and direct imports resolve through one specifier.
 * @module @deepseek-ai/dsh-host-lan-access
 */

export { LanAccessWebServer, default } from './server.ts'
export type { Config } from './server.ts'
