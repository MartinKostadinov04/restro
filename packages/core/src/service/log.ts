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
  'pause.started': 'night',
  'pause.lifted': 'night',
  'alert.raised': 'night',
  'alert.done': 'night',
  'waiter_call.called': 'night',
  'waiter_call.done': 'night',
  'waiter_call.lapsed': 'night',
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
): Promise<void> {
  const entry = LogEntryInputSchema.parse(input)
  if (scope.via !== null && !(VIA_VALUES as readonly string[]).includes(scope.via)) {
    throw new TypeError(`unknown via ${scope.via}`)
  }
  await tx.insert(logEntries).values({
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    serviceDate: scope.serviceDate,
    kind: entry.kind,
    sentOrderId: entry.sentOrderId ?? null,
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
