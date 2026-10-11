import {
  type ChangeSetOp,
  ChangeSetSchema,
  type NodeType,
  VENUE_MENU_TEMPLATE,
  validateWrite,
} from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { Article } from '../read/schemas.ts'
import { mapCatalogue, readArticlePicture } from './catalogue.ts'
import { BarsyMappingError } from './errors.ts'
import {
  article,
  BID,
  config,
  demoArticles,
  demoBurgerSupplements,
  group,
  INTEGRATION_ID,
  input,
  node,
  PUBLIC_ROOT,
  rootOf,
  VENUE_ID,
} from './test-data.ts'
import { BARSY_MAPPING_VERSION, type CatalogueMapping } from './types.ts'

const opsOf = (result: CatalogueMapping): ChangeSetOp[] => result.changeSet?.ops ?? []

/** The field ops (writes and clears) for one barsy object, by field key. */
function fieldOps(result: CatalogueMapping, externalType: string, externalId: string) {
  return opsOf(result).filter(
    (op) =>
      (op.op === 'setField' || op.op === 'clearField') &&
      'link' in op.node &&
      op.node.link.externalType === externalType &&
      op.node.link.externalId === externalId,
  )
}

function writeOf(
  result: CatalogueMapping,
  type: string,
  id: string,
  field: string,
  scope = 'master',
) {
  return fieldOps(result, type, id).find(
    (op) =>
      op.op !== 'createNode' && 'fieldKey' in op && op.fieldKey === field && op.scope === scope,
  )
}

const writtenValue = (op: ChangeSetOp | undefined) => (op?.op === 'setField' ? op.value : undefined)
const warningCodes = (result: CatalogueMapping) => result.warnings.map((w) => w.code)

