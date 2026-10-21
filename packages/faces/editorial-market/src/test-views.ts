// View models for this package's tests: one menu that has everything the face draws (photo cards
// and text rows, badges, dietary labels, tags, allergens, a section nobody's filters can keep),
// built the way the shell builds a real one. Used by the contract, face and model tests only.

import {
  buildViewModel,
  imageSlotsFor,
  type Locale,
  type ViewImage,
  type ViewItem,
  type ViewModel,
} from '@restro/shell'
import { type Fixture, fixtureId, snapshotFromSpec } from '@restro/shell/testing'

import { EDITORIAL_MARKET_MANIFEST } from './manifest'

const WEDNESDAY_EVENING = '2026-10-07T20:30:00+03:00'

/** Both languages of the test menu. */
const both = (en: string, bg: string) => ({ en_US: en, bg_BG: bg })

export const SIGNATURE_TAG = fixtureId('tg', 1)
export const SPICY_TAG = fixtureId('tg', 2)

/**
 * The test menu as a contract fixture: three sections, eight items. The menu starts in two
 * columns and lets guests switch; the first section is marked horizontal (the photo-led strip),
 * the others vertical (D92).
 */
export function richFixture(locale: Locale = 'en_US'): Fixture {
  const photo = fixtureId('as', 1)
  return {
    name: 'editorial-market-rich',
    note: 'Photo cards and text rows, badges, dietary labels, tags, allergens, a sold-out dish.',
    snapshot: snapshotFromSpec({
      // French is a language of the menu but none of these texts is translated into it: a guest
      // who asks for French reads every text in English, marked as such.
      locales: { default: 'en_US', available: ['en_US', 'bg_BG', 'fr_FR'] },
      menuTitle: both('Late Menu', 'Късно меню'),
      layout: { default: 'two', guest_switch: true },
      assets: { [photo]: { w: 1600, h: 1200, alt: { en_US: 'A plate of food' } } },
      tags: {
        [SIGNATURE_TAG]: both('Signature', 'Фирмено'),
        [SPICY_TAG]: both('Spicy', 'Лютиво'),
      },
      sections: [
        {
          title: both('Starters', 'Предястия'),
          layout: 'horizontal',
          items: [
            {
              name: both('Hummus', 'Хумус'),
              image: photo,
              price: 700,
              allergens: ['sesame'],
              dietary: ['vegan', 'gluten_free'],
              tags: [SIGNATURE_TAG],
              badges: ['new'],
              description: both('Chickpeas, tahini and lemon.', 'Нахут, тахан и лимон.'),
            },
            {
              name: both('Olives', 'Маслини'),
              price: 400,
              dietary: ['vegan', 'gluten_free'],
              tags: [SPICY_TAG],
            },
            {
              name: both('Halloumi', 'Халуми'),
              image: photo,
              price: 800,
              allergens: ['milk'],
              dietary: ['vegetarian'],
              tags: [SIGNATURE_TAG],
            },
          ],
        },
        {
          title: both('Mains', 'Основни'),
          layout: 'vertical',
          items: [
            {
              name: both('Burger', 'Бургер'),
              image: photo,
              price: 1400,
              allergens: ['gluten', 'milk', 'eggs'],
              tags: [SIGNATURE_TAG],
              description: both(
                'A beef patty, cheddar, pickles and house sauce in a toasted brioche bun.',
                'Телешко руло, чедър, кисели краставички и сос в препечен бриош.',
              ),
            },
            {
              name: both('Tofu bowl', 'Боул с тофу'),
              price: 1200,
              dietary: ['vegan'],
              badges: ['new'],
            },
            {
              name: both('Steak', 'Стек'),
              price: 2400,
              tags: [SPICY_TAG],
              soldOut: true,
            },
          ],
        },
        {
          title: both('Desserts', 'Десерти'),
          layout: 'vertical',
          items: [
            {
              name: both('Cheesecake', 'Чийзкейк'),
              price: 700,
              allergens: ['milk', 'eggs', 'gluten'],
              dietary: ['vegetarian'],
            },
          ],
        },
      ],
    }),
    overlay: null,
    context: { locale, now: WEDNESDAY_EVENING },
  }
}

/** The view model of a fixture, for this face (its image slot, a screen density). */
export function viewOf(fixture: Fixture, density = 1): ViewModel {
  return buildViewModel(fixture.snapshot, fixture.overlay, {
    ...fixture.context,
    images: imageSlotsFor(EDITORIAL_MARKET_MANIFEST, density),
  })
}

/** The test menu's view model. */
export function richView(locale: Locale = 'en_US'): ViewModel {
  return viewOf(richFixture(locale))
}

/** Every item placement of a view model, in reading order. */
export function itemsOf(view: ViewModel): ViewItem[] {
  const walk = (sections: ViewModel['sections']): ViewItem[] =>
    sections.flatMap((section) => [...section.items, ...walk(section.sections)])
  return walk(view.sections)
}

/** The first item photo of a view model (to use as a logo or a section image in a test). */
export function firstImage(view: ViewModel): ViewImage {
  const image = itemsOf(view).find((item) => item.image !== null)?.image
  if (image === undefined || image === null) throw new Error('the test menu has no photo')
  return image
}
