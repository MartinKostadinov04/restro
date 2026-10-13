// The menu's layout and the sections' layout reach the snapshot (D92; brief S6): `publishMenu`
// reads the menu's settings (`setMenuSettings`) and the sections' `layout` field, and writes
// `layout` and `hints.layout`. Postgres as restro_app.
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { type NodeId, newId } from '../ids'
import { apply } from './apply'
import { setMenuSettings } from './menus'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('the menu and section layouts in a publish', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu
  const picks = newId('nd') as NodeId
  const drinks = newId('nd') as NodeId

  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-10-13T18:00:00Z') + minutes * 60_000) },
    )
  const change = (ops: unknown[]) =>
    apply(app, tenant, {
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:us_test',
      observedAt: new Date().toISOString(),
      ops,
    } as ChangeSet).then((result) => expect(result.rejected).toEqual([]))
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-layout-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Layout test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Main', slug: testSlug('main') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
    const ops: unknown[] = []
    for (const [index, section] of [picks, drinks].entries()) {
      ops.push(
        {
          op: 'createNode',
          id: section,
          nodeType: 'section',
          parent: { id: menu.id },
          status: 'active',
          sortKey: 'end',
        },
        manual(section, 'title', { bg_BG: index === 0 ? 'Топ' : 'Напитки' }),
      )
      const item = newId('nd')
      ops.push(
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: index === 0 ? 'Негрони' : 'Вода' }),
        manual(item, 'price', { amount_minor: 500, currency: 'EUR' }),
        manual(item, 'allergens', []),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      )
    }
    await change(ops)
  })
  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant])
    await owner?.end()
    await app?.end()
  })

  it('publishes a list without the guest switch and vertical sections while nothing is set', async () => {
    const first = await publish(0)
    expect(first.status).toBe('published')
    expect(first.snapshot.body?.layout).toEqual({ default: 'list', guest_switch: false })
    expect(first.snapshot.body?.sections[picks]?.hints.layout).toBe('vertical')
    expect(first.snapshot.body?.sections[drinks]?.hints.layout).toBe('vertical')
  })

  it('publishes the menu’s settings and a section marked horizontal', async () => {
    const saved = await setMenuSettings(app, tenant, {
      venueId,
      menuId: menu.id,
      settings: { layout: 'two_columns', layout_switch: true },
    })
    expect(saved.ok).toBe(true)
    await change([manual(drinks, 'layout', 'horizontal')])

    const second = await publish(10)
    expect(second.status).toBe('published')
    expect(second.snapshot.body?.layout).toEqual({ default: 'two', guest_switch: true })
    expect(second.snapshot.body?.sections[picks]?.hints.layout).toBe('vertical')
    expect(second.snapshot.body?.sections[drinks]?.hints.layout).toBe('horizontal')
    // Nothing else changed: the same content is no new version.
    expect((await publish(11)).status).toBe('unchanged')
  })

  it('a changed menu setting alone is a new version', async () => {
    await setMenuSettings(app, tenant, {
      venueId,
      menuId: menu.id,
      settings: { layout: 'one_column', layout_switch: false },
    })
    const third = await publish(20)
    expect(third.status).toBe('published')
    expect(third.snapshot.body?.layout).toEqual({ default: 'one', guest_switch: false })
  })
})
