// loadDraft against Postgres as the restro_app role (brief S3-05): the draft is what a publish
// would write, built in memory and never stored; it refuses the way a publish refuses; it lists
// stale overrides (V12) and the sold-out marks of the day.
import { createPool, type DbPool, snapshots, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq, sql } from 'drizzle-orm'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { sha256Hex } from '../hash'
import { newId } from '../ids'
import { diffSnapshots } from '../snapshot/diff'
import { apply } from './apply'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadCurrentSnapshot, loadDraft, publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('the draft of a menu (as the restro_app role)', () => {
  const tenant = newId('tn')
  const otherTenant = newId('tn')
  const integration = newId('in')
  const EXTERNAL_ID = 'ext90417'
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  let record: string

  const section = newId('nd')
  const cocktail = newId('nd')
  const barsyItem = newId('nd')
  const at = (minutes: number) => new Date(Date.parse('2026-10-09T18:00:00Z') + minutes * 60_000)

  const changeSet = (source: string, ops: unknown[]): ChangeSet =>
    ({
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor: source === 'manual' ? 'user:us_test' : `integration:${integration}`,
      observedAt: new Date().toISOString(),
      ops,
    }) as ChangeSet
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const barsy = (fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link: { integration, externalType: 'article', externalId: EXTERNAL_ID } },
    fieldKey,
    layer: 'till',
    scope,
    value,
    sourceRecordId: record,
    mappingVersion: 1,
  })
  async function run(ops: unknown[], source = 'manual') {
    const result = await apply(app, tenant, changeSet(source, ops))
    expect(result.rejected).toEqual([])
  }
  const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
  const scope = () => ({ menuId: menu.id, venueId })
  const rowCount = async () =>
    (
      await withTenant(app, tenant, (tx) =>
        tx.select({ id: snapshots.id }).from(snapshots).where(eq(snapshots.menuId, menu.id)),
      )
    ).length
  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { ...scope(), reason: 'manual', actor: 'user:us_test' },
      { now: at(minutes) },
    )

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-draft-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Draft test club' })
    await provisionTenant(app, { tenantId: otherTenant, name: 'Another club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.integrations (id, tenant_id, kind, host)
        values (${integration}, ${tenant}, 'barsy', 'draft.example')`),
    )
    record = newId('sr')
    await withTenantWrite(app, tenant, (tx) =>
      tx.execute(sql`
        insert into restro.source_records
          (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
           payload)
        values (${record}, ${tenant}, ${integration}, 'article', ${EXTERNAL_ID}, 'master',
                ${sha256Hex(record)}, '{}', '{}'::jsonb)`),
    )
    await run([
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      { op: 'createNode', id: cocktail, nodeType: 'item', parent: null, status: 'active' },
      manual(cocktail, 'name', { bg_BG: 'Мохито', en_US: 'Mojito' }),
      manual(cocktail, 'price', eur(900)),
      manual(cocktail, 'allergens', []),
      { op: 'setPlacement', item: { id: cocktail }, section: { id: section }, sortKey: 'end' },
    ])
    await run(
      [
        { op: 'createNode', id: barsyItem, nodeType: 'item', parent: null, status: 'active' },
        {
          op: 'linkSource',
          node: { id: barsyItem },
          link: { integration, externalType: 'article', externalId: EXTERNAL_ID },
        },
        barsy('name', { bg_BG: 'Негрони', en_US: 'Negroni' }),
        barsy('price', eur(1250), `venue:${venueId}`),
        barsy('for_sale', true, `venue:${venueId}`),
        barsy('visible', true),
        barsy('allergens', []),
        barsy('portion', { value: 100, unit: 'ml' }),
      ],
      `till:${integration}`,
    )
    await run([
      { op: 'setPlacement', item: { id: barsyItem }, section: { id: section }, sortKey: 'end' },
    ])
  })

  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant, otherTenant])
    await owner?.end()
    await app?.end()
  })

  it('builds the first snapshot in memory and writes nothing', async () => {
    const draft = await loadDraft(app, tenant, scope(), { now: at(0) })
    expect(draft.snapshot.snapshot).toMatchObject({ version: 1, menu_id: menu.id })
    expect(Object.keys(draft.snapshot.items).sort()).toEqual([cocktail, barsyItem].sort())
    expect(draft.overlay).toEqual({ version: 1, items: {} })
    expect(draft.staleOverrides).toEqual([])
    expect(await rowCount()).toBe(0)
    expect(await loadCurrentSnapshot(app, tenant, scope())).toBeNull()
    // Every look at it is a fresh id that nothing keeps.
    const again = await loadDraft(app, tenant, scope(), { now: at(0) })
    expect(again.snapshot.snapshot.id).not.toBe(draft.snapshot.snapshot.id)
    expect(again.snapshot.snapshot.hash).toBe(draft.snapshot.snapshot.hash)
  })

  it('has the content a publish writes: the same hash, so there is nothing waiting afterwards', async () => {
    const draft = await loadDraft(app, tenant, scope(), { now: at(1) })
    const published = await publish(1)
    expect(published.status).toBe('published')
    expect(published.snapshot.hash).toBe(draft.snapshot.snapshot.hash)

    const current = await loadCurrentSnapshot(app, tenant, scope())
    const after = await loadDraft(app, tenant, scope(), { now: at(2) })
    expect(after.snapshot.snapshot.version).toBe(2)
    expect(diffSnapshots(current?.body ?? null, after.snapshot).total).toBe(0)
    expect(await rowCount()).toBe(1)
  })

  it('shows a change as waiting, without publishing it', async () => {
    await run([manual(cocktail, 'price', eur(1100))])
    const current = await loadCurrentSnapshot(app, tenant, scope())
    const draft = await loadDraft(app, tenant, scope(), { now: at(3) })
    const diff = diffSnapshots(current?.body ?? null, draft.snapshot)
    expect(diff.total).toBe(1)
    expect(diff.priceChanged).toMatchObject([{ id: cocktail, from: eur(900), to: eur(1100) }])
    expect(await rowCount()).toBe(1)
    expect((await loadCurrentSnapshot(app, tenant, scope()))?.id).toBe(current?.id)
  })

  it('lists a stale override (V12) with the item name', async () => {
    // The builder changed the portion; later barsy changed it too, so the override's basis is old.
    await run([
      {
        op: 'setField',
        node: { id: barsyItem },
        fieldKey: 'portion',
        layer: 'override',
        scope: 'master',
        value: { value: 90, unit: 'ml' },
        basis: { value: 100, unit: 'ml' },
      },
    ])
    await run([barsy('portion', { value: 120, unit: 'ml' })], `till:${integration}`)
    const draft = await loadDraft(app, tenant, scope(), { now: at(4) })
    expect(draft.staleOverrides).toEqual([
      {
        nodeId: barsyItem,
        fieldKey: 'portion',
        name: { bg_BG: 'Негрони', en_US: 'Negroni' },
        isItem: true,
      },
    ])
  })

  it('carries the sold-out marks of the day, as the live overlay would', async () => {
    await run([barsy('for_sale', false, `venue:${venueId}`)], `till:${integration}`)
    const draft = await loadDraft(app, tenant, scope(), { now: at(5) })
    expect(draft.overlay.items).toEqual({ [barsyItem]: { sold_out: true } })
    await run([barsy('for_sale', true, `venue:${venueId}`)], `till:${integration}`)
  })

  it('refuses the way a publish does: no visible item, an unknown menu, another tenant', async () => {
    const empty = await provisionVenue(app, tenant, { name: 'Empty', slug: testSlug('empty') })
    const emptyMenu = await provisionMenu(app, tenant, empty.id)
    await expect(
      loadDraft(app, tenant, { menuId: emptyMenu.id, venueId: empty.id }),
    ).rejects.toMatchObject({ name: 'PublishError', code: 'no_visible_items' })
    await expect(
      loadDraft(app, tenant, { menuId: menu.id, venueId: empty.id }),
    ).rejects.toMatchObject({ code: 'menu_not_found' })
    await expect(loadDraft(app, otherTenant, scope())).rejects.toMatchObject({
      code: 'menu_not_found',
    })
    await expect(loadDraft(app, tenant, { menuId: 'nope', venueId })).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
