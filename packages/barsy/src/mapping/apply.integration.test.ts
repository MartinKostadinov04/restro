// Acceptance test of brief S2-03a, item 0: the whole mapCatalogue output for the bid-10 demo
// recordings, plus the synthetic burger 7183 and its four supplement groups, applied through
// core's apply() to an empty menu on a real Postgres (as restro_app). Zero refused writes: the
// modifier groups take their `supplement_group` link, so their barsy values land too.
//
// It lives here because it needs both sides: barsy may import core, never the other way round.
import { newId } from '@restro/core'
import {
  apply,
  loadMenuDocument,
  type ProvisionedMenu,
  provisionMenu,
  provisionTenant,
  provisionVenue,
} from '@restro/core/apply'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Test-only reach into core's database test set-up and db's read entry point (barsy itself has
// no database dependency; production code here never does this).
import {
  appDatabaseUrl,
  cleanUp,
  hasDatabase,
  openOwnerPool,
  testSlug,
} from '../../../core/src/apply/test-database.ts'
import { createPool, type DbPool } from '../../../db/src/index.ts'
import { mapCatalogue } from './catalogue.ts'
import { article, config, demoArticles, demoBurgerSupplements, input } from './test-data.ts'
import type { CatalogueMapping } from './types.ts'

describe.skipIf(!hasDatabase)('mapCatalogue → apply(): the demo catalogue and the burger', () => {
  const tenant = newId('tn')
  const integrationId = newId('in')
  let owner: ReturnType<typeof openOwnerPool>
  let app: DbPool
  let menu: ProvisionedMenu
  let venueId: string
  let mapping: CatalogueMapping

  beforeAll(async () => {
    owner = openOwnerPool()
    app = createPool(appDatabaseUrl(), { applicationName: 'restro-barsy-apply-tests' })
    await provisionTenant(app, { tenantId: tenant, name: 'Mapping acceptance club' })
    venueId = (await provisionVenue(app, tenant, { name: 'Demo', slug: testSlug('demo') })).id
    menu = await provisionMenu(app, tenant, venueId)
    await owner.query(
      `insert into restro.integrations (id, tenant_id, kind, host)
       values ($1, $2, 'barsy', 'demo.barsyonline.com')`,
      [integrationId, tenant],
    )

    const burger = article(7183, {
      categories: ['370'],
      has_supplements: 1,
      article_name_public: 'Бургер',
    })
    mapping = mapCatalogue(
      input({
        venueId: venueId as never,
        menuId: menu.id,
        articles: [...demoArticles, burger],
        supplementsByArticle: { '7183': demoBurgerSupplements },
      }),
      config({ integrationId: integrationId as never, jobId: newId('jb') }),
    )
    // Tier 1 first, as the sync will: every barsy write cites one of these records.
    const records = new Map(mapping.sourceRecords.map((record) => [record.id, record]))
    for (const record of records.values()) {
      await owner.query(
        `insert into restro.source_records
           (id, tenant_id, integration_id, external_type, external_id, scope, content_hash, raw,
            payload)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          record.id,
          tenant,
          record.integrationId,
          record.externalType,
          record.externalId,
          record.scope,
          record.contentHash,
          record.raw,
          JSON.stringify(record.payload),
        ],
      )
    }
  })

  afterAll(async () => {
    await app?.end()
    if (owner) {
      await cleanUp(owner, [tenant])
      await owner.end()
    }
  })

  it('the mapping counts: 11 sections, 58 demo items + the burger, 4 groups, 14 options', () => {
    expect(mapping.counts).toMatchObject({
      sections: 11,
      items: 59,
      placements: 59,
      modifierGroups: 4,
      options: 14,
    })
  })

  it('applies with zero refused writes, and the document holds what was mapped', async () => {
    const changeSet = mapping.changeSet
    if (changeSet === null) throw new Error('the mapping produced no change set')
    const result = await apply(app, tenant, changeSet)
    expect(result.rejected).toEqual([])
    expect(result.skipped).toBe(0)
    expect(result.applied + result.unchanged).toBe(changeSet.ops.length)

    const doc = await loadMenuDocument(app, tenant, menu.id)
    const ofType = (type: string) => doc.nodes.filter((node) => node.type === type)
    expect(ofType('section')).toHaveLength(11)
    expect(ofType('item')).toHaveLength(59)
    expect(doc.placements).toHaveLength(59)

    const burgerLink = doc.links.find(
      (link) =>
        link.externalType === 'article' &&
        doc.values.some(
          (value) =>
            value.nodeId === link.nodeId &&
            value.fieldKey === 'name' &&
            JSON.stringify(value.value).includes('Бургер'),
        ),
    )
    expect(burgerLink).toBeDefined()
    const groups = ofType('modifier_group')
    expect(groups).toHaveLength(4)
    expect(groups.every((group) => group.parentId === burgerLink?.nodeId)).toBe(true)
    const options = ofType('option')
    expect(options).toHaveLength(14)
    const groupIds = new Set(groups.map((group) => group.id))
    expect(
      options.every((option) => option.parentId !== null && groupIds.has(option.parentId)),
    ).toBe(true)

    // The groups are linked, and their barsy values (name, min, max) are stored.
    const groupLinks = doc.links.filter((link) => link.externalType === 'supplement_group')
    expect(groupLinks.map((link) => link.nodeId).sort()).toEqual([...groupIds].sort())
    expect(groupLinks.every((link) => link.state === 'active')).toBe(true)
    for (const group of groups) {
      const fields = doc.values
        .filter((value) => value.nodeId === group.id && value.layer === 'barsy')
        .map((value) => value.fieldKey)
      expect(fields).toEqual(expect.arrayContaining(['min', 'max']))
    }
  })

  it('applying the same output again changes nothing; every placement is skipped', async () => {
    const changeSet = mapping.changeSet
    if (changeSet === null) throw new Error('the mapping produced no change set')
    const again = await apply(app, tenant, { ...changeSet, id: newId('cs') })
    expect(again).toMatchObject({ applied: 0, rejected: [], eventsWritten: 0, skipped: 59 })
  })
})
