// The reveal endpoint (D122 §9; tickets #70 and #72): `POST /internal/reveal` on the worker's own
// HTTP server. A table's code is stored as its hash and a copy sealed for this worker; the admin's
// Tables screen asks here, once per page load, for the codes it draws as QR thumbnails (and for
// one code when a sticker is downloaded). A staff member's PIN is stored the same way (its HMAC and
// a sealed copy, D122 §7); the people settings ask here to show PINs to the venue's owner or to
// Restro's admin team. Only the web app's server calls it, over the private network:
//   - the Host must be `localhost` or a `*.railway.internal` name, so the public domain never
//     reaches it;
//   - it carries the service token from REVEAL_SERVICE_TOKEN as a bearer, compared in constant
//     time; without the setting the endpoint does not exist (404);
//   - the web app names the signed-in account and its session (or a member of Restro's admin
//     team), and the session must exist and be that account's (RR-10); `applyService` checks that it holds `settings.codes` (codes) or `settings.roles`
//     (PINs, with a sign-in of the last 15 minutes) at the venue and writes one `record` Log entry
//     per reveal, and only then are the sealed copies opened.
// Nothing here stores or logs a code or a PIN; the answer is `no-store`.
import { createHash, type KeyObject, randomUUID, timingSafeEqual } from 'node:crypto'

import { idSchema } from '@restro/core'
import { openStaffPin, openTableCode } from '@restro/core/seal-open'
import {
  applyService,
  MAX_REVEALED_CODES,
  MAX_REVEALED_PINS,
  type ServiceContext,
} from '@restro/core/service'
import { type DbPool, staffMembers, venueTables, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { sessionIsLive } from './session-check'

/** Where the endpoint listens. */
export const REVEAL_PATH = '/internal/reveal'

/** The largest request body read, in bytes (500 table ids and the envelope fit easily). */
export const MAX_REVEAL_BODY_BYTES = 32 * 1024

/** Who asks: a signed-in account with its session, or a member of Restro's admin team. */
const RevealActorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('user'),
    userId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256),
  }),
  z.strictObject({ kind: z.literal('operator'), userId: z.string().min(1).max(128) }),
])

/** What every reveal names. */
const revealFields = {
  tenantId: idSchema('tn'),
  venueId: idSchema('vn'),
  /** The account asking (a reveal needs its own sign-in, never a PIN). */
  actor: RevealActorSchema,
  /** When the account last entered its password (its session's start); PINs need it fresh. */
  signedInAt: z.iso.datetime({ offset: true }).optional(),
}

/** A reveal of table codes. */
const TableRevealSchema = z.strictObject({
  ...revealFields,
  tableIds: z.array(idSchema('tb')).min(1).max(MAX_REVEALED_CODES),
})

/** A reveal of staff PINs (#72). */
const PinRevealSchema = z.strictObject({
  ...revealFields,
  staffMemberIds: z.array(idSchema('sm')).min(1).max(MAX_REVEALED_PINS),
})

/** What the web app sends: table codes or PINs, never both. */
export const RevealRequestSchema = z.union([TableRevealSchema, PinRevealSchema])

/** A reveal request as parsed. */
export type RevealRequest = z.output<typeof RevealRequestSchema>

/** A reveal of table codes as parsed. */
export type TableRevealRequest = z.output<typeof TableRevealSchema>

/** A reveal of PINs as parsed. */
export type PinRevealRequest = z.output<typeof PinRevealSchema>

/** What the endpoint answers. */
export type RevealAnswer =
  | {
      readonly status: 'accepted'
      /** Table id → its code, or staff member id → their PIN; null for one without. */
      readonly codes: Readonly<Record<string, string | null>>
    }
  | { readonly status: 'refused'; readonly code: string }

/** What the reveal needs: the pool and the worker's private seal key. */
interface RevealDeps {
  readonly pool: DbPool
  readonly privateKey: KeyObject
}

/** True for a Host header the endpoint answers: `localhost` or a Railway private name. */
export function isPrivateHost(host: string | undefined): boolean {
  if (host === undefined) return false
  const name = host
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, '')
  return name === 'localhost' || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.railway\.internal$/.test(name)
}

/** True when the Authorization header carries `token` as a bearer, compared in constant time. */
export function hasServiceToken(authorization: string | undefined, token: string): boolean {
  const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1] ?? ''
  // Digests of equal length, so neither the comparison nor its length leaks anything.
  const digest = (text: string) => createHash('sha256').update(text).digest()
  return timingSafeEqual(digest(given), digest(token)) && given !== ''
}

const NO_SESSION: RevealAnswer = { status: 'refused', code: 'session_unknown' }

/** The service context of a reveal: the account asking, as a staff write. */
function revealContext(request: RevealRequest): ServiceContext {
  return {
    tenantId: request.tenantId,
    venueId: request.venueId,
    origin: 'staff',
    actor: request.actor,
    jobId: `reveal-${randomUUID()}`,
    ...(request.signedInAt === undefined ? {} : { signedInAt: new Date(request.signedInAt) }),
  }
}

/** Answers one reveal: table codes or PINs. */
export function reveal(deps: RevealDeps, request: RevealRequest): Promise<RevealAnswer> {
  return 'tableIds' in request ? revealTableCodes(deps, request) : revealStaffPins(deps, request)
}

/** Opens the codes of the tables in the request, once applyService accepted the reveal. */
export async function revealTableCodes(
  deps: RevealDeps,
  request: TableRevealRequest,
): Promise<RevealAnswer> {
  if (!(await sessionIsLive(deps.pool, request.actor))) return NO_SESSION
  const { result } = await applyService(
    deps.pool,
    { type: 'table_code.reveal', tableIds: request.tableIds },
    revealContext(request),
  )
  if (result.status === 'refused') return { status: 'refused', code: result.code }
  const rows = await withTenant(deps.pool, request.tenantId, (tx) =>
    tx
      .select({ id: venueTables.id, sealed: venueTables.qrCodeSealed, plain: venueTables.qrToken })
      .from(venueTables)
      .where(
        and(inArray(venueTables.id, request.tableIds), eq(venueTables.venueId, request.venueId)),
      ),
  )
  const codes: Record<string, string | null> = {}
  for (const row of rows) {
    codes[row.id] =
      row.sealed !== null
        ? openTableCode(deps.privateKey, row.sealed, {
            tenantId: request.tenantId,
            tableId: row.id,
          })
        : // A code from before #70 that `seal-table-codes` has not reached yet.
          row.plain
  }
  return { status: 'accepted', codes }
}

/** Opens the PINs of the people in the request, once applyService accepted the reveal (#72). */
export async function revealStaffPins(
  deps: RevealDeps,
  request: PinRevealRequest,
): Promise<RevealAnswer> {
  if (!(await sessionIsLive(deps.pool, request.actor))) return NO_SESSION
  const { result } = await applyService(
    deps.pool,
    { type: 'pin.reveal', staffMemberIds: request.staffMemberIds },
    revealContext(request),
  )
  if (result.status === 'refused') return { status: 'refused', code: result.code }
  const rows = await withTenant(deps.pool, request.tenantId, (tx) =>
    tx
      .select({ id: staffMembers.id, sealed: staffMembers.pinSealed })
      .from(staffMembers)
      .where(inArray(staffMembers.id, request.staffMemberIds)),
  )
  const codes: Record<string, string | null> = {}
  for (const row of rows) {
    codes[row.id] =
      row.sealed === null
        ? null
        : openStaffPin(deps.privateKey, row.sealed, {
            tenantId: request.tenantId,
            staffMemberId: row.id,
          })
  }
  return { status: 'accepted', codes }
}
