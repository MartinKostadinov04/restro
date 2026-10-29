// Reads for the payment parts of Tonight (#115), as the signed-in actor, shaped for the screens by
// `payment-view.ts`. Reads only: nothing here writes and no provider is called. The service read
// side refuses what the actor does not hold, so a part a role may not see never gets its data.
import { readNightPayments, readPaymentDetail } from '@restro/core/service'

import { PAYMENT_RELEASE_REASONS } from '@/tonight/payment-state-words'

import { getPool } from '../db'
import { logInfo } from '../log'
import { type NightResult, type NightScope, sourceOf } from './night-load'
import { frameOf } from './night-view'
import {
  type PaymentDetailView,
  type PaymentsView,
  paymentDetailView,
  paymentsView,
  reasonsWithoutWord,
} from './payment-view'

/** The payments of one service day (end of night sections 1, 3–6); `all` lists every payment. */
export async function loadNightPayments(
  scope: NightScope,
  query: { readonly day?: string; readonly all?: number },
): Promise<NightResult<{ payments: PaymentsView }>> {
  const read = await readNightPayments(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    ...(scope.now === undefined ? {} : { now: scope.now }),
    ...query,
  })
  if (!read.ok) return read
  for (const reason of reasonsWithoutWord(read.payments.rows, PAYMENT_RELEASE_REASONS)) {
    logInfo('payment_reason_without_word', { reason })
  }
  return {
    ok: true,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now: scope.now ?? new Date(),
    }),
    payments: paymentsView(read.payments, read.access.venue.timezone),
  }
}

/** One payment for its sheet; null `detail` when it is not this venue's. */
export async function loadPaymentDetail(
  scope: NightScope,
  paymentId: string,
): Promise<NightResult<{ detail: PaymentDetailView | null }>> {
  const read = await readPaymentDetail(getPool(), {
    tenantId: scope.tenantId,
    venueId: scope.venue.id,
    actor: scope.actor,
    paymentId,
  })
  if (!read.ok) return read
  return {
    ok: true,
    frame: frameOf(read.access, {
      venueId: scope.venue.id,
      source: await sourceOf(scope, read.access),
      now: scope.now ?? new Date(),
    }),
    detail:
      read.detail === null ? null : paymentDetailView(read.detail, read.access.venue.timezone),
  }
}
