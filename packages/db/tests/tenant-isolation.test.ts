// Integration tests on a real Postgres: row-level security keeps tenants apart even when a query
// forgets its tenant filter (brief S1-03, cases 1, 2, 3 and 5), and the client's read/write
// split holds at the database level.
import { eq, sql } from 'drizzle-orm'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createPool,
  type DbPool,
  InvalidTenantIdError,
  templates,
  tenants,
  UnsafeDatabaseRoleError,
  venues,
  withSystem,
  withTenant,
  workerHeartbeats,
} from '../src/index'
import { withTenantWrite } from '../src/write/index'
import {
  appDatabaseUrl,
  cleanUp,
  databaseError,
  hasDatabase,
  openOwnerPool,
  ownerDatabaseUrl,
  testId,
} from './database'

/** Postgres's message when a row fails a policy's WITH CHECK. */
const RLS_VIOLATION = /violates row-level security policy/

describe.skipIf(!hasDatabase)('tenant isolation (row-level security)', () => {
  const tenantA = testId('tn')
  const tenantB = testId('tn')
  const venueA = testId('vn')
  const venueB = testId('vn')
  const templateA = testId('tp')
  const systemTemplate = testId('tp')
  const worker = `worker-test-${testId('wk')}`

  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-db-tests' })

    // Each tenant creates itself and its venue through the write path, as restro_app.
    for (const [tenantId, venueId, name] of [
      [tenantA, venueA, 'Club A'],
      [tenantB, venueB, 'Club B'],
    ] as const) {
      await withTenantWrite(app, tenantId, async (tx) => {
        await tx.insert(tenants).values({ id: tenantId, name })
        await tx.insert(venues).values({ id: venueId, tenantId, name, slug: 'main' })
      })
    }
    await withTenantWrite(app, tenantA, (tx) =>
      tx.insert(templates).values({
        id: templateA,
        tenantId: tenantA,
        key: 'venue-menu',
        version: 1,
        definition: { owner: 'A' },
      }),
    )
    // System templates (tenant_id NULL) are added by the owner only.
    await owner.query(
      `insert into restro.templates (id, tenant_id, key, version, definition)
       values ($1, null, $2, 1, '{}'::jsonb)`,
      [systemTemplate, `system-${systemTemplate}`],
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, {
        tenants: [tenantA, tenantB],
        templates: [systemTemplate],
        workers: [worker],
      })
      await owner.end()
    }
  })

  it('1. withTenant(A) sees only A, withTenant(B) only B, even without a where clause', async () => {
    const seenByA = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    const seenByB = await withTenant(app, tenantB, (tx) => tx.select().from(venues))
    expect(seenByA.map((venue) => venue.id)).toEqual([venueA])
    expect(seenByB.map((venue) => venue.id)).toEqual([venueB])

    // A query that names the other tenant's row explicitly still finds nothing.
    const crossRead = await withTenant(app, tenantA, (tx) =>
      tx.select().from(venues).where(eq(venues.tenantId, tenantB)),
    )
    expect(crossRead).toEqual([])
    const tenantRows = await withTenant(app, tenantA, (tx) => tx.select().from(tenants))
    expect(tenantRows.map((tenant) => tenant.id)).toEqual([tenantA])
  })

  it('1. venue defaults follow the brief (D45 service day, EUR, bg_BG + en_US)', async () => {
    const [venue] = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    expect(venue).toMatchObject({
      timezone: 'Europe/Sofia',
      serviceDayEndsAt: '07:00:00',
      currency: 'EUR',
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG', 'en_US'],
    })
  })

  it('2. inserting a venue for tenant B inside withTenantWrite(A) fails (WITH CHECK)', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, tenantA, (tx) =>
          tx
            .insert(venues)
            .values({ id: testId('vn'), tenantId: tenantB, name: 'Intruder', slug: 'x' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION)
  })

  it('2. moving a venue to another tenant, or writing to another tenant, fails or does nothing', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, tenantA, (tx) =>
          tx.update(venues).set({ tenantId: tenantB }).where(eq(venues.id, venueA)),
        ),
      ),
    ).toMatch(RLS_VIOLATION)

    const touched = await withTenantWrite(app, tenantA, (tx) =>
      tx.update(venues).set({ name: 'Renamed by A' }).where(eq(venues.id, venueB)).returning(),
    )
    expect(touched).toEqual([])
    expect(
      await databaseError(
        withTenantWrite(app, tenantA, (tx) =>
          tx.insert(tenants).values({ id: testId('tn'), name: 'Not A' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION)
    const [venueOfB] = await withTenant(app, tenantB, (tx) => tx.select().from(venues))
    expect(venueOfB?.name).toBe('Club B')
  })

  it('3. with no tenant set, select * from restro.venues returns 0 rows', async () => {
    // A bare connection as restro_app, outside the client: nothing has set app.tenant_id.
    const bare = new pg.Client({ connectionString: appDatabaseUrl() })
    await bare.connect()
    try {
      expect((await bare.query('select * from restro.venues')).rowCount).toBe(0)
      expect((await bare.query('select * from restro.tenants')).rowCount).toBe(0)
      // Once a transaction that set a tenant has ended, the setting is '' and still sees nothing.
      await bare.query('begin')
      await bare.query("select set_config('app.tenant_id', $1, true)", [tenantA])
      expect((await bare.query('select * from restro.venues')).rowCount).toBe(1)
      await bare.query('commit')
      expect((await bare.query('select * from restro.venues')).rowCount).toBe(0)
      await expect(
        bare.query(
          `insert into restro.venues (id, tenant_id, name, slug) values ($1, $2, 'No tenant', 'n')`,
          [testId('vn'), tenantA],
        ),
      ).rejects.toThrow(RLS_VIOLATION)
    } finally {
      await bare.end()
    }
  })

  it('3. withSystem sees no tenant rows and cannot write them', async () => {
    expect(await withSystem(app, (tx) => tx.select().from(venues))).toEqual([])
    expect(await withSystem(app, (tx) => tx.select().from(tenants))).toEqual([])
    expect(
      await databaseError(
        withSystem(app, (tx) =>
          tx.insert(venues).values({ id: testId('vn'), tenantId: tenantA, name: 'X', slug: 'y' }),
        ),
      ),
    ).toMatch(RLS_VIOLATION)
  })

  it('withSystem upserts worker heartbeats (system table)', async () => {
    const beat = (version: string) =>
      withSystem(app, (tx) =>
        tx
          .insert(workerHeartbeats)
          .values({ workerId: worker, version })
          .onConflictDoUpdate({
            target: workerHeartbeats.workerId,
            set: { version, lastBeatAt: sql`now()` },
          }),
      )
    await beat('1.0.0')
    await beat('1.0.1')
    const rows = await withSystem(app, (tx) =>
      tx.select().from(workerHeartbeats).where(eq(workerHeartbeats.workerId, worker)),
    )
    expect(rows.map((row) => row.version)).toEqual(['1.0.1'])
  })

  it('5. a system template is visible to both tenants; A’s own template is invisible to B', async () => {
    const keysFor = async (tenantId: string) =>
      (await withTenant(app, tenantId, (tx) => tx.select().from(templates)))
        .map((template) => template.id)
        .filter((id) => id === templateA || id === systemTemplate)
        .sort()
    expect(await keysFor(tenantA)).toEqual([templateA, systemTemplate].sort())
    expect(await keysFor(tenantB)).toEqual([systemTemplate])
  })

  it('5. tenants cannot add system templates or templates for another tenant', async () => {
    expect(
      await databaseError(
        withTenantWrite(app, tenantB, (tx) =>
          tx.insert(templates).values({
            id: testId('tp'),
            tenantId: null,
            key: 'sneaky-system',
            version: 1,
            definition: {},
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION)
    expect(
      await databaseError(
        withTenantWrite(app, tenantB, (tx) =>
          tx.insert(templates).values({
            id: testId('tp'),
            tenantId: tenantA,
            key: 'planted',
            version: 1,
            definition: {},
          }),
        ),
      ),
    ).toMatch(RLS_VIOLATION)
  })

  it('withTenant is read-only: Postgres rejects any write in it', async () => {
    expect(
      await databaseError(
        withTenant(app, tenantA, (tx) =>
          tx.execute(sql`update restro.venues set name = 'via read side' where id = ${venueA}`),
        ),
      ),
    ).toMatch(/read-only transaction/)
    expect(
      await databaseError(
        withTenant(app, tenantA, (tx) => tx.execute(sql`set transaction read write`)),
      ),
    ).toMatch(/read-write mode must be set before any query/)
  })

  it('the tenant setting never leaks from one pooled transaction to the next', async () => {
    const single = createPool(appDatabaseUrl(), { max: 1 })
    try {
      expect(await withTenant(single, tenantA, (tx) => tx.select().from(venues))).toHaveLength(1)
      expect(await withSystem(single, (tx) => tx.select().from(venues))).toEqual([])
      // Even a session-level SET by raw SQL is overridden by the next scope's local setting.
      await withSystem(single, (tx) =>
        tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, false)`),
      )
      expect(await withSystem(single, (tx) => tx.select().from(venues))).toEqual([])
      const seenByB = await withTenant(single, tenantB, (tx) => tx.select().from(venues))
      expect(seenByB.map((venue) => venue.id)).toEqual([venueB])
    } finally {
      await single.end()
    }
  })

  it('rejects malformed tenant ids before touching the database', async () => {
    for (const bad of ['', 'vn_123', 'tn_', "tn_x' or '1'='1", ' tn_abc']) {
      await expect(withTenant(app, bad, async () => 'ran')).rejects.toBeInstanceOf(
        InvalidTenantIdError,
      )
      await expect(withTenantWrite(app, bad, async () => 'ran')).rejects.toBeInstanceOf(
        InvalidTenantIdError,
      )
    }
  })

  it('refuses to run on a pool whose role can bypass row-level security (the owner)', async () => {
    const ownerAsApp = createPool(ownerDatabaseUrl(), { max: 1 })
    try {
      await expect(withTenant(ownerAsApp, tenantA, async () => 'ran')).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      )
      await expect(withSystem(ownerAsApp, async () => 'ran')).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      )
      await expect(withTenantWrite(ownerAsApp, tenantA, async () => 'ran')).rejects.toBeInstanceOf(
        UnsafeDatabaseRoleError,
      )
    } finally {
      await ownerAsApp.end()
    }
  })

  it('keeps venues.updated_at current on every update (trigger, as restro_app)', async () => {
    const [before] = await withTenant(app, tenantA, (tx) => tx.select().from(venues))
    const [after] = await withTenantWrite(app, tenantA, (tx) =>
      tx.update(venues).set({ name: 'Club A, renamed' }).where(eq(venues.id, venueA)).returning(),
    )
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity)
  })

  it('rolls back everything when the callback throws', async () => {
    const venueId = testId('vn')
    await expect(
      withTenantWrite(app, tenantA, async (tx) => {
        await tx
          .insert(venues)
          .values({ id: venueId, tenantId: tenantA, name: 'Ghost', slug: 'ghost' })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const found = await withTenant(app, tenantA, (tx) =>
      tx.select().from(venues).where(eq(venues.id, venueId)),
    )
    expect(found).toEqual([])
  })
})
