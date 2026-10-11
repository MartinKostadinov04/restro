// Several venues on one catalogue (brief CF-16): the section keys, the venue-scoped hiding, the
// menu test for combos, and the two recordings of catalogue 72 (bid 10 and bid 102).
import {
  type ChangeSetOp,
  ChangeSetSchema,
  canonicalJson,
  FieldWriteSchema,
  sha256Hex,
  VENUE_MENU_TEMPLATE,
  validateWrite,
} from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { mapCatalogue } from './catalogue.ts'
import { deriveId } from './ids.ts'
import {
  BID,
  C72_DRINKS,
  C72_FOOD,
  C72_ROOT,
  catalogue72Bid10,
  catalogue72Bid102,
  catalogue72Tree,
  config,
  demoArticles,
  demoBurgerSupplements,
  INTEGRATION_ID,
  input,
  MENU_ID,
  PUBLIC_ROOT,
  TILL_ROOT,
  VENUE_ID,
} from './test-data.ts'
import type { CatalogueMapping } from './types.ts'
import {
  inMenuOf,
  parseSectionLinkId,
  qualifiedSections,
  sectionLinkId,
  sectionLinksOfMenu,
  venueHideOps,
} from './venues.ts'

const opsOf = (result: CatalogueMapping): ChangeSetOp[] => result.changeSet?.ops ?? []
const pin = (result: CatalogueMapping) =>
  sha256Hex(
    canonicalJson({
      ops: result.changeSet?.ops,
      links: result.linkStates,
      records: result.sourceRecords.map((record) => record.id),
    }),
  )
const sectionLinks = (result: CatalogueMapping) =>
  result.linkStates.filter((intent) => intent.linkType === 'category').map((i) => i.externalId)

const OTHER_VENUE = deriveId('vn', 'second-venue')
const OTHER_MENU = deriveId('nd', 'second-menu')

describe('one venue: exactly what the mapping wrote before CF-16', () => {
  // Hashes of the ops, link intents and record ids, taken with the mapping as it was before CF-16
  // (b4ecbe1). A single venue gets no qualified key, so nothing it stored changes.
  it('the till root (1091) with the burger combo', () => {
    const result = mapCatalogue(
      input({ supplementsByArticle: { '7183': demoBurgerSupplements } }),
      config(),
    )
    expect(pin(result)).toBe('a5dbbb631b5caa1af56efa0c1fb456d939e85a1ec63ee2e7caf90c737f7bb627')
  })

  it('the public root (1171), current price', () => {
    const result = mapCatalogue(
      input({ qualifiedSections: new Set(), venueHiddenArticles: new Set() }),
      config({ catalogueRootCatId: PUBLIC_ROOT, priceSource: 'current_price' }),
    )
    expect(pin(result)).toBe('4c367fb5671c2555b52329a87ce8924efa2c7edd4469b0c47c63b8cf0584f993')
  })
})

