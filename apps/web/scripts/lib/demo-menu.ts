// The demo venue's menu for `pnpm db:seed:dev` and the e2e test: what a barsy pull would have
// produced for a small cocktail bar (four categories, twenty articles, two of them in no
// category), as data and as the change set that applies it. All external ids are made up. Pure:
// the seed script (../seed-dev.ts) does the database work, this file only describes the menu.
//
// Applying it goes through apply() like any pull: barsy-layer values citing a (fake) source
// record and mapping version 1, `category` and `article` links, placements at the end of the
// section. Running it again changes nothing.
import {
  type Allergen,
  type ChangeSet,
  type ChangeSetOp,
  type FieldWrite,
  type LocalizedText,
  type NodeId,
  newId,
  type SourceLink,
} from '@restro/core'

/** The fake mapping version the demo's barsy values record. */
export const DEMO_MAPPING_VERSION = 1

/** The host of the fake barsy installation (a reserved `.test` name: nothing ever resolves it). */
export const DEMO_BARSY_HOST = 'dev-seed.test'

export interface DemoSection {
  /** The fake barsy category id. */
  readonly externalId: string
  readonly title: LocalizedText
}

export interface DemoItem {
  /** The fake barsy article id. */
  readonly externalId: string
  /** Index into `DEMO_SECTIONS`, or null: in no category (it shows in Unsorted). */
  readonly section: number | null
  readonly bg: string
  readonly en?: string
  readonly priceMinor: number
  /** Allergens barsy holds; absent = barsy holds none for this article (check V4). */
  readonly allergens?: readonly Allergen[]
  /** barsy's own `is_public = false`: the composer cannot show it (rule 5). */
  readonly hiddenByBarsy?: true
  /** A description written here, in the manual layer. */
  readonly description?: LocalizedText
}

export const DEMO_SECTIONS: readonly DemoSection[] = [
  { externalId: '7101', title: { bg_BG: 'Коктейли', en_US: 'Cocktails' } },
  { externalId: '7102', title: { bg_BG: 'Бира', en_US: 'Beer' } },
  { externalId: '7103', title: { bg_BG: 'Безалкохолни', en_US: 'Soft drinks' } },
  { externalId: '7104', title: { bg_BG: 'Храна', en_US: 'Food' } },
]

