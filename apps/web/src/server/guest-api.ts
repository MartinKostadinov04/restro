// The guest API's handlers (D121; design `2026-10-20-guest-api-design.md` §2–§5; tickets #75, #110):
//
//   GET  /api/guest/state?since=<version>&view=menu|order|bill   the table's state, or "unchanged"
//   POST /api/guest/actions                                      one guest command, and the state
//   GET  /api/guest/payment                                      the paying phone's own payment
//
// The table's code comes in `Authorization: Table <code>`, never in the address or the body. A
// code of the wrong shape is answered 401 before the database is asked. Bodies are read up to
// 8 KB (413 past it) and parsed strictly with the shell's schemas; every answer is checked with
// them too before it leaves, and core has already run the forbidden-values walk on it (rule 3).
// Every answer is `no-store` and `no-referrer`. Nothing about the request (its header, its body,
// the code) is logged. The web calls no POS: a bill read only queues the worker's reading.
//
// The location check and the limits (#76, D122 §4): a command carries `X-Restro-Phone`, the random
// value the page made at load (the per-phone limits' key, in memory only); the phone's location
// pass travels in `X-Restro-Pass` on both requests. A request body that fails its schema is logged
// by the paths it got wrong, never by its values (a position among them). A guard's trip is one
// log line with the venue and the table, nothing more.
//
// Send (#77): an accepted Send queues the worker's `order-send` for the table; the web itself never
// calls the POS.
// Paying (#110, D127): the payment handle comes back to the phone in the answer to its `pay.start`
// and goes out in `X-Restro-Payment`, never in an address or a body. Nothing logs it; core keeps
// only its sha-256. Each pay command queues the worker's next step of the payment.
//
// The logic sits here, apart from the route files, so tests can call it with their own pool.

import {
  issuePaths,
  JOB_NAMES,
  OrderSendJobSchema,
  PaymentJobSchema,
  TABLE_TOKEN_PATTERN,
  TableReadJobSchema,
} from '@restro/core'
import {
  ForbiddenValueError,
  type GuardEvent,
  type GuestActInput,
  guestAct,
  guestPayment,
  guestState,
  type HumanCheck,
  MAX_PASS_LENGTH,
  type PaymentTarget,
  type QueuePayment,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'
import {
  GUEST_API_MAX_BYTES,
  GUEST_PASS_HEADER,
  GUEST_PAYMENT_HEADER,
  GUEST_PHONE_HEADER,
  GUEST_PHONE_PATTERN,
  GuestActionAnswerSchema,
  GuestActionRequestSchema,
  type GuestApiError,
  GuestPaymentAnswerSchema,
  GuestStateAnswerSchema,
  GuestStateQuerySchema,
  PAYMENT_HANDLE_PATTERN,
  TABLE_AUTH_SCHEME,
} from '@restro/shell'

import { serverEnv } from './env'
import { type BadCodeLimiter, clientNetwork, guestApiBadCodes } from './guard/bad-codes'
import { enqueueJob } from './jobs'
import { logError, logInfo, logWarn } from './log'
import { turnstileCheck } from './turnstile'

/** What the handlers need from the app. */
export interface GuestApiDeps {
  readonly pool: DbPool
  /** The count of wrong codes per network; tests pass their own. */
  readonly badCodes?: BadCodeLimiter
  /** Queues a fresh reading of a table's bill; tests pass their own. */
  readonly queueReading: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<unknown>
  /** `GUEST_PASS_KEY`, or null when the app has none (no pass is issued or held then). */
  readonly passKey?: string | null
  /** Turnstile's siteverify at Send and Pay; without it every Send and Pay fails the check. */
  readonly humanCheck?: HumanCheck
  /** Queues the worker's Send for a table (#77); tests pass their own. */
  readonly queueSend?: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<unknown>
  /** Queues the worker's next step of a payment (#110); tests pass their own. */
  readonly queuePayment?: (target: PaymentTarget, job: 'prepare' | 'check') => Promise<unknown>
}

const HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
} as const

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...HEADERS, ...extra } })
}

function refuse(code: GuestApiError['code'], status: number, extra?: Record<string, string>) {
  return json({ code } satisfies GuestApiError, status, extra)
}

/** The table's code from `Authorization: Table <code>`, or null when it is missing or misshapen. */
export function tableCodeOf(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (header === null) return null
  const [scheme, code, ...rest] = header.trim().split(/\s+/)
  if (scheme !== TABLE_AUTH_SCHEME || code === undefined || rest.length > 0) return null
  return TABLE_TOKEN_PATTERN.test(code) ? code : null
}

