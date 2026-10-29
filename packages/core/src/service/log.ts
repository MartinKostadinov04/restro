// The Log appender (D120, D122 §7; design §4; spec #64, 14). Every state change of a sent order,
// sitting, pause, alert, waiter call, setting, role and permission is one append-only row of
// `log_entries`. Each kind has its retention class fixed here, so a writer can't keep a guard
// change for 31 days or a night's detail for 18 months: `night` entries go after 31 days, `record`
// entries (guard and permission changes) after 18 months. The purge compares the class and the
// service day only.
//
// `appendLogEntry` is also the one crossing the write-target guard allows from the menu side: a
// menu-side writer whose change the Log must show calls it inside its own transaction with its
// own provenance (design §2.6).

import { logEntries } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { z } from 'zod'

import { idSchema } from '../ids'
import { serviceDate } from '../service-day'
import { type Provenance, VIA_VALUES, type Via } from './context'

/** How long a Log entry is kept (D122 §7, §9). */
export type LogRetention = 'night' | 'record'

/** Days a `night` entry is kept after its service day. */
export const NIGHT_RETENTION_DAYS = 31

/** Months a `record` entry is kept after its service day. */
export const RECORD_RETENTION_MONTHS = 18

/**
 * The Log's kinds and their retention class. A ticket that logs a new kind adds it here; a kind
 * moves from `night` to `record` only, never back (it would erase a record early).
 */
export const LOG_KINDS = {
  'sitting.opened': 'night',
  'sitting.ended': 'night',
  'sent_order.state': 'night',
  // An Unconfirmed sent order found on the POS bill by a later reading (#135).
  'sent_order.landed_late': 'night',
  'pause.started': 'night',
  'pause.lifted': 'night',
  'alert.raised': 'night',
  'alert.done': 'night',
  // The day's close cleared an alert nobody answered (#162).
  'alert.cleared': 'night',
  'waiter_call.called': 'night',
  'waiter_call.done': 'night',
  'waiter_call.lapsed': 'night',
  // A paid receipt marked Brought, or put back by Undo (#200).
  'receipt.brought': 'night',
  'lease.taken_over': 'night',
  'service_day.closed': 'night',
  'guard.tripped': 'record',
  'settings.changed': 'record',
  'role.changed': 'record',
  'assignment.changed': 'record',
  'staff.changed': 'record',
  'pin.changed': 'record',
  'pin.revealed': 'record',
  'device.changed': 'record',
  'table_code.reissued': 'record',
  'table_code.revealed': 'record',
  // A payment's route (#111): held, moved, closed, captured, released, unconfirmed, capture failed,
  // and the staff's answers to an unconfirmed close. Money records, kept with the payment.
  'payment.state': 'record',
  'payment.answered': 'record',
  // A refund the venue made in its provider's dashboard, read back (lg_pay_refund), its storno
  // done or put back (lg_pay_storno), and a dispute opened or closed (lg_pay_dispute) (#222).
  'payment.refund_seen': 'record',
  'payment.storno': 'record',
  'payment.dispute': 'record',
} as const satisfies Record<string, LogRetention>

/** One kind of Log entry. */
export type LogKind = keyof typeof LOG_KINDS

/** The retention class of a kind. */
export function retentionOf(kind: LogKind): LogRetention {
  return LOG_KINDS[kind]
}

/** A state or reason as the Log keeps it: a short code, never free text. */
const CodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

/**
 * An entry's details: flat facts with short keys. Never a note, never guest data, never a POS id
 * (rule 3); the Log shows Restro's ids and codes.
 */
const LogDetailsSchema = z.record(
  z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/),
  z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
)