export const DEMO_ITEMS: readonly DemoItem[] = [
  // Коктейли
  {
    externalId: '55001',
    section: 0,
    bg: 'Негрони',
    en: 'Negroni',
    priceMinor: 1050,
    allergens: [],
  },
  {
    externalId: '55002',
    section: 0,
    bg: 'Аперол Шприц',
    en: 'Aperol Spritz',
    priceMinor: 1100,
    allergens: ['sulphites'],
  },
  { externalId: '55003', section: 0, bg: 'Мохито', priceMinor: 950 },
  {
    externalId: '55004',
    section: 0,
    bg: 'Дайкири',
    en: 'Daiquiri',
    priceMinor: 900,
    allergens: [],
    description: {
      bg_BG: 'Класически ром, лайм и захар: леко и свежо.',
      en_US: 'Classic rum, lime and sugar: light and fresh.',
    },
  },
  { externalId: '55005', section: 0, bg: 'Маргарита', priceMinor: 1000 },
  { externalId: '55006', section: 0, bg: 'Космополитан', en: 'Cosmopolitan', priceMinor: 1050 },
  { externalId: '55007', section: 0, bg: 'Пиня Колада', priceMinor: 1100, allergens: ['milk'] },
  // Бира
  { externalId: '55008', section: 1, bg: 'Загорка 500 мл', priceMinor: 450, allergens: ['gluten'] },
  {
    externalId: '55009',
    section: 1,
    bg: 'Каменица 500 мл',
    en: 'Kamenitza 500 ml',
    priceMinor: 450,
    allergens: ['gluten'],
  },
  {
    externalId: '55010',
    section: 1,
    bg: 'Хайнекен 330 мл',
    priceMinor: 550,
    allergens: ['gluten'],
  },
  {
    externalId: '55011',
    section: 1,
    bg: 'Гинес 440 мл',
    en: 'Guinness 440 ml',
    priceMinor: 700,
    allergens: ['gluten'],
    hiddenByBarsy: true,
  },
  {
    externalId: '55012',
    section: 1,
    bg: 'Крафт IPA 330 мл',
    en: 'Craft IPA 330 ml',
    priceMinor: 800,
    allergens: ['gluten'],
  },
  // Безалкохолни
  {
    externalId: '55013',
    section: 2,
    bg: 'Кока-Кола 250 мл',
    en: 'Coca-Cola 250 ml',
    priceMinor: 400,
  },
  { externalId: '55014', section: 2, bg: 'Натурален сок 250 мл', priceMinor: 500 },
  {
    externalId: '55015',
    section: 2,
    bg: 'Минерална вода 500 мл',
    en: 'Mineral water 500 ml',
    priceMinor: 300,
    allergens: [],
  },
  { externalId: '55016', section: 2, bg: 'Ред Бул 250 мл', en: 'Red Bull 250 ml', priceMinor: 600 },
  // Храна
  {
    externalId: '55017',
    section: 3,
    bg: 'Начос със сирене',
    en: 'Nachos with cheese',
    priceMinor: 900,
    allergens: ['gluten', 'milk'],
  },
  {
    externalId: '55018',
    section: 3,
    bg: 'Пилешки крилца',
    priceMinor: 1200,
    allergens: ['celery', 'mustard'],
  },
  {
    externalId: '55019',
    section: 3,
    bg: 'Пица Маргарита',
    en: 'Pizza Margherita',
    priceMinor: 1300,
    allergens: ['gluten', 'milk'],
  },
  { externalId: '55020', section: 3, bg: 'Пържени картофки', priceMinor: 600, allergens: [] },
  // In no category: they land in Unsorted.
  { externalId: '55021', section: null, bg: 'Текила шот', en: 'Tequila shot', priceMinor: 500 },
]

/** The one item made here, with no barsy counterpart (also in Unsorted): "Owned here". */
export const DEMO_OWNED_ITEM = {
  name: { bg_BG: 'Лимонада на къщата', en_US: 'House lemonade' } satisfies LocalizedText,
  description: {
    bg_BG: 'Прясно изцедени лимони, мента и лед.',
    en_US: 'Freshly squeezed lemons, mint and ice.',
  } satisfies LocalizedText,
} as const

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })

/** The tier-1 records the demo cites: one per category and article, exactly as "barsy" sent them. */
export function demoSourceRecords(): {
  externalType: 'category' | 'article'
  externalId: string
  raw: string
  payload: unknown
}[] {
  return [
    ...DEMO_SECTIONS.map((section) => {
      const payload = {
        fake: true,
        cat_id: Number(section.externalId),
        cat_name_public: section.title.bg_BG,
      }
      return {
        externalType: 'category' as const,
        externalId: section.externalId,
        raw: JSON.stringify(payload),
        payload,
      }
    }),
    ...DEMO_ITEMS.map((item) => {
      const payload = {
        fake: true,
        article_id: Number(item.externalId),
        article_name: item.bg,
        actual_price: item.priceMinor / 100,
      }
      return {
        externalType: 'article' as const,
        externalId: item.externalId,
        raw: JSON.stringify(payload),
        payload,
      }
    }),
  ]
}

/** Inputs of `demoPullChangeSet`: who, where, and the ids of the records to cite. */
export interface DemoPullInput {
  readonly integrationId: string
  readonly venueId: string
  readonly menuId: NodeId
  /** `sr_` id of the record of each category / article, by external id. */
  readonly categoryRecords: ReadonlyMap<string, string>
  readonly articleRecords: ReadonlyMap<string, string>
  readonly observedAt?: string
}

/**
 * What a pull of the demo catalogue produces: the sections and items with their links, the
 * barsy-layer values (price and for-sale for this venue) and the placements at the end of each
 * section. Item names carry English only where "barsy holds it".
 */