/** The phone's location pass from `X-Restro-Pass`, or undefined when absent or too long. */
export function passOf(request: Request): string | undefined {
  const pass = request.headers.get(GUEST_PASS_HEADER)?.trim()
  return pass === undefined || pass === '' || pass.length > MAX_PASS_LENGTH ? undefined : pass
}

/** The payment handle from `X-Restro-Payment`, or undefined when absent or misshapen. */
export function paymentHandleOf(request: Request): string | undefined {
  const handle = request.headers.get(GUEST_PAYMENT_HEADER)?.trim()
  return handle !== undefined && PAYMENT_HANDLE_PATTERN.test(handle) ? handle : undefined
}

/** The queue as core takes it: a job that can't be queued is logged, never a failed command. */
function paymentQueue(deps: GuestApiDeps): { readonly queuePayment?: QueuePayment } {
  const queue = deps.queuePayment
  if (queue === undefined) return {}
  return {
    queuePayment: async (target, job) => {
      // The phone's poll of its payment queues the step again.
      await Promise.resolve(queue(target, job)).catch((error: unknown) =>
        logError('guest_payment_not_queued', error),
      )
    },
  }
}

/** Logs a guard's trip: what tripped, the venue and the table, nothing about the phone. */
function logGuard(event: GuardEvent): void {
  logInfo('guest_guard', { guard: event.kind, venueId: event.venueId, tableId: event.tableId })
}

/** The body as text, or `too_large` past `max` bytes: the stream is cut, not read to its end. */
export async function readCapped(request: Request, max = GUEST_API_MAX_BYTES) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > max) return { ok: false as const }
  if (request.body === null) return { ok: true as const, text: '' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return { ok: false as const }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return { ok: true as const, text: new TextDecoder().decode(bytes) }
}

/** A failure that must not reach the phone as anything but a 500. */
function failed(event: string, error: unknown): Response {
  logError(event, error instanceof ForbiddenValueError ? new Error('forbidden values') : error)
  return json({ code: 'failed' }, 500)
}

/** The pass as an input field, or nothing (core's inputs take no undefined values). */
function pass(request: Request): { readonly pass?: string } {
  const found = passOf(request)
  return found === undefined ? {} : { pass: found }
}

/**
 * A code that is no table's: counted against its network (D122 §9), and a 429 once that network is
 * blocked. Only ever after the code was looked up, so a right code is never answered by its
 * network's count (a club's guests share one address); `/t/<code>` can block first, it has no
 * phone to strand. The count is the API's own, so a venue reissuing its codes, whose open phones
 * each get one 401, can't stop the next guests' QR scans on the same network. Never the network
 * or the code in a log. Turnstile has no place in this answer: 20 wrong codes are only logged, as
 * at `/t/<code>`.
 */
function wrongCode(request: Request, deps: GuestApiDeps): Response {
  const limiter = deps.badCodes ?? guestApiBadCodes
  const { verdict, turnstileNow, blockedNow } = limiter.recordWrong(clientNetwork(request.headers))
  if (turnstileNow) logWarn('guest_bad_code_turnstile_required')
  if (blockedNow) logWarn('guest_bad_code_block')
  return verdict.kind === 'blocked'
    ? refuse('rate_limited', 429, { 'Retry-After': String(verdict.retryAfterSeconds) })
    : refuse('code_retired', 401)
}

/** A request core answered without a state: a code that is no table's, or a limit's trip. */
function stateless(
  answer:
    | { readonly code: 'code_retired' }
    | { readonly code: 'rate_limited'; readonly retryAfter: number },
  request: Request,
  deps: GuestApiDeps,
): Response {
  return answer.code === 'rate_limited'
    ? refuse('rate_limited', 429, { 'Retry-After': String(answer.retryAfter) })
    : wrongCode(request, deps)
}

/** `GET /api/guest/state`. */
export async function handleGuestState(request: Request, deps: GuestApiDeps): Promise<Response> {
  const code = tableCodeOf(request)
  if (code === null) return wrongCode(request, deps)
  const query = GuestStateQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!query.success) return refuse('invalid_request', 400)
  try {
    const read = await guestState(deps.pool, {
      code,
      view: query.data.view,
      ...(query.data.since === undefined ? {} : { since: query.data.since }),
      ...pass(request),
      passKey: deps.passKey ?? null,
      queueReading: async (target) => {
        // A reading that can't be queued leaves the last one on the screen: never a failed read.
        await Promise.resolve(deps.queueReading(target)).catch((error: unknown) =>
          logError('guest_table_read_not_queued', error),
        )
      },
    })
    if (!read.ok) return stateless(read, request, deps)
    return json(GuestStateAnswerSchema.parse(read.answer))
  } catch (error) {
    return failed('guest_state_failed', error)
  }
}

