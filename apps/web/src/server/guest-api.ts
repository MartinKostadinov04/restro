// The guest API's two handlers (D121; design `2026-10-20-guest-api-design.md` §2–§5; ticket #75):
//
//   GET  /api/guest/state?since=<version>&view=menu|order|bill   the table's state, or "unchanged"
//   POST /api/guest/actions                                      one guest command, and the state
//
// The table's code comes in `Authorization: Table <code>`, never in the address or the body. A
// code of the wrong shape is answered 401 before the database is asked. Bodies are read up to
// 8 KB (413 past it) and parsed strictly with the shell's schemas; every answer is checked with
// them too before it leaves, and core has already run the forbidden-values walk on it (rule 3).
// Every answer is `no-store` and `no-referrer`. Nothing about the request (its header, its body,
// the code) is logged. The web calls no POS: a bill read only queues the worker's reading.
//
// The logic sits here, apart from the route files, so tests can call it with their own pool.

import { JOB_NAMES, TABLE_TOKEN_PATTERN, TableReadJobSchema } from '@restro/core'
import { ForbiddenValueError, type GuestActInput, guestAct, guestState } from '@restro/core/service'
import type { DbPool } from '@restro/db'
import {
  GUEST_API_MAX_BYTES,
  GuestActionAnswerSchema,
  GuestActionRequestSchema,
  type GuestApiError,
  GuestStateAnswerSchema,
  GuestStateQuerySchema,
  TABLE_AUTH_SCHEME,
} from '@restro/shell'

import { enqueueJob } from './jobs'
import { logError } from './log'

/** What the handlers need from the app. */
export interface GuestApiDeps {
  readonly pool: DbPool
  /** Queues a fresh reading of a table's bill; tests pass their own. */
  readonly queueReading: (target: {
    readonly tenantId: string
    readonly venueId: string
    readonly tableId: string
  }) => Promise<unknown>
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

/** `GET /api/guest/state`. */
export async function handleGuestState(request: Request, deps: GuestApiDeps): Promise<Response> {
  const code = tableCodeOf(request)
  if (code === null) return refuse('code_retired', 401)
  const query = GuestStateQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!query.success) return refuse('invalid_request', 400)
  try {
    const read = await guestState(deps.pool, {
      code,
      view: query.data.view,
      ...(query.data.since === undefined ? {} : { since: query.data.since }),
      queueReading: async (target) => {
        // A reading that can't be queued leaves the last one on the screen: never a failed read.
        await Promise.resolve(deps.queueReading(target)).catch((error: unknown) =>
          logError('guest_table_read_not_queued', error),
        )
      },
    })
    if (!read.ok) return refuse(read.code, 401)
    return json(GuestStateAnswerSchema.parse(read.answer))
  } catch (error) {
    return failed('guest_state_failed', error)
  }
}

/** `POST /api/guest/actions`. */
export async function handleGuestAction(request: Request, deps: GuestApiDeps): Promise<Response> {
  const code = tableCodeOf(request)
  if (code === null) return refuse('code_retired', 401)
  const body = await readCapped(request)
  if (!body.ok) return refuse('too_large', 413)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(body.text)
  } catch {
    return refuse('invalid_request', 400)
  }
  const parsed = GuestActionRequestSchema.safeParse(parsedJson)
  if (!parsed.success) return refuse('invalid_request', 400)
  const { kind, ...fields } = parsed.data.command
  const command: GuestActInput['command'] = { type: kind, ...fields }
  try {
    const acted = await guestAct(deps.pool, {
      code,
      command,
      ageMs: parsed.data.ageMs,
      view: parsed.data.view,
    })
    if (!acted.ok) return refuse(acted.code, 401)
    if (acted.retryAfter !== null) {
      return refuse('rate_limited', 429, { 'Retry-After': String(acted.retryAfter) })
    }
    return json(GuestActionAnswerSchema.parse({ result: acted.result, state: acted.state }))
  } catch (error) {
    return failed('guest_action_failed', error)
  }
}

/** The app's queue for a table's reading (`table-read`, one per table at a time). */
export async function queueTableReading(target: {
  readonly tenantId: string
  readonly venueId: string
  readonly tableId: string
}): Promise<void> {
  await enqueueJob(JOB_NAMES.tableRead, TableReadJobSchema.parse(target))
}
