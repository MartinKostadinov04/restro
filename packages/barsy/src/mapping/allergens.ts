// Allergens from barsy's free-text characteristic (doc "Barsy to canonical mapping": key "Алергени"
// → `allergens` through a synonym table). D42: allergens are a plain data attribute (the 14 EU
// codes of core's ALLERGENS), shown when present.
//
// Never guessed: a word that is not in the table is reported back as unknown (the caller turns it
// into a warning) and contributes nothing. A segment with a negation ("без глутен", "gluten
// free") is reported as unknown as a whole, so "without gluten" can never become `gluten`.
// Numbers ("1, 7") are not read as Annex II numbers: they are unknown words too.
//
// Where the table is not obvious it errs on the side of the guest: `shellfish` stands for
// crustaceans and molluscs, a word that only hints at traces ("следи от мляко") still counts as
// the allergen it names.

import { ALLERGENS, type Allergen, isAllergenDetailName } from '@restro/core'

import type { ArticleDetailsGroup } from '../read/schemas.ts'

type Table = Readonly<Record<Allergen, readonly string[]>>

/** Lower-case words and phrases (Bulgarian and English) per allergen; a phrase is its words joined by one space. */
const SYNONYMS: Table = {
  gluten: [
    'глутен',
    'глутенови',
    'житни култури',
    'житни',
    'пшеница',
    'пшенични',
    'пшенично',
    'пшеничен',
    'ръж',
    'ръжен',
    'ржен',
    'ечемик',
    'овес',
    'овесени',
    'спелта',
    'камут',
    'gluten',
    'wheat',
    'rye',
    'barley',
    'oats',
    'spelt',
    'kamut',
    'cereals containing gluten',
  ],
  crustaceans: [
    'ракообразни',
    'ракообразните',
    'скариди',
    'раци',
    'рак',
    'омар',
    'омари',
    'crustaceans',
    'crustacean',
    'shrimp',
    'shrimps',
    'prawn',
    'prawns',
    'crab',
    'lobster',
    'crayfish',
  ],
  eggs: ['яйца', 'яйце', 'яйчен', 'яйчни', 'яйчено', 'egg', 'eggs'],
  fish: ['риба', 'риби', 'рибен', 'рибни', 'рибно', 'fish'],
  peanuts: [
    'фъстъци',
    'фъстък',
    'фъстъчен',
    'фъстъчени',
    'фъстъчено',
    'арахиди',
    'peanuts',
    'peanut',
    'groundnuts',
  ],
  soybeans: ['соя', 'соев', 'соеви', 'соево', 'соеви зърна', 'soy', 'soya', 'soybeans', 'soybean'],
  milk: ['мляко', 'млечни', 'млечен', 'млечно', 'лактоза', 'milk', 'dairy', 'lactose'],
  nuts: [
    'ядки',
    'черупкови плодове',
    'черупкови',
    'бадеми',
    'бадем',
    'лешници',
    'лешник',
    'орехи',
    'орех',
    'кашу',
    'шам фъстък',
    'шамфъстък',
    'пекан',
    'бразилски ядки',
    'макадамия',
    'nuts',
    'tree nuts',
    'almonds',
    'almond',
    'hazelnuts',
    'hazelnut',
    'walnuts',
    'walnut',
    'cashews',
    'cashew',
    'pecans',
    'pecan',
    'pistachios',
    'pistachio',
    'macadamia',
    'brazil nuts',
  ],
  celery: ['целина', 'celery', 'celeriac'],
  mustard: ['синап', 'горчица', 'mustard'],
  sesame: ['сусам', 'sesame'],
  sulphites: [
    'сулфити',
    'сулфит',
    'серен диоксид',
    'sulphites',
    'sulphite',
    'sulfites',
    'sulfite',
    'sulphur dioxide',
    'sulfur dioxide',
    'so2',
  ],
  lupin: ['лупина', 'лупин', 'lupin', 'lupine'],
  molluscs: [
    'мекотели',
    'мекотело',
    'миди',
    'мида',
    'калмари',
    'калмар',
    'октопод',
    'стриди',
    'molluscs',
    'mollusc',
    'mollusks',
    'mollusk',
    'mussels',
    'squid',
    'octopus',
    'oysters',
    'scallops',
  ],
}

/** Words that mean one word names two allergens. */
const MULTI: Readonly<Record<string, readonly Allergen[]>> = {
  shellfish: ['crustaceans', 'molluscs'],
}

