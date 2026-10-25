// Stripe's notices (webhook events) for the notice route (#108; D126, D127 1.4). Checked by hand
// with node:crypto, never the Stripe SDK, as https://docs.stripe.com/webhooks.md describes
// ("Verify webhook signatures"; facts dated in docs/deliverables/2026-10-22-stripe-knowledge.md):
//
// - the `Stripe-Signature` header is `t=<unix seconds>,v1=<signature>[,v1=…][,v0=…]`;
// - the signature is a hex HMAC-SHA256 of `t + "." + raw body` under the endpoint's secret;
// - several v1 appear while a secret is rolled, and any may match; v0 is a test scheme, ignored;
// - the libraries' default tolerance is five minutes;
// - an event from a connected account carries that account's id in `account`.
//
// The event is only a pointer: the worker reads the object back from Stripe (#107), so no amount
// or state is taken from the body. A live event in a test environment, or a test event in
// production, is refused (`livemode`).
import { type ProviderNotice, type ProviderNoticeKind, ProviderNoticeSchema } from '@restro/core'
import { z } from 'zod'

import { type NoticeConnector, setting } from '../notice-types'
import { checkSignedBody } from '../signed-notices'

/** The header Stripe signs with. */
export const STRIPE_SIGNATURE_HEADER = 'stripe-signature'

/** What the route reads of a Stripe event; everything else in it is ignored. */
const StripeEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  livemode: z.boolean(),
  account: z.string().optional(),
  data: z.object({ object: z.object({ id: z.string() }) }),
})

/** The platform's kind of a Stripe event type; any type with no handler is `other`. */
export function stripeNoticeKind(type: string): ProviderNoticeKind {
  if (
    type === 'charge.refunded' ||
    type === 'charge.refund.updated' ||
    type === 'refund.created' ||
    type === 'refund.updated' ||
    type === 'refund.failed'
  ) {
    return 'refund'
  }
  if (type.startsWith('charge.dispute.')) return 'dispute'
  return 'other'
}

function parseEvent(rawBody: string): z.output<typeof StripeEventSchema> | null {
  try {
    const parsed = StripeEventSchema.safeParse(JSON.parse(rawBody))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const noticeConnector: NoticeConnector = {
  kind: 'stripe',

  offered: () => true,

  secret: (env) => setting(env, 'STRIPE_NOTICE_SECRET'),

  verify(rawBody, headers, secret, now, live) {
    const refusal = checkSignedBody(rawBody, headers.get(STRIPE_SIGNATURE_HEADER), secret, now)
    if (refusal !== null) return { ok: false, reason: refusal }
    const event = parseEvent(rawBody)
    if (event === null) return { ok: false, reason: 'malformed' }
    if (event.livemode !== live) return { ok: false, reason: 'wrong_mode' }
    const notice = ProviderNoticeSchema.safeParse({
      id: event.id,
      type: event.type,
      kind: stripeNoticeKind(event.type),
      accountRef: event.account === undefined ? null : { provider: event.account },
      objectRef: { provider: event.data.object.id },
    } satisfies Record<keyof ProviderNotice, unknown>)
    return notice.success ? { ok: true, notice: notice.data } : { ok: false, reason: 'malformed' }
  },
}
