// The pre-opening check's alert (#82; D120, D122 §4): from 30 minutes before opening, a check that
// finds Restro cannot work with the POS tells the venue's staff and Restro's admin team. The
// worker runs the check (it calls the POS); this command only records the alert, once per venue
// and night and audience, so the check's later runs repeat nothing. A closed night has no opening
// and so no check, and the worker never sends this for it.

import { alerts } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '../ids'
import { defineCommand, type ServiceTx } from './definition'
import { accepted, type ServiceResult } from './results'

/** The alert kind of a failed pre-opening check. */
export const PRE_OPENING_ALERT = 'pre_opening_check'

/** Who the alert goes to, with the permission that answers it (null: Restro's admin team). */
const AUDIENCES = [
  { audience: 'venue', permission: 'alerts.answer' },
  { audience: 'restro', permission: null },
] as const

const CAUSE = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

const schema = z.strictObject({
  type: z.literal('hours.pre_opening_alert'),
  /** The night about to open. */
  serviceDate: z.iso.date(),
  /** When it opens. */
  opensAt: z.iso.datetime({ offset: true }),
  /** Why Restro can't work with the POS: a refusal's code, `training_mode`, `unreachable`… */
  cause: CAUSE,
})

async function raise(
  stx: ServiceTx,
  command: z.infer<typeof schema>,
  who: (typeof AUDIENCES)[number],
): Promise<boolean> {
  const [open] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.kind, PRE_OPENING_ALERT),
        eq(alerts.subjectId, stx.venueId),
        eq(alerts.serviceDate, command.serviceDate),
        eq(alerts.audience, who.audience),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  if (open !== undefined) return false
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: command.serviceDate,
    kind: PRE_OPENING_ALERT,
    audience: who.audience,
    subjectId: stx.venueId,
    permission: who.permission,
    details: { cause: command.cause, opensAt: command.opensAt },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    reason: PRE_OPENING_ALERT,
    details: { alertId: id, audience: who.audience, cause: command.cause },
  })
  return true
}

/** `hours.pre_opening_alert`: one open alert per audience for the night; a repeat adds none. */
export async function raisePreOpeningAlert(
  stx: ServiceTx,
  command: z.infer<typeof schema>,
): Promise<ServiceResult> {
  stx.rows.claim('alert', [`${PRE_OPENING_ALERT}:${stx.venueId}:${command.serviceDate}`])
  let raised = 0
  for (const who of AUDIENCES) if (await raise(stx, command, who)) raised += 1
  return accepted(null, { details: { raised } })
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
