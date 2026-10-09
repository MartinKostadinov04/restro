// Integration tests of the source plumbing the dev seed (and, later, the sync) uses: an
// integration per host, and tier-1 records that are appended only when their content changes.
import { createPool, type DbPool, integrations, sourceRecords, withTenant } from '@restro/db'
import { asc, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { newId } from '../ids'
import { apply } from './apply'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { provisionIntegration, recordSource } from './sources'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool } from './test-database'

describe.skipIf(!hasDatabase)('integrations and source records (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-sources-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Sources test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant, otherTenant])
      await owner.end()
    }
  })

  it('provisionIntegration creates one integration per host and returns it again', async () => {
    const first = await provisionIntegration(app, tenant, { kind: 'barsy', host: 'seed.test' })
    expect(first).toMatchObject({ kind: 'barsy', host: 'seed.test', created: true })
    expect(first.id).toMatch(/^in_[0-9A-Za-z]{22}$/)
    expect(await provisionIntegration(app, tenant, { kind: 'barsy', host: 'seed.test' })).toEqual({
      ...first,
      created: false,
    })
    const second = await provisionIntegration(app, tenant, { kind: 'barsy', host: 'other.test' })
    expect(second.id).not.toBe(first.id)
    const row = (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, first.id)),
      )
    )[0]
    expect(row).toMatchObject({ status: 'new', credentialsSealed: null })
  })

  it('provisionIntegration keeps tenants apart and refuses a host that is not a bare name', async () => {
    const mine = await provisionIntegration(app, tenant, { kind: 'barsy', host: 'shared.test' })
    const theirs = await provisionIntegration(app, otherTenant, {
      kind: 'barsy',
      host: 'shared.test',
    })
    expect(theirs.created).toBe(true)
    expect(theirs.id).not.toBe(mine.id)
    for (const host of ['', '  ', 'https://x.test/y', 'user@x.test', 'a b']) {
      await expect(
        provisionIntegration(app, tenant, { kind: 'barsy', host }),
      ).rejects.toMatchObject({
        code: 'invalid_input',
      })
    }
  })

  it('recordSource appends a record only when the content changes', async () => {
    const integration = await provisionIntegration(app, tenant, { kind: 'barsy', host: 'rec.test' })
    const input = {
      integrationId: integration.id,
      externalType: 'article',
      externalId: '4711',
      scope: 'master' as const,
      raw: '{"article_id":4711,"actual_price":2.40}',
      payload: { article_id: 4711, actual_price: 2.4 },
    }
    const first = await recordSource(app, tenant, input)
    expect(first.created).toBe(true)
    expect(first.id).toMatch(/^sr_[0-9A-Za-z]{22}$/)
    expect(await recordSource(app, tenant, input)).toEqual({ id: first.id, created: false })

    const changed = await recordSource(app, tenant, {
      ...input,
      raw: '{"article_id":4711,"actual_price":2.50}',
      payload: { article_id: 4711, actual_price: 2.5 },
    })
    expect(changed.created).toBe(true)
    expect(changed.id).not.toBe(first.id)

    const rows = await withTenant(app, tenant, (tx) =>
      tx
        .select({ id: sourceRecords.id, raw: sourceRecords.raw })
        .from(sourceRecords)
        .where(eq(sourceRecords.integrationId, integration.id))
        .orderBy(asc(sourceRecords.fetchedAt)),
    )
    expect(rows.map((row) => row.id)).toEqual([first.id, changed.id])
    // The raw text is kept exactly (barsy prices are floats on the wire).
    expect(rows[0]?.raw).toBe('{"article_id":4711,"actual_price":2.40}')
  })

  it('a barsy change set can cite the record it recorded', async () => {
    const venue = await provisionVenue(app, tenant, { name: 'Seeded', slug: 'seeded' })
    const menu = await provisionMenu(app, tenant, venue.id)
    const integration = await provisionIntegration(app, tenant, {
      kind: 'barsy',
      host: 'cite.test',
    })
    const record = await recordSource(app, tenant, {
      integrationId: integration.id,
      externalType: 'category',
      externalId: '12',
      scope: 'master',
      raw: '{"cat_id":12}',
      payload: { cat_id: 12 },
    })
    const section = newId('nd')
    const link = { integration: integration.id, externalType: 'category', externalId: '12' }
    const changeSet: ChangeSet = {
      id: newId('cs'),
      source: `barsy:${integration.id}`,
      jobId: newId('jb'),
      actor: `integration:${integration.id}`,
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
        { op: 'linkSource', node: { id: section }, link },
        {
          op: 'setField',
          node: { link },
          fieldKey: 'title',
          layer: 'barsy',
          scope: 'master',
          value: { bg_BG: 'Коктейли' },
          sourceRecordId: record.id,
          mappingVersion: 1,
        },
      ],
    }
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
    // And again: nothing new.
    expect(await apply(app, tenant, changeSet)).toMatchObject({ applied: 0, unchanged: 3 })
  })

  it('refuses a malformed tenant id and a malformed scope', async () => {
    await expect(
      provisionIntegration(app, 'tn_nope', { kind: 'barsy', host: 'x.test' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      recordSource(app, tenant, {
        integrationId: newId('in'),
        externalType: 'article',
        externalId: '1',
        scope: 'venue:nope' as never,
        raw: '{}',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
