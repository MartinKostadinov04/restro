// The simulated provider's notices (#108): what it sends when the venue refunds in its dashboard
// or the guest's bank disputes a payment, and how it signs them. It claims nothing about any real
// provider; the scheme is the common one, an HMAC-SHA256 of `timestamp.body` under a shared
// secret, so the web's verifier for it (`apps/web/src/connectors/sim-pay/notices.ts`) is checked
// the way a real provider's is. The two sides share no code (the web never imports a provider
// package): the same signed vector is pinned in both packages' tests.

import { createHmac } from 'node:crypto'

import { type ProviderNotice, type ProviderNoticeKind, providerRef } from '@restro/core'

/** The header that carries the signature: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const SIM_PAY_SIGNATURE_HEADER = 'sim-pay-signature'

/** A notice as the simulator sends it: the JSON body, a pointer with no amounts or states. */
export interface SimPayEvent {
  readonly id: string
  readonly type: 'refund.made' | 'dispute.opened' | 'dispute.closed'
  /** The venue's account the object belongs to. */
  readonly account: string
  /** The refund or the dispute. */
  readonly object: string
  /** Always false: the simulator never runs live. */
  readonly livemode: false
}

/** A notice ready to post: the raw body and its headers. */
export interface SimPayWireNotice {
  readonly body: string
  readonly headers: Readonly<Record<string, string>>
}

/** The platform's kind of a simulator event type; anything it does not know is `other`. */
export function simPayNoticeKind(type: string): ProviderNoticeKind {
  if (type === 'refund.made') return 'refund'
  if (type === 'dispute.opened' || type === 'dispute.closed') return 'dispute'
  return 'other'
}

/** The verified notice the web's verifier makes of an event. */
export function simPayNotice(event: SimPayEvent): ProviderNotice {
  return {
    id: event.id,
    type: event.type,
    kind: simPayNoticeKind(event.type),
    accountRef: providerRef(event.account),
    objectRef: providerRef(event.object),
  }
}

/** Signs an event at `now` with the endpoint's secret, as the simulator posts it. */
export function signSimPayNotice(event: SimPayEvent, secret: string, now: Date): SimPayWireNotice {
  const body = JSON.stringify(event)
  const timestamp = Math.floor(now.getTime() / 1000)
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return {
    body,
    headers: {
      'content-type': 'application/json',
      [SIM_PAY_SIGNATURE_HEADER]: `t=${timestamp},v1=${signature}`,
    },
  }
}