/** What a writer logs; the appender adds the venue, the day, the time and the provenance. */
export const LogEntryInputSchema = z.strictObject({
  kind: z.enum(Object.keys(LOG_KINDS) as [LogKind, ...LogKind[]]),
  sentOrderId: idSchema('so').optional(),
  paymentId: idSchema('py').optional(),
  tableId: idSchema('tb').optional(),
  sittingId: idSchema('st').optional(),
  fromState: CodeSchema.optional(),
  toState: CodeSchema.optional(),
  reason: CodeSchema.optional(),
  details: LogDetailsSchema.optional(),
})

/** What a writer logs. */
export type LogEntryInput = z.input<typeof LogEntryInputSchema>

/** Where the entry belongs and who wrote it: the transaction's, not the writer's choice. */
export interface LogEntryScope {
  readonly tenantId: string
  readonly venueId: string
  /** The venue's service day (`YYYY-MM-DD`). */
  readonly serviceDate: string
  readonly provenance: Provenance
  readonly via: Via | null
}

/**
 * Appends one Log entry inside `tx`. The entry is checked with Zod first, so a bad entry throws
 * before the database is asked and the caller's transaction rolls back.
 */
export async function appendLogEntry(
  tx: WriteTx,
  scope: LogEntryScope,
  input: LogEntryInput,
): Promise<{ readonly seq: number; readonly at: Date }> {
  const entry = LogEntryInputSchema.parse(input)
  if (scope.via !== null && !(VIA_VALUES as readonly string[]).includes(scope.via)) {
    throw new TypeError(`unknown via ${scope.via}`)
  }
  const [row] = await tx
    .insert(logEntries)
    .values({
      tenantId: scope.tenantId,
      venueId: scope.venueId,
      serviceDate: scope.serviceDate,
      kind: entry.kind,
      sentOrderId: entry.sentOrderId ?? null,
      paymentId: entry.paymentId ?? null,
      tableId: entry.tableId ?? null,
      sittingId: entry.sittingId ?? null,
      fromState: entry.fromState ?? null,
      toState: entry.toState ?? null,
      reason: entry.reason ?? null,
      via: scope.via,
      details: entry.details ?? {},
      retention: retentionOf(entry.kind),
      source: scope.provenance.source,
      actor: scope.provenance.actor,
      jobId: scope.provenance.jobId,
    })
    .returning({ seq: logEntries.seq, at: logEntries.at })
  if (row === undefined) throw new Error('the Log entry could not be written')
  return row
}

/**
 * When a row kept as a record (a sitting, a sent order, an archived staff member) may be erased:
 * 18 months after `from`, as the `retain_until` the service path sets (design §4).
 */
export function recordRetainUntil(from: Date): Date {
  const until = new Date(from.getTime())
  until.setUTCMonth(until.getUTCMonth() + RECORD_RETENTION_MONTHS)
  return until
}

/**
 * `months` calendar months before `at`, at the same time of day. A day the earlier month lacks
 * (the 31st, a 29 February) becomes that month's last day, so the result is never later than the
 * true one: a cutoff made from it can only keep a row longer.
 */
export function monthsBefore(at: Date, months: number): Date {
  const year = at.getUTCFullYear()
  const month = at.getUTCMonth() - months
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const until = new Date(at.getTime())
  until.setUTCFullYear(year, month, Math.min(at.getUTCDate(), lastDay))
  return until
}

/**
 * The first service day still kept at `now`, per retention class, in the venue's own service days
 * (its time zone and the hour its day ends): a row of service day D is due for the purge when D
 * comes before it. `night` keeps a day for 31 days after it ended; `record` for 18 months. A day
 * is due only once it ended that long ago: the service day of the instant 31 days (18 months)
 * back had not ended then, so every earlier day had.
 */
export function serviceRetentionCutoffs(
  now: Date,
  timezone: string,
  dayEndsAt: string,
): { readonly night: string; readonly record: string } {
  const nightAgo = new Date(now.getTime() - NIGHT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return {
    night: serviceDate(nightAgo, timezone, dayEndsAt),
    record: serviceDate(monthsBefore(now, RECORD_RETENTION_MONTHS), timezone, dayEndsAt),
  }
}
