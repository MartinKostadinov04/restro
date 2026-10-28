// The web app's side of the worker's payment connection endpoint (#109; payments/connection-api.ts in
// the worker). The provider's keys and its account are the worker's alone: the Paying settings ask
// it, over the private network (`WORKER_REVEAL_URL`, with `REVEAL_SERVICE_TOKEN` as a bearer), for
// the provider's hosted onboarding link, and for the account to be read back when the owner returns.
// The worker checks the signed-in person holds `settings.connect_payments` (with a sign-in of the last
// 15 minutes, to start). Only the onboarding address comes back to the browser. Nothing here stores
// or logs a link.
import { z } from 'zod'

import { logError } from './log'
import type { RevealActor, RevealConfig } from './reveal'

/** The endpoint's path on the worker. */
const CONNECTION_PATH = '/internal/payments/connection'
/** How long one request may take before the screen gives up (the provider is asked meanwhile). */
const TIMEOUT_MS = 20_000

/** What the Paying settings ask for. */
export type ConnectionAsk =
  | {
      readonly action: 'start'
      readonly returnUrl: string
      readonly refreshUrl: string
      readonly guestHost: string
    }
  | { readonly action: 'return'; readonly guestHost: string }

/** What it gets back. */
export type ConnectionReply =
  | { readonly ok: true; readonly url?: string; readonly state?: string }
  | { readonly ok: false; readonly error: string }

const AnswerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    url: z.string().optional(),
    state: z.string().optional(),
  }),
  z.object({ status: z.literal('refused'), code: z.string() }),
])

/** Asks the worker. `payments_off` when the endpoint is not there (no provider, or no token set). */
export async function askConnection(
  config: RevealConfig,
  target: { tenantId: string; venueId: string; actor: RevealActor },
  ask: ConnectionAsk,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionReply> {
  if (config.url === undefined || config.token === undefined) {
    return { ok: false, error: 'payments_off' }
  }
  const { actor } = target
  try {
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}${CONNECTION_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId: target.tenantId,
        venueId: target.venueId,
        actor:
          actor.operator === true
            ? { kind: 'operator', userId: actor.userId }
            : { kind: 'user', userId: actor.userId, sessionId: actor.sessionId },
        ...(actor.signedInAt === undefined ? {} : { signedInAt: actor.signedInAt.toISOString() }),
        ...ask,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 404) return { ok: false, error: 'payments_off' }
    if (response.status !== 200 && response.status !== 403) {
      logError('payment_connection_failed', new Error(`the worker answered ${response.status}`))
      return { ok: false, error: 'connection_failed' }
    }
    const answer = AnswerSchema.parse(await response.json())
    return answer.status === 'refused'
      ? { ok: false, error: answer.code }
      : {
          ok: true,
          ...(answer.url === undefined ? {} : { url: answer.url }),
          ...(answer.state === undefined ? {} : { state: answer.state }),
        }
  } catch (error) {
    // Never the request or the answer: they carry the onboarding link.
    logError('payment_connection_failed', error instanceof Error ? new Error(error.name) : error)
    return { ok: false, error: 'connection_failed' }
  }
}
