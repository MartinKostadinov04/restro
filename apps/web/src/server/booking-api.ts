// The booking page's two endpoints (#577; spec #322 stories 1–9, 32, 33):
//
//   GET  /api/booking/night?organization=<tn_>&venue=<vn_>&night=<YYYY-MM-DD>
//        the one narrow answer: can this night be booked, and if not, why. Nothing else.
//   POST /api/booking
//        a guest's request for a night, behind Turnstile (D127 §5.1, story 33): core's
//        `requestBooking`, the guest command `reservation.request` through `applyService`.
//
// The page knows the organisation and the venue from the published organisation index (rule 4);
// row-level security confines every read and the write to that organisation, so a venue of another
// one is simply unknown. Both answers are `no-store`. Nothing about the guest (the name, the phone,
// the email, the note, the address) is logged: only the event and the venue.
//
// The limits: a network may send 20 requests and ask about 120 nights in 10 minutes, then waits 15
// minutes (the bad-code limiter's mechanism, `guard/bad-codes.ts`; a club's guests usually book
// from their own networks, and a request that is the same request again is one row). Turnstile is
// the real gate on the write.
//
// The logic sits here, apart from the route files, so tests can call it with their own pool.

import { JOB_NAMES } from '@restro/core'
import {
  guestEmailJobOf,
  type HumanCheck,
  readBookingNight,
  requestBooking,
  type ServiceOptions,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'
import {
  BOOKING_API_MAX_BYTES,
  BookingNightQuerySchema,
  type BookingNightReply,
  BookingNightReplySchema,
  type BookingRefusal,
  type BookingReply,
  BookingReplySchema,
  BookingRequestSchema,
  bookingRefusalOf,
} from '@restro/shell'

import { serverEnv } from './env'
import { BAD_CODE_LIMITS, BadCodeLimiter, clientNetwork } from './guard/bad-codes'
import { readCapped } from './guest-api'
import { enqueueJobIn } from './jobs'
import { logError, logInfo } from './log'
import { turnstileCheck } from './turnstile'

/** What the handlers need; tests pass their own. */
export interface BookingApiDeps {
  readonly pool: DbPool
  readonly humanCheck: HumanCheck
  readonly now?: () => Date
  readonly requests?: BadCodeLimiter
  readonly nights?: BadCodeLimiter
  /** The key the guest's own link is made with (#579); without it a request gets no link. */
  readonly guestLinkKey?: string
  /** Queues the request's email in the command's transaction (#579); tests pass their own. */
  readonly queueJobs?: ServiceOptions['queueJobs']
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS })
}

function refusal(code: BookingRefusal, status: number): Response {
  return json(BookingReplySchema.parse({ ok: false, refusal: code } satisfies BookingReply), status)
}

/** How many booking requests a network may send in the window before it waits. */
const REQUEST_LIMITS = {
  ...BAD_CODE_LIMITS,
  turnstileAfter: Number.MAX_SAFE_INTEGER,
  blockAfter: 20,
}

/** How many nights a network may ask about in the window before it waits. */
const NIGHT_LIMITS = {
  ...BAD_CODE_LIMITS,
  turnstileAfter: Number.MAX_SAFE_INTEGER,
  blockAfter: 120,
}

/** The process's limiters (one web instance at pilot scale, as the bad-code limiter). */
export const bookingRequests = new BadCodeLimiter(REQUEST_LIMITS)
export const bookingNights = new BadCodeLimiter(NIGHT_LIMITS)

/** True when the network may go on; counts this ask. */
function allowed(limiter: BadCodeLimiter, request: Request): boolean {
  const network = clientNetwork(request.headers)
  if (limiter.check(network).kind === 'blocked') return false
  const { verdict, blockedNow } = limiter.recordWrong(network)
  if (blockedNow) logInfo('booking_limit_reached', {})
  return verdict.kind !== 'blocked'
}

/** `GET /api/booking/night`. */
export async function handleBookingNight(
  request: Request,
  deps: BookingApiDeps,
): Promise<Response> {
  const url = new URL(request.url)
  const parsed = BookingNightQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return json({ code: 'invalid_request' }, 400)
  if (!allowed(deps.nights ?? bookingNights, request)) return json({ code: 'rate_limited' }, 429)
  const { organization, venue, night } = parsed.data
  try {
    const answer = await readBookingNight(
      deps.pool,
      organization,
      venue,
      night,
      deps.now?.() ?? new Date(),
    )
    if (answer === null) return json({ code: 'unknown_venue' }, 404)
    return json(BookingNightReplySchema.parse({ night, answer } satisfies BookingNightReply))
  } catch (error) {
    logError('booking_night_failed', error)
    return json({ code: 'failed' }, 500)
  }
}

/** `POST /api/booking`. */
export async function handleBookingRequest(
  request: Request,
  deps: BookingApiDeps,
): Promise<Response> {
  const body = await readCapped(request, BOOKING_API_MAX_BYTES)
  if (!body.ok) return refusal('invalid_request', 413)
  let raw: unknown
  try {
    raw = JSON.parse(body.text)
  } catch {
    return refusal('invalid_request', 400)
  }
  const parsed = BookingRequestSchema.safeParse(raw)
  if (!parsed.success) return refusal('invalid_request', 400)
  if (!allowed(deps.requests ?? bookingRequests, request)) return refusal('rate_limited', 429)
  const form = parsed.data
  try {
    const result = await requestBooking(deps.pool, {
      tenantId: form.organization,
      venueId: form.venue,
      actionId: form.actionId,
      serviceDate: form.night,
      partySize: form.partySize,
      guestName: form.name,
      phone: form.phone,
      email: form.email,
      note: form.note,
      ...(form.humanToken === undefined ? {} : { humanToken: form.humanToken }),
      humanCheck: deps.humanCheck,
      onGuard: (kind) => logInfo('booking_guard', { guard: kind, venueId: form.venue }),
      ...(deps.now === undefined ? {} : { now: deps.now() }),
      ...(deps.guestLinkKey === undefined ? {} : { guestLinkKey: deps.guestLinkKey }),
      queueJobs: deps.queueJobs ?? queueRequestEmail(form),
    })
    if (result.status === 'accepted') {
      logInfo('booking_requested', { venueId: form.venue })
      return json(BookingReplySchema.parse({ ok: true } satisfies BookingReply))
    }
    const code = bookingRefusalOf(result.code)
    if (code === 'unavailable')
      logInfo('booking_refused', { venueId: form.venue, code: result.code })
    return refusal(code, code === 'human_check' ? 403 : 409)
  } catch (error) {
    logError('booking_request_failed', error)
    return refusal('unavailable', 500)
  }
}

/**
 * The request's "We got your request" email with the guest's own link (#579), queued in the
 * command's own transaction (#592): a request is never saved without its email.
 */
function queueRequestEmail(scope: {
  readonly organization: string
  readonly venue: string
}): NonNullable<ServiceOptions['queueJobs']> {
  return async (result, queue) => {
    const job = guestEmailJobOf(result, { tenantId: scope.organization, venueId: scope.venue })
    if (job !== null) await enqueueJobIn(queue, JOB_NAMES.guestEmail, job)
  }
}

/** The handlers' dependencies in the app: its pool, Turnstile and the guest link's key. */
export function bookingApiDeps(pool: DbPool): BookingApiDeps {
  const env = serverEnv()
  return {
    pool,
    humanCheck: turnstileCheck(env.TURNSTILE_SECRET_KEY),
    ...(env.GUEST_LINK_KEY === undefined ? {} : { guestLinkKey: env.GUEST_LINK_KEY }),
  }
}
