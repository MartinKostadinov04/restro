// setPayingSettings against Postgres as the restro_app role (D127, #104): the smallest card payment
// is saved beside the venue's other settings, never below the provider's minimum.
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { DEFAULT_PAYING_SETTINGS } from '../paying-settings'
import { PayingSettingsError, setPayingSettings } from './paying-settings'
import { provisionTenant, provisionVenue } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('saving the paying settings (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string

  const settingsOf = async (): Promise<Record<string, unknown> | undefined> =>
    (
      await withTenant(app, tenant, (tx) => tx.select().from(venues).where(eq(venues.id, venueId)))
    )[0]?.settings

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-paying-settings-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Paying club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Paying', slug: testSlug('paying') })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  it('saves the smallest card payment and keeps the other settings', async () => {
    await owner.query(
      `update restro.venues set settings = '{"ordering": {"x": 1}}' where id = $1`,
      [venueId],
    )
    const saved = await setPayingSettings(app, tenant, {
      venueId,
      settings: { minCardMinor: 500 },
      providerMinMinor: 50,
    })
    expect(saved).toEqual({ minCardMinor: 500 })
    expect(await settingsOf()).toEqual({ ordering: { x: 1 }, paying: { minCardMinor: 500 } })

    expect(
      await setPayingSettings(app, tenant, { venueId, settings: null, providerMinMinor: 50 }),
    ).toEqual(DEFAULT_PAYING_SETTINGS)
    expect(await settingsOf()).toEqual({ ordering: { x: 1 } })
  })

  it("refuses an amount below the provider's minimum and writes nothing", async () => {
    const attempt = setPayingSettings(app, tenant, {
      venueId,
      settings: { minCardMinor: 49 },
      providerMinMinor: 50,
    })
    await expect(attempt).rejects.toBeInstanceOf(PayingSettingsError)
    await expect(attempt).rejects.toMatchObject({ code: 'invalid_input' })
    expect((await settingsOf())?.paying).toBeUndefined()
  })

  it("does not reach another tenant's venue", async () => {
    await expect(
      setPayingSettings(app, otherTenant, {
        venueId,
        settings: { minCardMinor: 500 },
        providerMinMinor: 50,
      }),
    ).rejects.toMatchObject({ code: 'venue_not_found' })
  })
})