describe('mapCatalogue on the demo recordings (till root 1091, bid 10)', () => {
  const result = mapCatalogue(input(), config())

  it('produces a change set that core accepts, from the barsy integration', () => {
    expect(result.changeSet).not.toBeNull()
    const parsed = ChangeSetSchema.safeParse(result.changeSet)
    expect(
      parsed.success,
      parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)),
    ).toBe(true)
    expect(result.changeSet).toMatchObject({
      source: `till:${INTEGRATION_ID}`,
      actor: `integration:${INTEGRATION_ID}`,
      observedAt: '2026-10-09T10:00:00+03:00',
    })
  })

  it('counts sections, items, placements and what it left out', () => {
    // 1091 → [1, 1100, 1101, 1102]; 1 → [310, 400, 430, 340, 370, 1092, 1090].
    expect(result.counts).toMatchObject({
      sections: 11,
      deletedArticles: 0,
      skippedServices: 1, // article 1, "Зареждане портфейл"
      outsideCatalogue: 1, // article 1030 sits in "Суровини" only
    })
    expect(result.counts.items).toBe(58)
    expect(result.counts.placements).toBe(58) // every demo article sits in exactly one mapped section
    // Outside the root is counted, not warned about: a whole-catalogue read holds many (CF-16).
    expect(warningCodes(result)).not.toContain('article_outside_catalogue')
  })

  it('every barsy-layer write carries its source record and the mapping version; every cited record exists', () => {
    const recordIds = new Set<string>(result.sourceRecords.map((record) => record.id))
    const writes = opsOf(result).filter((op) => op.op === 'setField')
    expect(writes.length).toBeGreaterThan(150)
    for (const op of writes) {
      if (op.op !== 'setField') continue
      expect(op.layer).toBe('till')
      expect(op.mappingVersion).toBe(BARSY_MAPPING_VERSION)
      expect(recordIds.has(op.sourceRecordId ?? '')).toBe(true)
    }
  })

  it('validates every write against the venue-menu template for the node type it targets', () => {
    const typeOf: Record<string, NodeType> = {
      article: 'item',
      category: 'section',
      supplement_group: 'modifier_group',
      supplement: 'option',
    }
    for (const op of opsOf(result)) {
      if (op.op !== 'setField' || !('link' in op.node)) continue
      const verdict = validateWrite(
        VENUE_MENU_TEMPLATE,
        typeOf[op.node.link.externalType] ?? 'item',
        op,
      )
      expect(verdict.ok, `${op.node.link.externalType} ${op.fieldKey}`).toBe(true)
    }
  })

  it('stores price and for_sale per venue (our vn_ id, never the bid) and the rest as master', () => {
    const scopes = new Map<string, Set<string>>()
    for (const op of opsOf(result)) {
      if (op.op !== 'setField' && op.op !== 'clearField') continue
      const set = scopes.get(op.fieldKey) ?? new Set()
      set.add(op.scope)
      scopes.set(op.fieldKey, set)
    }
    expect([...(scopes.get('price') ?? [])]).toStrictEqual([`venue:${VENUE_ID}`])
    expect([...(scopes.get('for_sale') ?? [])]).toStrictEqual([`venue:${VENUE_ID}`])
    expect([...(scopes.get('name') ?? [])]).toStrictEqual(['master'])
    expect([...(scopes.get('visible') ?? [])]).toStrictEqual(['master'])
    expect(JSON.stringify(opsOf(result).filter((op) => op.op === 'setField'))).not.toContain(
      'venue:10',
    )
  })

  it('"Кафе" (article 11): actual_price 0.97 → 97 minor, current_price 0.63 → 63 when chosen', () => {
    expect(
      writtenValue(writeOf(result, 'article', '11', 'price', `venue:${VENUE_ID}`)),
    ).toStrictEqual({
      amount_minor: 97,
      currency: 'EUR',
    })
    const current = mapCatalogue(input(), config({ priceSource: 'current_price' }))
    expect(
      writtenValue(writeOf(current, 'article', '11', 'price', `venue:${VENUE_ID}`)),
    ).toStrictEqual({
      amount_minor: 63,
      currency: 'EUR',
    })
    // Both raw prices stay in the source record.
    const record = result.sourceRecords.find(
      (r) => r.externalType === 'article' && r.externalId === '11',
    )
    expect(record?.payload).toMatchObject({ actual_price: '0.97', current_price: '0.63' })
    expect(record?.scope).toBe(`venue:${VENUE_ID}`)
  })

  it('"Кафе" has no public name (every language of the _ml object is empty): barsy\'s own name stands in, with a warning (D75)', () => {
    expect(writtenValue(writeOf(result, 'article', '11', 'name'))).toStrictEqual({ bg_BG: 'Кафе' })
    expect(result.warnings).toContainEqual({
      code: 'item_public_name_missing',
      externalType: 'article',
      externalId: '11',
    })
    // It has a name, so it is not "no name at all".
    expect(result.warnings).not.toContainEqual({
      code: 'item_name_missing',
      externalType: 'article',
      externalId: '11',
    })
  })

  it('names per locale: empty strings are missing, the language-less public name fills the default', () => {
    // 220: ml {bg_BG, en_US} → both. 160: public "bacardi", en_US "" → bg_BG only.
    expect(writtenValue(writeOf(result, 'article', '220', 'name'))).toStrictEqual({
      bg_BG: 'Coca Cola 0,250',
      en_US: 'Coca Cola',
    })
    expect(writtenValue(writeOf(result, 'article', '160', 'name'))).toStrictEqual({
      bg_BG: 'bacardi',
    })
    // 40: only bg_BG has text; internal "КАФЕ ЕКСПРЕСО КЪСО" equals the public one here, still public.
    expect(writtenValue(writeOf(result, 'article', '40', 'name'))).toStrictEqual({
      bg_BG: 'КАФЕ ЕКСПРЕСО КЪСО',
    })
    // 70 has neither ml nor public name: barsy's own name stands in, under the default language (D75).
    expect(writtenValue(writeOf(result, 'article', '70', 'name'))).toStrictEqual({
      bg_BG: 'Абсолют  0.050',
    })
    // A public name wins as it stands: 160's own name "Бакарди" is not mixed in or added.
    expect(JSON.stringify(opsOf(result))).not.toContain('Бакарди')
  })

  it('maps description_ml / description_public as a fallback layer', () => {
    expect(writtenValue(writeOf(result, 'article', '130', 'description'))).toStrictEqual({
      bg_BG: 'Пушена сьомга, крема сирене, зелена ябълка, краставица, копър, рукола\n200 г',
      en_US: 'Пушена сьомга, крема сирене, зелена ябълка, краставица, копър, рукола\n200 г',
    })
    expect(writeOf(result, 'article', '70', 'description')?.op).toBe('clearField')
  })

  it('places each item at the end of its mapped section, only when unplaced', () => {
    const placement = opsOf(result).find(
      (op) =>
        op.op === 'setPlacement' &&
        'link' in op.item &&
        op.item.link.externalId === '11' &&
        'link' in op.section,
    )
    expect(placement).toMatchObject({
      sortKey: 'end',
      onlyIfUnplaced: true,
      section: { link: { externalType: 'category', externalId: '370' } },
    })
    // Article 460 is in 310 and in 1099 (outside the catalogue): one placement, in 310.
    const of460 = opsOf(result).filter(
      (op) => op.op === 'setPlacement' && 'link' in op.item && op.item.link.externalId === '460',
    )
    expect(of460).toHaveLength(1)
    expect(of460[0]).toMatchObject({ section: { link: { externalId: '310' } } })
    // Within a section the order is the article id: 310 holds 70, 160, 190, ...
    const inSection310 = opsOf(result)
      .filter(
        (op) =>
          op.op === 'setPlacement' && 'link' in op.section && op.section.link.externalId === '310',
      )
      .map((op) =>
        op.op === 'setPlacement' && 'link' in op.item ? Number(op.item.link.externalId) : 0,
      )
    expect(inSection310).toStrictEqual([...inSection310].sort((a, b) => a - b))
    expect(inSection310.slice(0, 3)).toStrictEqual([70, 160, 190])
  })

  it('creates nodes in dependency order and names every node by link after its creation', () => {
    const ops = opsOf(result)
    const created = new Set<string>()
    const linked = new Set<string>()
    for (const op of ops) {
      if (op.op === 'createNode') created.add(op.id)
      if (op.op === 'linkSource') {
        expect(created.has(op.node.id)).toBe(true)
        linked.add(`${op.link.externalType}:${op.link.externalId}`)
      }
      if (op.op === 'setField' || op.op === 'clearField') {
        expect('link' in op.node).toBe(true)
        if ('link' in op.node)
          expect(linked.has(`${op.node.link.externalType}:${op.node.link.externalId}`)).toBe(true)
      }
      if (op.op === 'setPlacement') {
        if ('link' in op.item) expect(linked.has(`article:${op.item.link.externalId}`)).toBe(true)
        if ('link' in op.section)
          expect(linked.has(`category:${op.section.link.externalId}`)).toBe(true)
      }
    }
  })

  it('asks for pictures: the picture URL, or the picture itself when that is a URL; never fetches', () => {
    const requests = new Map(
      result.assetRequests.map((request) => [request.articleExternalId, request]),
    )
    expect(requests.get('11')).toStrictEqual({
      articleExternalId: '11',
      pictureName: '1.png',
      url: 'https://demo.barsyonline.com/endpoints/res/files_get?obj_type=articles&bid=10&obj_id=11&obj_property=PICTURE&file=1.png',
    })
    // 130: `picture` is a full image URL and `picture_url` is null.
    expect(requests.get('130')?.url).toBe(
      'https://imagedelivery.net/MJtvjX9fb_fA1fd2F8b4_A/8d4a03c5-1097-4ab7-b6d0-cbdf4bf1b500/public',
    )
    expect(requests.has('40')).toBe(false) // no picture
    // Article 40 has none, so its barsy image is cleared; an article with a picture is not.
    expect(writeOf(result, 'article', '40', 'image')?.op).toBe('clearField')
    expect(writeOf(result, 'article', '11', 'image')).toBeUndefined()
    // A picture URL is never written into a field.
    expect(JSON.stringify(opsOf(result))).not.toContain('files_get')
  })

  it("sections have no public titles on the till tree: barsy's own name stands in, one warning each (D75)", () => {
    expect(writtenValue(writeOf(result, 'category', '310', 'title'))).toStrictEqual({
      bg_BG: 'Алкохол',
    })
    expect(
      warningCodes(result).filter((code) => code === 'section_public_title_missing'),
    ).toHaveLength(11)
    expect(warningCodes(result)).not.toContain('section_title_missing')
  })

  it('is_for_sale: article 100 is off sale (0); is_public maps to visible', () => {
    expect(writtenValue(writeOf(result, 'article', '100', 'for_sale', `venue:${VENUE_ID}`))).toBe(
      false,
    )
    expect(writtenValue(writeOf(result, 'article', '11', 'for_sale', `venue:${VENUE_ID}`))).toBe(
      true,
    )
    expect(writtenValue(writeOf(result, 'article', '11', 'visible'))).toBe(true)
  })

  it('records every mapped category and every received article as a source record (content-addressed ids)', () => {
    const byType = (type: string) => result.sourceRecords.filter((r) => r.externalType === type)
    expect(byType('category')).toHaveLength(11)
    expect(byType('article')).toHaveLength(60)
    const record = byType('article')[0]
    expect(record?.id).toMatch(/^sr_[0-9A-Za-z]{22}$/)
    expect(record?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(record?.raw ?? '')).toStrictEqual(record?.payload)
    expect(new Set(result.sourceRecords.map((r) => r.id)).size).toBe(result.sourceRecords.length)
  })

  it('every section and item link is reported active', () => {
    const active = result.linkStates.filter((s) => s.state === 'active')
    expect(active.filter((s) => s.linkType === 'category')).toHaveLength(11)
    expect(active.filter((s) => s.linkType === 'article')).toHaveLength(58)
    expect(result.linkStates.some((s) => s.state === 'deleted')).toBe(false)
  })
})

