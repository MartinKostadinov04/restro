// The payment provider's breaker at one venue (#112; D127 3.8, D120's rule): when no call to the
// venue's payment provider succeeded for 60 s, with at least 3 attempts, paying in the app pauses
// there; it lifts the same way a connection pause does (probes, 3 good in a row). Ordering never
// stops for it: the pause is the payment account's `paying_paused_at`, never a `pauses` row (those
// stop ordering at their target).
//
// The pure breaker (`stepBreaker`) decides in the worker; `paying.breaker` writes what it answers:
// - `pause`: paying pauses (new payments are refused `paying_paused`, a waiting one is cancelled at
//   its turn) and the owners, managers and Restro's team are told once;
// - `progress`: the breaker's state only, so a restarted worker restores it;
// - `lift`: paying is back, and the alert closes (its rule says "back").

import { alerts, paymentAccounts } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '../ids'
import { PAYING_PAUSED_KIND } from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { accepted, refused } from './results'

const Cause = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const BreakerJson = z.record(z.string(), z.unknown())

/** True while the provider's breaker pauses paying in the app at the venue. */
export async function payingPaused(stx: ServiceTx): Promise<boolean> {
  const [account] = await stx.tx
    .select({ pausedAt: paymentAccounts.payingPausedAt })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.venueId, stx.venueId))
  return account !== undefined && account.pausedAt !== null
}

/** `paying.breaker`: the provider's breaker paused paying at the venue, moved, or lifted. */
export function payingBreaker() {
  return defineCommand({
    schema: z.strictObject({
      type: z.literal('paying.breaker'),
      action: z.enum(['pause', 'progress', 'lift']),
      cause: Cause.nullable().default(null),
      breaker: BreakerJson,
    }),
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    async handle(stx, command) {
      stx.rows.claim('alert', [`${PAYING_PAUSED_KIND}:${stx.venueId}`])
      const [open] = await stx.tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(
          and(
            eq(alerts.kind, PAYING_PAUSED_KIND),
            eq(alerts.subjectId, stx.venueId),
            isNull(alerts.doneAt),
          ),
        )
        .for('update')
      stx.rows.claim('payment', [`account:${stx.venueId}`])
      const [account] = await stx.tx
        .select({ pausedAt: paymentAccounts.payingPausedAt })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.venueId, stx.venueId))
        .for('update')
      if (account === undefined) return refused(null, 'paying_not_offered')
      const paused = account.pausedAt !== null
      const set = (more: Partial<typeof paymentAccounts.$inferInsert>) =>
        stx.tx
          .update(paymentAccounts)
          .set({ breaker: command.breaker, ...more, ...stx.provenance, updatedAt: sql`now()` })
          .where(eq(paymentAccounts.venueId, stx.venueId))

      if (command.action === 'progress') {
        await set({})
        return accepted(null, { details: { paused, changed: false } })
      }
      if (command.action === 'pause') {
        if (paused) {
          await set({})
          return accepted(null, { details: { paused: true, changed: false } })
        }
        await set({ payingPausedAt: await stx.dbNow() })
        const cause = command.cause ?? 'provider_unreachable'
        if (open === undefined) {
          const id = newId('al')
          await stx.tx.insert(alerts).values({
            id,
            tenantId: stx.tenantId,
            venueId: stx.venueId,
            serviceDate: stx.serviceDate,
            kind: PAYING_PAUSED_KIND,
            audience: 'venue',
            subjectId: stx.venueId,
            permission: 'money.follow_up',
            details: { cause },
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          // The Log shows the pause as its alert (D120: Restro's pauses have no entry of their own).
          await stx.log({
            kind: 'alert.raised',
            reason: PAYING_PAUSED_KIND,
            details: { alertId: id, cause },
          })
        }
        return accepted(null, { details: { paused: true, changed: true } })
      }
      if (!paused) {
        await set({})
        return accepted(null, { details: { paused: false, changed: false } })
      }
      await set({ payingPausedAt: null })
      if (open !== undefined) {
        await stx.tx
          .update(alerts)
          .set({
            doneAt: sql`now()`,
            doneBy: stx.provenance.actor,
            via: stx.via,
            nextRepeatAt: null,
            ...stx.provenance,
            updatedAt: sql`now()`,
          })
          .where(eq(alerts.id, open.id))
        await stx.log({
          kind: 'alert.done',
          reason: PAYING_PAUSED_KIND,
          details: { alertId: open.id, lifted: true },
        })
      }
      return accepted(null, { details: { paused: false, changed: true } })
    },
  })
}
