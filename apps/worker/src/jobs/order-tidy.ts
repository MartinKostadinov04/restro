// The idle order job (#75; D121, design §6).
//
//   order-tidy-tick  every minute: for each open table whose order nobody touched for the idle
//                    time, runs `order.tidy` through `applyService`, which sets the order aside
//                    as the table's earlier order ("Earlier order · Restore"); the same tick
//                    lapses the waiter calls nobody answered (./waiter-call-lapse.ts, #81)
//
// A phone's read of the table does the same before it answers, so a table being read never waits
// for this tick; the tick covers the tables nobody reads, so the order is aside when a phone comes
// back. `order.tidy` changes nothing when nothing is due, so a run that races a phone is harmless.
// A table that fails is logged and skipped, so it never holds up the tables after it.

import { randomUUID } from 'node:crypto'

import { JOB_NAMES } from '@restro/core'
import { applyService } from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  sittings,
  tableOrders,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNull, lte } from 'drizzle-orm'

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
  },
})