describe('the public menu root (1171) has public section titles', () => {
  const result = mapCatalogue(input(), config({ catalogueRootCatId: PUBLIC_ROOT }))

  it('titles come from cat_name_public_ml, per language', () => {
    expect(result.counts.sections).toBe(8)
    expect(writtenValue(writeOf(result, 'category', '1172', 'title'))).toStrictEqual({
      bg_BG: 'Летни предложения',
      en_US: 'Summer Offers',
    })
    expect(warningCodes(result)).not.toContain('section_title_missing')
    expect(warningCodes(result)).not.toContain('section_public_title_missing')
    // None of the 60 demo articles sits in the public menu: they are all outside it.
    expect(result.counts.items).toBe(0)
    expect(result.counts.outsideCatalogue).toBe(59)
  })
})

describe('articles', () => {
  const tree = rootOf(node(100, [node(110, [node(111), node(112)]), node(120), node(370)]))
  const cfg = config({ catalogueRootCatId: 100 })

  it('places an article in every mapped category it belongs to (mirror mode), sorted by tree order', () => {
    const result = mapCatalogue(
      input({ tree, articles: [article(5, { categories: ['120', '111', '999'] })] }),
      cfg,
    )
    const sections = opsOf(result)
      .filter((op) => op.op === 'setPlacement')
      .map((op) =>
        op.op === 'setPlacement' && 'link' in op.section ? op.section.link.externalId : '',
      )
    expect(sections).toStrictEqual(['111', '120'])
  })

  it('flattens categories deeper than three levels into their depth-3 ancestor, with a warning', () => {
    const deep = rootOf(node(1, [node(2, [node(3, [node(4, [node(5)])])])]))
    const result = mapCatalogue(
      input({ tree: deep, articles: [article(7, { categories: ['5'] })] }),
      config({ catalogueRootCatId: 1 }),
    )
    // Root 1 is the menu root: 2 is depth 1, 3 is depth 2, 4 is depth 3, 5 is flattened into 4.
    expect(result.counts.sections).toBe(3)
    expect(result.warnings).toContainEqual({
      code: 'category_flattened',
      externalType: 'category',
      externalId: '5',
      detail: 'into 4',
    })
    expect(opsOf(result).find((op) => op.op === 'setPlacement')).toMatchObject({
      section: { link: { externalId: '4' } },
    })
  })

  it('skips services unless configured, keeps deleted ones out of the change set and reports them', () => {
    const articles = [article(1, { is_service: 1 }), article(2, { delete_flag: 1 }), article(3)]
    const result = mapCatalogue(
      input({ tree, articles: articles.map((a) => ({ ...a, categories: ['111'] })) }),
      cfg,
    )
    expect(result.counts).toMatchObject({ items: 1, skippedServices: 1, deletedArticles: 1 })
    expect(result.linkStates).toContainEqual({
      linkType: 'article',
      externalId: '2',
      state: 'deleted',
    })
    expect(JSON.stringify(opsOf(result))).not.toContain('"externalId":"2"')
    expect(JSON.stringify(opsOf(result))).not.toContain('"externalId":"1"')
    const withServices = mapCatalogue(
      input({ tree, articles: articles.map((a) => ({ ...a, categories: ['111'] })) }),
      { ...cfg, includeServices: true },
    )
    expect(withServices.counts.items).toBe(2)
  })

  it('is_for_sale_barsys[bid] wins over is_for_sale, in both directions; other venues are ignored', () => {
    const forSale = (a: Article) =>
      writtenValue(
        writeOf(
          mapCatalogue(input({ tree, articles: [a] }), cfg),
          'article',
          String(a.article_id),
          'for_sale',
          `venue:${VENUE_ID}`,
        ),
      )
    expect(forSale(article(1, { is_for_sale: 1, is_for_sale_barsys: { [BID]: 0 } }))).toBe(false)
    expect(forSale(article(2, { is_for_sale: 0, is_for_sale_barsys: { [BID]: 1 } }))).toBe(true)
    expect(forSale(article(3, { is_for_sale: 1, is_for_sale_barsys: { 99: 0 } }))).toBe(true)
    expect(forSale(article(4, { is_for_sale: 0, is_for_sale_barsys: {} }))).toBe(false)
    expect(forSale(article(5, { is_for_sale: 1, is_for_sale_barsys: { [BID]: null } }))).toBe(true)
    // As the catalogue recordings send them: text flags (CF-16).
    expect(forSale(article(6, { is_for_sale: 1, is_for_sale_barsys: { [BID]: '0' } }))).toBe(false)
    expect(forSale(article(7, { is_for_sale: 0, is_for_sale_barsys: { [BID]: '1' } }))).toBe(true)
  })

  it('maps sr_RS@latin to sr_RS, drops unknown language keys, honours the installation languages', () => {
    const a = article(1, {
      article_name_public: null,
      article_name_public_ml: {
        bg_BG: 'Супа',
        'sr_RS@latin': 'Supa',
        xx_XX: 'x',
        en_US: ' ',
        de_DE: 'Suppe',
      },
    })
    const mapped = mapCatalogue(input({ tree, articles: [a] }), cfg)
    expect(writtenValue(writeOf(mapped, 'article', '1', 'name'))).toStrictEqual({
      bg_BG: 'Супа',
      de_DE: 'Suppe',
      sr_RS: 'Supa',
    })
    // An installation without German does not get German text.
    const noGerman = mapCatalogue(
      input({ tree, articles: [a], languages: [{ lang_id: 'bg_BG', lang_name: 'Български' }] }),
      cfg,
    )
    expect(writtenValue(writeOf(noGerman, 'article', '1', 'name'))).toStrictEqual({ bg_BG: 'Супа' })
  })

  it('rejects an unreadable price instead of guessing, and clears the venue price', () => {
    const negative = article(1, { actual_price: '-1.00' as Article['actual_price'] })
    const missing = article(2, { actual_price: null })
    const result = mapCatalogue(input({ tree, articles: [negative, missing] }), cfg)
    expect(writeOf(result, 'article', '1', 'price', `venue:${VENUE_ID}`)?.op).toBe('clearField')
    expect(writeOf(result, 'article', '2', 'price', `venue:${VENUE_ID}`)?.op).toBe('clearField')
    expect(warningCodes(result)).toEqual(expect.arrayContaining(['price_invalid', 'price_missing']))
  })

  it('rounds half-up from the decimal text and takes integer prices as they are', () => {
    const price = (value: unknown) =>
      writtenValue(
        writeOf(
          mapCatalogue(
            input({
              tree,
              articles: [article(1, { actual_price: value as Article['actual_price'] })],
            }),
            cfg,
          ),
          'article',
          '1',
          'price',
          `venue:${VENUE_ID}`,
        ),
      )
    expect(price('2.405')).toStrictEqual({ amount_minor: 241, currency: 'EUR' })
    expect(price('2.404')).toStrictEqual({ amount_minor: 240, currency: 'EUR' })
    expect(price(3)).toStrictEqual({ amount_minor: 300, currency: 'EUR' })
    expect(price(0)).toStrictEqual({ amount_minor: 0, currency: 'EUR' })
  })

  it('warns about a duplicate article id and keeps one', () => {
    const result = mapCatalogue(input({ tree, articles: [article(1), article(1)] }), cfg)
    expect(result.counts.items).toBe(1)
    expect(warningCodes(result)).toContain('article_duplicate')
  })

  it('an article directly in the catalogue root is created unplaced, with a warning', () => {
    const result = mapCatalogue(
      input({ tree, articles: [article(1, { categories: ['100'] })] }),
      cfg,
    )
    expect(result.counts).toMatchObject({ items: 1, placements: 0 })
    expect(warningCodes(result)).toContain('article_unplaced')
  })

  it('rejects a picture that is not an https URL', () => {
    const result = mapCatalogue(
      input({
        tree,
        articles: [article(1, { picture: 'a.png', picture_url: 'http://insecure.example/a.png' })],
      }),
      cfg,
    )
    expect(result.assetRequests).toHaveLength(0)
    expect(warningCodes(result)).toContain('picture_url_invalid')
  })

  describe('the picture of an article', () => {
    const mapPicture = (overrides: Partial<Article>) =>
      mapCatalogue(input({ tree, articles: [article(1, overrides)] }), cfg)
    const imageOp = (result: CatalogueMapping) => writeOf(result, 'article', '1', 'image')

    it.each([
      ['null', null],
      ['an empty string', ''],
      ['blank', '   '],
    ])(
      'removed in barsy (picture is %s): clears the barsy image, requests nothing',
      (_name, picture) => {
        const result = mapPicture({ picture, picture_url: '' })
        expect(imageOp(result)).toStrictEqual({
          op: 'clearField',
          node: { link: { integration: INTEGRATION_ID, externalType: 'article', externalId: '1' } },
          fieldKey: 'image',
          layer: 'till',
          scope: 'master',
        })
        expect(result.assetRequests).toHaveLength(0)
        // The clear comes after the node is created and linked.
        const ops = opsOf(result)
        expect(
          ops.findIndex((op) => op.op === 'clearField' && op.fieldKey === 'image'),
        ).toBeGreaterThan(ops.findIndex((op) => op.op === 'linkSource'))
      },
    )

    it('not part of the response (the property was not asked for): writes nothing for the image', () => {
      const result = mapPicture({ picture: undefined, picture_url: undefined })
      expect(imageOp(result)).toBeUndefined()
      expect(result.assetRequests).toHaveLength(0)
    })

    it('still there: asks for the photo as before and does not clear the image', () => {
      const result = mapPicture({
        picture: 'a.png',
        picture_url: 'https://club.example/files?file=a.png',
      })
      expect(imageOp(result)).toBeUndefined()
      expect(result.assetRequests).toStrictEqual([
        {
          articleExternalId: '1',
          pictureName: 'a.png',
          url: 'https://club.example/files?file=a.png',
        },
      ])
    })

    it('an address that cannot be used is a warning, not a removal: the image stays', () => {
      const result = mapPicture({ picture: 'a.png', picture_url: 'http://insecure.example/a.png' })
      expect(imageOp(result)).toBeUndefined()
      expect(warningCodes(result)).toContain('picture_url_invalid')
    })
  })
})

