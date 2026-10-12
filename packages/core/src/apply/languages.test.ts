// Integration tests on a real Postgres (as restro_app): the connector's language report is
// recorded on the venue and the venue's languages follow it (D77, adjustments L1, I3).
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { LANGUAGE_REPORT_KEY, type LanguageReport } from '../languages'
import { readVenueLanguages, recordLanguageReport } from './languages'
import { ProvisionError, provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('venue languages against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string

  const report: LanguageReport = {
    reported_at: '2026-10-12T20:00:00.000Z',
    offered: ['bg_BG', 'en_US', 'de_DE', 'ru_RU'],
    filled: { bg_BG: 50, en_US: 30, de_DE: 12, ru_RU: 1 },
    total: 50,
  }

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-languages-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Languages test' })
    const venue = await provisionVenue(app, tenant, {
      name: 'Languages',
      slug: testSlug('languages'),
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG', 'en_US'],
    })
    venueId = venue.id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  it('a venue without a report has its owner’s languages', async () => {
    const languages = await readVenueLanguages(app, tenant, venueId)
    expect(languages).toMatchObject({
      main: 'bg_BG',
      all: ['bg_BG', 'en_US'],
      fromTill: [],
      coverage: null,
      report: null,
    })
  })

  it('records the report next to the other settings and adds the languages the till fills', async () => {
    // Another setting already there (written by the owner: this test is not about themes).
    await owner.query(
      `update restro.venues set settings = settings || '{"theme": {"brand": "#336699"}}'::jsonb where id = $1`,
      [venueId],
    )
    const languages = await recordLanguageReport(app, tenant, venueId, report)
    expect(languages.all).toEqual(['bg_BG', 'en_US', 'de_DE'])
    expect(languages.fromTill).toEqual(['bg_BG', 'en_US', 'de_DE'])
    expect(languages.report).toEqual(report)
    const [row] = await withTenant(app, tenant, (tx) =>
      tx.select({ settings: venues.settings }).from(venues).where(eq(venues.id, venueId)),
    )
    expect(row?.settings).toMatchObject({
      theme: { brand: '#336699' },
      [LANGUAGE_REPORT_KEY]: report,
    })
    expect(await readVenueLanguages(app, tenant, venueId)).toEqual(languages)
  })

  it('a newer report replaces the older one', async () => {
    const later = { ...report, reported_at: '2026-10-13T20:00:00.000Z', filled: { bg_BG: 50 } }
    const languages = await recordLanguageReport(app, tenant, venueId, later)
    expect(languages.all).toEqual(['bg_BG', 'en_US'])
    expect(languages.fromTill).toEqual(['bg_BG'])
    expect(languages.report).toEqual(later)
  })

  it('refuses a malformed report and a venue the tenant does not have', async () => {
    await expect(
      recordLanguageReport(app, tenant, venueId, { ...report, total: -1 }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(recordLanguageReport(app, tenant, newId('vn'), report)).rejects.toMatchObject({
      code: 'venue_missing',
    })
    await expect(readVenueLanguages(app, tenant, newId('vn'))).rejects.toBeInstanceOf(
      ProvisionError,
    )
  })
})
