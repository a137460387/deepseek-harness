/**
 * Text-file drop staging cards, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in the host cordis.yml / Loader; the browser
 * half ships via exports["./client"], discovered through the package.json
 * dsh.client declaration.
 * @module @deepseek-ai/dsh-client-text-file-cards
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
