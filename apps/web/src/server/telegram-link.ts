// The web app's side of the worker's Telegram link endpoint (#87; alerts/telegram-link-api.ts in the
// worker). The bot's token and the link-signing key are the worker's alone: the Alerts settings ask
// it, over the private network (`WORKER_REVEAL_URL`, with `REVEAL_SERVICE_TOKEN` as a bearer), for a
// link to open or to send a test message. The worker checks the signed-in person holds
// `settings.alerts` with a sign-in of the last 15 minutes. Nothing here stores or logs a link.
import { z } from 'zod'

import { logError } from './log'
import type { RevealActor, RevealConfig } from './reveal'

/** The endpoint's path on the worker. */
const TELEGRAM_PATH = '/internal/telegram'
/** How long one request may take before the screen gives up. */
const TIMEOUT_MS = 10_000

/** What the Alerts section asks for. */
export type TelegramAsk =
  | { readonly action: 'link_group' }
  | { readonly action: 'link_person'; readonly staffMemberId: string }
  | { readonly action: 'test' }

/** What it gets back. */
export type TelegramReply =
  | { readonly ok: true; readonly url?: string; readonly expiresAt?: string }
  | { readonly ok: false; readonly error: string }

const AnswerSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    url: z.string().optional(),
    expiresAt: z.string().optional(),
  }),
  z.object({ status: z.literal('refused'), code: z.string() }),
])

/** Asks the worker. `telegram_off` when the endpoint is not there (no bot, or no token set). */
export async function askTelegram(
  config: RevealConfig,
  target: { tenantId: string; venueId: string; actor: RevealActor },
  ask: TelegramAsk,
  fetchImpl: typeof fetch = fetch,
): Promise<TelegramReply> {
  if (config.url === undefined || config.token === undefined) {
    return { ok: false, error: 'telegram_off' }
  }
  const { actor } = target
  try {
    const response = await fetchImpl(`${config.url.replace(/\/+$/, '')}${TELEGRAM_PATH}`, {
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
    if (response.status === 404) return { ok: false, error: 'telegram_off' }
    if (response.status !== 200 && response.status !== 403) {
      logError('telegram_link_failed', new Error(`the worker answered ${response.status}`))
      return { ok: false, error: 'telegram_failed' }
    }
    const answer = AnswerSchema.parse(await response.json())
    return answer.status === 'refused'
      ? { ok: false, error: answer.code }
      : {
          ok: true,
          ...(answer.url === undefined ? {} : { url: answer.url }),
          ...(answer.expiresAt === undefined ? {} : { expiresAt: answer.expiresAt }),
        }
  } catch (error) {
    // Never the request or the answer: they carry links.
    logError('telegram_link_failed', error instanceof Error ? new Error(error.name) : error)
    return { ok: false, error: 'telegram_failed' }
  }
}
