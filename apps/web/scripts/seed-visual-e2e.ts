// Fixtures for the accessibility and visual audit of the Editorial Market (brief SH-07). Five
// menus, one per theme (the designer's four presets and one made from three colours), with the
// same content: photo cards in the strip and in every layout, a sold-out and a scheduled item, a
// 60-character Cyrillic name with a photo and one without, a dish with all fourteen allergens and
// two groups of choices, a sub-section, tags and dietary labels for the filter sheet, and a table
// code. They are written straight into the e2e publish folder (`LOCAL_PUBLISH_DIR`) as the files
// the guest page reads, like the look fixture of seed-guest-e2e.ts: no venue row, a fixed public
// code each (e2e/visual-fixtures.ts), and the photos are drawn here and saved as webp variants.
//
// Takes the template to draw as an argument (`seed-visual-e2e.ts qr-phone`, T89): the snapshots then
// carry `presentation.face`. Without one they carry none, and the guest page draws the default
// template (Editorial Market).
//
// Idempotent; touches no database. Like the other seeds it refuses to run unless NODE_ENV is
// development and DATABASE_URL points at this machine.
import { createRequire } from 'node:module'

import {
  createPublishStore,
  currentPath,
  livePath,
  publishPutOptions,
  publishStoreConfig,
  snapshotPath,
  variantPath,
  venueIndexBytes,
  venueIndexPath,
  writeTableTokenFile,
} from '@restro/assets'
import {
  ALLERGENS,
  type AssetId,
  deriveRoles,
  hashTableCode,
  type MenuSnapshot,
  type NodeId,
  type SnapshotId,
  snapshotContentHash,
  snapshotPalette,
  THEME_PRESETS,
  type VenueId,
} from '@restro/core'
import { fixtureId, snapshotFromSpec } from '@restro/shell/testing'

import {
  CUSTOM_COLOURS,
  isFaceId,
  LOGO_MARKS,
  LONG_NAME_BG,
  LONG_NAME_EN,
  LONG_TEXT_NAME_BG,
  LONG_TEXT_NAME_EN,
  VISUAL_ITEMS,
  VISUAL_SLUG,
  VISUAL_TABLE_LABEL,
  VISUAL_THEMES,
  type VisualTheme,
} from '../e2e/visual-fixtures'
import { assertDevEnvironment } from './lib/guard'

// sharp belongs to the worker (it makes the photo variants); this script borrows its copy.
const sharp = createRequire(new URL('../../worker/package.json', import.meta.url))('sharp') as (
  input: Buffer,
) => {
  resize(width: number): { webp(options: { quality: number }): { toBuffer(): Promise<Buffer> } }
}

const bgen = (bg: string, en: string) => ({ bg_BG: bg, en_US: en })

/** Closed except for one minute a day, so the item reads "scheduled" whatever day the test runs. */
const NEARLY_NEVER = {
  timezone: 'Europe/Sofia',
  rules: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '04:00', to: '04:01' }],
}

/** The photos: gradient artwork in different shapes (a tall one has a focal point). */
const PHOTOS = [
  { n: 1, w: 1600, h: 1200, colours: ['#f97316', '#be123c'], alt: bgen('Негрони', 'Negroni') },
  { n: 2, w: 1600, h: 1200, colours: ['#fbbf24', '#ea580c'], alt: bgen('Спритц', 'Spritz') },
  { n: 3, w: 1200, h: 1600, colours: ['#34d399', '#065f46'], alt: bgen('Мохито', 'Mojito') },
  { n: 4, w: 1600, h: 1200, colours: ['#fcd34d', '#92400e'], alt: bgen('Бира', 'Beer') },
  {
    n: 5,
    w: 2000,
    h: 900,
    colours: ['#a78bfa', '#4c1d95'],
    alt: bgen('Бирена градина', 'Beer garden'),
  },
  { n: 6, w: 1600, h: 1200, colours: ['#38bdf8', '#1e3a8a'], alt: bgen('Шот', 'Shot') },
  // The venue's logo, as wide as the logos of the demo venue.
  {
    n: 7,
    w: 640,
    h: 200,
    colours: ['#2563eb', '#1e3a8a'],
    alt: bgen('Логото на клуба', 'The club logo'),
  },
] as const
const photo = (n: number) => fixtureId('as', n)

/**
 * D109: the two logos with no background, one white and one black. Only their image files are
 * written: a snapshot may not name an asset that nothing uses, so the matrix swaps one in for the
 * logo it has (it serves the snapshot with that one asset moved to the new id).
 */