describe('readArticlePicture', () => {
  it('reads the file name and the address the way the mapper does', () => {
    expect(
      readArticlePicture({ picture: ' a.png ', picture_url: ' https://x.example/a.png ' }),
    ).toStrictEqual({
      kind: 'picture',
      pictureName: 'a.png',
      url: 'https://x.example/a.png',
    })
    // `picture` alone, when it is a full address.
    expect(
      readArticlePicture({ picture: 'https://x.example/b.png', picture_url: null }),
    ).toMatchObject({
      kind: 'picture',
      url: 'https://x.example/b.png',
    })
    expect(readArticlePicture({ picture: 'b.png', picture_url: '' })).toStrictEqual({
      kind: 'invalid',
      pictureName: 'b.png',
    })
    expect(readArticlePicture({ picture: null })).toStrictEqual({ kind: 'none' })
    expect(readArticlePicture({ picture: '  ' })).toStrictEqual({ kind: 'none' })
    expect(readArticlePicture({})).toStrictEqual({ kind: 'absent' })
  })
})

describe('allergens', () => {
  const tree = rootOf(node(100, [node(110)]))
  const cfg = config({ catalogueRootCatId: 100 })
  const withDetails = (details: Article['article_details']) =>
    mapCatalogue(
      input({ tree, articles: [article(1, { categories: ['110'], article_details: details })] }),
      cfg,
    )

  it('reads the "Алергени" characteristic (k102 in the demo) through the synonym table', () => {
    const result = withDetails({ k102: 'Глутен, мляко и яйца; Sesame, лупина, xyzzy' })
    expect(writtenValue(writeOf(result, 'article', '1', 'allergens'))).toStrictEqual([
      'gluten',
      'eggs',
      'milk',
      'sesame',
      'lupin',
    ])
    // Unknown words are reported, never guessed.
    expect(result.warnings).toContainEqual({
      code: 'allergen_unknown_word',
      externalType: 'article',
      externalId: '1',
      detail: 'xyzzy',
    })
  })

  it('no value → the barsy allergens are cleared (not an empty claim); no key → nothing is said', () => {
    expect(writeOf(withDetails({}), 'article', '1', 'allergens')?.op).toBe('clearField')
    expect(writeOf(withDetails({ k102: '  ' }), 'article', '1', 'allergens')?.op).toBe('clearField')
    // The property was not requested: say nothing.
    expect(writeOf(withDetails(undefined), 'article', '1', 'allergens')).toBeUndefined()
    const noKey = mapCatalogue(
      input({
        tree,
        detailsTree: [],
        articles: [article(1, { categories: ['110'], article_details: { k102: 'milk' } })],
      }),
      cfg,
    )
    expect(writeOf(noKey, 'article', '1', 'allergens')).toBeUndefined()
    expect(warningCodes(noKey)).toContain('allergen_key_not_found')
  })

  it('text it cannot read at all neither claims nor removes; a non-text value is flagged', () => {
    const unreadable = withDetails({ k102: 'xyzzy' })
    expect(writeOf(unreadable, 'article', '1', 'allergens')).toBeUndefined()
    expect(warningCodes(unreadable)).toContain('allergen_unknown_word')
    expect(warningCodes(withDetails({ k102: { value: 'milk' } }))).toContain(
      'allergen_detail_unreadable',
    )
  })

  it('takes the key from the configuration when given', () => {
    const result = mapCatalogue(
      input({
        tree,
        articles: [article(1, { categories: ['110'], article_details: { k999: 'fish' } })],
      }),
      { ...cfg, allergenDetailKey: 'k999' },
    )
    expect(writtenValue(writeOf(result, 'article', '1', 'allergens'))).toStrictEqual(['fish'])
  })
})

