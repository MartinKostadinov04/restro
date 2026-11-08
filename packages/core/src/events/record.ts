// `recordEvents`, the one write path of the guest events (D142; rule 1): nothing else writes
// `restro.guest_events`. One call writes a whole batch in one insert, append-only — there is no
// update and no delete here, and the app role holds neither (see packages/db/src/table-access.ts).
//
// Every row carries its provenance (rule 2 as D122 §9 puts it for service data: source, actor and
// job, NOT NULL, and no layer), the venue, the service day, the table and the moment. Nothing it
// writes can be personal data: the fields come from `GuestEventInputSchema`, which has none, and
// each event is parsed again here, so a caller in JavaScript cannot slip a field past the union.
//
// The caller's transaction is the unit: a service command records its own event inside the
// transaction that made the write it measures, so the two can never disagree. A batch from a
// phone gets a transaction of its own (`recordGuestEvents`).

import { guestEvents } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { z } from 'zod'

import { idSchema } from '../ids'
import { GuestEventBatchSchema, type GuestEventInput, guestEventRetentionOf } from './kinds'

/**
 * The `source` values a stored event may carry. The same list as the service rows'
 * (`packages/core/src/service/context.ts`) and the same check as the database's
 * (`guest_events_source` in packages/db/src/schema.ts); the database is the backstop.
 */
export const GUEST_EVENT_SOURCES = [
  'guest',
  'staff',
  'worker',
  'provider',
  'restro',
  'pos',
] as const

/** Where a recorded event came from. */
export type GuestEventSource = (typeof GUEST_EVENT_SOURCES)[number]

/**
 * Who it was, as the `actor` column's text: `guest`, `system`, `user:<id>`, `staff:sm_…`,
 * `operator:<id>` or `integration:in_…`. Never personal data.
 */
const ActorSchema = z
  .string()
  .regex(/^(system|guest|(user|staff|integration|operator):[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$/)

/** The id the server made for the web request, or the worker's job run. */
const JobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)

/** Where a batch of events belongs and who wrote it: the caller's, never the phone's claim. */
export const GuestEventScopeSchema = z.strictObject({
  tenantId: idSchema('tn'),
  venueId: idSchema('vn'),
  /** The table whose code the phone showed. */
  tableId: idSchema('tb'),
  /** The venue's service day (`YYYY-MM-DD`), in its own time zone and day end. */
  serviceDate: z.iso.date(),
  /** The table's open sitting, where it has one; an event's own `sittingId` wins over it. */
  sittingId: idSchema('st').nullable().optional(),
  source: z.enum(GUEST_EVENT_SOURCES),
  actor: ActorSchema,
  jobId: JobIdSchema,
})

/** Where a batch of events belongs. */
export type GuestEventScope = z.input<typeof GuestEventScopeSchema>

/**
 * Writes a batch of guest events inside `tx`. Checked with Zod first — the scope and every event —
 * so a bad batch throws before the database is asked and the caller's transaction rolls back.
 * Returns the `seq` of each row written, in the order given.
 *
 * An empty batch writes nothing and asks the database nothing.
 */
export async function recordEvents(
  tx: WriteTx,
  scope: GuestEventScope,
  events: readonly GuestEventInput[],
): Promise<readonly number[]> {
  if (events.length === 0) return []
  const where = GuestEventScopeSchema.parse(scope)
  const batch = GuestEventBatchSchema.parse(events)
  const rows = batch.map((event) => ({
    tenantId: where.tenantId,
    venueId: where.venueId,
    serviceDate: where.serviceDate,
    kind: event.kind,
    tableId: where.tableId,
    sittingId: event.sittingId ?? where.sittingId ?? null,
    nodeId: event.kind === 'item.opened' ? event.itemId : null,
    amountMinor:
      (event.kind === 'pay.started' || event.kind === 'pay.finished') && event.amount !== undefined
        ? event.amount.amount_minor
        : null,
    currency:
      (event.kind === 'pay.started' || event.kind === 'pay.finished') && event.amount !== undefined
        ? event.amount.currency
        : null,
    locale: event.kind === 'language.chosen' ? event.locale : null,
    outcome:
      event.kind === 'order.send_attempted' || event.kind === 'pay.finished' ? event.outcome : null,
    retention: guestEventRetentionOf(event.kind),
    source: where.source,
    actor: where.actor,
    jobId: where.jobId,
    // `at` defaults to the database's clock; a phone's own tap is placed back by its reported age.
    ...(event.at === undefined ? {} : { at: event.at }),
  }))
  const written = await tx.insert(guestEvents).values(rows).returning({ seq: guestEvents.seq })
  return written.map((row) => row.seq)
}
