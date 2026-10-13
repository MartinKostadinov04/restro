// What the All venues cards read (D86, D84): `listVenueCards` against a real Postgres, as the
// restro_app role. The state (Draft, Live, back to Draft after Unpublish), the POS instance and the
// venue's name in it, the guest address `/m/<organisation>/<venue>`, the bin left out, another
// organisation's venues hidden by row-level security, and the same number of queries however many
// venues there are; and `unpublishVenueAction`, which turns a live card into a draft. The session
// and the job queue are the only fakes. Skipped without a database.
import { JOB_NAMES, newId } from '@restro/core'
import {
  apply,
  archiveVenue,
  createIntegration,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  unpublishVenue,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'
import { listVenueCards } from './venues'
import { unpublishVenueAction } from './venues-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_s2tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'S2 cards', slug: 'night-group', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))
vi.mock('./jobs', () => ({
  enqueueJob: async (name: string, data: Record<string, unknown>) => {
    if (queue.failing) throw new Error('the queue is down')
    queue.jobs.push({ name, data })
    return 'job-1'
  },
}))

describe.skipIf(!hasDatabase)('listVenueCards (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const organizationSlug = testSlug('night-group')
  let owner: pg.Pool

  /** A venue with its menu; `publish` also puts one section and one priced item on guests' phones. */
  async function makeVenue(name: string, publish: boolean, tenantId = tenant) {
    const slug = testSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    const venue = await provisionVenue(getPool(), tenantId, { name, slug })
    const menu = await provisionMenu(getPool(), tenantId, venue.id)
    if (publish) {
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
      const result = await apply(getPool(), tenantId, {
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
            parent: { id: menu.id },
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
      } as never)
      expect(result.rejected).toEqual([])
      await publishMenu(getPool(), tenantId, {
        menuId: menu.id,
        venueId: venue.id,
        reason: 'manual',
        actor: 'user:us_test',
      })
    }
    return { venue, slug }
  }
  const cards = () => listVenueCards(getPool(), tenant)
  const cardOf = async (name: string) => (await cards()).find((card) => card.name === name)

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'S2 cards' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    await owner.query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)', [
      tenant,
      'S2 cards',
      organizationSlug,
    ])
  })

  beforeEach(() => {
    asked.tenantId = tenant
    asked.role = 'owner'
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      await owner.query('delete from restro.auth_organization where id = $1', [tenant])
      for (const table of [
        'job_runs',
        'item_first_published',
        'publish_pointers',
        'snapshots',
        'events',
        'field_values',
        'placements',
        'menus',
        'nodes',
        'barsy_venues',
        'integrations',
        'venue_slug_history',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
    await getPool().end()
  })

  it('is a draft before the first publish, live after it, and a draft again once unpublished', async () => {
    const { venue } = await makeVenue('Cards Fresh', false)
    expect(await cardOf('Cards Fresh')).toMatchObject({ id: venue.id, state: 'draft' })

    const live = await makeVenue('Cards Live', true)
    expect(await cardOf('Cards Live')).toMatchObject({ id: live.venue.id, state: 'live' })

    await unpublishVenue(getPool(), tenant, live.venue.id)
    expect((await cardOf('Cards Live'))?.state).toBe('draft')
  })

  it('names the guest address /m/<organisation>/<venue>, the organisation’s slug and the venue’s', async () => {
    const { slug } = await makeVenue('Cards Address', false)
    expect((await cardOf('Cards Address'))?.guestPath).toBe(`/m/${organizationSlug}/${slug}`)
  })

  it('has no address when the organisation’s own is not known', async () => {
    const lonely = newId('tn')
    await provisionTenant(getPool(), { tenantId: lonely, name: 'No slug' })
    await makeVenue('Cards Lonely', false, lonely)
    expect((await listVenueCards(getPool(), lonely)).map((card) => card.guestPath)).toEqual([null])
    await owner.query('delete from restro.menus where tenant_id = $1', [lonely])
    await owner.query('delete from restro.nodes where tenant_id = $1', [lonely])
    await owner.query('delete from restro.venues where tenant_id = $1', [lonely])
    await owner.query('delete from restro.tenants where id = $1', [lonely])
  })

  it('says By hand (no instance) for a venue with no POS link, and names the instance and the POS venue for a linked one', async () => {
    const hand = await makeVenue('Cards By Hand', false)
    const linked = await makeVenue('Cards Linked', false)
    const integration = await createIntegration(getPool(), tenant, {
      kind: 'barsy',
      host: 's2-cards.test',
      name: 'Till Sofia',
    })
    await updateIntegration(getPool(), tenant, integration.id, { status: 'connected' })
    await upsertBarsyVenues(getPool(), tenant, integration.id, [
      { bid: 9001, name: 'Neon (centre)' },
    ])
    expect(
      await mapBarsyVenue(getPool(), tenant, integration.id, 9001, linked.venue.id),
    ).toMatchObject({ ok: true })

    expect(await cardOf('Cards By Hand')).toEqual({
      id: hand.venue.id,
      name: 'Cards By Hand',
      state: 'draft',
      instanceName: null,
      tillVenueName: null,
      guestPath: `/m/${organizationSlug}/${hand.slug}`,
    })
    expect(await cardOf('Cards Linked')).toEqual({
      id: linked.venue.id,
      name: 'Cards Linked',
      state: 'draft',
      instanceName: 'Till Sofia',
      tillVenueName: 'Neon (centre)',
      guestPath: `/m/${organizationSlug}/${linked.slug}`,
    })
  })

  it('leaves out a venue in the bin, and another organisation’s venues', async () => {
    const gone = await makeVenue('Cards Gone', false)
    const theirs = await makeVenue('Cards Theirs', false, otherTenant)
    await archiveVenue(getPool(), tenant, gone.venue.id)
    const ids = (await cards()).map((card) => card.id)
    expect(ids).not.toContain(gone.venue.id)
    expect(ids).not.toContain(theirs.venue.id)
    expect((await listVenueCards(getPool(), otherTenant)).map((card) => card.id)).toEqual([
      theirs.venue.id,
    ])
  })

  it('turns a live card into a draft when an owner or admin unpublishes the venue, and queues the files that withdraw it', async () => {
    for (const role of ['owner', 'admin']) {
      asked.role = role
      queue.jobs.length = 0
      const name = `Cards Unpublish ${role}`
      const { venue } = await makeVenue(name, true)
      expect((await cardOf(name))?.state).toBe('live')
      expect(await unpublishVenueAction({ venueId: venue.id })).toEqual({
        ok: true,
        name,
        filesQueued: true,
      })
      expect((await cardOf(name))?.state).toBe('draft')
      expect(queue.jobs.map((job) => job.name)).toEqual([
        JOB_NAMES.publishFiles,
        JOB_NAMES.publishTableTokens,
      ])
    }
  })

  it('says so when the withdrawing jobs could not be queued; the venue is a draft all the same', async () => {
    const { venue } = await makeVenue('Cards Unpublish Late', true)
    queue.failing = true
    expect(await unpublishVenueAction({ venueId: venue.id })).toEqual({
      ok: true,
      name: 'Cards Unpublish Late',
      filesQueued: false,
    })
    expect((await cardOf('Cards Unpublish Late'))?.state).toBe('draft')
  })

  it('refuses a plain member, another organisation’s venue and a deleted venue, and changes nothing', async () => {
    const { venue } = await makeVenue('Cards Unpublish Refused', true)
    asked.role = 'member'
    expect(await unpublishVenueAction({ venueId: venue.id })).toEqual({
      ok: false,
      error: 'not_allowed',
    })
    expect((await cardOf('Cards Unpublish Refused'))?.state).toBe('live')
    expect(queue.jobs).toEqual([])

    asked.role = 'owner'
    const theirs = await makeVenue('Cards Unpublish Theirs', true, otherTenant)
    expect(await unpublishVenueAction({ venueId: theirs.venue.id })).toEqual({
      ok: false,
      error: 'invalid',
    })
    const theirCards = await listVenueCards(getPool(), otherTenant)
    expect(theirCards.find((card) => card.id === theirs.venue.id)?.state).toBe('live')

    await archiveVenue(getPool(), tenant, venue.id)
    expect(await unpublishVenueAction({ venueId: venue.id })).toEqual({
      ok: false,
      error: 'venue_archived',
    })
    expect(await unpublishVenueAction({ venueId: 'nope' })).toEqual({ ok: false, error: 'invalid' })
    expect(queue.jobs).toEqual([])
  })

  it('reads every venue with the same queries, however many there are (no N+1)', async () => {
    const queries = vi.spyOn(pg.Client.prototype, 'query')
    try {
      queries.mockClear()
      const before = (await cards()).length
      const withFew = queries.mock.calls.length
      // The spy sees the queries at all (otherwise 0 would equal 0 below).
      expect(withFew).toBeGreaterThan(0)
      for (const name of ['Cards Many A', 'Cards Many B', 'Cards Many C', 'Cards Many D']) {
        await makeVenue(name, false)
      }
      queries.mockClear()
      const after = (await cards()).length
      expect(after).toBe(before + 4)
      expect(queries.mock.calls.length).toBe(withFew)
    } finally {
      queries.mockRestore()
    }
  })
})