describe('combos: the burger (article 7183)', () => {
  const tree = rootOf(node(100, [node(110)]))
  const cfg = config({ catalogueRootCatId: 100 })
  // The 60-article demo page does not reach article 7183: a synthetic burger and public option names.
  const burger = article(7183, {
    categories: ['110'],
    has_supplements: 1,
    article_name_public: 'Бургер',
  })
  const bbq = article(7095, {
    categories: ['110'],
    article_name_public: null,
    article_name_public_ml: { bg_BG: 'Сос BBQ', en_US: 'BBQ sauce' },
  })
  const result = mapCatalogue(
    input({
      tree,
      articles: [burger, bbq],
      supplementsByArticle: { '7183': demoBurgerSupplements },
    }),
    cfg,
  )

  it('one modifier group per supplement group, in barsy order, with min/max', () => {
    expect(result.counts).toMatchObject({ modifierGroups: 4, options: 14 })
    const groups = ['192', '191', '160', '190'].map((id) => `7183:${id}`)
    const mins = groups.map((id) => writtenValue(writeOf(result, 'supplement_group', id, 'min')))
    const maxes = groups.map((id) => writtenValue(writeOf(result, 'supplement_group', id, 'max')))
    expect(mins).toStrictEqual([0, 0, 1, 0]) // "хляб" is required
    expect(maxes).toStrictEqual([1, 1, 1, 3])
    expect(writtenValue(writeOf(result, 'supplement_group', '7183:160', 'name'))).toStrictEqual({
      bg_BG: 'хляб',
    })
    const order = opsOf(result)
      .filter((op) => op.op === 'linkSource' && op.link.externalType === 'supplement_group')
      .map((op) => (op.op === 'linkSource' ? op.link.externalId : ''))
    expect(order).toStrictEqual(groups)
    // The group hangs off the item, named by link.
    const create = opsOf(result).find(
      (op) => op.op === 'createNode' && op.nodeType === 'modifier_group',
    )
    expect(create).toMatchObject({
      parent: { link: { externalType: 'article', externalId: '7183' } },
    })
  })

  it('options carry a supplement link and a price delta per venue: 0 and 0,26', () => {
    const delta = (optionKey: string) =>
      writtenValue(writeOf(result, 'supplement', optionKey, 'price_delta', `venue:${VENUE_ID}`))
    expect(delta('7183:160:6970')).toStrictEqual({ amount_minor: 26, currency: 'EUR' })
    expect(delta('7183:192:7102')).toStrictEqual({ amount_minor: 0, currency: 'EUR' })
    const create = opsOf(result).find((op) => op.op === 'createNode' && op.nodeType === 'option')
    expect(create).toMatchObject({ parent: { link: { externalType: 'supplement_group' } } })
  })

  it("the option name is the option article's public name; none in the list → left alone and flagged", () => {
    expect(writtenValue(writeOf(result, 'supplement', '7183:191:7095', 'name'))).toStrictEqual({
      bg_BG: 'Сос BBQ',
      en_US: 'BBQ sauce',
    })
    // The option's own (internal) name in the combo response is never used. An option whose
    // article is not in this run's list is neither written nor cleared (B1-F6): a stored name stays.
    expect(writeOf(result, 'supplement', '7183:191:7096', 'name')).toBeUndefined()
    expect(warningCodes(result).filter((code) => code === 'option_name_missing')).toHaveLength(13)
    expect(JSON.stringify(opsOf(result))).not.toContain('СОС ПЕСТО')
  })

  it('a batch that holds only the combo (an incremental run) never clears an option name', () => {
    const alone = mapCatalogue(
      input({ tree, articles: [burger], supplementsByArticle: { '7183': demoBurgerSupplements } }),
      cfg,
    )
    const nameOps = opsOf(alone).filter(
      (op) =>
        (op.op === 'setField' || op.op === 'clearField') &&
        'link' in op.node &&
        op.node.link.externalType === 'supplement' &&
        op.fieldKey === 'name',
    )
    expect(nameOps).toEqual([])
    expect(alone.counts).toMatchObject({ modifierGroups: 4, options: 14 })
    // The options themselves are still seen, so they are not concluded missing.
    expect(alone.linkStates.filter((state) => state.linkType === 'supplement')).toHaveLength(14)
    expect(warningCodes(alone).filter((code) => code === 'option_name_missing')).toHaveLength(14)
  })

  it('an option article that is in the list but has no public name takes its own name, with a warning (D75)', () => {
    const unnamed = article(7095, { categories: ['110'], article_name_public: null })
    const named = mapCatalogue(
      input({
        tree,
        articles: [burger, unnamed],
        supplementsByArticle: { '7183': demoBurgerSupplements },
      }),
      cfg,
    )
    expect(writtenValue(writeOf(named, 'supplement', '7183:191:7095', 'name'))).toStrictEqual({
      bg_BG: 'INTERNAL 7095',
    })
    expect(named.warnings).toContainEqual({
      code: 'option_public_name_missing',
      externalType: 'supplement',
      externalId: '7183:191:7095',
    })
    // The name comes from the option article's record, not from the combo response.
    const op = writeOf(named, 'supplement', '7183:191:7095', 'name')
    const record = named.sourceRecords.find(
      (r) => r.externalType === 'article' && r.externalId === '7095',
    )
    expect(op?.op === 'setField' ? op.sourceRecordId : null).toBe(record?.id)
    // The combo response's own name for the option (what it calls it there) is still not read.
    expect(JSON.stringify(opsOf(named))).not.toContain('СОС ПЕСТО')
    // An option article with no name at all (not even its own) still clears the name.
    const nameless = mapCatalogue(
      input({
        tree,
        articles: [
          burger,
          article(7095, { categories: ['110'], article_name: '  ', article_name_public: null }),
        ],
        supplementsByArticle: { '7183': demoBurgerSupplements },
      }),
      cfg,
    )
    expect(writeOf(nameless, 'supplement', '7183:191:7095', 'name')?.op).toBe('clearField')
    expect(warningCodes(nameless)).toContain('option_name_missing')
  })

  it('is valid for core and validates against the template; supplement records are venue-scoped', () => {
    expect(ChangeSetSchema.safeParse(result.changeSet).success).toBe(true)
    const record = result.sourceRecords.find((r) => r.externalType === 'article_supplements')
    expect(record).toMatchObject({ externalId: '7183', scope: `venue:${VENUE_ID}` })
    const linkTypes = new Set(result.linkStates.map((s) => s.linkType))
    expect(linkTypes).toEqual(new Set(['category', 'article', 'supplement_group', 'supplement']))
  })

  it('an unknown max is not guessed; supplements of an unmapped article are flagged', () => {
    const odd = mapCatalogue(
      input({
        tree,
        articles: [burger],
        supplementsByArticle: {
          '7183': [group(1, 'Нещо', [{ id: 1, price: '-0.50' }], { max_selected: null })],
          '555': [group(2, 'Друго', [])],
        },
      }),
      cfg,
    )
    expect(writeOf(odd, 'supplement_group', '7183:1', 'max')?.op).toBe('clearField')
    expect(warningCodes(odd)).toEqual(
      expect.arrayContaining([
        'modifier_group_max_unknown',
        'option_price_invalid',
        'supplements_for_unmapped_article',
      ]),
    )
  })
})