describe('section keys', () => {
  it('formats and reads plain and venue-qualified ids', () => {
    expect(sectionLinkId(1100, null)).toBe('1100')
    expect(sectionLinkId(1100, VENUE_ID)).toBe(`1100@${VENUE_ID}`)
    expect(parseSectionLinkId('1100')).toEqual({ catId: 1100, venueId: null })
    expect(parseSectionLinkId(`1100@${VENUE_ID}`)).toEqual({ catId: 1100, venueId: VENUE_ID })
    for (const bad of ['', 'x', '1100@', '1100@tn_x', '-1', '1.5', '1100@vn_x@vn_y']) {
      expect(parseSectionLinkId(bad), bad).toBeNull()
    }
  })

  it('a venue keeps its own links, takes free plain keys, and qualifies the ones another menu holds', () => {
    const links = [
      { externalId: '1', menuId: MENU_ID }, // ours
      { externalId: '1100', menuId: OTHER_MENU }, // the other venue's
      { externalId: `1101@${VENUE_ID}`, menuId: MENU_ID }, // ours, qualified already
      { externalId: '1102', menuId: null }, // no menu found: never taken
      { externalId: `310@${OTHER_VENUE}`, menuId: OTHER_MENU }, // the other's qualified key
      { externalId: 'junk', menuId: MENU_ID },
    ]
    expect([...qualifiedSections(VENUE_ID, MENU_ID, links)].sort()).toEqual([1100, 1101, 1102])
    expect([...sectionLinksOfMenu(MENU_ID, links)].sort()).toEqual([
      '1',
      `1101@${VENUE_ID}`,
      'junk',
    ])
    // The other venue: 1100 is its own; plain 1101 is free (the first venue's link is qualified).
    expect([...qualifiedSections(OTHER_VENUE, OTHER_MENU, links)].sort()).toEqual([1, 1102, 310])
  })

  it('qualified sections get their own links and node ids, nested parents and placements follow', () => {
    const qualified = new Set([1, 310, 1100])
    const plain = mapCatalogue(input(), config())
    const second = mapCatalogue(
      input({ venueId: OTHER_VENUE, menuId: OTHER_MENU, qualifiedSections: qualified }),
      config(),
    )
    const expected = sectionLinks(plain).map((id) =>
      qualified.has(Number(id)) ? `${id}@${OTHER_VENUE}` : id,
    )
    expect(sectionLinks(second)).toEqual(expected)

    const creates = opsOf(second).filter(
      (op) => op.op === 'createNode' && op.nodeType === 'section',
    )
    const plainCreates = opsOf(plain).filter(
      (op) => op.op === 'createNode' && op.nodeType === 'section',
    )
    const ids = new Set(creates.map((op) => (op.op === 'createNode' ? op.id : '')))
    for (const op of plainCreates) if (op.op === 'createNode') expect(ids.has(op.id)).toBe(false)

    // 310 (Алкохол) sits under 1 (Бар/Bar): both qualified, the parent named by its qualified link.
    const alcohol = opsOf(second).find(
      (op, index, all) =>
        op.op === 'createNode' &&
        all[index + 1]?.op === 'linkSource' &&
        (all[index + 1] as { link: { externalId: string } }).link.externalId ===
          `310@${OTHER_VENUE}`,
    )
    expect(alcohol).toMatchObject({ parent: { link: { externalId: `1@${OTHER_VENUE}` } } })
    // 400 is plain under the qualified 1.
    const placementSections = new Set(
      opsOf(second).flatMap((op) =>
        op.op === 'setPlacement' && 'link' in op.section ? [op.section.link.externalId] : [],
      ),
    )
    expect(placementSections.has(`310@${OTHER_VENUE}`)).toBe(true)
    expect(placementSections.has('310')).toBe(false)
    expect(placementSections.has('400')).toBe(true)
    // The category records are barsy's, one per category whichever venue shows it.
    const records = (result: CatalogueMapping) =>
      result.sourceRecords.filter((r) => r.externalType === 'category').map((r) => r.id)
    expect(records(second)).toEqual(records(plain))
    expect(ChangeSetSchema.safeParse(second.changeSet).success).toBe(true)
  })
})

describe('hidden in one venue', () => {
  it('clears the venue-scoped visible of a mapped article the venue had hidden, and nothing else', () => {
    const result = mapCatalogue(
      input({ venueHiddenArticles: new Set(['11', '40', '999999']) }),
      config(),
    )
    const clears = opsOf(result).filter(
      (op) => op.op === 'clearField' && op.fieldKey === 'visible' && op.scope !== 'master',
    )
    expect(
      clears.map((op) =>
        op.op === 'clearField' && 'link' in op.node ? op.node.link.externalId : '',
      ),
    ).toEqual(['11', '40'])
    for (const op of clears) expect(op).toMatchObject({ layer: 'till', scope: `venue:${VENUE_ID}` })
  })

  it('venueHideOps only ever writes visible = false at the venue, in the till layer, with its record (rule 5)', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000_000 }), { maxLength: 30 }),
        (ids) => {
          const ops = venueHideOps(
            INTEGRATION_ID,
            VENUE_ID,
            ids.map((id) => ({ articleExternalId: String(id), sourceRecordId: `sr_${id}` })),
          )
          expect(ops).toHaveLength(ids.length)
          for (const op of ops) {
            expect(FieldWriteSchema.safeParse(op).success).toBe(true)
            expect(op).toMatchObject({
              op: 'setField',
              fieldKey: 'visible',
              layer: 'till',
              scope: `venue:${VENUE_ID}`,
              value: false,
              mappingVersion: 1,
            })
            if (op.op === 'setField') {
              expect(validateWrite(VENUE_MENU_TEMPLATE, 'item', op)).toMatchObject({ ok: true })
            }
          }
        },
      ),
    )
  })
})

