// The worker's side of the provider notices (#108; D127 1.4, design §8): the stored notices not
// handled yet, page by page; marking one handled; and the venue a provider account belongs to.
// The notice route only stores (`./notices.ts`); the `provider-notices` job reads each notice's
// payment back from the provider and records it with `payment.observe`.

import {
  authOrganization,
  type DbPool,
  type PROVIDER_NOTICE_KINDS,
  paymentAccounts,
  providerNotices,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

/** A notice's kind in the platform's words, which picks the worker's handler. */
export type StoredNoticeKind = (typeof PROVIDER_NOTICE_KINDS)[number]

/** A stored notice the worker has not handled. Its refs are backend only (rule 3). */
export interface StoredProviderNotice {
  readonly seq: number
  readonly providerKind: string
  readonly eventId: string
  readonly live: boolean
  readonly accountRef: string | null
  readonly type: string
  readonly kind: StoredNoticeKind
  readonly objectRef: string | null
  readonly receivedAt: Date
}

/** Which unhandled notices to read: a page of a keyset walk by `seq`. */
export interface UnhandledNoticesPage {
  /** At most this many. */
  readonly limit: number
  /** Only notices after this `seq` (0 for the start). */
  readonly afterSeq?: number
  /** Only notices of these provider kinds (all when left out). */
  readonly providerKinds?: readonly string[]
}

/**
 * The notices not handled yet, in the order they were stored (`seq`). A caller pages through
 * them with `afterSeq`, so notices that keep waiting never hide the ones stored after them.
 */
export async function unhandledProviderNotices(
  pool: DbPool,
  page: UnhandledNoticesPage,
): Promise<StoredProviderNotice[]> {
  if (page.providerKinds?.length === 0) return []
  const rows = await withSystem(pool, (tx) =>
    tx
      .select({
        seq: providerNotices.seq,
        providerKind: providerNotices.providerKind,
        eventId: providerNotices.eventId,
        live: providerNotices.live,
        accountRef: providerNotices.accountRef,
        type: providerNotices.type,
        kind: providerNotices.kind,
        objectRef: providerNotices.objectRef,
        receivedAt: providerNotices.receivedAt,
      })
      .from(providerNotices)
      .where(
        and(
          isNull(providerNotices.handledAt),
          gt(providerNotices.seq, page.afterSeq ?? 0),
          page.providerKinds === undefined
            ? undefined
            : inArray(providerNotices.providerKind, [...page.providerKinds]),
        ),
      )
      .orderBy(asc(providerNotices.seq))
      .limit(page.limit),
  )
  return rows.map((row) => ({ ...row, kind: row.kind as StoredNoticeKind }))
}

/** Marks a notice handled; false when it was handled already (by another run). */
export async function markProviderNoticeHandled(pool: DbPool, seq: number): Promise<boolean> {
  const updated = await withSystem(pool, (tx) =>
    tx
      .update(providerNotices)
      .set({ handledAt: sql`now()` })
      .where(and(eq(providerNotices.seq, seq), isNull(providerNotices.handledAt)))
      .returning({ seq: providerNotices.seq }),
  )
  return updated.length > 0
}

/** Where a provider account belongs: one venue of one tenant (`payment_accounts_account_unique`). */
export interface AccountVenue {
  readonly tenantId: string
  readonly venueId: string
}

/**
 * The venues of a provider's accounts, by account ref. A notice names only the account; the
 * accounts live in tenant tables under row-level security, so each tenant is read in turn, as the
 * floor tick does. A venue that was deleted still maps (its notices are refused there, and logged)
 * unless `liveOnly` leaves archived venues out (a job that acts for the venue).
 */
export async function paymentAccountVenues(
  pool: DbPool,
  providerKind: string,
  options: { readonly liveOnly?: boolean } = {},
): Promise<Map<string, AccountVenue>> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  const byAccount = new Map<string, AccountVenue>()
  for (const organisation of organisations) {
    const rows = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({ accountRef: paymentAccounts.accountRef, venueId: paymentAccounts.venueId })
        .from(paymentAccounts)
        .innerJoin(venues, eq(venues.id, paymentAccounts.venueId))
        .where(
          and(
            eq(paymentAccounts.providerKind, providerKind),
            isNotNull(paymentAccounts.accountRef),
            options.liveOnly === true ? isNull(venues.archivedAt) : undefined,
          ),
        ),
    )
    for (const row of rows) {
      if (row.accountRef !== null) {
        byAccount.set(row.accountRef, { tenantId: organisation.id, venueId: row.venueId })
      }
    }
  }
  return byAccount
}
