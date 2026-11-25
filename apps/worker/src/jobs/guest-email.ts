// `guest-email` (#576; D136, D101): tells a guest what happened to his reservation, from the
// venue's name, in his language. The service command that made the news says so in its accepted
// answer and its caller queues this job (`guestEmailJobOf` in core/service); only this job sends.
//
// When the job runs it reads the reservation and the guest record again and sends only while the
// news is still true: the reservation is still in that state, not taken out of the book, and the
// Log entry that recorded the news is still its latest of that kind. A deletion, a later change or
// a guest erased meanwhile (a retry can run minutes later) sends nothing. The email address is
// read here and dropped after the one send.
//
// A send the service refuses for good (a bad address, a spent quota) is logged and ends the job;
// one it could not take now (busy, unreachable) throws, and pg-boss tries the job again with its
// queue's retries, then moves it to `guest-email.dead`. The idempotency key (the reservation, the
// kind and the Log entry) makes a retry after an answer that never arrived go out once.
//
// Logs carry the reservation's id, the kind, the language and the outcome: never the address and
// never the guest's name (CLAUDE.md: no personal data in logs).

import {
  type GuestEmailJob,
  GuestEmailJobSchema,
  type GuestEmailKind,
  JOB_NAMES,
} from '@restro/core'
import { GUEST_EMAIL_LOG_KINDS } from '@restro/core/service'
import { type DbPool, guests, logEntries, reservations, venues, withTenant } from '@restro/db'
import { and, eq, isNull, max } from 'drizzle-orm'
import type { Job } from 'pg-boss'

import { EmailSendError, type EmailSender } from '../email/sender'
import {
  type GuestEmailLanguage,
  guestEmailWords,
  type ReservationFacts,
} from '../guest-email/words'
import type { Logger } from '../logger'
import { defineJob, type JobDefinition } from './types'

/** What the job reads before it sends: the reservation as it is now, and whom to tell. */
export interface GuestEmailNews extends ReservationFacts {
  readonly status: string
  readonly deleted: boolean
  /** The Log's latest entry of the news's kind about this reservation. */
  readonly latestEntry: number | null
  /** The guest record's email; null without a record, an email, or once he is erased. */
  readonly email: string | null
}

/** Reads the news of one job, or null when the reservation is not this venue's (or is gone). */
export type GuestEmailReader = (pool: DbPool, job: GuestEmailJob) => Promise<GuestEmailNews | null>

/** Why a job sent nothing. */
export type GuestEmailSkip = 'reservation_missing' | 'news_changed' | 'no_email'

/** The state each kind of news leaves a reservation in, while it is still true. */
const STILL_TRUE: Readonly<Record<GuestEmailKind, (news: GuestEmailNews) => boolean>> = {
  reservation_cancelled: (news) => news.status === 'cancelled',
}

/**
 * The language a guest is written to: the one his booking was made in, Bulgarian for a booking
 * staff took (#576). Every booking is one staff took until the booking page (#322) records the
 * guest's own language; then this reads it.
 */
export function bookingLanguage(_news: GuestEmailNews): GuestEmailLanguage {
  return 'bg'
}

/** Whether to send, and to whom; or why not. Pure. */
export function guestEmailDecision(
  job: GuestEmailJob,
  news: GuestEmailNews | null,
):
  | {
      readonly send: true
      readonly to: string
      readonly language: GuestEmailLanguage
      readonly news: GuestEmailNews
    }
  | { readonly send: false; readonly reason: GuestEmailSkip } {
  if (news === null) return { send: false, reason: 'reservation_missing' }
  if (news.deleted || !STILL_TRUE[job.kind](news) || news.latestEntry !== job.entry) {
    return { send: false, reason: 'news_changed' }
  }
  if (news.email === null || news.email.trim() === '') {
    return { send: false, reason: 'no_email' }
  }
  return { send: true, to: news.email.trim(), language: bookingLanguage(news), news }
}

