import { join } from 'node:path'

import { pino } from 'pino'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { createBarsyClient } from '../client.ts'
import { BarsyConfigError, BarsyResponseError } from '../errors.ts'
import type { BarsyFixture } from '../fixture.ts'
import { FIXTURES_ROOT, readFixture } from '../fixture-files.ts'
import { createBarsyMockServer } from '../testing/mock-server.ts'
import { ARTICLE_EXTRA_PROPERTIES, ARTICLES_ORDER_BY, createBarsyReader } from './reader.ts'

// Every wrapper runs against MSW with the real demo recordings (fixtures/demo/). Nothing here can
// reach the network: the harness fails any request it has no handler for.

const DEMO = join(FIXTURES_ROOT, 'demo')
const FILES = {
  Barsys_getlist: 'barsys.json',
  Languages_getlist: 'languages.json',
  Currencies_getlist: 'currencies.json',
  Categories_getalltree: 'tree-bid10.json',
  Articles_getlist: 'articles-bid10-page1.json',
  Articlesupplements_get: 'supplements-7183-burger.json',
  Modificators_getlist: 'modificators-bid10.json',
  Articledetails_gettree: 'article-details.json',
  Places_getlist: 'places-bid10.json',
} as const

const fixtures = await Promise.all(
  Object.values(FILES).map((name) => readFixture(join(DEMO, name))),
)
const byMethod = (method: keyof typeof FILES): BarsyFixture => {
  const found = fixtures.find((fixture) => fixture.method === method)
  if (!found) throw new Error(`no fixture for ${method}`)
  return found
}

const mock = createBarsyMockServer(fixtures)
beforeAll(() => mock.listen())
afterEach(() => mock.reset())
afterAll(() => mock.close())

const reader = createBarsyReader(
  createBarsyClient(
    {
      host: 'https://demo.barsyonline.com',
      user: 'demo',
      password: 'test-password-not-a-real-one',
      env: 'test',
    },
    { logger: pino({ level: 'silent' }) },
  ),
)

describe('the nine wrappers on the demo recordings', () => {
  it('getVenues: the installation list, with the venue roots', async () => {
    const result = await reader.getVenues()
    expect(result.data).toHaveLength(5)
    expect(result.data.find((venue) => venue.barsy_id === 10)).toMatchObject({
      name: 'Bar & Dinner',
      cat_id: 1091,
      public_cat_id: 1171,
    })
    expect(result.raw).toBe(byMethod('Barsys_getlist').body)
    expect(result.requestId).toBeNull()
    expect(mock.requests[0]).toMatchObject({ methods: ['Barsys_getlist'], bid: null, params: {} })
  })

  it('getLanguages: keeps barsy language keys as sent (sr_RS@latin is normalised by the mapping)', async () => {
    const { data, requestId } = await reader.getLanguages()
    expect(data.map((language) => language.lang_id)).toContain('sr_RS@latin')
    expect(data).toHaveLength(11)
    expect(requestId).toBe('1:1139013')
  })

  it('getCurrencies', async () => {
    const { data } = await reader.getCurrencies()
    expect(data).toMatchObject([{ currency_id: 1, currency_code: 'EUR', is_current: 1 }])
  })

  it('getCategoryTree: public tree of one venue, as one root node', async () => {
    const { data, raw } = await reader.getCategoryTree(10)
    expect(data.category.cat_id).toBeNull()
    expect(data.categories.map((node) => node.category.cat_id)).toContain(1171)
    expect(raw).toBe(byMethod('Categories_getalltree').body)
    expect(mock.requests[0]).toMatchObject({
      methods: ['Categories_getalltree'],
      bid: '10',
      params: { only_public: '1', articles_lazy_load_mode: '1' },
    })
  })

  it('getArticlesPage: subtree filter, stable order, the extra properties, lossless prices', async () => {
    const { data, requestId } = await reader.getArticlesPage(10, {
      rootCatId: 1091,
      offset: 0,
      length: 60,
    })
    expect(data).toHaveLength(60)
    expect(requestId).toBe('1:1139014')
    const coffee = data.find((article) => article.article_id === 11)
    // 0.97 and 0.63 arrive as the exact decimal text, never as floats (rule 8).
    expect(coffee).toMatchObject({
      actual_price: '0.97',
      current_price: '0.63',
      categories: ['370'],
    })
    expect(mock.requests[0]).toMatchObject({
      methods: ['Articles_getlist'],
      bid: '10',
      params: {
        filters: { cat_id_deep: '1091' },
        order_by: { cat_weight_deep: 'asc', article_id: 'asc' },
        extra_properties: ARTICLE_EXTRA_PROPERTIES,
        offset: '0',
        length: '60',
      },
    })
    expect(ARTICLES_ORDER_BY).toStrictEqual({ cat_weight_deep: 'asc', article_id: 'asc' })
    expect(mock.requests[0]?.authorization).toMatch(/^Basic /)
  })

  it('getSupplements: the burger combo, four groups with prices and flags', async () => {
    const { data } = await reader.getSupplements(10, 7183)
    expect(data.map((group) => group.supplement_group_id)).toStrictEqual([192, 191, 160, 190])
    expect(data[2]).toMatchObject({ supplement_group_name: 'хляб', required: 1, max_selected: 1 })
    expect(data[2]?.articles[0]).toMatchObject({ article_id: 6970, supplement_price: '0.26' })
    expect(data[0]?.articles[0]?.supplement_price).toBe(0)
    expect(mock.requests[0]).toMatchObject({
      methods: ['Articlesupplements_get'],
      bid: '10',
      params: { article_id: '7183' },
    })
  })

  it('getModificatorsPage: pages explicitly (the default of 50 would cut the list)', async () => {
    const { data } = await reader.getModificatorsPage(10, { offset: 0, length: 100 })
    expect(data).toHaveLength(42)
    expect(data[0]).toMatchObject({ mod_id: 47, mod_name: 'Alternative Milk' })
    expect(mock.requests[0]).toMatchObject({
      methods: ['Modificators_getlist'],
      bid: '10',
      params: { filters: {}, extra_properties: ['categories'], offset: '0', length: '100' },
    })
  })

  it('getArticleDetailsTree: the characteristic keys, installation-wide', async () => {
    const { data } = await reader.getArticleDetailsTree()
    expect(data[0]?.details.k102).toMatchObject({ detail_name: 'Алергени', type: 'text' })
    expect(mock.requests[0]).toMatchObject({ bid: null, params: {} })
  })

  it('getPlaces: place_num stays text', async () => {
    const { data } = await reader.getPlaces(10)
    expect(data).toHaveLength(92)
    expect(data.map((place) => place.place_num)).toContain('VIP')
    expect(data.every((place) => typeof place.place_num === 'string')).toBe(true)
    expect(mock.requests[0]).toMatchObject({ methods: ['Places_getlist'], bid: '10' })
  })

  it('every wrapper sends only methods on the read allowlist, with credentials', async () => {
    await reader.getVenues()
    await reader.getLanguages()
    await reader.getCurrencies()
    await reader.getCategoryTree(10)
    await reader.getArticlesPage(10, { rootCatId: 1091, offset: 0, length: 60 })
    await reader.getSupplements(10, '7183')
    await reader.getModificatorsPage(10, { offset: 0, length: 50 })
    await reader.getArticleDetailsTree()
    await reader.getPlaces(10)
    expect(mock.requests.map((request) => request.methods[0])).toStrictEqual(Object.keys(FILES))
    expect(mock.requests.every((request) => request.authorization?.startsWith('Basic '))).toBe(true)
  })
})