describe("barsy's own name stands in for a missing public name (D75)", () => {
  const tree = rootOf(
    node(100, [
      node(110, [], { cat_name: 'Own section', cat_name_public: ' Public section ' }),
      node(120, [], { cat_name: 'Own only', cat_name_public_ml: { bg_BG: '  ', en_US: null } }),
      node(130, [], { cat_name: '   ', cat_name_public: null }),
      node(140, [], { cat_name: 'Own EN', cat_name_public_ml: { en_US: 'Only English' } }),
    ]),
  )
  const cfg = config({ catalogueRootCatId: 100 })
  const mapOne = (overrides: Partial<Article>) =>
    mapCatalogue(
      input({ tree, articles: [article(1, { categories: ['110'], ...overrides })] }),
      cfg,
    )
  const nameOf = (result: CatalogueMapping) => writtenValue(writeOf(result, 'article', '1', 'name'))

  it('an item with no public name gets its own name under the default language, and one warning', () => {
    for (const none of [
      { article_name_public: null, article_name_public_ml: null },
      { article_name_public: '', article_name_public_ml: {} },
      { article_name_public: '  ', article_name_public_ml: { bg_BG: '', en_US: ' ', de_DE: null } },
    ]) {
      const result = mapOne({ article_name: '  Own name  ', ...none })
      expect(nameOf(result)).toStrictEqual({ bg_BG: 'Own name' })
      expect(result.warnings.filter((w) => w.code === 'item_public_name_missing')).toStrictEqual([
        { code: 'item_public_name_missing', externalType: 'article', externalId: '1' },
      ])
      expect(warningCodes(result)).not.toContain('item_name_missing')
    }
  })

  it('the language barsy text without a tag is stored under is the configured default language', () => {
    const result = mapCatalogue(
      input({
        tree,
        articles: [
          article(1, { categories: ['110'], article_name_public: null, article_name: 'Own' }),
        ],
      }),
      { ...cfg, defaultLocale: 'en_US' },
    )
    expect(nameOf(result)).toStrictEqual({ en_US: 'Own' })
  })

  it('a public name in any one language wins as it stands: the two are never mixed', () => {
    const onlyEnglish = mapOne({
      article_name: 'Own name',
      article_name_public: null,
      article_name_public_ml: { en_US: 'Public' },
    })
    expect(nameOf(onlyEnglish)).toStrictEqual({ en_US: 'Public' })
    const unnamed = mapOne({
      article_name: 'Own name',
      article_name_public: 'Public',
      article_name_public_ml: null,
    })
    expect(nameOf(unnamed)).toStrictEqual({ bg_BG: 'Public' })
    for (const result of [onlyEnglish, unnamed]) {
      expect(JSON.stringify(opsOf(result))).not.toContain('Own name')
      expect(warningCodes(result)).not.toContain('item_public_name_missing')
    }
  })

  it('a public name only in a language the installation does not hold counts as missing', () => {
    const result = mapCatalogue(
      input({
        tree,
        languages: [{ lang_id: 'bg_BG', lang_name: 'Български' }],
        articles: [
          article(1, {
            categories: ['110'],
            article_name: 'Own name',
            article_name_public: null,
            article_name_public_ml: { de_DE: 'Nur Deutsch', xx_XX: 'x' },
          }),
        ],
      }),
      cfg,
    )
    expect(nameOf(result)).toStrictEqual({ bg_BG: 'Own name' })
  })

  it('no name at all (not even its own) is still "no name": cleared, and flagged as before', () => {
    const result = mapOne({ article_name: '   ', article_name_public: null })
    expect(writeOf(result, 'article', '1', 'name')?.op).toBe('clearField')
    expect(result.warnings).toContainEqual({
      code: 'item_name_missing',
      externalType: 'article',
      externalId: '1',
    })
    expect(warningCodes(result)).not.toContain('item_public_name_missing')
  })

  it('a response that did not carry the public fields at all says nothing: no fallback, no clear', () => {
    const result = mapOne({
      article_name: 'Own name',
      article_name_public: undefined,
      article_name_public_ml: undefined,
    })
    expect(writeOf(result, 'article', '1', 'name')).toBeUndefined()
    expect(JSON.stringify(opsOf(result))).not.toContain('Own name')
    expect(warningCodes(result)).not.toContain('item_public_name_missing')
  })

  it("a section: the public title wins, else the category's own name, else nothing", () => {
    const result = mapCatalogue(input({ tree, articles: [] }), cfg)
    const title = (id: string) => writtenValue(writeOf(result, 'category', id, 'title'))
    expect(title('110')).toStrictEqual({ bg_BG: 'Public section' })
    expect(title('120')).toStrictEqual({ bg_BG: 'Own only' }) // blank _ml in every language
    expect(writeOf(result, 'category', '130', 'title')?.op).toBe('clearField') // no name at all
    expect(title('140')).toStrictEqual({ en_US: 'Only English' }) // one language wins as it stands
    expect(JSON.stringify(opsOf(result))).not.toContain('Own EN')
    const missing = (code: string) =>
      result.warnings.filter((w) => w.code === code).map((w) => w.externalId)
    expect(missing('section_public_title_missing')).toStrictEqual(['120'])
    expect(missing('section_title_missing')).toStrictEqual(['130'])
  })

  it('counts one warning per fallback, none for a public name, whatever the order', () => {
    const articles = [
      article(1, { categories: ['110'], article_name: 'A', article_name_public: null }),
      article(2, { categories: ['110'], article_name: 'B', article_name_public: 'Public B' }),
      article(3, { categories: ['110'], article_name: 'C', article_name_public: null }),
    ]
    const forward = mapCatalogue(input({ tree, articles }), cfg)
    const backward = mapCatalogue(input({ tree, articles: [...articles].reverse() }), cfg)
    const fallbacks = (result: CatalogueMapping) =>
      result.warnings.filter((w) => w.code === 'item_public_name_missing').map((w) => w.externalId)
    expect(fallbacks(forward)).toStrictEqual(['1', '3'])
    expect(backward).toStrictEqual(forward)
  })

  it("only the one name is read: ids, prices, notes and every other field of barsy's own stay out", () => {
    const secret = {
      internal_note: 'NOTE-SECRET',
      cost_price: '1.11',
      delivery_price: '2.22',
      code: 'CODE-SECRET',
      barcode: 'BARCODE-SECRET',
      ref_num: 'REF-SECRET',
      export_id: 'EXPORT-SECRET',
    }
    const result = mapOne({ article_name: 'Own name', article_name_public: null, ...secret })
    expect(nameOf(result)).toStrictEqual({ bg_BG: 'Own name' })
    const written = JSON.stringify(opsOf(result))
    for (const value of Object.values(secret)) expect(written).not.toContain(value)
    // No field beyond the ones the mapping already wrote for an item and its section.
    const keys = new Set(
      opsOf(result).flatMap((op) =>
        op.op === 'setField' || op.op === 'clearField' ? [op.fieldKey] : [],
      ),
    )
    const known = [
      'allergens',
      'description',
      'for_sale',
      'image',
      'name',
      'price',
      'title',
      'visible',
    ]
    for (const key of keys) expect(known, key).toContain(key)
  })
})

