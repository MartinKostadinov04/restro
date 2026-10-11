// Sending a command to the host (D72). Every command carries an `actionId`: a uuid made once per
// user action and reused when the same action is tried again, so the host can answer a repeat with
// the answer it gave the first time. `runCommand` never throws: an error, a timeout or an answer
// to some other command is `{ ok: false }`, which the screens treat as "the outcome is unknown".

import type { CommandResult, GuestCommand } from '@restro/shell'

/** How long the face waits for the host's answer before it calls the outcome unknown. */
export const SERVICE_TIMEOUT_MS = 15_000

/** A uuid for one user action (version 4). */
export function newActionId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID()
  // `randomUUID` exists only on secure pages (https, localhost); `getRandomValues` exists everywhere.
  const bytes = webCrypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** What came of a command: the host's answer, or nothing usable. */
export type Outcome = { readonly ok: true; readonly result: CommandResult } | { readonly ok: false }

const STATUSES: readonly string[] = ['pending', 'accepted', 'rejected']

/** Whether a value is an answer to this command. */
function isAnswerTo(command: GuestCommand, value: unknown): value is CommandResult {
  if (typeof value !== 'object' || value === null) return false
  const { actionId, status } = value as Partial<CommandResult>
  return actionId === command.actionId && typeof status === 'string' && STATUSES.includes(status)
}

/**
 * Sends one command and waits for the answer, at most `timeoutMs`. It does not throw: if the host
 * throws, rejects, takes too long or answers another command, the outcome is `{ ok: false }`. An
 * answer that arrives after the timeout is ignored; the command may still have worked, which is
 * why a retry reuses the `actionId`.
 */
export async function runCommand(
  dispatch: (command: GuestCommand) => Promise<CommandResult>,
  command: GuestCommand,
  timeoutMs: number = SERVICE_TIMEOUT_MS,
): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('the host did not answer in time')), timeoutMs)
    })
    // `.then` so a dispatch that throws before it returns a promise is caught as well.
    const answer = await Promise.race([Promise.resolve().then(() => dispatch(command)), timeout])
    return isAnswerTo(command, answer) ? { ok: true, result: answer } : { ok: false }
  } catch {
    return { ok: false }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
