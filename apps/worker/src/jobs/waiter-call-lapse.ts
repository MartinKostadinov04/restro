// The waiter calls that lapse (#81; D122 §4), run by the minute tick beside the idle orders
// (./order-tidy.ts). A call nobody marked Handled lapses after the venue's time (15 minutes by
// default, `callLapseMinutes`); one whose sitting has ended lapses at once. `waiter_call.lapse`
// decides again under the call's lock, so a run that races a Handled or another run changes
// nothing. A call that throws is logged and skipped, so it never holds up the calls after it.

import { randomUUID } from 'node:crypto'

import { readOrderingSettings } from '@restro/core'
import { applyService, waiterCallLapsesAt } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  sittings,
  venues,
  waiterCalls,
  withSystem,
  withTenant,
} from '@restro/db'
import { eq } from 'drizzle-orm'

import type { Logger } from '../logger'

/** One open call that is due to lapse. */
export interface DueWaiterCall {
  readonly tenantId: string
  readonly venueId: string
  readonly waiterCallId: string
}

/** The open calls whose time has passed or whose sitting has ended at `now`, in every organisation. */
export async function dueWaiterCalls(pool: DbPool, now: Date): Promise<DueWaiterCall[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const due: DueWaiterCall[] = []
  for (const organisation of organisations) {
    const open = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({
          id: waiterCalls.id,
          venueId: waiterCalls.venueId,
          lastCalledAt: waiterCalls.lastCalledAt,
          settings: venues.settings,
          sittingEndedAt: sittings.endedAt,
        })
        .from(waiterCalls)
        .innerJoin(venues, eq(venues.id, waiterCalls.venueId))
        .innerJoin(sittings, eq(sittings.id, waiterCalls.sittingId))
        .where(eq(waiterCalls.state, 'open')),
    )
    for (const call of open) {
      const lapseMinutes = readOrderingSettings(call.settings).callLapseMinutes
      if (
        call.sittingEndedAt !== null ||
        waiterCallLapsesAt(call.lastCalledAt, lapseMinutes).getTime() <= now.getTime()
      ) {
        due.push({ tenantId: organisation.id, venueId: call.venueId, waiterCallId: call.id })
      }
    }
  }
  return due
}

/** Lapses every due call; answers how many lapsed. A call that throws is skipped. */
export async function lapseWaiterCalls(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn'>,
): Promise<number> {
  let lapsed = 0
  for (const call of await dueWaiterCalls(pool, now)) {
    try {
      const { result } = await applyService(
        pool,
        { type: 'waiter_call.lapse', waiterCallId: call.waiterCallId },
        {
          tenantId: call.tenantId,
          venueId: call.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `waiter-call-lapse-${randomUUID()}`,
        },
      )
      if (result.status === 'accepted' && result.details.changed === true) lapsed += 1
    } catch (error) {
      log.warn({ waiterCallId: call.waiterCallId, err: error }, 'a waiter call could not lapse')
    }
  }
  return lapsed
}
