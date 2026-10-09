// Integration tests of the source plumbing the dev seed and the sync use: an integration per
// host (create, update), and tier-1 records that are appended only when their content is new.
import { createPool, type DbPool, integrations, sourceRecords, withTenant } from '@restro/db'
import { asc, eq } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { newId } from '../ids'
import { apply } from './apply'
import { provisionMenu, provisionTenant, provisionVenue } from './provision'
import { appendSourceRecords, createIntegration, updateIntegration } from './sources'
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

  const row = async (id: string) =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select().from(integrations).where(eq(integrations.id, id)),
      )
    )[0]

  it('createIntegration creates one integration per host and returns it again', async () => {
    const first = await createIntegration(app, tenant, { kind: 'barsy', host: 'seed.test' })
    expect(first).toMatchObject({ kind: 'barsy', host: 'seed.test', created: true })
    expect(first.id).toMatch(/^in_[0-9A-Za-z]{22}$/)
    expect(await createIntegration(app, tenant, { kind: 'barsy', host: 'seed.test' })).toEqual({
      ...first,
      created: false,
    })
    const second = await createIntegration(app, tenant, { kind: 'barsy', host: 'other.test' })
    expect(second.id).not.toBe(first.id)
    expect(await row(first.id)).toMatchObject({ status: 'new', credentialsSealed: null })
  })

  it('createIntegration takes a pre-made id and sealed credentials', async () => {
    const id = newId('in')
    const created = await createIntegration(app, tenant, {
      kind: 'barsy',
      host: 'sealed.test',
      id,
      credentialsSealed: 'rs1.AAAA',
    })
    expect(created).toMatchObject({ id, created: true })
    expect(await row(id)).toMatchObject({ credentialsSealed: 'rs1.AAAA' })
    await expect(
      createIntegration(app, tenant, { kind: 'barsy', host: 'bad.test', id: 'in_nope' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      createIntegration(app, tenant, {
        kind: 'barsy',
        host: 'bad.test',
        credentialsSealed: 'has a space',
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('createIntegration keeps tenants apart and refuses a host that is not a bare name', async () => {
    const mine = await createIntegration(app, tenant, { kind: 'barsy', host: 'shared.test' })
    const theirs = await createIntegration(app, otherTenant, {
      kind: 'barsy',
      host: 'shared.test',
    })
    expect(theirs.created).toBe(true)
    expect(theirs.id).not.toBe(mine.id)
    for (const host of ['', '  ', 'https://x.test/y', 'user@x.test', 'a b']) {
      await expect(createIntegration(app, tenant, { kind: 'barsy', host })).rejects.toMatchObject({
        code: 'invalid_input',
      })
    }
  })

  it('updateIntegration changes only the fields it names', async () => {
    const { id } = await createIntegration(app, tenant, { kind: 'barsy', host: 'update.test' })
    const checked = new Date('2026-10-09T10:00:00Z')
    const updated = await updateIntegration(app, tenant, id, {
      status: 'error',
      statusDetail: 'Wrong user or password',
      lastCheckedAt: checked,
      credentialsSealed: 'rs1.BBBB',
    })
    expect(updated).toMatchObject({
      id,
      host: 'update.test',
      status: 'error',
      statusDetail: 'Wrong user or password',
      credentialsSealed: 'rs1.BBBB',
    })
    expect(updated?.lastCheckedAt?.toISOString()).toBe(checked.toISOString())

    // Only the status: everything else stays.
    const connected = await updateIntegration(app, tenant, id, {
      status: 'connected',
      statusDetail: null,
    })
    expect(connected).toMatchObject({
      status: 'connected',
      statusDetail: null,
      credentialsSealed: 'rs1.BBBB',
    })
    // Credentials can be forgotten.
    expect(await updateIntegration(app, tenant, id, { credentialsSealed: null })).toMatchObject({
      credentialsSealed: null,
    })
  })

  it('updateIntegration merges config at the top level; null removes a key', async () => {
    const { id } = await createIntegration(app, tenant, { kind: 'barsy', host: 'config.test' })
    await updateIntegration(app, tenant, id, { config: { price_source: 'actual_price', a: 1 } })
    await updateIntegration(app, tenant, id, { config: { a: null, b: { c: 2 } } })
    expect((await row(id))?.config).toEqual({ price_source: 'actual_price', b: { c: 2 } })
  })

  it('updateIntegration cuts a long detail, finds nothing for a foreign id and refuses an empty patch', async () => {
    const { id } = await createIntegration(app, tenant, { kind: 'barsy', host: 'edge.test' })
    const updated = await updateIntegration(app, tenant, id, { statusDetail: 'x'.repeat(900) })
    expect(updated?.statusDetail).toHaveLength(500)
    expect(await updateIntegration(app, tenant, newId('in'), { status: 'connected' })).toBeNull()
    // Another tenant's integration is invisible: nothing is updated.
    const theirs = await createIntegration(app, otherTenant, { kind: 'barsy', host: 'theirs.test' })
    expect(await updateIntegration(app, tenant, theirs.id, { status: 'error' })).toBeNull()
    await expect(updateIntegration(app, tenant, id, {})).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      updateIntegration(app, tenant, id, { status: 'bogus' as never }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('appendSourceRecords appends a record only when its content is new', async () => {
    const integration = await createIntegration(app, tenant, { kind: 'barsy', host: 'rec.test' })
    const input = {
      externalType: 'article',
      externalId: '4711',
      scope: 'master' as const,
      raw: '{"article_id":4711,"actual_price":2.40}',
      payload: { article_id: 4711, actual_price: 2.4 },
    }
    const [first] = await appendSourceRecords(app, tenant, integration.id, [input])
    expect(first?.created).toBe(true)
    expect(first?.id).toMatch(/^sr_[0-9A-Za-z]{22}$/)
    expect(await appendSourceRecords(app, tenant, integration.id, [input])).toEqual([
      { id: first?.id, created: false },
    ])

    const [changed] = await appendSourceRecords(app, tenant, integration.id, [
      {
        ...input,
        raw: '{"article_id":4711,"actual_price":2.50}',
        payload: { article_id: 4711, actual_price: 2.5 },
      },
    ])
    expect(changed?.created).toBe(true)
    expect(changed?.id).not.toBe(first?.id)

    const rows = await withTenant(app, tenant, (tx) =>
      tx
        .select({ id: sourceRecords.id, raw: sourceRecords.raw })
        .from(sourceRecords)
        .where(eq(sourceRecords.integrationId, integration.id))
        .orderBy(asc(sourceRecords.fetchedAt)),
    )
    expect(rows.map((r) => r.id)).toEqual([first?.id, changed?.id])
    // The raw text is kept exactly (barsy prices are floats on the wire).
    expect(rows[0]?.raw).toBe('{"article_id":4711,"actual_price":2.40}')
  })

  it('an object that goes A, B, A reuses record A (recency is not read from this table)', async () => {
    const integration = await createIntegration(app, tenant, { kind: 'barsy', host: 'aba.test' })
    const version = (price: string) => ({
      externalType: 'article',
      externalId: '1',
      scope: 'master' as const,
      raw: `{"p":${price}}`,
      payload: { p: Number(price) },
    })
    const [a] = await appendSourceRecords(app, tenant, integration.id, [version('1.10')])
    const [b] = await appendSourceRecords(app, tenant, integration.id, [version('1.20')])
    const [again] = await appendSourceRecords(app, tenant, integration.id, [version('1.10')])
    expect(b?.created).toBe(true)
    expect(again).toEqual({ id: a?.id, created: false })
    const stored = await withTenant(app, tenant, (tx) =>
      tx.select().from(sourceRecords).where(eq(sourceRecords.integrationId, integration.id)),
    )
    expect(stored).toHaveLength(2)
  })

  it('appendSourceRecords takes content-derived ids, answers in order and survives duplicates', async () => {
    const integration = await createIntegration(app, tenant, { kind: 'barsy', host: 'batch.test' })
    const id = newId('sr')
    const same = {
      id,
      externalType: 'category',
      externalId: '9',
      scope: 'master' as const,
      raw: '{"cat_id":9}',
      payload: { cat_id: 9 },
    }
    const other = {
      externalType: 'category',
      externalId: '10',
      scope: 'master' as const,
      raw: '{"cat_id":10}',
      payload: { cat_id: 10 },
    }
    const results = await appendSourceRecords(app, tenant, integration.id, [same, other, same])
    expect(results[0]).toEqual({ id, created: true })
    expect(results[1]?.created).toBe(true)
    expect(results[2]).toEqual({ id, created: false })
    // A repeated batch stores nothing.
    expect(
      (await appendSourceRecords(app, tenant, integration.id, [same, other])).map((r) => r.created),
    ).toEqual([false, false])
    expect(await appendSourceRecords(app, tenant, integration.id, [])).toEqual([])
    // A scope is part of the identity: the same content in another scope is another record.
    const venueScoped = await appendSourceRecords(app, tenant, integration.id, [
      { ...other, scope: `venue:vn_${'a'.repeat(22)}` },
    ])
    expect(venueScoped[0]?.created).toBe(true)
  })

  it('a record with a content-derived id is stored under that id even if the content exists under another', async () => {
    const integration = await createIntegration(app, tenant, { kind: 'barsy', host: 'ids.test' })
    const content = {
      externalType: 'article',
      externalId: '77',
      scope: 'master' as const,
      raw: '{"article_id":77}',
      payload: { article_id: 77 },
    }
    // A writer without ids (the dev seed) stored it first, under a random id.
    const [random] = await appendSourceRecords(app, tenant, integration.id, [content])
    // The sync names the record by an id derived from the content: change sets cite that id, so
    // it must exist; the random-id row with the same content does not stand in for it.
    const derived = newId('sr')
    const [named] = await appendSourceRecords(app, tenant, integration.id, [
      { ...content, id: derived },
    ])
    expect(named).toEqual({ id: derived, created: true })
    expect(derived).not.toBe(random?.id)
    expect(
      await appendSourceRecords(app, tenant, integration.id, [{ ...content, id: derived }]),
    ).toEqual([{ id: derived, created: false }])
  })

  it('a barsy change set can cite the record it recorded', async () => {
    const venue = await provisionVenue(app, tenant, { name: 'Seeded', slug: 'seeded' })
    const menu = await provisionMenu(app, tenant, venue.id)
    const integration = await createIntegration(app, tenant, {
      kind: 'barsy',
      host: 'cite.test',
    })
    const [record] = await appendSourceRecords(app, tenant, integration.id, [
      {
        externalType: 'category',
        externalId: '12',
        scope: 'master',
        raw: '{"cat_id":12}',
        payload: { cat_id: 12 },
      },
    ])
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
          sourceRecordId: record?.id as string,
          mappingVersion: 1,
        },
      ],
    }
    expect((await apply(app, tenant, changeSet)).rejected).toEqual([])
    // And again: nothing new.
    expect(await apply(app, tenant, changeSet)).toMatchObject({ applied: 0, unchanged: 3 })
  })

  it('refuses a malformed tenant id, scope and record id', async () => {
    await expect(
      createIntegration(app, 'tn_nope', { kind: 'barsy', host: 'x.test' }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    const bad = {
      externalType: 'article',
      externalId: '1',
      raw: '{}',
      payload: {},
    }
    await expect(
      appendSourceRecords(app, tenant, newId('in'), [{ ...bad, scope: 'venue:nope' as never }]),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      appendSourceRecords(app, tenant, newId('in'), [{ ...bad, scope: 'master', id: 'sr_short' }]),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
