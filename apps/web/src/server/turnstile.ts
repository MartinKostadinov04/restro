// Turnstile's server check (D119, D121; design §5; ticket #76): the web's `HumanCheck` for an
// on-the-bill Send. Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
//   POST https://challenges.cloudflare.com/turnstile/v0/siteverify
//        secret, response (the token, at most 2048 characters), idempotency_key
//
// A token works once and lasts 300 s; the idempotency key (the Send's action id) lets a retry of
// the same Send ask again without being told the token was used. No IP address is sent: it is
// optional and personal data. Fail closed: a failed token, no secret, or an answer for another
// action is `failed`. Only when siteverify itself is down (a network error, a timeout, a 5xx, or
// its own `internal-error`) is it `unavailable`, which core lets through and counts.

import type { HumanCheck, HumanCheckVerdict } from '@restro/core/service'
import { TURNSTILE_SEND_ACTION } from '@restro/shell'
import { z } from 'zod'

/** The address of siteverify. */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** How long the server waits for siteverify. */
const TIMEOUT_MS = 5_000

const SiteverifySchema = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
  action: z.string().optional(),
})

/** Cloudflare's published test secrets (`1x…AA` passes, `2x…AA` fails, `3x…AA` is spent). */
function isTestSecret(secret: string): boolean {
  return /^[123]x0{31}AA$/.test(secret)
}

/** Builds the check with the secret, or one that fails every token without it. */
export function turnstileCheck(
  secret: string | undefined,
  fetcher: typeof fetch = fetch,
): HumanCheck {
  return async (token, actionId): Promise<HumanCheckVerdict> => {
    if (secret === undefined) return 'failed'
    let response: Response
    try {
      response = await fetcher(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: token, idempotency_key: actionId }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      return 'unavailable'
    }
    if (response.status >= 500) return 'unavailable'
    if (!response.ok) return 'failed'
    const parsed = SiteverifySchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) return 'failed'
    const answer = parsed.data
    if (answer['error-codes'].includes('internal-error')) return 'unavailable'
    if (!answer.success) return 'failed'
    // A token of a widget run for another action is not this Send's. Cloudflare's test secrets
    // answer the action `test` or none at all (as the `1x…AA` secret does for the dummy token),
    // which only they may.
    if (isTestSecret(secret)) {
      return [undefined, 'test', TURNSTILE_SEND_ACTION].includes(answer.action)
        ? 'passed'
        : 'failed'
    }
    return answer.action === TURNSTILE_SEND_ACTION ? 'passed' : 'failed'
  }
}
