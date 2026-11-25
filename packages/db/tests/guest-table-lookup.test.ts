// Integration tests on a real Postgres for the guest lookup by table-code hash (migration 0029;
// ticket #70; D121, D122 §9): restro_app finds a table from its code's hash with no tenant set,
// gets its state, and nothing else; restro_purge cannot call it; the code columns hold together.
import { createHash } from 'node:crypto'

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPool, type DbPool, guestTableByCodeHash } from '../src/index'
import {
  appDatabaseUrl,
  cleanUp,
  databaseError,
  hasDatabase,
  openOwnerPool,
  purgeDatabaseUrl,
  testId,
  testPublicId,
} from './database'

function codeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex')
}

/** A fresh code in the guest files' token pattern. */
function newCode(): string {
  return testId('qr').replace('qr_test', 'Qr')
}

describe.skipIf(!hasDatabase)('guest lookup by table-code hash (migration 0029)', () => {
  const tenantId = testId('tn')
  const venueId = testId('vn')
  const offlineVenueId = testId('vn')
  const areaId = testId('ar')
  const hiddenAreaId = testId('ar')
  const offlineAreaId = testId('ar')
  const codes = {
    live: newCode(),
    hiddenTable: newCode(),
    hiddenArea: newCode(),
    archived: newCode(),
    offline: newCode(),
  }
  const tableIds = {
    live: testId('tb'),
    hiddenTable: testId('tb'),
    hiddenArea: testId('tb'),
    archived: testId('tb'),
    offline: testId('tb'),
  }

  let owner: pg.Pool
  let app: DbPool

  beforeAll(async () => {
    owner = await openOwnerPool()
    app = createPool(appDatabaseUrl(), { max: 2, applicationName: 'restro-db-tests' })
    await owner.query('insert into restro.tenants (id, name) values ($1, $2)', [tenantId, 'Club'])
    await owner.query(
      `insert into restro.venues (id, tenant_id, name, slug, public_id, unpublished_at)
       values ($1, $2, 'Club', 'main', $3, null), ($4, $2, 'Offline', 'offline', $5, now())`,
      [venueId, tenantId, testPublicId(), offlineVenueId, testPublicId()],
    )
    await owner.query(
      `insert into restro.areas (id, tenant_id, venue_id, name, sort_key, hidden)
       values ($1, $2, $3, 'Hall', 'a', false), ($4, $2, $3, 'Back', 'b', true),
              ($5, $2, $6, 'Hall', 'a', false)`,
      [areaId, tenantId, venueId, hiddenAreaId, offlineAreaId, offlineVenueId],
    )
    const rows: [string, string, string, boolean, boolean][] = [
      // [table, area, code, hidden, archived]
      [tableIds.live, areaId, codes.live, false, false],
      [tableIds.hiddenTable, areaId, codes.hiddenTable, true, false],
      [tableIds.hiddenArea, hiddenAreaId, codes.hiddenArea, false, false],
      [tableIds.archived, areaId, codes.archived, false, true],
    ]
    for (const [i, [id, area, code, hidden, archived]] of rows.entries()) {
      await owner.query(
        `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key, hidden,
                                    qr_token, qr_code_hash, archived_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $10 then now() end)`,
        [
          id,
          tenantId,
          venueId,
          area,
          String(i + 1),
          `a${i}`,
          hidden,
          code,
          codeHash(code),
          archived,
        ],
      )
    }
    await owner.query(
      `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key, qr_token,
                                  qr_code_hash)
       values ($1, $2, $3, $4, '1', 'a', $5, $6)`,
      [
        tableIds.offline,
        tenantId,
        offlineVenueId,
        offlineAreaId,
        codes.offline,
        codeHash(codes.offline),
      ],
    )
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, { tenants: [tenantId] })
    await app?.end()
    await owner?.end()
  })

  it('finds a live table from its hash, with no tenant set', async () => {
    expect(await guestTableByCodeHash(app, codeHash(codes.live))).toEqual({
      tenantId,
      venueId,
      tableId: tableIds.live,
      codeGeneration: 1,
      state: 'live',
    })
  })

  it('says hidden for a hidden table or a table in a hidden area', async () => {
    expect((await guestTableByCodeHash(app, codeHash(codes.hiddenTable)))?.state).toBe('hidden')
    expect((await guestTableByCodeHash(app, codeHash(codes.hiddenArea)))?.state).toBe('hidden')
  })

  it('says venue_not_live for a table of a venue taken offline', async () => {
    expect((await guestTableByCodeHash(app, codeHash(codes.offline)))?.state).toBe('venue_not_live')
  })

  it('finds nothing for a deleted table, an unknown hash, a malformed hash or the plain code', async () => {
    expect(await guestTableByCodeHash(app, codeHash(codes.archived))).toBeNull()
    expect(await guestTableByCodeHash(app, codeHash(newCode()))).toBeNull()
    expect(await guestTableByCodeHash(app, 'not-a-hash')).toBeNull()
    expect(await guestTableByCodeHash(app, codes.live)).toBeNull()
  })

  it('reads one row per hash and nothing else of the table, even for restro_app called raw', async () => {
    const raw = new pg.Pool({ connectionString: appDatabaseUrl(), max: 1 })
    try {
      const { rows, fields } = await raw.query(
        'select * from restro.guest_table_by_code_hash($1)',
        [codeHash(codes.live)],
      )
      expect(rows).toHaveLength(1)
      expect(fields.map((field) => field.name)).toEqual([
        'tenant_id',
        'venue_id',
        'table_id',
        'code_generation',
        'state',
      ])
      // Outside the function the same role still sees no table without a tenant.
      const direct = await raw.query('select count(*)::int as n from restro.tables')
      expect(direct.rows[0]?.n).toBe(0)
    } finally {
      await raw.end()
    }
  })

  it('restro_purge cannot call it', async () => {
    const purge = new pg.Pool({ connectionString: purgeDatabaseUrl(), max: 1 })
    try {
      expect(
        await databaseError(
          purge.query('select * from restro.guest_table_by_code_hash($1)', [codeHash(codes.live)]),
        ),
      ).toMatch(/permission denied/)
    } finally {
      await purge.end()
    }
  })

  it('keeps the code columns together: no plain code without its hash, no hash on its own', async () => {
    const insert = (token: string | null, hash: string | null, payment = false) =>
      owner.query(
        `insert into restro.tables (id, tenant_id, venue_id, area_id, number, sort_key, qr_token,
                                    qr_code_hash, is_payment_table)
         values ($1, $2, $3, $4, '9', 'z', $5, $6, $7)`,
        [testId('tb'), tenantId, venueId, areaId, token, hash, payment],
      )
    const code = newCode()
    expect(await databaseError(insert(code, null))).toMatch(/tables_qr_code_complete/)
    expect(await databaseError(insert(null, codeHash(code)))).toMatch(/tables_qr_code_complete/)
    expect(await databaseError(insert(code, codeHash(code).toUpperCase()))).toMatch(
      /tables_qr_code_hash_format/,
    )
    expect(await databaseError(insert(code, codeHash(code), true))).toMatch(
      /tables_payment_table_no_code/,
    )
  })

  it('the backfill hash (Postgres sha256 of the UTF-8 code) matches Node’s', async () => {
    const code = codes.live
    const { rows } = await owner.query<{ hash: string }>(
      "select encode(sha256(convert_to($1, 'UTF8')), 'hex') as hash",
      [code],
    )
    expect(rows[0]?.hash).toBe(codeHash(code))
  })
})
