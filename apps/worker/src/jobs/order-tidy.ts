// The idle order job (#75; D121, design §6).
//
//   order-tidy-tick  every minute: for each open table whose order nobody touched for the idle
//                    time, runs `order.tidy` through `applyService`, which sets the order aside
//                    as the table's earlier order ("Earlier order · Restore"); the same tick
//                    lapses the waiter calls nobody answered (./waiter-call-lapse.ts, #81) and
//                    lifts the Unconfirmed table pauses older than 15 minutes (`sweep`, #79)
//
// A phone's read of the table does the same before it answers, so a table being read never waits
// for this tick; the tick covers the tables nobody reads, so the order is aside when a phone comes
// back. `order.tidy` changes nothing when nothing is due, so a run that races a phone is harmless.
// A table that fails is logged and skipped, so it never holds up the tables after it.

import { randomUUID } from 'node:crypto'

import { JOB_NAMES } from '@restro/core'
import { applyService, ORDER_UNCONFIRMED_CAUSE, UNCONFIRMED_PAUSE_MS } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  pauses,
  sittings,
  tableOrders,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNull, lte, sql } from 'drizzle-orm'

import type { Logger } from '../logger'
import { defineJob, type JobDefinition } from './types'
import { lapseWaiterCalls } from './waiter-call-lapse'

/** One table whose order is due to be set aside. */
export interface IdleOrder {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}

/** The open tables whose order went idle at or before `now`, in every organisation. */
export async function idleOrders(pool: DbPool, now: Date): Promise<IdleOrder[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const due: IdleOrder[] = []
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({ venueId: tableOrders.venueId, tableId: tableOrders.tableId })
        .from(tableOrders)
        .innerJoin(sittings, eq(sittings.id, tableOrders.sittingId))
        .where(and(isNull(sittings.endedAt), lte(tableOrders.idleExpiresAt, now))),
    )
    for (const row of rows) due.push({ tenantId: organisation.id, ...row })
  }
  return due
}

/** Sets aside every idle order; answers how many were set aside. A table that throws is skipped. */
export async function tidyIdleOrders(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn'>,
): Promise<number> {
  let tidied = 0
  for (const order of await idleOrders(pool, now)) {
    try {
      const { result } = await applyService(
        pool,
        { type: 'order.tidy', tableId: order.tableId },
        {
          tenantId: order.tenantId,
          venueId: order.venueId,
          origin: 'worker',
          actor: { kind: 'system' },
          jobId: `order-tidy-${randomUUID()}`,
        },
      )
      if (result.status === 'accepted' && result.details.changed === true) tidied += 1
    } catch (error) {
      log.warn({ tableId: order.tableId, err: error }, 'an idle order could not be set aside')
    }
  }
  return tidied
}

/**
 * Lifts the Unconfirmed table pauses older than 15 minutes (#79): `sweep` for each venue that has
 * one; the command decides again under the tables' locks. Answers how many were lifted.
 */
export async function sweepUnconfirmedPauses(
  pool: DbPool,
  log: Pick<Logger, 'warn'>,
): Promise<number> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let lifted = 0
  for (const organisation of organisations) {
    const due = await withTenant(pool, organisation.id, (tx) =>
      tx
        .selectDistinct({ venueId: pauses.venueId })
        .from(pauses)
        .where(
          and(
            eq(pauses.scope, 'table'),
            eq(pauses.cause, ORDER_UNCONFIRMED_CAUSE),
            isNull(pauses.liftedAt),
            lte(
              pauses.startedAt,
              sql`now() - make_interval(secs => ${UNCONFIRMED_PAUSE_MS / 1000})`,
            ),
          ),
        ),
    )
    for (const { venueId } of due) {
      try {
        const { result } = await applyService(
          pool,
          { type: 'sweep' },
          {
            tenantId: organisation.id,
            venueId,
            origin: 'worker',
            actor: { kind: 'system' },
            jobId: `order-tidy-${randomUUID()}`,
          },
        )
        if (result.status === 'accepted') lifted += Number(result.details.lifted ?? 0)
      } catch (error) {
        log.warn({ venueId, err: error }, 'the unconfirmed pauses could not be swept')
      }
    }
  }
  return lifted
}

/** `order-tidy-tick`. */
export const orderTidyTick: JobDefinition = defineJob({
  name: JOB_NAMES.orderTidyTick,
  schedule: { cron: '* * * * *', tz: 'Europe/Sofia' },
  options: {
    queue: {
      retryLimit: 0,
      expireInSeconds: 120,
      retentionSeconds: 10 * 60,
      deleteAfterSeconds: 60 * 60,
    },
  },
  async handler(_jobs, context) {
    const tidied = await tidyIdleOrders(context.pool, context.now(), context.log)
    if (tidied > 0) context.log.info({ tidied }, 'idle orders set aside')
    const lapsed = await lapseWaiterCalls(context.pool, context.now(), context.log)
    if (lapsed > 0) context.log.info({ lapsed }, 'waiter calls lapsed')
    const unpaused = await sweepUnconfirmedPauses(context.pool, context.log)
    if (unpaused > 0) context.log.info({ unpaused }, 'unconfirmed table pauses lifted')
  },
})