const MARKS = [
  { id: LOGO_MARKS.white, ink: '#ffffff' },
  { id: LOGO_MARKS.black, ink: '#000000' },
] as const
/** The size of a mark: as wide as the logos of the demo venue. */
const MARK_SIZE = { w: 640, h: 200 } as const

/** A club mark in one colour on a transparent ground: a ring and two bars. */
function markArtwork(width: number, height: number, ink: string) {
  const r = height * 0.36
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <circle cx="${height / 2}" cy="${height / 2}" r="${r}" fill="none" stroke="${ink}" stroke-width="${height * 0.1}"/>
    <rect x="${height * 1.05}" y="${height * 0.3}" width="${width * 0.55}" height="${height * 0.12}" fill="${ink}"/>
    <rect x="${height * 1.05}" y="${height * 0.56}" width="${width * 0.38}" height="${height * 0.12}" fill="${ink}"/>
  </svg>`
  return Buffer.from(svg)
}

function artwork(width: number, height: number, [from, to]: readonly [string, string]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <circle cx="${width * 0.68}" cy="${height * 0.42}" r="${height * 0.22}" fill="#ffffff" fill-opacity="0.28"/>
    <circle cx="${width * 0.34}" cy="${height * 0.66}" r="${height * 0.15}" fill="#000000" fill-opacity="0.18"/>
  </svg>`
  return Buffer.from(svg)
}

