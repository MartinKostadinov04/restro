// The provider notice inbox (#108; D127 1.4, D125 3.8, design §8): POST
// /api/payments/notices/<provider kind>. It reads the raw body first (the signature is over it),
// checks it with the provider's verifier, and stores a verified notice once by its event id
// (`recordProviderNotice`, the one thing of core/service it may import: the
// `notice-route-records-only` dependency rule). It never acts on a payment: the worker's
// `provider-notices` job reads each notice's object back from the provider and records that.
//
// Answers:
// - 200 for a notice stored now and for one stored before, so the provider stops sending it;
// - 400 for an unsigned, badly signed, stale or malformed notice (logged, reason only);
// - 200 for a wrong-mode notice, refused and logged the same way but not stored: a provider's
//   production endpoint also gets its test events, which would otherwise be sent again for days;
// - 404 for a kind with no verifier here, 413 for a body over the cap;
// - 503 when this deployment has no environment label or no secret for the kind, 500 when the
//   database fails: the provider sends it again later.
// Nothing about the body, the signature, a header or the secret is ever logged.
import type { RecordProviderNoticeInput } from '@restro/core/service/notices'

import type { NoticeConnector, NoticeEnv, PaymentsEnv } from '@/connectors/notice-types'
import { logError, logInfo, logWarn } from '@/server/log'

/** The largest body taken: 1 MiB. A provider's event is a few kilobytes. */
export const MAX_NOTICE_BYTES = 1024 * 1024

/** What the inbox works with, given by the route (and by the tests). */
export interface NoticeInbox {
  readonly env: NoticeEnv
  readonly paymentsEnv: PaymentsEnv | null
  readonly connectorFor: (kind: string, env: PaymentsEnv) => NoticeConnector | null
  readonly record: (input: RecordProviderNoticeInput) => Promise<'recorded' | 'duplicate'>
  readonly newJobId: () => string
  readonly now: () => Date
}

const answer = (status: number): Response =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } })

/**
 * The raw body as text, or null when it is over `cap` (by its declared length or as it streams)
 * or is not UTF-8. A byte-order mark is kept: the signature covers it.
 */
export async function readCappedBody(request: Request, cap: number): Promise<string | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null && !(Number(declared) <= cap)) return null
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > cap) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks))
  } catch {
    return null
  }
}

/** Handles one notice for the provider `kind` named in the address. */
export async function handleNotice(
  request: Request,
  kind: string,
  inbox: NoticeInbox,
): Promise<Response> {
  const environment = inbox.paymentsEnv
  if (environment === null) {
    logError('payment_notice.not_configured')
    return answer(503)
  }
  const connector = inbox.connectorFor(kind, environment)
  if (connector === null) return answer(404)
  const secret = connector.secret(inbox.env)
  if (secret === null) {
    logError('payment_notice.not_configured')
    return answer(503)
  }

  const rawBody = await readCappedBody(request, MAX_NOTICE_BYTES)
  if (rawBody === null) {
    logWarn('payment_notice.refused', { kind: connector.kind, reason: 'too_large' })
    return answer(413)
  }
  const live = environment === 'production'
  const verified = connector.verify(rawBody, request.headers, secret, inbox.now(), live)
  if (!verified.ok) {
    logWarn('payment_notice.refused', { kind: connector.kind, reason: verified.reason })
    return answer(verified.reason === 'wrong_mode' ? 200 : 400)
  }

  try {
    const stored = await inbox.record({
      providerKind: connector.kind,
      live,
      notice: verified.notice,
      jobId: inbox.newJobId(),
    })
    logInfo(`payment_notice.${stored}`, { kind: connector.kind, notice: verified.notice.kind })
    return answer(200)
  } catch (error) {
    logError('payment_notice.store_failed', error)
    return answer(500)
  }
}