/** `POST /api/guest/actions`. */
export async function handleGuestAction(request: Request, deps: GuestApiDeps): Promise<Response> {
  const code = tableCodeOf(request)
  if (code === null) return wrongCode(request, deps)
  const phone = request.headers.get(GUEST_PHONE_HEADER)
  if (phone === null || !GUEST_PHONE_PATTERN.test(phone)) return refuse('invalid_request', 400)
  const body = await readCapped(request)
  if (!body.ok) return refuse('too_large', 413)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(body.text)
  } catch {
    return refuse('invalid_request', 400)
  }
  const parsed = GuestActionRequestSchema.safeParse(parsedJson)
  if (!parsed.success) {
    logWarn('guest_action_invalid', { paths: issuePaths(parsed.error).join(',') })
    return refuse('invalid_request', 400)
  }
  const { kind, ...fields } = parsed.data.command
  const command: GuestActInput['command'] = { type: kind, ...fields }
  const handle = paymentHandleOf(request)
  try {
    const acted = await guestAct(deps.pool, {
      code,
      command,
      ageMs: parsed.data.ageMs,
      view: parsed.data.view,
      phone,
      ...pass(request),
      ...(parsed.data.check === undefined ? {} : { check: parsed.data.check }),
      passKey: deps.passKey ?? null,
      ...(deps.humanCheck === undefined ? {} : { humanCheck: deps.humanCheck }),
      queueSend: async (target) => {
        // The sent order is written: a Send that can't be queued now is queued by the worker's
        // sweep within a minute, so the guest still gets their answer.
        const queue = deps.queueSend ?? queueTableSend
        await Promise.resolve(queue(target)).catch((error: unknown) =>
          logError('guest_send_not_queued', error),
        )
      },
      ...(handle === undefined ? {} : { handle }),
      ...paymentQueue(deps),
      onGuard: logGuard,
    })
    if (!acted.ok) return stateless(acted, request, deps)
    if (acted.retryAfter !== null) {
      return refuse('rate_limited', 429, { 'Retry-After': String(acted.retryAfter) })
    }
    return json(
      GuestActionAnswerSchema.parse({
        result: acted.result,
        state: acted.state,
        pass: acted.pass,
        handle: acted.handle,
      }),
    )
  } catch (error) {
    return failed('guest_action_failed', error)
  }
}

/** `GET /api/guest/payment`: the paying phone's own payment, by the handle it holds (#110). */
export async function handleGuestPayment(request: Request, deps: GuestApiDeps): Promise<Response> {
  const code = tableCodeOf(request)
  if (code === null) return wrongCode(request, deps)
  const handle = paymentHandleOf(request)
  if (handle === undefined) return refuse('unknown_payment', 404)
  try {
    const read = await guestPayment(deps.pool, { code, handle, ...paymentQueue(deps) })
    if (!read.ok) {
      return read.code === 'unknown_payment'
        ? refuse('unknown_payment', 404)
        : stateless(read, request, deps)
    }
    return json(GuestPaymentAnswerSchema.parse(read.answer))
  } catch (error) {
    return failed('guest_payment_failed', error)
  }
}

/** The handlers' dependencies in the app: its pool, the job queue, the pass key and Turnstile. */
export function guestApiDeps(pool: DbPool): GuestApiDeps {
  const env = serverEnv()
  return {
    pool,
    queueReading: queueTableReading,
    passKey: env.GUEST_PASS_KEY ?? null,
    humanCheck: turnstileCheck(env.TURNSTILE_SECRET_KEY),
    queueSend: queueTableSend,
    queuePayment: queuePaymentStep,
  }
}

/** The app's queue for a payment's next step (`payment-prepare`, `payment-check`; one per payment). */
export async function queuePaymentStep(
  target: PaymentTarget,
  job: 'prepare' | 'check',
): Promise<void> {
  const data = PaymentJobSchema.parse(target)
  await enqueueJob(job === 'prepare' ? JOB_NAMES.paymentPrepare : JOB_NAMES.paymentCheck, data)
}

/** The app's queue for a table's reading (`table-read`, one per table at a time). */
export async function queueTableReading(target: {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}): Promise<void> {
  await enqueueJob(JOB_NAMES.tableRead, TableReadJobSchema.parse(target))
}

/** The app's queue for a table's Send (`order-send`, one per table at a time, #77). */
export async function queueTableSend(target: {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}): Promise<void> {
  await enqueueJob(JOB_NAMES.orderSend, OrderSendJobSchema.parse(target))
}