describe('determinism', () => {
  const tree = rootOf(node(100, [node(110), node(120)]))
  const cfg = config({ catalogueRootCatId: 100 })
  const articles = [
    article(3, { categories: ['120', '110'] }),
    article(1, { categories: ['110'] }),
    article(2, { categories: ['120'], has_supplements: 1 }),
    article(9, { delete_flag: 1 }),
  ]
  const supplementsByArticle = {
    '2': [
      group(5, 'A', [
        { id: 3, price: '0.30' },
        { id: 1, price: 0 },
      ]),
    ],
  }

  it('the same input gives a deep-equal result, repeatedly', () => {
    const a = mapCatalogue(input({ tree, articles, supplementsByArticle }), cfg)
    const b = mapCatalogue(input({ tree, articles, supplementsByArticle }), cfg)
    expect(b).toStrictEqual(a)
  })

  it('does not depend on the order of the article list or of the languages (demo + synthetic articles)', () => {
    const all = [...demoArticles, article(7183, { categories: ['370'], has_supplements: 1 })]
    const base = mapCatalogue(
      input({ articles: all, supplementsByArticle: { '7183': demoBurgerSupplements } }),
      config(),
    )
    fc.assert(
      fc.property(
        fc.shuffledSubarray(all, { minLength: all.length, maxLength: all.length }),
        fc.shuffledSubarray([...input().languages], { minLength: 11, maxLength: 11 }),
        (shuffledArticles, shuffledLanguages) => {
          const again = mapCatalogue(
            input({
              articles: shuffledArticles,
              languages: shuffledLanguages,
              supplementsByArticle: { '7183': demoBurgerSupplements },
            }),
            config(),
          )
          expect(again).toStrictEqual(base)
        },
      ),
      { numRuns: 25 },
    )
  })

  it('a changed article changes only its own source record and the change set id', () => {
    const a = mapCatalogue(input({ tree, articles, supplementsByArticle }), cfg)
    const changed = articles.map((x) =>
      x.article_id === 1
        ? article(1, { categories: ['110'], actual_price: '9.99' as Article['actual_price'] })
        : x,
    )
    const b = mapCatalogue(input({ tree, articles: changed, supplementsByArticle }), cfg)
    const differing = a.sourceRecords.filter((r, i) => r.id !== b.sourceRecords[i]?.id)
    expect(differing.map((r) => r.externalId)).toStrictEqual(['1'])
    expect(b.changeSet?.id).not.toBe(a.changeSet?.id)
    // The node ids are the same: the same nodes are addressed.
    const created = (r: CatalogueMapping) =>
      opsOf(r)
        .filter((op) => op.op === 'createNode')
        .map((op) => (op.op === 'createNode' ? op.id : ''))
    expect(created(b)).toStrictEqual(created(a))
  })

  it('an empty catalogue has nothing to apply', () => {
    const result = mapCatalogue(input({ tree: rootOf(node(100)), articles: [] }), cfg)
    expect(result.changeSet).toBeNull()
    expect(result.counts.items).toBe(0)
  })
})