/** The reader on the database, as the job's tenant (row-level security). */
export const readGuestEmailNews: GuestEmailReader = (pool, job) =>
  withTenant(pool, job.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        status: reservations.status,
        deletedAt: reservations.deletedAt,
        serviceDate: reservations.serviceDate,
        startsAt: reservations.startsAt,
        partySize: reservations.partySize,
        email: guests.email,
        venueName: venues.name,
        timeZone: venues.timezone,
      })
      .from(reservations)
      .innerJoin(venues, eq(venues.id, reservations.venueId))
      .leftJoin(guests, and(eq(guests.id, reservations.guestId), isNull(guests.erasedAt)))
      .where(and(eq(reservations.id, job.reservationId), eq(reservations.venueId, job.venueId)))
      .limit(1)
    if (row === undefined) return null
    const [latest] = await tx
      .select({ seq: max(logEntries.seq) })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.reservationId, job.reservationId),
          eq(logEntries.venueId, job.venueId),
          eq(logEntries.kind, GUEST_EMAIL_LOG_KINDS[job.kind]),
        ),
      )
    return {
      status: row.status,
      deleted: row.deletedAt !== null,
      serviceDate: row.serviceDate,
      startsAt: row.startsAt,
      partySize: row.partySize,
      latestEntry: latest?.seq ?? null,
      email: row.email,
      venueName: row.venueName,
      timeZone: row.timeZone,
    }
  })

/** What one run needs. */
export interface GuestEmailDeps {
  readonly pool: DbPool
  readonly log: Pick<Logger, 'info' | 'warn'>
  /** Null where GUEST_EMAIL_FROM_ADDRESS is unset: guest emails are off, and the job sends nothing. */
  readonly sender: Pick<EmailSender, 'sendGuestEmail'> | null
  /** Tests pass their own. */
  readonly read?: GuestEmailReader
}

/** How one job ended. */
export type GuestEmailOutcome = 'sent' | 'off' | 'refused' | GuestEmailSkip

/**
 * Sends one guest email when its news is still true. Answers how it ended; throws only what is
 * worth another try (the service busy or unreachable, the database), so pg-boss retries it.
 */
export async function sendGuestEmailOf(
  job: GuestEmailJob,
  deps: GuestEmailDeps,
): Promise<GuestEmailOutcome> {
  const about = { reservationId: job.reservationId, kind: job.kind }
  if (deps.sender === null) {
    deps.log.info({ ...about, outcome: 'off' }, 'guest emails are off: nothing sent')
    return 'off'
  }
  const decision = guestEmailDecision(job, await (deps.read ?? readGuestEmailNews)(deps.pool, job))
  if (!decision.send) {
    deps.log.info({ ...about, outcome: decision.reason }, 'guest email not sent')
    return decision.reason
  }
  const { news } = decision
  try {
    await deps.sender.sendGuestEmail({
      to: decision.to,
      venueName: news.venueName,
      words: guestEmailWords(job.kind, decision.language, news),
      idempotencyKey: `${job.reservationId}-${job.kind}-${job.entry}`,
    })
  } catch (error) {
    if (error instanceof EmailSendError && !error.retryable) {
      // Final: the same send would be refused again. The error names the part, never the value.
      deps.log.warn(
        { ...about, outcome: 'refused', status: error.status, detail: error.message },
        'guest email refused',
      )
      return 'refused'
    }
    throw error
  }
  deps.log.info({ ...about, language: decision.language, outcome: 'sent' }, 'guest email sent')
  return 'sent'
}

/** The `guest-email` job. `sender` null: guest emails are off (the worker warned at start). */
export function createGuestEmailJob(options: {
  readonly sender: Pick<EmailSender, 'sendGuestEmail'> | null
}): JobDefinition<GuestEmailJob> {
  return defineJob<GuestEmailJob>({
    name: JOB_NAMES.guestEmail,
    options: {
      // One waiting and one running per piece of news (`ONE_RUN_PER_GROUP_JOBS` in core/jobs.ts).
      policy: 'short',
      queue: {
        // A busy or unreachable service: tried again after 1, 2, 4, 8 and 16 minutes, then
        // `guest-email.dead`. The idempotency key keeps a retry from sending twice.
        retryLimit: 5,
        retryDelay: 60,
        retryBackoff: true,
        // One read and one call of 15 seconds at most, with a wide margin.
        expireInSeconds: 2 * 60,
        retentionSeconds: 24 * 60 * 60,
        deleteAfterSeconds: 24 * 60 * 60,
      },
      work: { pollingIntervalSeconds: 5, groupConcurrency: 1 },
    },
    async handler(jobs: Job<GuestEmailJob>[], context) {
      for (const job of jobs) {
        const parsed = GuestEmailJobSchema.safeParse(job.data)
        if (!parsed.success)
          throw new Error(`the ${JOB_NAMES.guestEmail} job has an invalid payload`)
        await sendGuestEmailOf(parsed.data, {
          pool: context.pool,
          log: context.log,
          sender: options.sender,
        })
      }
    },
  })
}
