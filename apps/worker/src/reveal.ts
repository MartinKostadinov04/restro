// The reveal endpoint (D122 §9; ticket #70): `POST /internal/reveal` on the worker's own HTTP
// server. A table's code is stored as its hash and a copy sealed for this worker; the admin's
// Tables screen asks here, once per page load, for the codes it draws as QR thumbnails (and for
// one code when a sticker is downloaded). Only the web app's server calls it, over the private
// network:
//   - the Host must be `localhost` or a `*.railway.internal` name, so the public domain never
//     reaches it;
//   - it carries the service token from REVEAL_SERVICE_TOKEN as a bearer, compared in constant
//     time; without the setting the endpoint does not exist (404);
//   - the web app names the signed-in account and its session; `applyService` checks that it
//     holds `settings.codes` at the venue and writes one `record` Log entry per reveal, and only
//     then are the sealed copies opened.
// Nothing here stores or logs a code; the answer is `no-store`.
import { createHash, type KeyObject, randomUUID, timingSafeEqual } from 'node:crypto'

import { idSchema } from '@restro/core'
import { openTableCode } from '@restro/core/seal-open'
import { applyService, MAX_REVEALED_CODES } from '@restro/core/service'
import { type DbPool, venueTables, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'

/** Where the endpoint listens. */
export const REVEAL_PATH = '/internal/reveal'

/** The largest request body read, in bytes (500 table ids and the envelope fit easily). */
export const MAX_REVEAL_BODY_BYTES = 32 * 1024

/** What the web app sends. */
export const RevealRequestSchema = z.strictObject({
  tenantId: idSchema('tn'),
  venueId: idSchema('vn'),
  tableIds: z.array(idSchema('tb')).min(1).max(MAX_REVEALED_CODES),
  /** The signed-in account asking, with its session (the reveal needs its own sign-in). */
  actor: z.strictObject({
    kind: z.literal('user'),
    userId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(256),
  }),
})

/** A reveal request as parsed. */
export type RevealRequest = z.output<typeof RevealRequestSchema>

/** What the endpoint answers. */
export type RevealAnswer =
  | {
      readonly status: 'accepted'
      /** Table id → its code, or null for a table without one. */
      readonly codes: Readonly<Record<string, string | null>>
    }
  | { readonly status: 'refused'; readonly code: string }

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

/** Opens the codes of the tables in the request, once applyService accepted the reveal. */
export async function revealTableCodes(
  deps: { readonly pool: DbPool; readonly privateKey: KeyObject },
  request: RevealRequest,
): Promise<RevealAnswer> {
  const { result } = await applyService(
    deps.pool,
    { type: 'table_code.reveal', tableIds: request.tableIds },
    {
      tenantId: request.tenantId,
      venueId: request.venueId,
      origin: 'staff',
      actor: request.actor,
      jobId: `reveal-${randomUUID()}`,
    },
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
