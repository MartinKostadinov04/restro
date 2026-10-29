// The pre-opening check's alert (#82; D120, D122 §4): from 30 minutes before opening, a check that
// finds Restro cannot work with the POS tells the venue's staff and Restro's admin team. The
// worker runs the check (it calls the POS); this command only records the alert, once per venue
// and night. One row serves both: the kind's delivery rules (`alert-rules.ts`, #83) tell the
// ticked accounts, the venue's Telegram group and the Restro team's chat, even outside service
// hours. A closed night has no opening and so no check; the worker never sends this for it.

import { alerts } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '../ids'
import { PRE_OPENING_KIND } from './alert-rules'
import { defineCommand, type ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'

const CAUSE = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const schema = z.strictObject({
  type: z.literal('hours.pre_opening_alert'),
  /** The night about to open. */
  serviceDate: z.iso.date(),
  /** When it opens. */
  opensAt: z.iso.datetime({ offset: true }),
  /** Why Restro can't work with the POS: a refusal's code, `training_mode`, `pos_unreachable`… */
  cause: CAUSE,
})

/** `hours.pre_opening_alert`: one open alert for the night; a repeat adds none. */
export async function raisePreOpeningAlert(
  stx: ServiceTx,
  command: z.infer<typeof schema>,
): Promise<ServiceResult> {
  stx.rows.claim('alert', [`${PRE_OPENING_KIND}:${stx.venueId}:${command.serviceDate}`])
  const [open] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.kind, PRE_OPENING_KIND),
        eq(alerts.subjectId, stx.venueId),
        eq(alerts.serviceDate, command.serviceDate),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  if (open !== undefined) return accepted(null, { details: { raised: 0 } })
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: command.serviceDate,
    kind: PRE_OPENING_KIND,
    audience: 'venue',
    subjectId: stx.venueId,
    permission: 'alerts.answer',
    details: { cause: command.cause, opensAt: command.opensAt },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    reason: PRE_OPENING_KIND,
    details: { alertId: id, cause: command.cause },
  })
  return accepted(null, { details: { raised: 1 } })
}

/** The command's definition: the worker's. */
export const preOpeningAlert = () =>
  defineCommand({
    schema,
    origins: ['worker'],
    permission: null,
    idempotency: 'by_state',
    handle: raisePreOpeningAlert,
  })
