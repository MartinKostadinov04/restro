// Rename, delete and restore a venue (CF-18, D76) against a real Postgres, as the restro_app role:
// what the server actions write, who may call them (owners delete and restore, owners and admins
// rename), every refusal, the jobs they queue, and that the reads of the admin leave a deleted
// venue out. The session and the job queue are the only fakes: they say which organisation and
// role is asking, and record the jobs that would be queued.

import { randomUUID } from 'node:crypto'
import { JOB_NAMES, newId } from '@restro/core'
import {
  createIntegration,
  issueTableToken,
  listVenueTables,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  upsertBarsyVenues,
  upsertPlaces,
} from '@restro/core/apply'

import type pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { getPool } from './db'
import { hasDatabase, openOwnerPool, testSlug, useTestServerEnvironment } from './test-database'
import { getVenue, getVenueInAnyState, listArchivedVenues, listVenues } from './venues'
import {
  deleteVenueAction,
  renameVenueAction,
  restoreVenueAction,
  unpublishVenueAction,
} from './venues-actions'

const asked = vi.hoisted(() => ({ tenantId: '', role: 'owner' }))
const revalidated = vi.hoisted(() => [] as string[])
const queue = vi.hoisted(() => ({
  jobs: [] as { name: string; data: Record<string, unknown> }[],
  failing: false,
}))

