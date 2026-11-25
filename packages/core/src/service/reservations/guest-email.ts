// Which guest email a reservation command owes, and the job its caller queues for it (#576; D136,
// D101: "everything that happens to a guest's reservation reaches him by email").
//
// A handler never sends anything and never queues a job: it runs inside the command's transaction,
// and the email service is the worker's (CLAUDE.md: a provider is called outside any transaction).
// So the handler that made the news says so in its accepted answer — `guestEmail` (the kind) and
// `guestEmailEntry` (the Log entry that recorded the news) — and the caller of `applyService` turns
// that into a `guest-email` job with `guestEmailJobOf`, queued through the command's `queueJobs` in
// the same transaction (#592), so the news and its email are saved together or not at all. The
// answer carries a code and a number, never the address or the name.
//
// The worker reads the reservation and the guest record again when it sends, and sends nothing
// when the news is no longer true (a deletion, a later change, an erased guest), so what is said
// here is only that there was news for a guest who had an address at the time.
//
// One command can owe many emails: the night's end declines every request nobody answered (#578).
// Its answer carries counts, not a list, so its caller reads the declines its own job wrote from
// the Log (`nightEndGuestEmailJobs`) and queues one job each.

import { type DbPool, guests, logEntries, reservations, withTenant } from '@restro/db'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'

import {
  GUEST_EMAIL_KINDS,
  type GuestEmailJob,
  GuestEmailJobSchema,
  type GuestEmailKind,
} from '../../jobs'
import type { ServiceTx } from '../definition'
import type { LogKind } from '../log'
import type { ResultDetails, ServiceResult } from '../results'
import { NIGHT_END_REASON } from './status'

/** The Log kind each email's news is recorded under: the entry the worker checks is still latest. */
export const GUEST_EMAIL_LOG_KINDS: Readonly<Record<GuestEmailKind, LogKind>> = {
  reservation_cancelled: 'reservation.status',
  reservation_confirmed: 'reservation.status',
  reservation_declined: 'reservation.status',
}

/**
 * The details that say a guest email is owed, or none: the reservation is a party's (a block is
 * nobody), it has a guest record that is not erased, and that record holds an address. Call it
 * after the command logged its news, so the entry is this command's own.
 */
export async function guestEmailOwed(
  stx: ServiceTx,
  reservation: { readonly kind: string; readonly guestId: string | null },
  kind: GuestEmailKind,
): Promise<ResultDetails> {
  if (reservation.kind === 'block' || reservation.guestId === null) return {}
  const entry = stx.lastLogged([GUEST_EMAIL_LOG_KINDS[kind]])
  if (entry === null) return {}
  const [guest] = await stx.tx
    .select({ email: guests.email })
    .from(guests)
    .where(and(eq(guests.id, reservation.guestId), isNull(guests.erasedAt)))
    .limit(1)
  if (guest === undefined || guest.email === null || guest.email.trim() === '') return {}
  return { guestEmail: kind, guestEmailEntry: entry.seq }
}

/**
 * The `guest-email` job an accepted answer asks for, or null: a refusal, an answer that owes no
 * email, or one whose details do not make a valid job (never thrown: the command is done whatever
 * becomes of its email).
 */
export function guestEmailJobOf(
  result: ServiceResult,
  scope: { readonly tenantId: string; readonly venueId: string },
): GuestEmailJob | null {
  if (result.status !== 'accepted') return null
  const kind = result.details.guestEmail
  if (typeof kind !== 'string' || !(GUEST_EMAIL_KINDS as readonly string[]).includes(kind)) {
    return null
  }
  const job = GuestEmailJobSchema.safeParse({
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    reservationId: result.details.reservationId,
    kind,
    entry: result.details.guestEmailEntry,
  })
  return job.success ? job.data : null
}

/**
 * The `guest-email` jobs a night's end owes (#578; spec #322, Implementation Decision 2): one per
 * request that run declined, read from the Log entries of its own job (`jobId`, the provenance the
 * caller gave `applyService`) and kept to a guest record that is not erased and holds an address.
 * Call it after the command committed, and only when its answer counted a decline. Read as the
 * venue's tenant (row-level security); the address itself is never returned.
 */
export async function nightEndGuestEmailJobs(
  pool: DbPool,
  scope: { readonly tenantId: string; readonly venueId: string; readonly jobId: string },
): Promise<GuestEmailJob[]> {
  const rows = await withTenant(pool, scope.tenantId, (tx) =>
    tx
      .select({ reservationId: logEntries.reservationId, entry: logEntries.seq })
      .from(logEntries)
      .innerJoin(reservations, eq(reservations.id, logEntries.reservationId))
      .innerJoin(guests, and(eq(guests.id, reservations.guestId), isNull(guests.erasedAt)))
      .where(
        and(
          eq(logEntries.venueId, scope.venueId),
          // The job just ran: the bound keeps the read on the venue's newest entries.
          gt(logEntries.at, sql`now() - interval '1 day'`),
          eq(logEntries.jobId, scope.jobId),
          eq(logEntries.kind, GUEST_EMAIL_LOG_KINDS.reservation_declined),
          eq(logEntries.toState, 'declined'),
          eq(logEntries.reason, NIGHT_END_REASON),
          sql`nullif(trim(${guests.email}), '') is not null`,
        ),
      )
      .orderBy(logEntries.seq),
  )
  return rows.flatMap((row) => {
    const job = GuestEmailJobSchema.safeParse({
      tenantId: scope.tenantId,
      venueId: scope.venueId,
      reservationId: row.reservationId,
      kind: 'reservation_declined',
      entry: row.entry,
    })
    return job.success ? [job.data] : []
  })
}