describe('inMenuOf: the articles a venue maps', () => {
  it('is exactly the set the mapping places (or keeps unplaced in the root)', () => {
    for (const root of [TILL_ROOT, PUBLIC_ROOT]) {
      const result = mapCatalogue(input(), config({ catalogueRootCatId: root }))
      const mapped = new Set(
        result.linkStates.filter((i) => i.linkType === 'article').map((i) => i.externalId),
      )
      const inMenu = inMenuOf(input().tree, root)
      for (const article of demoArticles) {
        expect(inMenu(article), `${root}:${article.article_id}`).toBe(
          mapped.has(String(article.article_id)),
        )
      }
    }
  })
})

describe('catalogue 72 read whole by two venues (bid 10 and bid 102)', () => {
  const tree = catalogue72Tree()
  const venueA = mapCatalogue(
    input({ tree, articles: catalogue72Bid10, bid: BID }),
    config({ catalogueRootCatId: C72_ROOT }),
  )
  const venueB = mapCatalogue(
    input({
      tree,
      articles: catalogue72Bid102,
      bid: 102,
      venueId: OTHER_VENUE,
      menuId: OTHER_MENU,
      qualifiedSections: new Set([C72_DRINKS, 1140, 1142, 1143, 1144, 1154, 1155, 1156]),
    }),
    config({ catalogueRootCatId: C72_DRINKS }),
  )
  const articles = (result: CatalogueMapping) =>
    result.linkStates.filter((i) => i.linkType === 'article').map((i) => i.externalId)

  it('every article is one item; each venue maps the part under its own root', () => {
    expect(articles(venueA).length).toBeGreaterThan(articles(venueB).length)
    for (const id of articles(venueB)) expect(articles(venueA)).toContain(id)
    // Article 7409 sits in 1131 (food) and 1142 (drinks): one item in both menus.
    expect(articles(venueA)).toContain('7409')
    expect(articles(venueB)).toContain('7409')
    expect(venueB.counts.outsideCatalogue).toBeGreaterThan(0)
    expect(venueB.warnings.map((w) => w.code)).not.toContain('article_outside_catalogue')
  })

  it('price and for-sale are written per venue; the text flags of is_for_sale_barsys are read', () => {
    const priceOf = (result: CatalogueMapping, id: string, venue: string) =>
      opsOf(result).find(
        (op) =>
          op.op === 'setField' &&
          op.fieldKey === 'price' &&
          op.scope === `venue:${venue}` &&
          'link' in op.node &&
          op.node.link.externalId === id,
      )
    expect(priceOf(venueA, '7409', VENUE_ID)).toMatchObject({
      value: { amount_minor: 665, currency: 'EUR' },
    })
    expect(priceOf(venueB, '7409', OTHER_VENUE)).toMatchObject({
      value: { amount_minor: 665, currency: 'EUR' },
    })
    // Article 7405 carries {"1":"1","10":"1","70":"1","102":"1"}.
    const forSale = (result: CatalogueMapping, venue: string) =>
      opsOf(result).find(
        (op) =>
          op.op === 'setField' &&
          op.fieldKey === 'for_sale' &&
          op.scope === `venue:${venue}` &&
          'link' in op.node &&
          op.node.link.externalId === '7405',
      )
    expect(forSale(venueA, VENUE_ID)).toMatchObject({ value: true })
    // 7405 is food (1133): only venue A maps it.
    expect(forSale(venueB, OTHER_VENUE)).toBeUndefined()
  })

  it('each venue gets its own sections under the keys it was given', () => {
    expect(sectionLinks(venueA)).toContain(String(C72_FOOD))
    expect(sectionLinks(venueA)).toContain('1142')
    expect(sectionLinks(venueB)).toContain(`1142@${OTHER_VENUE}`)
    expect(sectionLinks(venueB)).not.toContain('1142')
    expect(ChangeSetSchema.safeParse(venueB.changeSet).success).toBe(true)
  })

  it('inMenuOf keeps a whole-catalogue read to the combos of one venue', () => {
    const drinks = inMenuOf(tree, C72_DRINKS)
    const ids = catalogue72Bid102.filter(drinks).map((a) => String(a.article_id))
    expect(ids.sort()).toEqual(articles(venueB).sort())
  })
})
