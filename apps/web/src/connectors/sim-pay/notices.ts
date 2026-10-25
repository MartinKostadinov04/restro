// The simulated payment provider's notices for the notice route (#108; #103). The simulator signs
// the common way (`../signed-notices.ts`) in the `sim-pay-signature` header; its body is
// `{ id, type, account, object, livemode }`, a pointer with no amounts. The web never imports the
// simulator's package: the signed vector its tests pin is pinned in this folder's test too.
// Never offered in production, where the route answers 404 for this kind.
import { type ProviderNoticeKind, ProviderNoticeSchema } from '@restro/core'
import { z } from 'zod'

import { type NoticeConnector, setting } from '../notice-types'
import { checkSignedBody } from '../signed-notices'

/** The header the simulator signs with. */
export const SIM_PAY_SIGNATURE_HEADER = 'sim-pay-signature'

const SimPayEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  account: z.string(),
  object: z.string(),
  livemode: z.boolean(),
})

/** The platform's kind of a simulator event type; anything else is `other`. */
export function simPayNoticeKind(type: string): ProviderNoticeKind {
  if (type === 'refund.made') return 'refund'
  if (type === 'dispute.opened' || type === 'dispute.closed') return 'dispute'
  return 'other'
}

function parseEvent(rawBody: string): z.output<typeof SimPayEventSchema> | null {
  try {
    const parsed = SimPayEventSchema.safeParse(JSON.parse(rawBody))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const noticeConnector: NoticeConnector = {
  kind: 'sim-pay',

  offered: (env) => env !== 'production',

  secret: (env) => setting(env, 'SIM_PAY_NOTICE_SECRET'),

  verify(rawBody, headers, secret, now, live) {
    const refusal = checkSignedBody(rawBody, headers.get(SIM_PAY_SIGNATURE_HEADER), secret, now)
    if (refusal !== null) return { ok: false, reason: refusal }
    const event = parseEvent(rawBody)
    if (event === null) return { ok: false, reason: 'malformed' }
    if (event.livemode !== live) return { ok: false, reason: 'wrong_mode' }
    const notice = ProviderNoticeSchema.safeParse({
      id: event.id,
      type: event.type,
      kind: simPayNoticeKind(event.type),
      accountRef: { provider: event.account },
      objectRef: { provider: event.object },
    })
    return notice.success ? { ok: true, notice: notice.data } : { ok: false, reason: 'malformed' }
  },
}
