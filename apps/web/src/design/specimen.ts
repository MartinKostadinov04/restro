// What an option's tile draws (D130, ticket 8): a specimen of a few of the venue's items, never the
// whole menu, with the option's value swapped in and the draft's colours and body font around it.
//
// The specimen is the venue's own draft snapshot cut down (two sections, three items each) and dressed
// with demo content where the venue has none, so that a Photos tile shows a photo and a Labels tile
// shows labels even on a menu that has neither yet. The demo content is a make-believe picture, a
// description, a portion and a few labels, never a real price, and it exists only in this browser's
// frame: nothing here is saved or published. The demo photo is a file of the app (`/design-demo`), so
// the frame is given that folder as its photo base (`DEMO_ASSET_BASE`).
import {
  ALLERGENS,
  type AssetId,
  CALL_WAITER_KINDS,
  DEFAULT_GUEST_FEATURES,
  type GuestFeatures,
  type Locale,
  type MenuSnapshot,
  NEW_BADGE,
} from '@restro/core'

/** Where the demo photo's files are served from. The frame's photo base while it draws a specimen. */
export const DEMO_ASSET_BASE = '/design-demo'

const DEMO_ASSET = 'as_DemoPhoto000000000000A' as AssetId

/** How much of the menu a tile draws. */
export const TILE_SECTIONS = 2
export const TILE_ITEMS = 3

type Item = MenuSnapshot['items'][string]

const SAMPLE_DESCRIPTION: Readonly<Record<'en' | 'bg', string>> = {
  en: 'Made to order with fresh, seasonal produce. Served with house bread and a little something on the side, as the kitchen likes it.',
  bg: 'Приготвя се на момента от пресни сезонни продукти. Сервира се с домашен хляб и малко допълнение, както го обича кухнята.',
}

/** A text for each language the menu has: the English sample for English, the Bulgarian for the rest. */
function sampleText(locales: readonly Locale[]): Partial<Record<Locale, string>> {
  const text: Partial<Record<Locale, string>> = {}
  for (const locale of locales) {
    text[locale] = locale.startsWith('bg') ? SAMPLE_DESCRIPTION.bg : SAMPLE_DESCRIPTION.en
  }
  return text
}

/** The draft cut down to what a tile shows. */
export function cutDown(
  draft: MenuSnapshot,
  { sections = TILE_SECTIONS, items = TILE_ITEMS }: { sections?: number; items?: number } = {},
): MenuSnapshot {
  const kept = draft.menu.sections.slice(0, sections)
  const cut = Object.fromEntries(
    Object.entries(draft.sections).map(([id, section]) => [
      id,
      { ...section, items: section.items.slice(0, items) },
    ]),
  ) as MenuSnapshot['sections']
  return { ...draft, menu: { ...draft.menu, sections: kept }, sections: cut }
}

/** The services a tile of a guest-feature screen draws: all of them on, whatever the venue chose. */
export function allFeatures(base: GuestFeatures | undefined): GuestFeatures {
  const features = base ?? DEFAULT_GUEST_FEATURES
  return {
    ...features,
    call_waiter: {
      enabled: true,
      kinds:
        features.call_waiter.kinds.length > 0 ? features.call_waiter.kinds : [...CALL_WAITER_KINDS],
    },
    bill: true,
    ordering: true,
    pay: true,
  }
}

/** The item as a specimen: orderable, with a picture and the parts a design styles. */
function dressedItem(item: Item, index: number, draft: MenuSnapshot): Item {
  const locales = draft.locales.available
  const noPhoto = { ...item, image: DEMO_ASSET }
  return {
    ...noPhoto,
    description:
      Object.keys(item.description).length === 0 ? sampleText(locales) : item.description,
    price: item.price ?? { amount_minor: 1200 + index * 300, currency: draft.currency },
    portion: item.portion ?? (index === 1 ? { value: 330, unit: 'ml' } : item.portion),
    // The first dish carries every kind of mark the Labels page styles.
    allergens:
      index === 0 && item.allergens.length === 0 ? [ALLERGENS[0], ALLERGENS[6]] : item.allergens,
    dietary: index === 0 && item.dietary.length === 0 ? ['vegetarian'] : item.dietary,
    badges: index === 0 && item.badges.length === 0 ? [NEW_BADGE] : item.badges,
    availability: { ...item.availability, state: 'available' },
    order_mode: 'orderable',
    orderable: true,
    modifier_groups: [],
  }
}

/**
 * The draft as a specimen: cut down, with demo content and a demo photo for every item, and (for the
 * guest-feature screens) every service on. `strip` draws the first section as a row of feature cards.
 */
export function specimenOf(
  draft: MenuSnapshot,
  { services, strip }: { services: boolean; strip: boolean },
): MenuSnapshot {
  const cut = cutDown(draft)
  const ids = cut.menu.sections.flatMap((id) => cut.sections[id]?.items ?? [])
  const items = { ...cut.items }
  ids.forEach((id, index) => {
    const item = items[id]
    if (item !== undefined) items[id] = dressedItem(item, index, cut)
  })
  const sections = { ...cut.sections }
  const first = cut.menu.sections[0]
  if (strip && first !== undefined && sections[first] !== undefined) {
    sections[first] = {
      ...sections[first],
      hints: { ...sections[first].hints, layout: 'horizontal' },
    }
  }
  const photo = {
    w: 800,
    h: 600,
    focal: null,
    alt: {},
    variants: {
      thumb: `/a/${DEMO_ASSET}/w320.webp`,
      card: `/a/${DEMO_ASSET}/w640.webp`,
      full: `/a/${DEMO_ASSET}/w1280.webp`,
    },
  }
  return {
    ...cut,
    items,
    sections,
    assets: { [DEMO_ASSET]: photo },
    // A logo the venue has is drawn as the demo picture too: the frame has the one photo base.
    theme: { ...cut.theme, logo: cut.theme.logo === null ? null : DEMO_ASSET },
    ...(services ? { features: allFeatures(cut.features) } : {}),
  }
}
