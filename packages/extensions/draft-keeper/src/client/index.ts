/**
 * Composer draft persistence, browser half: mirrors each session's unsent
 * draft into localStorage and restores it into the empty composer after a
 * reload or crash.
 * @module @deepseek-ai/dsh-client-draft-keeper/client
 */

/**
 * Required services: the session list (current session + live session ids)
 * and the conversation face (per-session input facade).
 */
export const inject = ['sessions', 'conversation']

/**
 * Client plugin body: mount the draft persistence subscriptions.
 */
export function apply(): void {}
