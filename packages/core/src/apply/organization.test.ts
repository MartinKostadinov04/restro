// The organisation's address memory (D84), as the restro_app role on a real Postgres: the current
// slug and the earlier ones, recording a rename, refusing another organisation's names, and what
// is free. Skipped without a database.
import { createPool, type DbPool } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { organizationAddress, organizationSlugIsFree, recordOrganizationSlug } from './organization'
import { provisionTenant } from './provision'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('the organisation’s address names (as the restro_app role)', () => {
  const tenant = newId('tn')
  const other = newId('tn')
  const slug = testSlug('night-group')
  const otherSlug = testSlug('day-group')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-organization-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Night group' })
    await provisionTenant(app, { tenantId: other, name: 'Day group' })
    // The organisation rows are Better Auth's (a system table); the test makes them as sign-up would.
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.auth_organization (id, name, slug)
        values (${tenant}, 'Night group', ${slug}), (${other}, 'Day group', ${otherSlug})`),
    )
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await owner.query(
        'delete from restro.organization_slug_history where organization_id = any($1)',
        [[tenant, other]],
      )
      await owner.query('delete from restro.auth_organization where id = any($1)', [
        [tenant, other],
      ])
      await cleanUp(owner, [tenant, other])
      await owner.end()
    }
  })

  it('knows the current slug and, at first, no earlier one', async () => {
    expect(await organizationAddress(app, tenant)).toEqual({
      organizationId: tenant,
      name: 'Night group',
      slug,
      oldSlugs: [],
    })
    expect(await organizationAddress(app, newId('tn'))).toBeNull()
    expect(await organizationAddress(app, 'nope')).toBeNull()
  })

  it('records an earlier slug once; the current slug and a repeat record nothing', async () => {
    const old = testSlug('night-club')
    expect(
      await recordOrganizationSlug(app, { organizationId: tenant, previousSlug: old }),
    ).toEqual({ ok: true, recorded: true })
    expect(
      await recordOrganizationSlug(app, { organizationId: tenant, previousSlug: old }),
    ).toEqual({ ok: true, recorded: false })
    expect(
      await recordOrganizationSlug(app, { organizationId: tenant, previousSlug: slug }),
    ).toEqual({ ok: true, recorded: false })
    expect((await organizationAddress(app, tenant))?.oldSlugs).toEqual([old])

    // Another organisation's earlier name is not ours to redirect, and not free either.
    expect(
      await recordOrganizationSlug(app, { organizationId: other, previousSlug: old }),
    ).toMatchObject({ ok: false, error: 'slug_taken' })
    expect(await organizationSlugIsFree(app, other, old)).toBe(false)
    expect(await organizationSlugIsFree(app, tenant, old)).toBe(true)
    // A current slug of another organisation is taken; a brand-new one is free.
    expect(await organizationSlugIsFree(app, tenant, otherSlug)).toBe(false)
    expect(await organizationSlugIsFree(app, tenant, testSlug('fresh'))).toBe(true)
    expect(await organizationSlugIsFree(app, tenant, 'Not A Slug')).toBe(false)
  })

  it('refuses malformed ids and slugs', async () => {
    expect(
      await recordOrganizationSlug(app, { organizationId: 'nope', previousSlug: 'fine' }),
    ).toMatchObject({ ok: false, error: 'invalid_input' })
    expect(
      await recordOrganizationSlug(app, { organizationId: tenant, previousSlug: 'Not Fine' }),
    ).toMatchObject({ ok: false, error: 'invalid_input' })
  })
})
