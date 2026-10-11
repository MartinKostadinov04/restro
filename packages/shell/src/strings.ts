// The few words the shell itself puts on a menu: allergen and dietary names, "from …", "Ask your
// waiter", sold out, "from 18:00", yes/no and measurement units. Menu text never comes from here
// (it comes from the snapshot's localized texts). The shell is pure and has no next-intl, so the
// tables for the two pilot languages (BG, EN) live here; every other locale reads the English one.

import type { Allergen, DietaryLabel, Locale, MeasurementUnit } from '@restro/core'

/**
 * The words of a guest page that are not menu text (S3-03: the phone face and its loader). Menu
 * text never comes from here; these are the controls and the messages around it.
 */
export interface GuestStrings {
  /** The banner for a known table: "Table 12". A label that is not a plain number is shown as it is. */
  readonly table: (label: string) => string
  /** The page's heading for a screen reader when the menu has no title of its own. */
  readonly menu: string
  readonly language: string
  readonly sections: string
  readonly filters: string
  /** The line under the title of the filter sheet. */
  readonly filterIntro: string
  readonly filterAll: string
  readonly filterDiet: string
  readonly filterTags: string
  readonly noMatches: string
  readonly clearFilters: string
  readonly more: string
  readonly less: string
  readonly allergens: string
  readonly allergensTitle: string
  readonly allergensHint: string
  readonly footerTitle: string
  readonly footerText: string
  readonly close: string
  /** The close control of a dish page: it goes back to the menu. */
  readonly back: string
  /** The name of the control that switches how the menu is laid out. */
  readonly layout: string
  readonly layoutList: string
  readonly layoutOne: string
  readonly layoutTwo: string
  readonly loading: string
  /** "Menu from 18:00": the whole menu is outside its schedule. */
  readonly menuSchedule: (when: string) => string
  readonly notFoundTitle: string
  readonly notFoundText: string
  readonly notPublishedTitle: string
  readonly notPublishedText: string
  readonly loadFailedTitle: string
  readonly loadFailedText: string
  readonly retry: string
}

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
  readonly guest: GuestStrings
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
  guest: {
    table: (label) => (/^\d+[A-Za-z]?$/.test(label) ? `Table ${label}` : label),
    menu: 'Menu',
    language: 'Language',
    sections: 'Menu sections',
    filters: 'Filter the menu',
    filterIntro: 'Choose one or more labels.',
    filterAll: 'All',
    filterDiet: 'Diet',
    filterTags: 'Tags',
    noMatches: 'Nothing on the menu matches these filters.',
    clearFilters: 'Clear filters',
    more: 'More',
    less: 'Less',
    allergens: 'Allergens',
    allergensTitle: 'Allergens',
    allergensHint: 'Tap a code to see what it stands for.',
    footerTitle: 'Allergen information',
    footerText:
      'The codes on each item stand for the allergens it contains. Ask the staff if you have an allergy or any doubt.',
    close: 'Close',
    back: 'Back to menu',
    layout: 'Menu layout',
    layoutList: 'List',
    layoutOne: '1 column',
    layoutTwo: '2 columns',
    loading: 'Loading the menu',
    menuSchedule: (when) => `Menu ${when}`,
    notFoundTitle: 'Menu not found',
    notFoundText: 'Check the link, or ask the staff for the right code.',
    notPublishedTitle: 'This menu is not published yet',
    notPublishedText: 'Please come back in a little while.',
    loadFailedTitle: 'The menu could not be loaded',
    loadFailedText: 'Check your connection and try again.',
    retry: 'Try again',
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
  guest: {
    table: (label) => (/^\d+[A-Za-z]?$/.test(label) ? `Маса ${label}` : label),
    menu: 'Меню',
    language: 'Език',
    sections: 'Раздели на менюто',
    filters: 'Филтриране на менюто',
    filterIntro: 'Изберете един или повече етикети.',
    filterAll: 'Всички',
    filterDiet: 'Диета',
    filterTags: 'Етикети',
    noMatches: 'Нищо от менюто не отговаря на тези филтри.',
    clearFilters: 'Изчисти филтрите',
    more: 'Още',
    less: 'По-малко',
    allergens: 'Алергени',
    allergensTitle: 'Алергени',
    allergensHint: 'Докоснете код, за да видите какво означава.',
    footerTitle: 'Информация за алергените',
    footerText:
      'Кодовете при всяка позиция обозначават алергените в нея. Попитайте персонала, ако имате алергия или съмнение.',
    close: 'Затвори',
    back: 'Обратно към менюто',
    layout: 'Изглед на менюто',
    layoutList: 'Списък',
    layoutOne: '1 колона',
    layoutTwo: '2 колони',
    loading: 'Менюто се зарежда',
    menuSchedule: (when) => `Менюто е ${when}`,
    notFoundTitle: 'Менюто не е намерено',
    notFoundText: 'Проверете връзката или попитайте персонала за правилния код.',
    notPublishedTitle: 'Менюто още не е публикувано',
    notPublishedText: 'Моля, върнете се след малко.',
    loadFailedTitle: 'Менюто не можа да се зареди',
    loadFailedText: 'Проверете връзката си и опитайте отново.',
    retry: 'Опитайте отново',
  },
}

/** The words for a locale: Bulgarian for `bg_BG`, English for every other. */
export function stringsFor(locale: Locale): Strings {
  return locale === 'bg_BG' ? BG : EN
}