vi.mock('@/server/session', () => ({
  requireTenant: async () => ({
    user: { id: 'us_cf18tester', name: 'Tester', email: 'tester@example.test' },
    organizations: [],
    organization: { id: asked.tenantId, name: 'CF-18 club', slug: 'cf18-club', role: asked.role },
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidated.push(path) }))
vi.mock('./jobs', () => ({
  enqueueJob: async (name: string, data: Record<string, unknown>) => {
    if (queue.failing) throw new Error('the queue is down')
    queue.jobs.push({ name, data })
    return 'job-1'
  },
}))

describe.skipIf(!hasDatabase)('rename, delete and restore a venue (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let owner: pg.Pool
  let integrationId: string
  let bid = 4000

  const rowOf = async (venueId: string) =>
    (
      await owner.query<{ name: string; archived_at: Date | null; updated_at: Date }>(
        'select name, archived_at, updated_at from restro.venues where id = $1',
        [venueId],
      )
    ).rows[0]
  const linkedBid = async (venueId: string) =>
    (
      await owner.query<{ bid: number }>(
        'select bid from restro.barsy_venues where venue_id = $1',
        [venueId],
      )
    ).rows[0]?.bid
  /** A venue of `tenantId` with its menu, made the way the app makes it. */
  const makeVenue = async (tenantId: string, name = 'Club Neon') => {
    const venue = await provisionVenue(getPool(), tenantId, { name, slug: testSlug('cf18') })
    const menu = await provisionMenu(getPool(), tenantId, venue.id)
    return { venue, menu }
  }
  /** A venue linked to a till venue with two tables that have codes. */
  async function tillVenueWithCodes() {
    const made = await makeVenue(tenant, 'Till Club')
    bid += 1
    await upsertBarsyVenues(getPool(), tenant, integrationId, [{ bid, name: `Till ${bid}` }])
    expect(await mapBarsyVenue(getPool(), tenant, integrationId, bid, made.venue.id)).toMatchObject(
      { ok: true },
    )
    await upsertPlaces(
      getPool(),
      tenant,
      integrationId,
      bid,
      [
        { placeId: `t${bid}a`, placeNum: '1', salonName: 'Hall', isPublic: true },
        { placeId: `t${bid}b`, placeNum: '2', salonName: 'Hall', isPublic: true },
      ],
      { pagesOk: [true] },
    )
    const codes: string[] = []
    for (const table of await listVenueTables(getPool(), tenant, made.venue.id)) {
      const issued = await issueTableToken(getPool(), tenant, table.id)
      if (!issued.ok) throw new Error(issued.reason)
      codes.push(issued.table.token ?? '')
    }
    return { ...made, bid, codes }
  }

  beforeAll(async () => {
    useTestServerEnvironment()
    owner = openOwnerPool()
    await provisionTenant(getPool(), { tenantId: tenant, name: 'CF-18 club' })
    await provisionTenant(getPool(), { tenantId: otherTenant, name: 'Another club' })
    integrationId = (
      await createIntegration(getPool(), tenant, { kind: 'barsy', host: 'cf18-web.test' })
    ).id
    asked.tenantId = tenant
  })

  beforeEach(() => {
    asked.role = 'owner'
    asked.tenantId = tenant
    revalidated.length = 0
    queue.jobs.length = 0
    queue.failing = false
  })

  afterAll(async () => {
    if (owner) {
      const tenants = [tenant, otherTenant]
      for (const table of [
        'places',
        'barsy_venues',
        'integrations',
        'menu_routes',
        'tables',
        'areas',
        'menus',
        'nodes',
        'venues',
      ]) {
        await owner.query(`delete from restro.${table} where tenant_id = any($1)`, [tenants])
      }
      await owner.query('delete from restro.tenants where id = any($1)', [tenants])
      await owner.end()
    }
    await getPool().end()
  })

  describe('renameVenueAction', () => {
    it('renames for an owner, trimmed, and revalidates the layout so the sidebar follows', async () => {
      const { venue } = await makeVenue(tenant, 'Old name')
      expect(await renameVenueAction({ venueId: venue.id, name: '  New name  ' })).toEqual({
        ok: true,
        name: 'New name',
        changed: true,
      })
      expect((await rowOf(venue.id))?.name).toBe('New name')
      expect(revalidated).toEqual(['/'])
      // Nothing is queued: the name reaches guests with the next publish.
      expect(queue.jobs).toEqual([])
    })

    it('lets an admin, and a person with several roles that include one, rename', async () => {
      const { venue } = await makeVenue(tenant)
      for (const [role, name] of [
        ['admin', 'By an admin'],
        ['member,owner', 'By a owner member'],
      ] as const) {
        asked.role = role
        expect(await renameVenueAction({ venueId: venue.id, name })).toMatchObject({ ok: true })
        expect((await rowOf(venue.id))?.name).toBe(name)
      }
    })

    it('says "unchanged" for the name it already has, and writes nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Same')
      const before = await rowOf(venue.id)
      expect(await renameVenueAction({ venueId: venue.id, name: 'Same' })).toEqual({
        ok: true,
        name: 'Same',
        changed: false,
      })
      expect((await rowOf(venue.id))?.updated_at).toEqual(before?.updated_at)
    })

    it('refuses a plain member and writes nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Members cannot')
      asked.role = 'member'
      expect(await renameVenueAction({ venueId: venue.id, name: 'Changed' })).toEqual({
        ok: false,
        error: 'not_allowed',
      })
      expect((await rowOf(venue.id))?.name).toBe('Members cannot')
      expect(revalidated).toEqual([])
    })

    it("refuses another organisation's venue as invalid, and a deleted one as deleted", async () => {
      const theirs = await makeVenue(otherTenant, 'Theirs')
      expect(await renameVenueAction({ venueId: theirs.venue.id, name: 'Mine now' })).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect((await rowOf(theirs.venue.id))?.name).toBe('Theirs')

      const mine = await makeVenue(tenant, 'Soon gone')
      await owner.query('update restro.venues set archived_at = now() where id = $1', [
        mine.venue.id,
      ])
      expect(await renameVenueAction({ venueId: mine.venue.id, name: 'Too late' })).toEqual({
        ok: false,
        error: 'venue_archived',
      })
      expect((await rowOf(mine.venue.id))?.name).toBe('Soon gone')
    })

    it('refuses bad input as invalid and writes nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Keeps its name')
      const bad: unknown[] = [
        { venueId: venue.id, name: '' },
        { venueId: venue.id, name: '    ' },
        { venueId: venue.id, name: 'x'.repeat(121) },
        { venueId: venue.id, name: 5 },
        { venueId: venue.id },
        { name: 'No venue' },
        { venueId: 'nd_0123456789ABCDEFGHIJKL', name: 'Fine' },
        { venueId: venue.id, name: 'Fine', slug: 'extra' },
        null,
        'name',
      ]
      for (const input of bad) {
        expect(await renameVenueAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect((await rowOf(venue.id))?.name).toBe('Keeps its name')
      // 120 characters is fine.
      expect(await renameVenueAction({ venueId: venue.id, name: 'y'.repeat(120) })).toMatchObject({
        ok: true,
      })
    })
  })

  describe('deleteVenueAction', () => {
    it('archives the venue for an owner who typed its name, releases the till, and queues the withdrawals', async () => {
      const { venue, menu, bid: till, codes } = await tillVenueWithCodes()
      const result = await deleteVenueAction({ venueId: venue.id, confirmName: 'Till Club' })
      expect(result).toEqual({ ok: true, filesQueued: true })

      expect((await rowOf(venue.id))?.archived_at).toBeInstanceOf(Date)
      expect(await linkedBid(venue.id)).toBeUndefined()
      // The till venue itself is still there, free for another venue.
      const free = await owner.query(
        'select bid from restro.barsy_venues where integration_id = $1 and bid = $2 and venue_id is null',
        [integrationId, till],
      )
      expect(free.rowCount).toBe(1)

      expect(queue.jobs).toEqual([
        {
          name: JOB_NAMES.publishFiles,
          data: { tenantId: tenant, menuId: menu.id, venueId: venue.id },
        },
        {
          name: JOB_NAMES.publishTableTokens,
          data: { tenantId: tenant, venueId: venue.id, retired: [...codes].sort() },
        },
      ])
      expect(revalidated).toEqual(['/'])
      // Not erased: the venue, its menu and the codes are still in the database.
      expect(
        (await owner.query('select id from restro.menus where venue_id = $1', [venue.id])).rowCount,
      ).toBe(1)
      const stored = await owner.query<{ qr_token: string }>(
        'select qr_token from restro.tables where venue_id = $1',
        [venue.id],
      )
      expect(stored.rows.map((row) => row.qr_token).sort()).toEqual([...codes].sort())
    })

    it('trims what was typed, and queues one token job even for a venue without table codes', async () => {
      const { venue } = await makeVenue(tenant, 'Plain Club')
      expect(
        await deleteVenueAction({ venueId: venue.id, confirmName: '  Plain Club \n' }),
      ).toEqual({
        ok: true,
        filesQueued: true,
      })
      expect(queue.jobs.map((job) => job.name)).toEqual([
        JOB_NAMES.publishFiles,
        JOB_NAMES.publishTableTokens,
      ])
      expect(queue.jobs[1]?.data.retired).toEqual([])
    })

    it('refuses a wrong name (also a different case or part of it), and deletes nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Exact Name')
      for (const confirmName of [
        '',
        'exact name',
        'Exact',
        'Exact Name!',
        'Other',
        'Exact  Name',
      ]) {
        expect(
          await deleteVenueAction({ venueId: venue.id, confirmName }),
          JSON.stringify(confirmName),
        ).toEqual({ ok: false, error: 'name_mismatch' })
      }
      expect((await rowOf(venue.id))?.archived_at).toBeNull()
      expect(queue.jobs).toEqual([])
      expect(revalidated).toEqual([])
    })

    it('refuses an admin and a member, and deletes nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Owners only')
      for (const role of ['admin', 'member', 'member,admin']) {
        asked.role = role
        expect(
          await deleteVenueAction({ venueId: venue.id, confirmName: 'Owners only' }),
          role,
        ).toEqual({ ok: false, error: 'not_allowed' })
      }
      expect((await rowOf(venue.id))?.archived_at).toBeNull()
      expect(queue.jobs).toEqual([])
    })

    it('lets a person with several roles that include owner delete', async () => {
      const { venue } = await makeVenue(tenant, 'Several roles')
      asked.role = 'member,owner'
      expect(
        await deleteVenueAction({ venueId: venue.id, confirmName: 'Several roles' }),
      ).toMatchObject({ ok: true })
    })

    it("refuses another organisation's venue as invalid, and a deleted one as deleted", async () => {
      const theirs = await makeVenue(otherTenant, 'Not yours')
      expect(
        await deleteVenueAction({ venueId: theirs.venue.id, confirmName: 'Not yours' }),
      ).toEqual({ ok: false, error: 'invalid' })
      expect((await rowOf(theirs.venue.id))?.archived_at).toBeNull()

      const { venue } = await makeVenue(tenant, 'Twice')
      expect(await deleteVenueAction({ venueId: venue.id, confirmName: 'Twice' })).toMatchObject({
        ok: true,
      })
      queue.jobs.length = 0
      expect(await deleteVenueAction({ venueId: venue.id, confirmName: 'Twice' })).toEqual({
        ok: false,
        error: 'venue_archived',
      })
      expect(queue.jobs).toEqual([])
    })

    it('refuses bad input as invalid', async () => {
      const { venue } = await makeVenue(tenant, 'Bad input')
      const bad: unknown[] = [
        { venueId: venue.id },
        { confirmName: 'Bad input' },
        { venueId: venue.id, confirmName: 5 },
        { venueId: 'not-an-id', confirmName: 'Bad input' },
        { venueId: venue.id, confirmName: 'Bad input', force: true },
        null,
      ]
      for (const input of bad) {
        expect(await deleteVenueAction(input), JSON.stringify(input)).toEqual({
          ok: false,
          error: 'invalid',
        })
      }
      expect((await rowOf(venue.id))?.archived_at).toBeNull()
    })

    it('deletes the venue even when the queue is down, and says the files are late', async () => {
      const { venue } = await makeVenue(tenant, 'Queue down')
      queue.failing = true
      expect(await deleteVenueAction({ venueId: venue.id, confirmName: 'Queue down' })).toEqual({
        ok: true,
        filesQueued: false,
      })
      expect((await rowOf(venue.id))?.archived_at).toBeInstanceOf(Date)
    })

    it('splits the table codes into batches the job accepts', async () => {
      // 501 codes: two jobs. Made straight in the database; only their number matters here.
      const { venue } = await makeVenue(tenant, 'Many tables')
      bid += 1
      await upsertBarsyVenues(getPool(), tenant, integrationId, [{ bid, name: `Many ${bid}` }])
      await mapBarsyVenue(getPool(), tenant, integrationId, bid, venue.id)
      const area = `ar_many${randomUUID().replaceAll('-', '').slice(0, 15)}`
      await owner.query(
        `insert into restro.areas (id, tenant_id, venue_id, name, sort_key)
         values ($1, $2, $3, 'Hall', 'a0')`,
        [area, tenant, venue.id],
      )
      await owner.query(
        `insert into restro.tables
           (id, tenant_id, venue_id, area_id, number, sort_key, qr_token, qr_code_hash)
         select 'tb_many' || lpad(n::text, 15, '0'), $1, $2, $3, n::text, 'a' || lpad(n::text, 3, '0'),
                code, encode(sha256(convert_to(code, 'UTF8')), 'hex')
         from generate_series(1, 501) as n, lateral (select $4 || lpad(n::text, 8, '0') as code) c`,
        [tenant, venue.id, area, randomUUID().replaceAll('-', '').slice(0, 14)],
      )
      expect(
        await deleteVenueAction({ venueId: venue.id, confirmName: 'Many tables' }),
      ).toMatchObject({ ok: true, filesQueued: true })
      const tokenJobs = queue.jobs.filter((job) => job.name === JOB_NAMES.publishTableTokens)
      expect(tokenJobs.map((job) => (job.data.retired as string[]).length)).toEqual([500, 1])
    })
  })

  describe('restoreVenueAction', () => {
    it('restores a deleted venue for an owner, with its till linked again, and queues nothing', async () => {
      const { venue, bid: till, codes } = await tillVenueWithCodes()
      await deleteVenueAction({ venueId: venue.id, confirmName: 'Till Club' })
      queue.jobs.length = 0
      revalidated.length = 0

      expect(await restoreVenueAction({ venueId: venue.id })).toEqual({
        ok: true,
        name: 'Till Club',
        relinked: true,
      })
      expect((await rowOf(venue.id))?.archived_at).toBeNull()
      // Linked again (adjustments V1), with the same table codes; the publish brings the files
      // back (D86), so no job is queued here.
      expect(await linkedBid(venue.id)).toBe(till)
      expect(
        (await listVenueTables(getPool(), tenant, venue.id)).map((table) => table.token).sort(),
      ).toEqual([...codes].sort())
      expect(queue.jobs).toEqual([])
      expect(revalidated).toEqual(['/'])
      expect((await getVenue(tenant, venue.id))?.name).toBe('Till Club')
    })

    it('refuses the restore, naming the venue, when another one serves its till venue now', async () => {
      const { venue, bid: till } = await tillVenueWithCodes()
      await deleteVenueAction({ venueId: venue.id, confirmName: 'Till Club' })
      const holder = await makeVenue(tenant, 'Holder Club')
      expect(
        await mapBarsyVenue(getPool(), tenant, integrationId, till, holder.venue.id),
      ).toMatchObject({ ok: true })
      queue.jobs.length = 0

      expect(await restoreVenueAction({ venueId: venue.id })).toEqual({
        ok: false,
        error: 'till_taken',
        holder: 'Holder Club',
      })
      expect((await rowOf(venue.id))?.archived_at).toBeInstanceOf(Date)
      expect(await linkedBid(holder.venue.id)).toBe(till)
      expect(queue.jobs).toEqual([])
    })

    it('refuses an admin and a member, and restores nothing', async () => {
      const { venue } = await makeVenue(tenant, 'Stays deleted')
      await deleteVenueAction({ venueId: venue.id, confirmName: 'Stays deleted' })
      for (const role of ['admin', 'member']) {
        asked.role = role
        expect(await restoreVenueAction({ venueId: venue.id }), role).toEqual({
          ok: false,
          error: 'not_allowed',
        })
      }
      expect((await rowOf(venue.id))?.archived_at).toBeInstanceOf(Date)
    })

    it('answers ok for a venue that is live already, and refuses what is not the organisation’s', async () => {
      const { venue } = await makeVenue(tenant, 'Live already')
      expect(await restoreVenueAction({ venueId: venue.id })).toMatchObject({ ok: true })
      const theirs = await makeVenue(otherTenant, 'Theirs')
      await owner.query('update restro.venues set archived_at = now() where id = $1', [
        theirs.venue.id,
      ])
      expect(await restoreVenueAction({ venueId: theirs.venue.id })).toEqual({
        ok: false,
        error: 'invalid',
      })
      expect((await rowOf(theirs.venue.id))?.archived_at).toBeInstanceOf(Date)
      expect(await restoreVenueAction({ venueId: 'nope' })).toEqual({ ok: false, error: 'invalid' })
    })

    it('restores a venue without a till even when the queue is down (it needs no job)', async () => {
      const { venue } = await makeVenue(tenant, 'Restore late')
      await deleteVenueAction({ venueId: venue.id, confirmName: 'Restore late' })
      queue.failing = true
      expect(await restoreVenueAction({ venueId: venue.id })).toEqual({
        ok: true,
        name: 'Restore late',
        relinked: false,
      })
      expect((await rowOf(venue.id))?.archived_at).toBeNull()
    })
  })

  describe('unpublishVenueAction', () => {
    it('takes a live venue off the phones and hands its table codes to the files job (D86)', async () => {
      const { venue, codes } = await tillVenueWithCodes()
      queue.jobs.length = 0
      expect(await unpublishVenueAction({ venueId: venue.id })).toMatchObject({
        ok: true,
        name: 'Till Club',
        filesQueued: true,
      })
      const tokensJob = queue.jobs.find((job) => job.name === JOB_NAMES.publishTableTokens)
      expect([...((tokensJob?.data.retired as string[] | undefined) ?? [])].sort()).toEqual(
        [...codes].sort(),
      )
      expect((await getVenue(tenant, venue.id))?.unpublishedAt).toBeInstanceOf(Date)
    })
  })

  describe('the reads of the admin', () => {
    it('leave a deleted venue out of the list, the single read and the restore list moves it', async () => {
      const kept = await makeVenue(tenant, 'Kept')
      const gone = await makeVenue(tenant, 'Gone')
      expect((await listVenues(tenant)).map((venue) => venue.id)).toEqual(
        expect.arrayContaining([kept.venue.id, gone.venue.id]),
      )
      await deleteVenueAction({ venueId: gone.venue.id, confirmName: 'Gone' })

      const live = (await listVenues(tenant)).map((venue) => venue.id)
      expect(live).toContain(kept.venue.id)
      expect(live).not.toContain(gone.venue.id)
      expect(await getVenue(tenant, gone.venue.id)).toBeNull()
      expect((await getVenue(tenant, kept.venue.id))?.name).toBe('Kept')
      // In any state it is still found (the delete action tells "deleted" from "not yours").
      expect((await getVenueInAnyState(tenant, gone.venue.id))?.archivedAt).toBeInstanceOf(Date)
      expect(await getVenueInAnyState(otherTenant, gone.venue.id)).toBeNull()

      const archived = await listArchivedVenues(tenant)
      expect(archived.map((venue) => venue.id)).toContain(gone.venue.id)
      expect(archived.map((venue) => venue.id)).not.toContain(kept.venue.id)
      // Another organisation's deleted venues are not in it.
      expect((await listArchivedVenues(otherTenant)).map((venue) => venue.id)).not.toContain(
        gone.venue.id,
      )

      await restoreVenueAction({ venueId: gone.venue.id })
      expect((await listVenues(tenant)).map((venue) => venue.id)).toContain(gone.venue.id)
      expect((await listArchivedVenues(tenant)).map((venue) => venue.id)).not.toContain(
        gone.venue.id,
      )
    })

    it('list the most recently deleted venue first', async () => {
      const first = await makeVenue(tenant, 'Deleted first')
      const second = await makeVenue(tenant, 'Deleted second')
      await deleteVenueAction({ venueId: first.venue.id, confirmName: 'Deleted first' })
      await deleteVenueAction({ venueId: second.venue.id, confirmName: 'Deleted second' })
      const ids = (await listArchivedVenues(tenant)).map((venue) => venue.id)
      expect(ids.indexOf(second.venue.id)).toBeLessThan(ids.indexOf(first.venue.id))
    })
  })
})
