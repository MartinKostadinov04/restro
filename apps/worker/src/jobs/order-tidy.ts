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
// A table that fails is logged and skipped, so it never holds up the tables after it; so is an
// organisation whose listing fails, and each of the tick's three passes runs whatever the others do
// (screen round 11-18, C4): one tenant's error never stops the waiter calls or pauses of the rest.

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

/**
 * The open tables whose order went idle at or before `now`, in every organisation. An organisation
 * whose listing throws is logged, added to `failed` and skipped; the caller fails once the rest ran.
 */
export async function idleOrders(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn' | 'error'>,
  failed: unknown[] = [],
): Promise<IdleOrder[]> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const due: IdleOrder[] = []
  for (const organisation of organisations) {
    try {
      const rows = await withTenant(pool, organisation.id, (tx) =>
        tx
          .select({ venueId: tableOrders.venueId, tableId: tableOrders.tableId })
          .from(tableOrders)
          .innerJoin(sittings, eq(sittings.id, tableOrders.sittingId))
          .where(and(isNull(sittings.endedAt), lte(tableOrders.idleExpiresAt, now))),
      )
      for (const row of rows) due.push({ tenantId: organisation.id, ...row })
    } catch (error) {
      log.error({ tenantId: organisation.id, err: error }, 'the idle orders could not be listed')
      failed.push(error)
    }
  }
  return due
}

/**
 * Sets aside every idle order; answers how many were set aside. A table that throws is skipped; an
 * organisation that could not be listed fails the pass after the others' orders were set aside.
 */
export async function tidyIdleOrders(
  pool: DbPool,
  now: Date,
  log: Pick<Logger, 'warn' | 'error'>,
): Promise<number> {
  let tidied = 0
  const failed: unknown[] = []
  for (const order of await idleOrders(pool, now, log, failed)) {
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
  throwIfAny(failed, 'idle orders')
  return tidied
}

/** Fails a pass whose organisations could not all be listed, so the tick's record shows it (C4). */
export function throwIfAny(failed: readonly unknown[], what: string): void {
  if (failed.length > 0) {
    throw new AggregateError(failed, `${failed.length} organisation(s) could not list ${what}`)
  }
}

/**
 * Lifts the Unconfirmed table pauses older than 15 minutes (#79): `sweep` for each venue that has
 * one; the command decides again under the tables' locks. Answers how many were lifted.
 */
export async function sweepUnconfirmedPauses(
  pool: DbPool,
  log: Pick<Logger, 'warn' | 'error'>,
): Promise<number> {
  const failed: unknown[] = []
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let lifted = 0
  for (const organisation of organisations) {
    let due: readonly { readonly venueId: string }[]
    try {
      due = await withTenant(pool, organisation.id, (tx) =>
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
    } catch (error) {
      log.error(
        { tenantId: organisation.id, err: error },
        'the unconfirmed pauses could not be listed',
      )
      failed.push(error)
      continue
    }
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
  throwIfAny(failed, 'unconfirmed pauses')
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
    // Each pass runs whatever the one before it did (C4); the tick fails only after all three ran,
    // so the error still reaches the queue's record.
    const failed: { readonly pass: string; readonly error: unknown }[] = []
    const pass = async (name: string, run: () => Promise<void>) => {
      try {
        await run()
      } catch (error) {
        context.log.error({ pass: name, err: error }, 'an order-tidy pass failed')
        failed.push({ pass: name, error })
      }
    }
    await pass('tidy', async () => {
      const tidied = await tidyIdleOrders(context.pool, context.now(), context.log)
      if (tidied > 0) context.log.info({ tidied }, 'idle orders set aside')
    })
    await pass('lapse', async () => {
      const lapsed = await lapseWaiterCalls(context.pool, context.now(), context.log)
      if (lapsed > 0) context.log.info({ lapsed }, 'waiter calls lapsed')
    })
    await pass('sweep', async () => {
      const unpaused = await sweepUnconfirmedPauses(context.pool, context.log)
      if (unpaused > 0) context.log.info({ unpaused }, 'unconfirmed table pauses lifted')
    })
    if (failed.length > 0) {
      throw new AggregateError(
        failed.map((each) => each.error),
        `order-tidy-tick: ${failed.map((each) => each.pass).join(', ')} failed`,
      )
    }
  },
})