/** The menu every theme shares: sections, items, tags and the sub-section's items (moved below). */
function menuSpec(): Parameters<typeof snapshotFromSpec>[0] {
  const signature = fixtureId('tg', 1)
  const spicy = fixtureId('tg', 2)
  return {
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    menuTitle: bgen('Визуален клуб', 'Visual Club'),
    assets: Object.fromEntries(
      PHOTOS.map((entry) => [
        photo(entry.n),
        {
          w: entry.w,
          h: entry.h,
          focal: entry.n === 3 ? { x: 0.3, y: 0.7 } : null,
          alt: entry.alt,
        },
      ]),
    ),
    tags: { [signature]: bgen('Фирмено', 'Signature'), [spicy]: bgen('Люто', 'Spicy') },
    // The logo is the one asset no item uses; the snapshot must name it to accept it.
    theme: { logo: photo(7) },
    features: {
      filters: true,
      call_waiter: { enabled: false, kinds: [] },
      bill: false,
      ordering: false,
      pay: false,
    },
    // The menu starts in two columns and guests may switch it; the cocktails are the photo-led
    // strip (D92: a menu setting and a section marked horizontal in the composer, brief S6), so
    // the audit sees every layout and the strip.
    layout: { default: 'two', guest_switch: true },
    sections: [
      {
        title: bgen('Коктейли', 'Cocktails'),
        layout: 'horizontal',
        description: bgen('Авторски коктейли от нашия бар.', 'Signature cocktails from our bar.'),
        items: [
          {
            name: bgen(VISUAL_ITEMS.negroni, 'Negroni'),
            description: bgen(
              'Джин, Кампари и червен вермут: горчиво, наситено и класическо, сервирано върху голям леден къс с резен портокал.',
              'Gin, Campari and red vermouth: bitter, rich and classic, served over one large ice cube with an orange slice.',
            ),
            image: photo(1),
            badges: ['new'],
            dietary: ['vegan', 'gluten_free'],
            tags: [signature],
            allergens: ['sulphites'],
            portion: { value: 90, unit: 'ml' },
            price: 1250,
          },
          {
            name: bgen('Апероль Спритц', 'Aperol Spritz'),
            description: bgen('Апероль, просеко и сода.', 'Aperol, prosecco and soda.'),
            image: photo(2),
            allergens: ['sulphites'],
            tags: [spicy],
            price: 1100,
          },
          {
            name: bgen('Мохито', 'Mojito'),
            image: photo(3),
            allergens: [],
            price: 1000,
          },
          { name: bgen('Дайкири', 'Daiquiri'), allergens: [], price: 950 },
        ],
      },
      {
        title: bgen('Бира', 'Beer'),
        description: bgen(
          'Наливна и бутилирана, студена като лед.',
          'On tap and bottled, ice cold.',
        ),
        image: photo(5),
        items: [
          {
            name: bgen('Загорка 500 мл', 'Zagorka 500 ml'),
            description: bgen('Светла бира.', 'A light lager.'),
            image: photo(4),
            allergens: ['gluten'],
            price: 480,
          },
          {
            name: bgen(VISUAL_ITEMS.soldOut, 'Wheat beer'),
            image: photo(4),
            soldOut: true,
            allergens: ['gluten'],
            price: 650,
          },
          {
            name: bgen(VISUAL_ITEMS.scheduled, 'Late-night shot'),
            image: photo(6),
            schedule: NEARLY_NEVER,
            allergens: [],
            price: 300,
          },
          {
            name: { bg_BG: LONG_NAME_BG, en_US: LONG_NAME_EN },
            image: photo(1),
            allergens: ['sulphites'],
            price: 1390,
          },
          { name: bgen('Светла бира', 'Lager'), allergens: ['gluten'], price: 400 },
          {
            name: bgen('Тъмна бира', 'Dark beer'),
            soldOut: true,
            allergens: ['gluten'],
            price: 450,
          },
        ],
      },
      {
        title: bgen('Храна', 'Food'),
        items: [
          {
            name: bgen(VISUAL_ITEMS.platter, 'Sharing platter'),
            description: bgen(
              'Плато за двама до четирима: сирена, колбаси, хляб, ядки и сос по избор.',
              'A platter for two to four: cheese, cured meats, bread, nuts and a sauce of your choice.',
            ),
            image: photo(2),
            allergens: [...ALLERGENS],
            dietary: ['vegetarian'],
            price: 3200,
            groups: [
              {
                name: bgen('Сос', 'Sauce'),
                min: 1,
                max: 1,
                options: [
                  { name: bgen('Хрян', 'Horseradish'), delta: null },
                  { name: bgen('Горчица', 'Mustard'), delta: 0 },
                  { name: bgen('Чили', 'Chilli'), delta: 100 },
                  { name: bgen('Трюфел', 'Truffle'), delta: 300 },
                ],
              },
              {
                name: bgen('Добавки', 'Extras'),
                min: 0,
                max: 3,
                options: [
                  { name: bgen('Маслини', 'Olives'), delta: 200 },
                  { name: bgen('Печен чесън', 'Roast garlic'), delta: 150 },
                  { name: bgen('Мед', 'Honey'), delta: 100 },
                ],
              },
            ],
          },
          {
            name: { bg_BG: LONG_TEXT_NAME_BG, en_US: LONG_TEXT_NAME_EN },
            allergens: ['milk'],
            price: 2400,
          },
          {
            name: bgen('Пържени картофки', 'Fries'),
            allergens: [],
            dietary: ['vegan'],
            tags: [spicy],
            price: 700,
          },
          { name: bgen('Бутилка водка', 'Bottle of vodka'), price: 12000, askWaiter: true },
        ],
      },
      {
        // Moved under "Храна" below: the builder makes top-level sections only.
        title: bgen('Предястия', 'Starters'),
        items: [
          {
            name: bgen('Хумус', 'Hummus'),
            image: photo(3),
            allergens: ['sesame'],
            dietary: ['vegan'],
            price: 700,
          },
          { name: bgen('Кюфтета', 'Meatballs'), allergens: ['gluten', 'eggs'], price: 800 },
        ],
      },
      {
        title: bgen('Безалкохолни', 'Soft drinks'),
        items: [
          { name: bgen('Лимонада', 'Lemonade'), allergens: [], price: 450 },
          { name: bgen('Вода', 'Water'), allergens: [], price: 250 },
        ],
      },
    ],
  }
}

