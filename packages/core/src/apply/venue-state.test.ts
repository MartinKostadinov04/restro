// A venue's state (D86): the pure function, and Unpublish against Postgres as the restro_app
// role: it flags the venue, a publish of any of its menus clears the flag, a deleted venue is
// refused. Skipped without a database (the pure part always runs).
import { createPool, type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { newId } from '../ids'
import { venueIsServed, venueStateOf } from '../venue-state'
import { apply } from './apply'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'
import { archiveVenue, unpublishVenue } from './venue-lifecycle'

describe('venueStateOf (D86)', () => {
  const at = new Date('2026-10-12T10:00:00Z')
  it('is archived first, then a draft when unpublished or never published, else live', () => {
    expect(venueStateOf({ archivedAt: at, unpublishedAt: null, livePublished: true })).toBe(
      'archived',
    )
    expect(venueStateOf({ archivedAt: at, unpublishedAt: at, livePublished: false })).toBe(
      'archived',
    )
    expect(venueStateOf({ archivedAt: null, unpublishedAt: at, livePublished: true })).toBe('draft')
    expect(venueStateOf({ archivedAt: null, unpublishedAt: null, livePublished: false })).toBe(
      'draft',
    )
    expect(venueStateOf({ archivedAt: null, unpublishedAt: null, livePublished: true })).toBe(
      'live',
    )
    expect(venueIsServed({ archivedAt: null, unpublishedAt: null, livePublished: true })).toBe(true)
    expect(venueIsServed({ archivedAt: null, unpublishedAt: at, livePublished: true })).toBe(false)
  })
})

describe.skipIf(!hasDatabase)('unpublishVenue (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-venue-state-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'State club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  /** A venue with a published live menu (one section, one priced item). */
  async function publishedVenue(name: string): Promise<{ venueId: string; menuId: string }> {
    const slug = testSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    const venueId = (await provisionVenue(app, tenant, { name, slug })).id
    const menuId = (await provisionMenu(app, tenant, venueId)).id
    const section = newId('nd')
    const item = newId('nd')
    const manual = (node: string, fieldKey: string, value: unknown) => ({
      op: 'setField',
      node: { id: node },
      fieldKey,
      layer: 'manual',
      scope: 'master',
      value,
    })
    const result = await apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops: [
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menuId },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: 'Main', en_US: 'Main' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Item', en_US: 'Item' }),
        manual(item, 'price', { amount_minor: 900, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
    await publishMenu(app, tenant, { menuId, venueId, reason: 'manual', actor: 'user:us_test' })
    return { venueId, menuId }
  }
  const unpublishedAt = async (venueId: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select({ at: venues.unpublishedAt }).from(venues).where(eq(venues.id, venueId)),
      )
    )[0]?.at ?? null

  it('flags the venue, says so twice, and a publish clears the flag', async () => {
    const { venueId, menuId } = await publishedVenue('To unpublish')
    expect(await unpublishedAt(venueId)).toBeNull()
    const first = await unpublishVenue(app, tenant, venueId)
    expect(first.changed).toBe(true)
    expect(first.unpublishedAt).toBeInstanceOf(Date)
    // No tables here: nothing to withdraw (the lifecycle test covers a venue with codes).
    expect(first.tableTokens).toEqual([])
    expect(await unpublishedAt(venueId)).toEqual(first.unpublishedAt)
    const again = await unpublishVenue(app, tenant, venueId)
    expect(again).toEqual({
      venueId,
      changed: false,
      unpublishedAt: first.unpublishedAt,
      tableTokens: [],
    })

    // Publishing (even "nothing changed") is the word to serve the venue again.
    const published = await publishMenu(app, tenant, {
      menuId,
      venueId,
      reason: 'manual',
      actor: 'user:us_test',
    })
    expect(published.status).toBe('unchanged')
    expect(await unpublishedAt(venueId)).toBeNull()
  })

  it('refuses a deleted venue and one the tenant does not have', async () => {
    const { venueId } = await publishedVenue('Gone')
    await archiveVenue(app, tenant, venueId)
    await expect(unpublishVenue(app, tenant, venueId)).rejects.toMatchObject({
      code: 'venue_archived',
    })
    await expect(unpublishVenue(app, tenant, newId('vn'))).rejects.toMatchObject({
      code: 'venue_missing',
    })
    await expect(unpublishVenue(app, tenant, 'nope')).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
