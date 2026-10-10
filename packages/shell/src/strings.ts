// The few words the shell itself puts on a menu: allergen and dietary names, "from …", "Ask your
// waiter", sold out, "from 18:00", yes/no and measurement units. Menu text never comes from here
// (it comes from the snapshot's localized texts). The shell is pure and has no next-intl, so the
// tables for the two pilot languages (BG, EN) live here; every other locale reads the English one.

import type { Allergen, DietaryLabel, Locale, MeasurementUnit } from '@restro/core'

/** The words of one language. `lang` is the language the strings are really in. */
export interface Strings {
  readonly lang: Locale
  readonly newBadge: string
  readonly askWaiter: string
  readonly soldOut: string
  readonly unavailable: string
  readonly yes: string
  readonly no: string
  /** "from 12,50 €": the price prefix (R4). */
  readonly fromPrice: (amount: string) => string
  /** "from 18:00" (R1). */
  readonly scheduledFrom: (time: string) => string
  /** "tomorrow from 18:00". */
  readonly scheduledTomorrow: (time: string) => string
  /** "Fri from 18:00". */
  readonly scheduledOnDay: (day: string, time: string) => string
  readonly units: { readonly [U in MeasurementUnit]: string }
  readonly allergens: { readonly [A in Allergen]: string }
  readonly dietary: { readonly [D in DietaryLabel]: string }
}

const EN: Strings = {
  lang: 'en_US',
  newBadge: 'New',
  askWaiter: 'Ask your waiter',
  soldOut: 'Sold out',
  unavailable: 'Unavailable',
  yes: 'Yes',
  no: 'No',
  fromPrice: (amount) => `from ${amount}`,
  scheduledFrom: (time) => `from ${time}`,
  scheduledTomorrow: (time) => `tomorrow from ${time}`,
  scheduledOnDay: (day, time) => `${day} from ${time}`,
  units: { g: 'g', kg: 'kg', ml: 'ml', l: 'l', cl: 'cl', pcs: 'pcs' },
  allergens: {
    gluten: 'Gluten',
    crustaceans: 'Crustaceans',
    eggs: 'Eggs',
    fish: 'Fish',
    peanuts: 'Peanuts',
    soybeans: 'Soybeans',
    milk: 'Milk',
    nuts: 'Nuts',
    celery: 'Celery',
    mustard: 'Mustard',
    sesame: 'Sesame',
    sulphites: 'Sulphites',
    lupin: 'Lupin',
    molluscs: 'Molluscs',
  },
  dietary: {
    vegan: 'Vegan',
    vegetarian: 'Vegetarian',
    gluten_free: 'Gluten-free',
    lactose_free: 'Lactose-free',
    halal: 'Halal',
    kosher: 'Kosher',
  },
}

const BG: Strings = {
  lang: 'bg_BG',
  newBadge: 'Ново',
  askWaiter: 'Попитайте сервитьора',
  soldOut: 'Изчерпано',
  unavailable: 'Недостъпно',
  yes: 'Да',
  no: 'Не',
  fromPrice: (amount) => `от ${amount}`,
  scheduledFrom: (time) => `от ${time}`,
  scheduledTomorrow: (time) => `утре от ${time}`,
  scheduledOnDay: (day, time) => `${day} от ${time}`,
  units: { g: 'гр', kg: 'кг', ml: 'мл', l: 'л', cl: 'cl', pcs: 'бр.' },
  allergens: {
    gluten: 'Глутен',
    crustaceans: 'Ракообразни',
    eggs: 'Яйца',
    fish: 'Риба',
    peanuts: 'Фъстъци',
    soybeans: 'Соя',
    milk: 'Мляко',
    nuts: 'Ядки',
    celery: 'Целина',
    mustard: 'Синап',
    sesame: 'Сусам',
    sulphites: 'Сулфити',
    lupin: 'Лупина',
    molluscs: 'Мекотели',
  },
  dietary: {
    vegan: 'Веган',
    vegetarian: 'Вегетарианско',
    gluten_free: 'Без глутен',
    lactose_free: 'Без лактоза',
    halal: 'Халал',
    kosher: 'Кашер',
  },
}

/** The words for a locale: Bulgarian for `bg_BG`, English for every other. */
export function stringsFor(locale: Locale): Strings {
  return locale === 'bg_BG' ? BG : EN
}