/** The base snapshot with its "Предястия" section moved under "Храна", ids and look of one theme. */
function snapshotOf(theme: VisualTheme, index: number, face: string | null): MenuSnapshot {
  const base = snapshotFromSpec(menuSpec())
  const sectionIds = Object.keys(base.sections)
  const food = sectionIds[2]
  const starters = sectionIds[3]
  if (food === undefined || starters === undefined) throw new Error('the fixture lost a section')
  const foodSection = base.sections[food]
  if (foodSection === undefined) throw new Error('the fixture lost its food section')
  const sections = {
    ...base.sections,
    [food]: { ...foodSection, sections: [starters] },
  }
  const menuSections = base.menu.sections.filter((id) => id !== starters)

  const preset = THEME_PRESETS.find((entry) => entry.id === theme.id)
  const roles = preset !== undefined ? preset.overrides : deriveRoles(CUSTOM_COLOURS)
  const tertiary = preset !== undefined ? preset.colours.tertiary : CUSTOM_COLOURS.tertiary
  const ids = {
    snapshot: `sn_${`E2eVisual${theme.id}`.padEnd(22, '0')}`,
    menu: `nd_${`E2eVisualMenu${index}`.padEnd(22, '0')}`,
    venue: `vn_${`E2eVisualVenue${index}`.padEnd(22, '0')}`,
  }
  const content: Omit<MenuSnapshot, 'snapshot'> = {
    ...base,
    sections,
    menu: {
      ...base.menu,
      id: ids.menu,
      sections: menuSections,
      intro: bgen(
        'Добре дошли! Менюто се обновява през нощта.',
        'Welcome! The menu is updated through the night.',
      ),
    },
    theme: {
      ...base.theme,
      palette: snapshotPalette(tertiary),
      font: 'Inter',
      logo: photo(7),
      radius: preset?.radius ?? 12,
      shadow: 1,
      roles: { light: roles.light, dark: roles.dark },
      scheme: 'auto',
    },
    ...(face === null ? {} : { presentation: { face, options: {} } }),
  }
  return {
    ...content,
    snapshot: {
      ...base.snapshot,
      id: ids.snapshot,
      menu_id: ids.menu,
      venue_id: ids.venue,
      hash: snapshotContentHash(content),
    },
  } as MenuSnapshot
}

async function main(): Promise<void> {
  assertDevEnvironment(process.env)
  const [face = null] = process.argv.slice(2)
  if (face !== null && !isFaceId(face)) {
    throw new Error(`the template must be an id such as "qr-phone", not "${face}"`)
  }
  for (const text of [LONG_NAME_BG, LONG_NAME_EN, LONG_TEXT_NAME_BG, LONG_TEXT_NAME_EN]) {
    if ([...text].length !== 60)
      throw new Error(`a long fixture name is not 60 characters: ${text}`)
  }
  const config = publishStoreConfig(process.env)
  if (config.kind !== 'local') throw new Error('the e2e publish store must be local')
  const store = await createPublishStore(config)
  const put = (file: string, value: unknown) =>
    store.put(file, new TextEncoder().encode(JSON.stringify(value)), publishPutOptions(file))

  // The photos, once: the three widths the snapshot names (320, 640 and 1280).
  for (const entry of PHOTOS) {
    const source = artwork(entry.w, entry.h, entry.colours)
    for (const width of [320, 640, 1280]) {
      const path = variantPath(photo(entry.n) as AssetId, width)
      const bytes = await sharp(source).resize(width).webp({ quality: 70 }).toBuffer()
      await store.put(path, bytes, publishPutOptions(path))
    }
  }
  // The marks have an alpha channel, which webp keeps.
  for (const entry of MARKS) {
    const source = markArtwork(MARK_SIZE.w, MARK_SIZE.h, entry.ink)
    for (const width of [320, 640, 1280]) {
      const path = variantPath(entry.id as AssetId, width)
      const bytes = await sharp(source).resize(width).webp({ quality: 80 }).toBuffer()
      await store.put(path, bytes, publishPutOptions(path))
    }
  }

  for (const [index, theme] of VISUAL_THEMES.entries()) {
    const snapshot = snapshotOf(theme, index + 1, face)
    const menuId = snapshot.snapshot.menu_id as NodeId
    const venueId = snapshot.snapshot.venue_id as VenueId
    await put(snapshotPath(snapshot.snapshot.id as SnapshotId), snapshot)
    await put(currentPath(menuId, venueId), {
      snapshot_id: snapshot.snapshot.id,
      version: snapshot.snapshot.version,
      hash: snapshot.snapshot.hash,
    })
    await put(livePath(menuId, venueId), { version: snapshot.snapshot.version, items: {} })
    await store.put(
      venueIndexPath(theme.publicId),
      venueIndexBytes({ venue_id: venueId, menu_id: menuId, slug: VISUAL_SLUG }),
      publishPutOptions(venueIndexPath(theme.publicId)),
    )
    await writeTableTokenFile(store, await hashTableCode(theme.table), {
      venue_public_id: theme.publicId,
      venue_slug: VISUAL_SLUG,
      table_label: VISUAL_TABLE_LABEL,
    })
  }
  console.log(
    JSON.stringify({ level: 'info', event: 'seed_visual_e2e_done', themes: VISUAL_THEMES.length }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`seed-visual-e2e failed: ${error instanceof Error ? error.stack : String(error)}`)
    process.exit(1)
  })