/** Words that carry no allergen: labels, "contains", connectives, filler of the official wording. */
const FILLERS: ReadonlySet<string> = new Set([
  'алергени',
  'алерген',
  'алергия',
  'съдържа',
  'съдържат',
  'съдържащи',
  'съдържащ',
  'съдържащо',
  'включително',
  'вкл',
  'продукти',
  'продукт',
  'на',
  'от',
  'тях',
  'негова',
  'основа',
  'и',
  'или',
  'с',
  'със',
  'може',
  'да',
  'следи',
  'следа',
  'allergens',
  'allergen',
  'allergy',
  'contains',
  'contain',
  'including',
  'products',
  'product',
  'and',
  'or',
  'of',
  'from',
  'with',
  'may',
  'traces',
  'trace',
  'the',
  'a',
  'an',
])

/** A word that turns a segment into a statement about absence. */
const NEGATIONS: ReadonlySet<string> = new Set([
  'без',
  'не',
  'free',
  'without',
  'no',
  'not',
  'non',
  'безглутенов',
  'безглутенова',
  'безлактозен',
  'безлактозно',
])

const MAX_PHRASE_WORDS = 3
/** E220 to E228 are sulphur dioxide and the sulphites (EU Annex II, point 12). */
const SULPHITE_E_NUMBER = /^e22[0-8]$/

const PHRASES: ReadonlyMap<string, readonly Allergen[]> = (() => {
  const map = new Map<string, readonly Allergen[]>()
  for (const allergen of ALLERGENS) {
    for (const phrase of SYNONYMS[allergen]) map.set(phrase, [allergen])
  }
  for (const [word, allergens] of Object.entries(MULTI)) map.set(word, allergens)
  return map
})()

// Separators between statements: commas, semicolons, colons, slashes, bullets, brackets, a full
// stop that ends a word, and the connectives "и" / "and" / "or" / "или" between spaces.
const SEPARATORS = /[,;:/|\n\r\t•·+&()[\]{}]|\.(?=\s|$)|\s+(?:и|или|and|or)\s+/giu
const EDGE_PUNCTUATION = /^[\s"'«»„“”‹›*.!?\-–—]+|[\s"'«»„“”‹›*.!?\-–—]+$/gu

function words(segment: string): string[] {
  return segment
    .replace(EDGE_PUNCTUATION, '')
    .split(/\s+/u)
    .map((word) => word.replace(EDGE_PUNCTUATION, ''))
    .filter((word) => word !== '')
}

export interface ParsedAllergens {
  /** Recognised allergens, deduplicated, in the order of core's ALLERGENS. */
  readonly allergens: readonly Allergen[]
  /** Words (or negated statements) the table does not know, in order of appearance, without repeats. */
  readonly unknown: readonly string[]
}

/** Parses a free-text allergen characteristic into EU-14 codes and the words it could not read. */
export function parseAllergenText(text: string): ParsedAllergens {
  const found = new Set<Allergen>()
  const unknown: string[] = []
  const addUnknown = (entry: string) => {
    if (!unknown.includes(entry)) unknown.push(entry)
  }

  for (const segment of text.toLowerCase().split(SEPARATORS)) {
    const tokens = words(segment)
    if (tokens.length === 0) continue
    if (tokens.some((token) => NEGATIONS.has(token))) {
      addUnknown(tokens.join(' '))
      continue
    }
    let index = 0
    while (index < tokens.length) {
      let matched = 0
      for (let size = Math.min(MAX_PHRASE_WORDS, tokens.length - index); size >= 1; size--) {
        const phrase = tokens.slice(index, index + size).join(' ')
        const allergens = PHRASES.get(phrase)
        if (allergens !== undefined) {
          for (const allergen of allergens) found.add(allergen)
          matched = size
          break
        }
      }
      if (matched > 0) {
        index += matched
        continue
      }
      const token = tokens[index] ?? ''
      if (SULPHITE_E_NUMBER.test(token)) found.add('sulphites')
      else if (!FILLERS.has(token)) addUnknown(token)
      index += 1
    }
  }
  return { allergens: ALLERGENS.filter((allergen) => found.has(allergen)), unknown }
}

export interface AllergenKey {
  /** The characteristic key (`k102`), or null when the installation has none for allergens. */
  readonly key: string | null
  readonly ambiguous: boolean
  /** Every key whose name matched, sorted. */
  readonly candidates: readonly string[]
}

/**
 * The characteristic key that holds allergens. An explicit key from the configuration wins;
 * otherwise the key whose name is "Алергени" or "Allergens" (any case). If several match, the
 * lowest key is used and the result is flagged ambiguous.
 */
export function findAllergenKey(
  detailsTree: readonly ArticleDetailsGroup[],
  configured: string | undefined,
): AllergenKey {
  if (configured !== undefined)
    return { key: configured, ambiguous: false, candidates: [configured] }
  const found = new Set<string>()
  for (const group of detailsTree) {
    for (const [key, detail] of Object.entries(group.details)) {
      if (isAllergenDetailName(detail.detail_name)) found.add(key)
    }
  }
  const candidates = [...found].sort()
  return { key: candidates[0] ?? null, ambiguous: candidates.length > 1, candidates }
}
