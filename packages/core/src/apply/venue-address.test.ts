// A venue's address name over time (D84), as the restro_app role on a real Postgres: a rename
// remembers the old name, an old name of another venue is not free (neither for a new venue nor
// for a rename), a venue may take its own old name back, and the organisation's history stays
// within the organisation (row-level security). Skipped without a database.
import { createPool, type DbPool, venueSlugHistory, withTenant } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { provisionTenant, provisionVenue, renameVenueSlug } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)(
  'venue address names and their history (as the restro_app role)',
  () => {
    const tenant = newId('tn')
    const other = newId('tn')
    let app: DbPool
    let owner: pg.Pool

    beforeAll(async () => {
      owner = openOwnerPool()
      app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-address-tests' })
      await provisionTenant(app, { tenantId: tenant, name: 'Address club' })
      await provisionTenant(app, { tenantId: other, name: 'Other address club' })
    })

    afterAll(async () => {
      await app?.end()
      if (owner) {
        await cleanUp(owner, [tenant, other])
        await owner.end()
      }
    })

    const history = () =>
      withTenant(app, tenant, (tx) =>
        tx
          .select({ slug: venueSlugHistory.slug, venueId: venueSlugHistory.venueId })
          .from(venueSlugHistory),
      )

    it('a rename remembers the old name; the old name is reserved for that venue', async () => {
      const first = testSlug('first-name')
      const second = testSlug('second-name')
      const venue = (await provisionVenue(app, tenant, { name: 'Renamed', slug: first })).id
      expect(await renameVenueSlug(app, tenant, venue, second)).toMatchObject({
        slug: second,
        changed: true,
      })
      expect((await history()).filter((row) => row.venueId === venue)).toEqual([
        { slug: first, venueId: venue },
      ])

      // Another venue cannot be created with, or renamed to, the old name.
      await expect(
        provisionVenue(app, tenant, { name: 'Squatter', slug: first }),
      ).rejects.toMatchObject({ code: 'slug_taken' })
      const neighbour = (
        await provisionVenue(app, tenant, { name: 'Neighbour', slug: testSlug('neighbour') })
      ).id
      await expect(renameVenueSlug(app, tenant, neighbour, first)).rejects.toMatchObject({
        code: 'slug_taken',
      })
      // The current name is taken too (as before).
      await expect(renameVenueSlug(app, tenant, neighbour, second)).rejects.toMatchObject({
        code: 'slug_taken',
      })

      // The venue itself may go back to its old name; both names stay remembered for it.
      expect(await renameVenueSlug(app, tenant, venue, first)).toMatchObject({
        slug: first,
        changed: true,
      })
      expect(
        (await history())
          .filter((row) => row.venueId === venue)
          .map((row) => row.slug)
          .sort(),
      ).toEqual([first, second].sort())
      // Another organisation is free to use the same names (the history is per organisation).
      const elsewhere = await provisionVenue(app, other, { name: 'Elsewhere', slug: first })
      expect(elsewhere.slug).toBe(first)
      expect(await withTenant(app, other, (tx) => tx.select().from(venueSlugHistory))).toEqual([])
    })
  },
)