describe('validation', () => {
  it('rejects a response whose used fields have the wrong shape, naming the path but not the body', async () => {
    const articles = JSON.parse(byMethod('Articles_getlist').body) as Record<string, unknown>[]
    articles[3] = { ...articles[3], article_id: 'not-a-number' }
    mock.setFixtures([{ ...byMethod('Articles_getlist'), body: JSON.stringify(articles) }])
    const error = await reader
      .getArticlesPage(10, { rootCatId: 1091, offset: 0, length: 60 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BarsyResponseError)
    expect((error as BarsyResponseError).issues).toMatchObject([
      { path: '3.article_id', code: 'invalid_type' },
    ])
    expect((error as Error).message).not.toContain('not-a-number')
  })

  it('accepts an integer price and a long decimal: number | exact decimal text', async () => {
    const articles = JSON.parse(byMethod('Articles_getlist').body) as Record<string, unknown>[]
    const body = JSON.stringify([articles[1]]).replace('"actual_price":0.97', '"actual_price":3')
    mock.setFixtures([{ ...byMethod('Articles_getlist'), body }])
    const { data } = await reader.getArticlesPage(10, { rootCatId: 1091, offset: 0, length: 1 })
    expect(data[0]?.actual_price).toBe(3)
  })

  it('refuses a bad page or article id before sending anything', async () => {
    const articles = (offset: number, length: number, rootCatId = 1091) =>
      reader.getArticlesPage(10, { rootCatId, offset, length })
    await expect(articles(-1, 10)).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(articles(0, 0)).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(articles(0, 1001)).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(articles(0.5, 10)).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(articles(0, 10, -5)).rejects.toBeInstanceOf(BarsyConfigError)
    await expect(
      reader.getModificatorsPage(10, { offset: 0, length: 5000 }),
    ).rejects.toBeInstanceOf(BarsyConfigError)
    for (const id of ['', '0', '12a', '1 2', '-3', 1.5]) {
      await expect(reader.getSupplements(10, id), String(id)).rejects.toBeInstanceOf(
        BarsyConfigError,
      )
    }
    expect(mock.requests).toHaveLength(0)
  })
})
