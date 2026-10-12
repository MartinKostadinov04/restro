// A venue's menu languages, read and reported (D77; adjustments L1, I3). `venueLanguages` (pure,
// ../languages.ts) decides; this module reads the facts for it and records the connector's report
// after a complete full read. Only this folder may import the write side of the database.

import { type DbPool, type ReadTx, venues, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq, sql } from 'drizzle-orm'

import { isId } from '../ids'
import {
  LANGUAGE_REPORT_KEY,
  type LanguageReport,
  LanguageReportSchema,
  type VenueLanguages,
  venueLanguages,
} from '../languages'
import { ProvisionError } from './provision'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

const LANGUAGE_COLUMNS = {
  defaultLocale: venues.defaultLocale,
  enabledLocales: venues.enabledLocales,
  settings: venues.settings,
}

/**
 * The venue's languages inside a transaction the caller owns (the publisher, the tag writers), or
 * null when the tenant has no such venue.
 */
export async function venueLanguagesIn(
  tx: ReadTx,
  venueId: string,
): Promise<VenueLanguages | null> {
  const [venue] = await tx.select(LANGUAGE_COLUMNS).from(venues).where(eq(venues.id, venueId))
  return venue === undefined ? null : venueLanguages(venue)
}

/** The venue's languages. Throws `ProvisionError` (`venue_missing`) when the tenant has no such venue. */
export async function readVenueLanguages(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<VenueLanguages> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  const languages = await withTenant(pool, tenantId, (tx) => venueLanguagesIn(tx, venueId))
  if (languages === null) {
    throw new ProvisionError('venue_missing', venueRefusalText(venueId, 'venue_missing'))
  }
  return languages
}

/**
 * Records what a connector found after a complete full read of the venue's till (D77, I3): the
 * languages the till offers and how many guest-facing texts it fills in each. The report replaces
 * the previous one; the owner's own languages are untouched. Returns the venue's languages as
 * they are now. Refuses a malformed report (`invalid_input`), a venue the tenant does not have
 * (`venue_missing`) and a deleted one (`venue_archived`).
 */
export async function recordLanguageReport(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  report: LanguageReport,
): Promise<VenueLanguages> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', venueId)) throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  const parsed = LanguageReportSchema.safeParse(report)
  if (!parsed.success) {
    throw new ProvisionError(
      'invalid_input',
      `the language report is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}`,
    )
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    // One top-level key replaced; every other setting stays.
    const patch = JSON.stringify({ [LANGUAGE_REPORT_KEY]: parsed.data })
    const [row] = await tx
      .update(venues)
      .set({ settings: sql`(${venues.settings} || ${patch}::jsonb)` })
      .where(eq(venues.id, venueId))
      .returning(LANGUAGE_COLUMNS)
    if (row === undefined) {
      throw new ProvisionError('venue_missing', venueRefusalText(venueId, 'venue_missing'))
    }
    return venueLanguages(row)
  })
}
