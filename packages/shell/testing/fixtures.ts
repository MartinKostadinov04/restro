// Fixture snapshots for the face contract tests (doc "Contract tests"): the hard cases every face
// must render. Each one is built here with deterministic ids and then parsed by S3-01a's strict
// schema (`parseSnapshot`), so a fixture that drifts from the published contract fails at once.
// Built fresh on every call: a test may change what it gets.

import {
  ALLERGENS,
  type Allergen,
  type AssetId,
  assetVariantPath,
  DIETARY_LABELS,
  type DietaryLabel,
  type LiveOverlay,
  type Locale,
  type LocalizedText,
  type MenuSnapshot,
  parseSnapshot,
  snapshotContentHash,
} from '@restro/core'

import type { ShellContextInput } from '../src/context'

/** One fixture: a snapshot, the overlay and the context to build its view model with. */
export interface Fixture {
  readonly name: string
  readonly note: string
  readonly snapshot: MenuSnapshot
  readonly overlay: LiveOverlay | null
  readonly context: ShellContextInput
}

type Item = MenuSnapshot['items'][string]

export interface ItemSpec {
  name: LocalizedText
  description?: LocalizedText
  /** Minor units of EUR. */
  price?: number | null
  priceFrom?: number
  image?: string
  allergens?: readonly Allergen[]
  dietary?: readonly DietaryLabel[]
  tags?: readonly string[]
  portion?: Item['portion']
  badges?: Item['badges']
  soldOut?: boolean
  schedule?: Item['availability']['schedule']
  askWaiter?: boolean
  groups?: readonly GroupSpec[]
  fields?: Item['fields']
}

export interface GroupSpec {
  name: LocalizedText
  min: number
  max: number
  options: readonly { name: LocalizedText; delta?: number | null }[]
}

export interface SectionSpec {
  title: LocalizedText
  description?: LocalizedText
  image?: string
  color?: string
  items: readonly ItemSpec[]
}

export interface AssetSpec {
  w: number
  h: number
  focal?: { x: number; y: number } | null
  alt?: LocalizedText
}

/** What a test says about a snapshot; `snapshotFromSpec` fills in everything else. */
export interface SnapshotSpec {
  locales: { default: Locale; available: Locale[] }
  menuTitle?: LocalizedText
  menuAvailability?: MenuSnapshot['menu']['availability']
  sections: readonly SectionSpec[]
  assets?: Readonly<Record<string, AssetSpec>>
  tags?: Readonly<Record<string, LocalizedText>>
  fieldTypes?: MenuSnapshot['field_types']
  theme?: Partial<MenuSnapshot['theme']>
}

/** A deterministic id of the right shape: `nd_0000000000000000000042`. */
export function fixtureId(kind: 'nd' | 'as' | 'tg' | 'sn' | 'vn', n: number): string {
  return `${kind}_${String(n).padStart(22, '0')}`
}

const PALETTE = [
  '#fdf4f3',
  '#fbe8e6',
  '#f6d0cc',
  '#efaea7',
  '#e5827a',
  '#d65b51',
  '#b9443a',
  '#98372f',
  '#7e312b',
  '#6a2e29',
  '#391411',
]

