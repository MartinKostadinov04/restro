// The guest's own link to his booking (#579; spec #322 stories 8 and 34): one narrow endpoint keyed
// by the token in its path.
//
//   GET  /api/booking/link/<token>?organization=<tn_>&venue=<vn_>
//        that one booking: its night, hour, party, spots and state, and whether it can still be
//        called off. Nothing about any other booking, no phone, no note, no id.
//   POST /api/booking/link/<token>
//        its Cancel, behind Turnstile: core's `cancelGuestBooking`, the guest command
//        `reservation.guest_cancel` through `applyService`, with the cancellation's email queued in
//        the same transaction (#592).
//
// The token travels in the path only, never in a query string, and is never logged: the logs name
// the event and the venue. An unknown, a malformed and an expired token get the same answer, 404
// with `link_unknown`, after the same work (the token is hashed and looked up whatever it is), so
// nobody can tell which it was. Every answer is `no-store` with no referrer.
//
// The limit: a network may ask 120 times in 10 minutes, then waits 15 minutes (the bad-code
// limiter's mechanism, `guard/bad-codes.ts`). A token is 256 bits, so the limit is against load,
// not guessing. The logic sits here, apart from the route file, so tests can call it with their own
// pool.

import { JOB_NAMES } from '@restro/core'
import {
  type GuestLinkBooking as CoreGuestLinkBooking,
  cancelGuestBooking,
  guestEmailJobOf,
  type HumanCheck,
  MAX_GUEST_LINK_TOKEN_LENGTH,
  readGuestBooking,
  type ServiceOptions,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'
import {
  BOOKING_API_MAX_BYTES,
  type GuestCancelReply,
  GuestCancelReplySchema,
  GuestCancelRequestSchema,
  type GuestLinkBooking,
  GuestLinkBookingSchema,
  GuestLinkQuerySchema,
  type GuestLinkRefusal,
  guestLinkRefusalOf,
} from '@restro/shell'

import { serverEnv } from './env'
import { BAD_CODE_LIMITS, BadCodeLimiter, clientNetwork } from './guard/bad-codes'
import { readCapped } from './guest-api'
import { enqueueJobIn } from './jobs'
import { logError, logInfo } from './log'
import { turnstileCheck } from './turnstile'

/** What the handlers need; tests pass their own. */
export interface BookingLinkApiDeps {
  readonly pool: DbPool
  readonly humanCheck: HumanCheck
  /** GUEST_LINK_KEY: a token must be this key's for its booking. Without it no link opens. */
  readonly guestLinkKey: string | undefined
  readonly now?: () => Date
  readonly limiter?: BadCodeLimiter
  /** Queues the cancellation's email in the command's transaction; tests pass their own. */
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

function refusal(code: GuestLinkRefusal, status: number): Response {
  return json(
    GuestCancelReplySchema.parse({ ok: false, refusal: code } satisfies GuestCancelReply),
    status,
  )
}

/** The one answer for a link that opens nothing, whatever the reason. */
function gone(): Response {
  return refusal('link_unknown', 404)
}

/** How many times a network may ask about links in the window before it waits. */
const LINK_LIMITS = {
  ...BAD_CODE_LIMITS,
  turnstileAfter: Number.MAX_SAFE_INTEGER,
  blockAfter: 120,
}

/** The process's limiter (one web instance at pilot scale, as the bad-code limiter). */
export const bookingLinks = new BadCodeLimiter(LINK_LIMITS)

/** True when the network may go on; counts this ask. */
function allowed(limiter: BadCodeLimiter, request: Request): boolean {
  const network = clientNetwork(request.headers)
  if (limiter.check(network).kind === 'blocked') return false
  const { verdict, blockedNow } = limiter.recordWrong(network)
  if (blockedNow) logInfo('booking_link_limit_reached', {})
  return verdict.kind !== 'blocked'
}

/**
 * The token as the path gave it, capped: anything longer is cut before it is hashed, so a huge
 * path costs no more than a real token and still finds nothing.
 */
function tokenOf(segment: string): string {
  return segment.slice(0, MAX_GUEST_LINK_TOKEN_LENGTH)
}

/** The booking as the wire carries it: the fields of the contract and nothing else. */
function wireOf(booking: CoreGuestLinkBooking): GuestLinkBooking {
  return GuestLinkBookingSchema.parse({
    night: booking.night,
    time: booking.time,
    partySize: booking.partySize,
    spots: booking.spots,
    state: booking.state,
    canCancel: booking.canCancel,
    nightStarted: booking.nightStarted,
  } satisfies Record<keyof GuestLinkBooking, unknown>)
}

/** `GET /api/booking/link/<token>`. */
export async function handleGuestLinkRead(
  request: Request,
  token: string,
  deps: BookingLinkApiDeps,
): Promise<Response> {
  const url = new URL(request.url)
  const parsed = GuestLinkQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return gone()
  if (!allowed(deps.limiter ?? bookingLinks, request)) return refusal('rate_limited', 429)
  try {
    const booking = await readGuestBooking(deps.pool, {
      tenantId: parsed.data.organization,
      venueId: parsed.data.venue,
      token: tokenOf(token),
      guestLinkKey: deps.guestLinkKey,
      now: deps.now?.() ?? new Date(),
    })
    if (booking === null) return gone()
    return json(wireOf(booking))
  } catch (error) {
    logError('booking_link_read_failed', error)
    return refusal('unavailable', 500)
  }
}

/** `POST /api/booking/link/<token>`. */
export async function handleGuestLinkCancel(
  request: Request,
  token: string,
  deps: BookingLinkApiDeps,
): Promise<Response> {
  const body = await readCapped(request, BOOKING_API_MAX_BYTES)
  if (!body.ok) return refusal('invalid_request', 413)
  let raw: unknown
  try {
    raw = JSON.parse(body.text)
  } catch {
    return refusal('invalid_request', 400)
  }
  const parsed = GuestCancelRequestSchema.safeParse(raw)
  if (!parsed.success) return refusal('invalid_request', 400)
  if (!allowed(deps.limiter ?? bookingLinks, request)) return refusal('rate_limited', 429)
  const form = parsed.data
  const now = deps.now?.() ?? new Date()
  try {
    const result = await cancelGuestBooking(deps.pool, {
      tenantId: form.organization,
      venueId: form.venue,
      token: tokenOf(token),
      guestLinkKey: deps.guestLinkKey,
      actionId: form.actionId,
      ...(form.humanToken === undefined ? {} : { humanToken: form.humanToken }),
      humanCheck: deps.humanCheck,
      onGuard: (kind) => logInfo('booking_link_guard', { guard: kind, venueId: form.venue }),
      queueJobs: deps.queueJobs ?? queueCancelEmail(form),
      now,
    })
    if (result.status !== 'accepted') {
      const code = guestLinkRefusalOf(result.code)
      if (code === 'link_unknown') return gone()
      if (code === 'unavailable') {
        logInfo('booking_link_refused', { venueId: form.venue, code: result.code })
      }
      return refusal(code, code === 'human_check' ? 403 : 409)
    }
    logInfo('booking_cancelled_by_guest', { venueId: form.venue })
    // The booking as it stands now, read again: what the page shows is what the server holds.
    const booking = await readGuestBooking(deps.pool, {
      tenantId: form.organization,
      venueId: form.venue,
      token: tokenOf(token),
      guestLinkKey: deps.guestLinkKey,
      now,
    })
    if (booking === null) return gone()
    return json(
      GuestCancelReplySchema.parse({
        ok: true,
        booking: wireOf(booking),
      } satisfies GuestCancelReply),
    )
  } catch (error) {
    logError('booking_link_cancel_failed', error)
    return refusal('unavailable', 500)
  }
}

/** The cancellation's guest email, queued in the command's own transaction (#592). */
function queueCancelEmail(scope: {
  readonly organization: string
  readonly venue: string
}): NonNullable<ServiceOptions['queueJobs']> {
  return async (result, queue) => {
    const job = guestEmailJobOf(result, { tenantId: scope.organization, venueId: scope.venue })
    if (job !== null) await enqueueJobIn(queue, JOB_NAMES.guestEmail, job)
  }
}

/** The handlers' dependencies in the app: its pool and Turnstile. */
export function bookingLinkApiDeps(pool: DbPool): BookingLinkApiDeps {
  const env = serverEnv()
  return {
    pool,
    humanCheck: turnstileCheck(env.TURNSTILE_SECRET_KEY),
    guestLinkKey: env.GUEST_LINK_KEY,
  }
}
