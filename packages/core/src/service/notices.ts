// @restro/core/service/notices: the one thing the provider notice route may do (#108; D127 1.4,
// design §8): store a verified notice once by its event id. The route imports this module and
// nothing else of core/service (dependency-cruiser: `notice-route-records-only`), so a notice can
// never act on a payment from the web: the worker's `provider-notices` job reads each stored
// notice back from the provider and records what the reading says (`payment.observe`).
//
// The row is the job (a transactional outbox): it is written in one statement, so a notice is
// either stored and will be handled, or not stored and the provider sends it again.

import { type DbPool, PROVIDER_NOTICE_KINDS, providerNotices, withSystem } from '@restro/db'
import { z } from 'zod'

import { JobIdSchema } from './context'

// The verifier's notice (`ProviderNotice` of the payment seam), restated in the database's words:
// the service path imports nothing under connectors/ (no-outbound.test.ts). notices.test.ts checks
// that both shapes take and refuse the same notices.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/
const RefSchema = z.strictObject({
  provider: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
})
const NoticeSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/),
  type: z.string().regex(NAME),
  kind: z.enum(PROVIDER_NOTICE_KINDS),
  accountRef: RefSchema.nullable(),
  objectRef: RefSchema.nullable(),
})

const RecordInputSchema = z.strictObject({
  /** The provider kind, as its package names itself (`provider_notices.provider_kind`). */
  providerKind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  /** The event's live/test flag, which the verifier checked against this environment. */
  live: z.boolean(),
  notice: NoticeSchema,
  /** The id the server made for the request (`job_id`). */
  jobId: JobIdSchema,
})

/** What the route records: the verifier's notice and where it came from. */
export type RecordProviderNoticeInput = z.input<typeof RecordInputSchema>

/**
 * Stores a verified notice once (D125 3.8): `recorded` the first time, `duplicate` for an event
 * id already stored, which the route answers the same way, so the provider stops sending it.
 * Throws on malformed input (a bug in the verifier) or a database error (the route answers 5xx
 * and the provider retries).
 */
export async function recordProviderNotice(
  pool: DbPool,
  input: RecordProviderNoticeInput,
): Promise<'recorded' | 'duplicate'> {
  const { providerKind, live, notice, jobId } = RecordInputSchema.parse(input)
  const inserted = await withSystem(pool, (tx) =>
    tx
      .insert(providerNotices)
      .values({
        providerKind,
        eventId: notice.id,
        live,
        accountRef: notice.accountRef?.provider ?? null,
        type: notice.type,
        kind: notice.kind,
        objectRef: notice.objectRef?.provider ?? null,
        source: 'provider',
        actor: 'system',
        jobId,
      })
      .onConflictDoNothing({ target: [providerNotices.providerKind, providerNotices.eventId] })
      .returning({ seq: providerNotices.seq }),
  )
  return inserted.length > 0 ? 'recorded' : 'duplicate'
}