/** Builds a snapshot from a spec with deterministic ids, validated by the snapshot schema. */
export function snapshotFromSpec(spec: SnapshotSpec): MenuSnapshot {
  let next = 1
  const nd = () => fixtureId('nd', next++)

  const assets: MenuSnapshot['assets'] = {}
  for (const [id, asset] of Object.entries(spec.assets ?? {})) {
    assets[id] = {
      w: asset.w,
      h: asset.h,
      focal: asset.focal ?? null,
      alt: asset.alt ?? {},
      variants: {
        thumb: assetVariantPath(id as AssetId, 320),
        card: assetVariantPath(id as AssetId, 640),
        full: assetVariantPath(id as AssetId, 1280),
      },
    }
  }

  const sections: MenuSnapshot['sections'] = {}
  const items: MenuSnapshot['items'] = {}
  const groups: MenuSnapshot['modifier_groups'] = {}
  const options: MenuSnapshot['options'] = {}
  const sectionIds: string[] = []

  for (const sectionSpec of spec.sections) {
    const sectionId = nd()
    sectionIds.push(sectionId)
    const itemIds: string[] = []
    for (const itemSpec of sectionSpec.items) {
      const itemId = nd()
      itemIds.push(itemId)
      const groupIds: string[] = []
      for (const groupSpec of itemSpec.groups ?? []) {
        const groupId = nd()
        groupIds.push(groupId)
        const optionIds: string[] = []
        for (const optionSpec of groupSpec.options) {
          const optionId = nd()
          optionIds.push(optionId)
          options[optionId] = {
            name: optionSpec.name,
            price_delta:
              optionSpec.delta === undefined || optionSpec.delta === null
                ? null
                : { amount_minor: optionSpec.delta, currency: 'EUR' },
          }
        }
        groups[groupId] = {
          name: groupSpec.name,
          min: groupSpec.min,
          max: groupSpec.max,
          options: optionIds,
        }
      }
      const price = itemSpec.price === undefined ? 500 : itemSpec.price
      const askWaiter = itemSpec.askWaiter === true
      items[itemId] = {
        name: itemSpec.name,
        description: itemSpec.description ?? {},
        price: price === null ? null : { amount_minor: price, currency: 'EUR' },
        price_from:
          itemSpec.priceFrom === undefined
            ? null
            : { amount_minor: itemSpec.priceFrom, currency: 'EUR' },
        image: itemSpec.image ?? null,
        allergens: [...(itemSpec.allergens ?? [])],
        dietary: [...(itemSpec.dietary ?? [])],
        tags: [...(itemSpec.tags ?? [])],
        portion: itemSpec.portion ?? null,
        badges: [...(itemSpec.badges ?? [])],
        availability: {
          state: itemSpec.soldOut === true ? 'sold_out' : 'available',
          schedule: itemSpec.schedule ?? null,
        },
        order_mode: askWaiter ? 'ask_waiter' : 'orderable',
        orderable: !askWaiter && price !== null && itemSpec.soldOut !== true,
        modifier_groups: groupIds,
        fields: itemSpec.fields ?? {},
      }
    }
    sections[sectionId] = {
      title: sectionSpec.title,
      description: sectionSpec.description ?? {},
      image: sectionSpec.image ?? null,
      hints: { color: sectionSpec.color ?? null, icon: null },
      sections: [],
      items: itemIds,
    }
  }

  const tags: MenuSnapshot['tags'] = {}
  for (const [id, label] of Object.entries(spec.tags ?? {})) tags[id] = { label }

  const menuId = nd()
  const content: Omit<MenuSnapshot, 'snapshot'> = {
    schema: 'menu-snapshot/1',
    locales: spec.locales,
    currency: 'EUR',
    theme: { palette: PALETTE, font: 'Inter', radius: 8, shadow: 1, logo: null, ...spec.theme },
    assets,
    field_types: spec.fieldTypes ?? {},
    menu: {
      id: menuId,
      title: spec.menuTitle ?? { [spec.locales.default]: 'Menu' },
      intro: {},
      availability: spec.menuAvailability ?? null,
      sections: sectionIds,
    },
    sections,
    items,
    modifier_groups: groups,
    options,
    tags,
  }
  return parseSnapshot({
    ...content,
    snapshot: {
      id: fixtureId('sn', 1),
      version: 1,
      hash: snapshotContentHash(content),
      published_at: '2026-10-08T21:04:12+03:00',
      menu_id: menuId,
      venue_id: fixtureId('vn', 1),
      edition: ['master'],
    },
  })
}

const BG_EN: { default: Locale; available: Locale[] } = {
  default: 'bg_BG',
  available: ['bg_BG', 'en_US'],
}

/** A Friday night 22:00 to 04:00 window, like a club's late menu. */
const LATE_NIGHT: NonNullable<Item['availability']['schedule']> = {
  timezone: 'Europe/Sofia',
  rules: [{ days: [5, 6], from: '22:00', to: '04:00' }],
}

/** Every day from 18:00 to 23:00. */
const EVENINGS: NonNullable<Item['availability']['schedule']> = {
  timezone: 'Europe/Sofia',
  rules: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '18:00', to: '23:00' }],
}

const bgen = (bg: string, en: string): LocalizedText => ({ bg_BG: bg, en_US: en })

/** A Wednesday at 20:30 in Sofia: the evening menu is open, the late-night one is not. */
const WEDNESDAY_EVENING = '2026-10-07T20:30:00+03:00'

