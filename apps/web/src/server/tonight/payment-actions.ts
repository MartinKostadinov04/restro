'use server'

// The reads of the payment parts of Tonight that the browser asks again (#115): the night's payments
// ("Show all") and one payment's sheet. Read-only server actions, like night-actions.ts: each checks
// its input with Zod, finds who is asking (`requireTenant`) and that the venue is theirs, then reads
// as that signed-in account; the service read side checks the permission again. The answer to a
// payment is `answerPaymentAction` (actions.ts), not here.
import { idSchema } from '@restro/core'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'

import { logError } from '../log'
import { requireTenant } from '../session'
import { getVenue } from '../venues'
import type { NightScope } from './night-load'
import type { Frame } from './night-view'
import { loadNightPayments, loadPaymentDetail } from './payment-load'
import type { PaymentDetailView, PaymentsView } from './payment-view'

const venueId = idSchema('vn')
const Payment = z.strictObject({ venueId, paymentId: idSchema('py') })
const Payments = z.strictObject({
  venueId,
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  all: z.int().min(1).max(2000),
})

type ReadAnswer<T> = ({ readonly ok: true; readonly frame: Frame } & T) | { readonly ok: false }

const FAILED = { ok: false } as const

async function scopeOf(id: string): Promise<NightScope | null> {
  const { organization, user, sessionId } = await requireTenant()
  const venue = await getVenue(organization.id, id)
  if (!venue) return null
  return {
    tenantId: organization.id,
    venue,
    actor: { kind: 'user', userId: user.id, sessionId },
    sourceNone: (await getTranslations('tonight'))('source_none'),
  }
}

async function answer<T>(
  event: string,
  read: () => Promise<
    | ({ readonly ok: true; readonly frame: Frame } & T)
    | { readonly ok: false; readonly code?: string }
  >,
): Promise<ReadAnswer<T>> {
  try {
    const result = await read()
    return result.ok ? (result as ReadAnswer<T>) : FAILED
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(event, error)
    return FAILED
  }
}

/** The night's payments, every one of them (the end of the night's "Show all {n}"). */
export async function nightPaymentsAction(
  input: unknown,
): Promise<ReadAnswer<{ payments: PaymentsView }>> {
  const parsed = Payments.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('tonight_payments_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadNightPayments(scope, {
      ...(parsed.data.day === undefined ? {} : { day: parsed.data.day }),
      all: parsed.data.all,
    })
  })
}

/** One payment's sheet. */
export async function paymentDetailAction(
  input: unknown,
): Promise<ReadAnswer<{ detail: PaymentDetailView | null }>> {
  const parsed = Payment.safeParse(input)
  if (!parsed.success) return FAILED
  return answer('tonight_payment_failed', async () => {
    const scope = await scopeOf(parsed.data.venueId)
    if (scope === null) return FAILED
    return loadPaymentDetail(scope, parsed.data.paymentId)
  })
}
