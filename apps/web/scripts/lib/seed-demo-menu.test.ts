// The demo menu in a real database, read the way the Composer tab reads it: seed it, seed it
// again (nothing may change), then load, resolve and build the view the screen gets. Runs when
// DATABASE_URL_OWNER is set (after `pnpm db:migrate && pnpm db:roles`), like the other database
// tests; CI sets it and then the test is required.
import {
  type ChangeSet,
  mergeDocumentParts,
  newId,
  resolve,
  VENUE_MENU_TEMPLATE,
} from '@restro/core'
import {
  apply,
  loadMenuDocument,
  loadUnplacedItems,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import { createPool, type DbPool } from '@restro/db'
import type pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildComposerView } from '../../src/composer/view-model'
import {
  appDatabaseUrl,
  hasDatabase,
  openOwnerPool,
  testSlug,
} from '../../src/server/test-database'
import { DEMO_ITEMS } from './demo-menu'
import { seedDemoMenu } from './seed-demo-menu'

/** Document tables, children before parents, for the clean-up (the app role cannot delete). */
const TABLES = [
  'events',
  'field_values',
  'placements',
  'source_links',
  'menus',
  'nodes',
  'source_records',
  'job_runs',
  'places',
  'barsy_venues',
  'assets',
  'integrations',
  'venues',
] as const

describe.skipIf(!hasDatabase)('the demo menu against Postgres (as the restro_app role)', () => {
  const tenant = newId('tn')
  let app: DbPool
  let owner: pg.Pool
  let venueId: string

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-web-demo-menu-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Demo menu test club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Demo', slug: testSlug('demo') })).id
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      for (const table of TABLES) {
        await owner.query(`delete from restro.${table} where tenant_id = $1`, [tenant])
      }
      await owner.query('delete from restro.tenants where id = $1', [tenant])
      await owner.end()
    }
  })

  const countEvents = async () =>
    Number(
      (
        await owner.query<{ n: string }>(
          'select count(*) as n from restro.events where tenant_id = $1',
          [tenant],
        )
      ).rows[0]?.n,
    )

  it('seeds the menu, and seeding again changes nothing', async () => {
    const first = await seedDemoMenu(app, tenant, venueId, 'abcDEF123456')
    expect(first).toEqual({
      sections: 4,
      articles: DEMO_ITEMS.length,
      created: 4 + DEMO_ITEMS.length + 1,
    })
    const eventsAfterFirst = await countEvents()
    expect(eventsAfterFirst).toBeGreaterThan(100)

    const second = await seedDemoMenu(app, tenant, venueId, 'abcDEF123456')
    expect(second.created).toBe(0)
    expect(await countEvents()).toBe(eventsAfterFirst)
  })

  it('shows what the composer shows: four sections, 20 placed items, two in Unsorted', async () => {
    const menu = await provisionMenu(app, tenant, venueId)
    const document = mergeDocumentParts(
      await loadMenuDocument(app, tenant, menu.id),
      await loadUnplacedItems(app, tenant, menu.id),
    )
    const resolved = resolve(VENUE_MENU_TEMPLATE, document, {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG', 'en_US'],
      now: new Date().toISOString(),
    })
    const view = buildComposerView({ doc: document, resolved, displayLocale: 'bg_BG' })

    expect(view.rootIds.map((id) => view.sections[id]?.title)).toEqual([
      'Коктейли',
      'Бира',
      'Безалкохолни',
      'Храна',
    ])
    expect(view.rootIds.map((id) => view.placements[id]?.length)).toEqual([7, 5, 4, 4])
    expect(view.rootIds.every((id) => view.sections[id]?.origin === 'till')).toBe(true)

    const named = (name: string) => Object.values(view.items).find((item) => item.name === name)
    expect(view.unsortedIds.map((id) => view.items[id]?.name)).toEqual([
      'Лимонада на къщата',
      'Текила шот',
    ])
    expect(named('Лимонада на къщата')?.origin).toBe('owned')
    expect(named('Текила шот')?.origin).toBe('till')
    expect(named('Негрони')?.price).toEqual({ amount_minor: 1050, currency: 'EUR' })
    expect(named('Гинес 440 мл')).toMatchObject({ hiddenBy: 'till', shown: false })
    expect(Object.values(view.items).filter((item) => item.hiddenBy !== null)).toHaveLength(1)

    // One description written here; an item without allergens or an English name has issues.
    const daiquiri = Object.values(resolved.items).find(
      (item) => (item.fields.name?.value as { bg_BG?: string } | null)?.bg_BG === 'Дайкири',
    )
    expect(daiquiri?.fields.description).toMatchObject({ provenance: 'owned', layer: 'manual' })
    expect(named('Мохито')?.issues.length).toBeGreaterThan(0)
    expect(named('Негрони')?.issues).toEqual([])
  })

  it('cannot show the item barsy hides (rule 5), however it is asked', async () => {
    const menu = await provisionMenu(app, tenant, venueId)
    const before = await loadMenuDocument(app, tenant, menu.id)
    const node = Object.values(
      resolve(VENUE_MENU_TEMPLATE, before, {
        venueScope: `venue:${venueId}`,
        locales: ['bg_BG'],
        now: new Date().toISOString(),
      }).items,
    ).find(
      (item) => (item.fields.name?.value as { bg_BG?: string } | null)?.bg_BG === 'Гинес 440 мл',
    )
    if (!node) throw new Error('the barsy-hidden demo item is missing')

    const manual = (op: ChangeSet['ops'][number]): ChangeSet => ({
      id: newId('cs'),
      source: 'manual',
      jobId: newId('jb'),
      actor: 'user:abcDEF123456',
      observedAt: new Date().toISOString(),
      ops: [op],
    })
    const show = await apply(
      app,
      tenant,
      manual({
        op: 'setField',
        node: { id: node.id },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
        value: true,
      }),
    )
    expect(show.rejected.map((rejection) => rejection.code)).toEqual(['less_cautious'])
    await apply(
      app,
      tenant,
      manual({
        op: 'clearField',
        node: { id: node.id },
        fieldKey: 'visible',
        layer: 'manual',
        scope: 'master',
      }),
    )
    const after = resolve(VENUE_MENU_TEMPLATE, await loadMenuDocument(app, tenant, menu.id), {
      venueScope: `venue:${venueId}`,
      locales: ['bg_BG'],
      now: new Date().toISOString(),
    })
    expect(after.items[node.id]?.visible).toBe(false)
  })
})