function longNames(): Fixture {
  const sixty = (seed: string) => `${seed} ${'и'.repeat(60)}`.slice(0, 60)
  const sixtyEn = (seed: string) => `${seed} ${'x'.repeat(60)}`.slice(0, 60)
  return {
    name: 'long-names',
    note: 'Names of exactly 60 characters, in both languages, with and without prices.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      sections: [
        {
          title: bgen('Коктейли', 'Cocktails'),
          items: [
            {
              name: { bg_BG: sixty('Негрони'), en_US: sixtyEn('Negroni') },
              allergens: ['sulphites'],
            },
            { name: { bg_BG: sixty('Мохито') }, price: 1250, allergens: ['eggs', 'milk'] },
            { name: { en_US: sixtyEn('Espresso Martini') }, price: null, allergens: ['nuts'] },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'en_US', now: WEDNESDAY_EVENING },
  }
}

function sixLanguages(): Fixture {
  const available: Locale[] = ['bg_BG', 'en_US', 'de_DE', 'fr_FR', 'ru_RU', 'el_GR']
  return {
    name: 'six-languages',
    note: 'Six languages with gaps; the guest asks for French, which some texts lack.',
    snapshot: snapshotFromSpec({
      locales: { default: 'bg_BG', available },
      menuTitle: { bg_BG: 'Меню', en_US: 'Menu', fr_FR: 'Carte' },
      sections: [
        {
          title: { bg_BG: 'Бира', en_US: 'Beer', de_DE: 'Bier', fr_FR: 'Bière' },
          items: [
            {
              name: { bg_BG: 'Светла бира', en_US: 'Lager', de_DE: 'Helles', fr_FR: 'Blonde' },
              description: { bg_BG: 'Леко и свежо', en_US: 'Light and fresh', ru_RU: 'Лёгкое' },
              allergens: ['gluten'],
            },
            {
              name: { bg_BG: 'Тъмна бира', el_GR: 'Σκούρα μπύρα' },
              description: { de_DE: 'Dunkel und malzig' },
              allergens: ['gluten', 'sulphites'],
            },
            { name: { ru_RU: 'Пшеничное', de_DE: 'Weizen' }, allergens: ['gluten'] },
          ],
        },
        {
          title: { en_US: 'Wine', el_GR: 'Κρασί' },
          items: [{ name: { en_US: 'House red', el_GR: 'Κόκκινο' }, allergens: ['sulphites'] }],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'fr_FR', now: WEDNESDAY_EVENING },
  }
}

function noImages(): Fixture {
  return {
    name: 'no-images',
    note: 'No assets at all: every item uses the face’s no-image layout.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      sections: [
        {
          title: bgen('Храна', 'Food'),
          items: [
            { name: bgen('Пица', 'Pizza'), allergens: ['gluten', 'milk'], price: 1400 },
            { name: bgen('Салата', 'Salad'), allergens: [], price: 900 },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'bg_BG', now: WEDNESDAY_EVENING },
  }
}

function withImages(): Fixture {
  const photo = fixtureId('as', 1)
  const focal = fixtureId('as', 2)
  return {
    name: 'with-images',
    note: 'A photo, a photo with a focal point, and an item without one; a 2x screen.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      assets: {
        [photo]: { w: 1600, h: 1200, alt: { en_US: 'Negroni on ice' } },
        [focal]: { w: 1200, h: 1600, focal: { x: 0.3, y: 0.75 } },
      },
      sections: [
        {
          title: bgen('Коктейли', 'Cocktails'),
          items: [
            { name: bgen('Негрони', 'Negroni'), image: photo, allergens: ['sulphites'] },
            { name: bgen('Маргарита', 'Margarita'), image: focal, allergens: [] },
            { name: bgen('Вода', 'Water') },
          ],
        },
      ],
    }),
    overlay: null,
    context: {
      locale: 'en_US',
      now: WEDNESDAY_EVENING,
      images: { item: { variant: 'card', density: 2 } },
    },
  }
}

function soldOut(): Fixture {
  const snapshot = snapshotFromSpec({
    locales: BG_EN,
    sections: [
      {
        title: bgen('Коктейли', 'Cocktails'),
        items: [
          { name: bgen('Мохито', 'Mojito'), allergens: [] },
          { name: bgen('Негрони', 'Negroni'), soldOut: true, allergens: ['sulphites'] },
          { name: bgen('Дайкири', 'Daiquiri'), allergens: ['eggs'] },
        ],
      },
    ],
  })
  const [mojito, , daiquiri] = Object.keys(snapshot.items)
  return {
    name: 'sold-out',
    note: 'One item sold out in the snapshot, two more sold out by the live overlay.',
    snapshot,
    overlay: {
      version: snapshot.snapshot.version,
      items: {
        [mojito ?? '']: { sold_out: true },
        [daiquiri ?? '']: { sold_out: true },
      },
    },
    context: { locale: 'en_US', now: WEDNESDAY_EVENING },
  }
}

function scheduled(): Fixture {
  return {
    name: 'scheduled',
    note: 'A late-night item closed on a Wednesday evening and an evening item that is open.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      sections: [
        {
          title: bgen('Нощно меню', 'Late-night menu'),
          items: [
            { name: bgen('Шот', 'Shot'), schedule: LATE_NIGHT, allergens: [] },
            { name: bgen('Бургер', 'Burger'), schedule: EVENINGS, allergens: ['gluten', 'eggs'] },
            { name: bgen('Вода', 'Water'), allergens: [] },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'en_US', now: WEDNESDAY_EVENING },
  }
}

function big(): Fixture {
  const sections = Array.from({ length: 10 }, (_, s) => ({
    title: bgen(`Секция ${s + 1}`, `Section ${s + 1}`),
    items: Array.from({ length: 30 }, (_, i): ItemSpec => {
      const n = s * 30 + i + 1
      return {
        name: bgen(`Артикул ${n}`, `Item ${n}`),
        description: n % 3 === 0 ? bgen(`Описание ${n}`, `Description ${n}`) : {},
        price: 300 + n * 5,
        allergens: n % 4 === 0 ? [ALLERGENS[n % ALLERGENS.length] ?? 'milk'] : [],
        soldOut: n % 17 === 0,
      }
    }),
  }))
  return {
    name: 'big-menu',
    note: '300 items in 10 sections.',
    snapshot: snapshotFromSpec({ locales: BG_EN, sections }),
    overlay: null,
    context: { locale: 'bg_BG', now: WEDNESDAY_EVENING },
  }
}

function deepModifiers(): Fixture {
  const group = (n: number): GroupSpec => ({
    name: bgen(`Група ${n}`, `Group ${n}`),
    min: n % 2,
    max: 3,
    options: Array.from({ length: 6 }, (_, i) => ({
      name: bgen(`Опция ${n}.${i + 1}`, `Option ${n}.${i + 1}`),
      delta: i === 0 ? null : i * 100,
    })),
  })
  return {
    name: 'deep-modifiers',
    note: 'One item with four modifier groups of six options each, with price deltas.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      sections: [
        {
          title: bgen('Бургери', 'Burgers'),
          items: [
            {
              name: bgen('Бургер по избор', 'Build your burger'),
              price: 1200,
              priceFrom: 1300,
              allergens: ['gluten', 'eggs', 'milk'],
              groups: [group(1), group(2), group(3), group(4)],
            },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'en_US', now: WEDNESDAY_EVENING },
  }
}

function askWaiter(): Fixture {
  return {
    name: 'ask-waiter',
    note: 'An item guests cannot order by phone, beside an orderable one.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      sections: [
        {
          title: bgen('Бутилки', 'Bottles'),
          items: [
            { name: bgen('Бутилка водка', 'Bottle of vodka'), price: 12000, askWaiter: true },
            { name: bgen('Шот водка', 'Vodka shot'), price: 400 },
          ],
        },
      ],
    }),
    overlay: null,
    context: {
      locale: 'en_US',
      now: WEDNESDAY_EVENING,
      orderingEnabled: true,
      tableToken: 'fixture-table-token',
    },
  }
}

function tagsAndDietary(): Fixture {
  const signature = fixtureId('tg', 1)
  const spicy = fixtureId('tg', 2)
  return {
    name: 'tags-dietary',
    note: 'Tags, dietary labels, a new badge, a portion and custom fields in template order.',
    snapshot: snapshotFromSpec({
      locales: BG_EN,
      tags: { [signature]: bgen('Фирмено', 'Signature'), [spicy]: { en_US: 'Spicy' } },
      fieldTypes: {
        abv: { type: 'number', label: bgen('Алкохол', 'ABV'), unit: '%' },
        origin: { type: 'short_text', label: bgen('Произход', 'Origin'), unit: null },
        vegan_friendly: { type: 'boolean', label: bgen('Подходящо', 'Friendly'), unit: null },
      },
      sections: [
        {
          title: bgen('Коктейли', 'Cocktails'),
          items: [
            {
              name: bgen('Негрони', 'Negroni'),
              description: bgen('Джин, Кампари, вермут', 'Gin, Campari, vermouth'),
              allergens: ['sulphites'],
              dietary: ['vegan', 'gluten_free'],
              tags: [signature, spicy],
              portion: { value: 90, unit: 'ml' },
              badges: ['new'],
              fields: { abv: 24, origin: 'Italy', vegan_friendly: true },
            },
            {
              name: bgen('Хумус', 'Hummus'),
              allergens: ['sesame'],
              dietary: [...DIETARY_LABELS].slice(0, 2),
              fields: { origin: 'Lebanon' },
            },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale: 'bg_BG', now: WEDNESDAY_EVENING },
  }
}

/** All fixtures, freshly built. */
export function fixtures(): Fixture[] {
  return [
    longNames(),
    sixLanguages(),
    noImages(),
    withImages(),
    soldOut(),
    scheduled(),
    big(),
    deepModifiers(),
    askWaiter(),
    tagsAndDietary(),
  ]
}

/** One fixture by name. */
export function fixture(name: string): Fixture {
  const found = fixtures().find((candidate) => candidate.name === name)
  if (found === undefined) throw new Error(`no fixture named ${name}`)
  return found
}