export function demoPullChangeSet(input: DemoPullInput): ChangeSet {
  const { integrationId, venueId, menuId } = input
  const link = (externalType: 'category' | 'article', externalId: string): SourceLink => ({
    integration: integrationId,
    externalType,
    externalId,
  })
  const venueScope = `venue:${venueId}` as const
  const ops: ChangeSetOp[] = []

  for (const section of DEMO_SECTIONS) {
    const ref = link('category', section.externalId)
    const id = newId('nd')
    // On a second run the createNode and its link collapse onto the node that already exists.
    ops.push(
      {
        op: 'createNode',
        id,
        nodeType: 'section',
        parent: { id: menuId },
        status: 'active',
        sortKey: 'end',
      },
      { op: 'linkSource', node: { id }, link: ref },
      {
        op: 'setField',
        node: { link: ref },
        fieldKey: 'title',
        layer: 'barsy',
        scope: 'master',
        value: section.title,
        sourceRecordId: input.categoryRecords.get(section.externalId) ?? '',
        mappingVersion: DEMO_MAPPING_VERSION,
      },
    )
  }

  for (const item of DEMO_ITEMS) {
    const ref = link('article', item.externalId)
    const record = input.articleRecords.get(item.externalId) ?? ''
    const id = newId('nd')
    const barsyField = (
      fieldKey: string,
      value: FieldWrite['value'],
      scope: 'master' | `venue:${string}` = 'master',
    ): ChangeSetOp => ({
      op: 'setField',
      node: { link: ref },
      fieldKey,
      layer: 'barsy',
      scope,
      value,
      sourceRecordId: record,
      mappingVersion: DEMO_MAPPING_VERSION,
    })
    ops.push(
      { op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' },
      { op: 'linkSource', node: { id }, link: ref },
      barsyField('name', item.en ? { bg_BG: item.bg, en_US: item.en } : { bg_BG: item.bg }),
      barsyField('price', eur(item.priceMinor), venueScope),
      barsyField('for_sale', true, venueScope),
      barsyField('visible', item.hiddenByBarsy !== true),
    )
    if (item.allergens) ops.push(barsyField('allergens', [...item.allergens]))
    if (item.section !== null) {
      const section = DEMO_SECTIONS[item.section]
      if (!section)
        throw new Error(`demo item ${item.externalId} names a section that is not there`)
      ops.push({
        op: 'setPlacement',
        item: { link: ref },
        section: { link: link('category', section.externalId) },
        sortKey: 'end',
      })
    }
  }

  return {
    id: newId('cs'),
    source: `barsy:${integrationId}`,
    jobId: newId('jb'),
    actor: `integration:${integrationId}`,
    observedAt: input.observedAt ?? new Date().toISOString(),
    ops,
  }
}

/** The descriptions written here (manual layer) on items the pull created, by external id. */
export function demoManualChangeSet(input: {
  userId: string
  nodeIdByArticle: ReadonlyMap<string, NodeId>
  observedAt?: string
}): ChangeSet | null {
  const ops: ChangeSetOp[] = []
  for (const item of DEMO_ITEMS) {
    const node = input.nodeIdByArticle.get(item.externalId)
    if (!item.description || !node) continue
    ops.push({
      op: 'setField',
      node: { id: node },
      fieldKey: 'description',
      layer: 'manual',
      scope: 'master',
      value: item.description,
    })
  }
  if (ops.length === 0) return null
  return {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: `user:${input.userId}`,
    observedAt: input.observedAt ?? new Date().toISOString(),
    ops,
  }
}

/** The hand-made item: created, named and described in the manual layer. */
export function demoOwnedItemChangeSet(input: {
  userId: string
  itemId: NodeId
  observedAt?: string
}): ChangeSet {
  const base = {
    op: 'setField',
    node: { id: input.itemId },
    layer: 'manual',
    scope: 'master',
  } as const
  return {
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: `user:${input.userId}`,
    observedAt: input.observedAt ?? new Date().toISOString(),
    ops: [
      { op: 'createNode', id: input.itemId, nodeType: 'item', parent: null, status: 'active' },
      { ...base, fieldKey: 'name', value: DEMO_OWNED_ITEM.name },
      { ...base, fieldKey: 'description', value: DEMO_OWNED_ITEM.description },
    ],
  }
}
