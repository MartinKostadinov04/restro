// The menu's header name reaches the guest heading (D92, #27): `publishMenu` and `loadDraft` read
// the menu's name (`renameMenu`) and the venue's name, and the snapshot's `menu.title` is the
// header name, else the venue's name. A rename is a change waiting to be published. Postgres as
// restro_app.
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { ChangeSet } from '../change-set'
import { newId } from '../ids'
import { diffSnapshots } from '../snapshot/diff'
import type { MenuSnapshot } from '../snapshot/schema'
import { apply } from './apply'
import { renameMenu } from './menus'
import { type ProvisionedMenu, provisionMenu, provisionTenant, provisionVenue } from './provision'
import { loadDraft, publishMenu } from './publish'
import { appDatabaseUrl, cleanUp, hasDatabase, openOwnerPool, testSlug } from './test-database'

describe.skipIf(!hasDatabase)('the menu’s header name in a publish', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: `vn_${string}`
  let menu: ProvisionedMenu

  const publish = (minutes: number) =>
    publishMenu(
      app,
      tenant,
      { menuId: menu.id, venueId, reason: 'manual', actor: 'user:us_test' },
      { now: new Date(Date.parse('2026-10-18T18:00:00Z') + minutes * 60_000) },
    )
  const rename = async (name: string) =>
    expect((await renameMenu(app, tenant, { venueId, menuId: menu.id, name })).ok).toBe(true)

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-core-header-name-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Header name test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Demo Club', slug: testSlug('hdr') }))
      .id as `vn_${string}`
    menu = await provisionMenu(app, tenant, venueId)
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
    const result = await apply(app, tenant, {
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
        manual(section, 'title', { bg_BG: 'Напитки' }),
        { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
        manual(item, 'name', { bg_BG: 'Вода' }),
        manual(item, 'price', { amount_minor: 300, currency: 'EUR' }),
        manual(item, 'allergens', []),
        // An internal note that reads like the header name: the heading is public all the same.
        manual(item, 'internal_note', 'Club Sofia'),
        { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
      ],
    } as ChangeSet)
    expect(result.rejected).toEqual([])
  })
  afterAll(async () => {
    if (owner) await cleanUp(owner, [tenant])
    await owner?.end()
    await app?.end()
  })

  let live: MenuSnapshot | null = null

  it('titles a menu without a header name with the venue’s name', async () => {
    const first = await publish(0)
    expect(first.status).toBe('published')
    live = first.snapshot.body
    expect(live?.menu.title).toEqual({ [live?.locales.default ?? '']: 'Demo Club' })
  })

  it('a rename is one change waiting, and the next publish carries the header name', async () => {
    await rename('Club Sofia')
    const draft = await loadDraft(app, tenant, { menuId: menu.id, venueId })
    expect(diffSnapshots(live, draft.snapshot)).toMatchObject({ areas: ['menu'], total: 1 })
    const second = await publish(5)
    expect(second.status).toBe('published')
    const body = second.snapshot.body
    expect(body?.menu.title).toEqual({ [body?.locales.default ?? '']: 'Club Sofia' })
  })

  it('clearing the name is a change too: the heading goes back to the venue’s name', async () => {
    const before = await loadDraft(app, tenant, { menuId: menu.id, venueId })
    await rename('')
    const after = await loadDraft(app, tenant, { menuId: menu.id, venueId })
    expect(diffSnapshots(before.snapshot, after.snapshot)).toMatchObject({
      areas: ['menu'],
      total: 1,
    })
    const third = await publish(10)
    expect(third.status).toBe('published')
    const body = third.snapshot.body
    expect(body?.menu.title).toEqual({ [body?.locales.default ?? '']: 'Demo Club' })
    expect((await publish(11)).status).toBe('unchanged')
  })
})