describe('input errors', () => {
  it('a catalogue root that is not in the tree is an error, not an empty menu', () => {
    expect(() => mapCatalogue(input(), config({ catalogueRootCatId: 424242 }))).toThrow(
      BarsyMappingError,
    )
    try {
      mapCatalogue(input(), config({ catalogueRootCatId: 424242 }))
    } catch (error) {
      expect((error as BarsyMappingError).code).toBe('catalogue_root_not_found')
    }
  })

  it('refuses a bad configuration or bad ids, naming the field but not the value', () => {
    const bad = (cfg: Partial<ReturnType<typeof config>>) => () =>
      mapCatalogue(input(), { ...config(), ...cfg } as never)
    expect(bad({ integrationId: 'nope' as never })).toThrow(/integrationId/)
    expect(bad({ mappingVersion: (BARSY_MAPPING_VERSION + 1) as never })).toThrow(/mappingVersion/)
    expect(bad({ observedAt: 'yesterday' })).toThrow(/observedAt/)
    expect(bad({ priceSource: 'list_price' as never })).toThrow(/priceSource/)
    expect(() => mapCatalogue(input({ venueId: 'venue-1' as never }), config())).toThrow(/venueId/)
    expect(() => mapCatalogue(input({ menuId: 'x' as never }), config())).toThrow(/menuId/)
    expect(() => mapCatalogue(input({ venueId: 'venue-1' as never }), config())).not.toThrow(
      /venue-1/,
    )
  })
})
