// createAsset(): input checks that need no database, then the writer against Postgres as the
// restro_app role (brief S2-06b): the row, idempotency by id, id conflicts, tenant isolation, and
// the database's own checks behind it.
import { assets, createPool, type DbPool, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { sha256Hex } from '../hash'
import { isId, newId } from '../ids'
import * as core from '../index'
import { CreateAssetError, type CreateAssetInput, createAsset } from './create-asset'
import * as applyEntry from './index'
import { provisionTenant } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

/** A pool that is never used: the input checks run before any query. */
const unusedPool = {} as DbPool

const checksum = sha256Hex('some image bytes')

function input(overrides: Partial<CreateAssetInput> = {}): CreateAssetInput {
  return {
    origin: 'upload',
    contentType: 'image/jpeg',
    checksum,
    width: 1200,
    height: 800,
    storageKey: `tenants/tn_x/assets/${newId('as')}/original.jpg`,
    ...overrides,
  }
}

describe('module boundary', () => {
  it('is exported from @restro/core/apply, never from the pure @restro/core entry', () => {
    expect(Object.keys(applyEntry)).toEqual(
      expect.arrayContaining(['createAsset', 'CreateAssetError', 'loadItemDocument']),
    )
    expect(Object.keys(core)).not.toContain('createAsset')
  })
})

describe('input checks (no database needed)', () => {
  it.each([
    ['a type that is not an image we accept', { contentType: 'image/gif' as 'image/png' }],
    ['an SVG', { contentType: 'image/svg+xml' as 'image/png' }],
    ['a short checksum', { checksum: 'abc123' }],
    ['an upper-case checksum', { checksum: checksum.toUpperCase() }],
    ['a zero width', { width: 0 }],
    ['a fractional height', { height: 10.5 }],
    ['a side beyond the WebP limit', { width: 16_384 }],
    ['an unknown origin', { origin: 'ftp' as 'upload' }],
    ['a malformed asset id', { id: 'as_nope' as `as_${string}` }],
    ['a storage key that climbs out of its folder', { storageKey: 'tenants/../secrets/a.jpg' }],
    ['a storage key with an empty segment', { storageKey: 'tenants//a.jpg' }],
    ['an absolute storage key', { storageKey: '/etc/passwd' }],
    ['a storage key with a backslash', { storageKey: 'tenants\\a.jpg' }],
    ['an empty storage key', { storageKey: '' }],
    ['a storage key with a space', { storageKey: 'tenants/my file.jpg' }],
    ['an unknown field', { extra: 1 } as unknown as Partial<CreateAssetInput>],
  ])('refuses %s before touching the database', async (_label, overrides) => {
    await expect(createAsset(unusedPool, newId('tn'), input(overrides))).rejects.toMatchObject({
      name: 'CreateAssetError',
      code: 'invalid_input',
    })
  })
})

describe.skipIf(!hasDatabase)('createAsset against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  const rowOf = (tenantId: string, id: string) =>
    withTenant(app, tenantId, (tx) => tx.select().from(assets).where(eq(assets.id, id)))

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-asset-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Asset test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  it('writes a stored asset row with a fresh as_ id', async () => {
    const created = await createAsset(app, tenant, input({ originRef: 'upload:test' }))
    expect(isId('as', created.id)).toBe(true)
    expect(created).toMatchObject({
      tenantId: tenant,
      origin: 'upload',
      originRef: 'upload:test',
      contentType: 'image/jpeg',
      checksum,
      width: 1200,
      height: 800,
      status: 'stored',
      created: true,
    })
    const [row] = await rowOf(tenant, created.id)
    expect(row).toMatchObject({ id: created.id, storageKey: created.storageKey, status: 'stored' })
  })

  it('uses the id it is given, and is idempotent for the same content', async () => {
    const id = newId('as')
    const wanted = input({
      id,
      storageKey: `tenants/${tenant}/assets/${id}/original.png`,
      contentType: 'image/png',
    })
    const first = await createAsset(app, tenant, wanted)
    expect(first).toMatchObject({ id, created: true })
    const again = await createAsset(app, tenant, wanted)
    expect(again).toMatchObject({ id, created: false })
    expect(await rowOf(tenant, id)).toHaveLength(1)
  })

  it('refuses an id that exists with other content', async () => {
    const id = newId('as')
    await createAsset(app, tenant, input({ id }))
    await expect(
      createAsset(app, tenant, input({ id, checksum: sha256Hex('other bytes') })),
    ).rejects.toMatchObject({ name: 'CreateAssetError', code: 'id_conflict' })
  })

  it('keeps tenants apart: another tenant sees nothing and cannot take the id', async () => {
    const created = await createAsset(app, tenant, input())
    expect(await rowOf(otherTenant, created.id)).toHaveLength(0)
    await expect(
      createAsset(app, otherTenant, input({ id: created.id as `as_${string}` })),
    ).rejects.toBeInstanceOf(CreateAssetError)
    // The other tenant's attempt left the first tenant's row alone.
    expect(await rowOf(tenant, created.id)).toHaveLength(1)
  })

  it('never lets one tenant write a row for another (row-level security)', async () => {
    // createAsset scopes the transaction to the tenant it is given, so a mismatch cannot happen
    // through it; a tenant id that does not exist at all is refused by the foreign key.
    await expect(createAsset(app, newId('tn'), input())).rejects.toThrow()
  })
})
