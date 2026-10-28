import {
  DESIGN_MARKER,
  DESIGN_TOKEN,
  DESIGN_TOKEN_MAX,
} from '../packages/shell/src/design/contract'

// The checks behind scripts/design-contract.test.ts (D127, D129, D67). Each takes plain data and
// returns the problems it finds, so the test can plant a difference and see the check fail.

export interface ValueLike {
  readonly id: string
  readonly en: string
  readonly bg: string
}

export interface OptionLike {
  readonly id: string
  readonly kind: string
  readonly en: string
  readonly bg: string
  readonly brand?: boolean
  readonly values?: readonly ValueLike[]
}

export interface PageLike {
  readonly id: string
  readonly en: string
  readonly bg: string
  readonly markers: readonly string[]
  readonly options: readonly OptionLike[]
}

/** One row of the table in docs/decisions/D129.md. */
export interface D129Row {
  readonly page: string
  readonly option: string
  readonly values: string
}

/** The rows of D129's option table, in order. */
export function readD129Table(markdown: string): D129Row[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => /^\|\s*Page\s*\|\s*Option\s*\|\s*Values/.test(line))
  if (start < 0) return []
  const rows: D129Row[] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const [page = '', option = '', values = ''] = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim())
    rows.push({ page, option, values })
  }
  return rows
}

const csv = (text: string): string[] => text.split(',').map((word) => word.trim())

/** The ids of an option's values, in order. */
const idsOf = (option: OptionLike): string[] => (option.values ?? []).map((value) => value.id)

/**
 * Pages, options, values and their order, compared with D129's table. The table's English names
 * are the contract's English labels; its "same, or one of the six" is `same` and the body fonts;
 * its Style row lists the premade Styles before the semicolon; its Colours row is the free value.
 */
export function checkAgainstD129(pages: readonly PageLike[], rows: readonly D129Row[]): string[] {
  const problems: string[] = []
  const options = pages.flatMap((page) => page.options.map((option) => ({ page, option })))
  if (options.length !== rows.length) {
    problems.push(`D129 has ${rows.length} options, the contract has ${options.length}`)
  }
  const fonts = idsOf(
    options.find((entry) => entry.option.id === 'body_font')?.option ?? ({} as OptionLike),
  )
  for (let i = 0; i < Math.min(options.length, rows.length); i++) {
    const { page, option } = options[i] as (typeof options)[number]
    const row = rows[i] as D129Row
    const at = `row ${i + 1} (${row.page} / ${row.option})`
    if (page.en !== row.page) problems.push(`${at}: the contract's page is "${page.en}"`)
    if (option.en !== row.option) problems.push(`${at}: the contract's option is "${option.en}"`)
    if (option.kind === 'colours') {
      if (!/^the venue['’]s three colours/.test(row.values)) {
        problems.push(`${at}: the contract has a free colours option, D129 does not`)
      }
      continue
    }
    const expected =
      row.values === 'same, or one of the six'
        ? ['same', ...fonts]
        : csv((row.values.split(';')[0] ?? '').trim())
    const actual = idsOf(option)
    if (expected.join(',') !== actual.join(',')) {
      problems.push(
        `${at}: D129 lists ${expected.join(', ')}; the contract lists ${actual.join(', ')}`,
      )
    }
  }
  return problems
}

/** Ids shaped as tokens, unique where they must be, markers owned by one page. */
export function checkShape(pages: readonly PageLike[]): string[] {
  const problems: string[] = []
  const ID = /^[a-z]+(?:_[a-z]+)*$/
  const seenPages = new Set<string>()
  const seenMarkers = new Map<string, string>()
  for (const page of pages) {
    if (!ID.test(page.id) || seenPages.has(page.id))
      problems.push(`page "${page.id}": not a unique lower-case id`)
    seenPages.add(page.id)
    if (page.markers.length === 0) problems.push(`page "${page.id}": owns no marker`)
    for (const marker of page.markers) {
      if (!DESIGN_MARKER.test(marker))
        problems.push(
          `page "${page.id}": marker "${marker}" is not lower-case words joined by dots`,
        )
      const owner = seenMarkers.get(marker)
      if (owner !== undefined)
        problems.push(`marker "${marker}": owned by "${owner}" and "${page.id}"`)
      seenMarkers.set(marker, page.id)
    }
    const seenOptions = new Set<string>()
    for (const option of page.options) {
      const at = `${page.id}.${option.id}`
      if (!ID.test(option.id) || seenOptions.has(option.id))
        problems.push(`${at}: not a unique lower-case id`)
      seenOptions.add(option.id)
      if (option.kind === 'colours') continue
      const values = idsOf(option)
      if (values.length === 0) problems.push(`${at}: no values`)
      if (new Set(values).size !== values.length) problems.push(`${at}: a value is listed twice`)
      for (const id of values) {
        if (!DESIGN_TOKEN.test(id) || id.length > DESIGN_TOKEN_MAX) {
          problems.push(`${at}: value "${id}" is not a short lower-case token`)
        }
      }
    }
  }
  return problems
}

const CYRILLIC = /[Ѐ-ӿ]/
const LATIN = /[A-Za-z0-9]/

/**
 * The English and the Bulgarian label of every page, option and value. A Bulgarian label has
 * Cyrillic letters; only a name that is the same in both languages (a font, a Style) may repeat the
 * English one.
 */
export function checkLabels(pages: readonly PageLike[]): string[] {
  const problems: string[] = []
  // A Style's name and a font's name are the same in both languages.
  const isName = (option: OptionLike, value: ValueLike) =>
    option.kind === 'style' ||
    option.id === 'body_font' ||
    (option.id === 'heading_font' && value.id !== 'same')
  const check = (at: string, label: { en: string; bg: string }, properName: boolean) => {
    if (label.en.trim() === '' || !LATIN.test(label.en) || CYRILLIC.test(label.en)) {
      problems.push(`${at}: no English label`)
    }
    if (label.bg.trim() === '') problems.push(`${at}: no Bulgarian label`)
    else if (properName) {
      if (label.bg !== label.en) problems.push(`${at}: a name, the same in both languages`)
    } else if (!CYRILLIC.test(label.bg))
      problems.push(`${at}: the Bulgarian label has no Cyrillic letters`)
  }
  for (const page of pages) {
    check(page.id, page, false)
    for (const option of page.options) {
      check(`${page.id}.${option.id}`, option, false)
      for (const value of option.values ?? []) {
        check(`${page.id}.${option.id}.${value.id}`, value, isName(option, value))
      }
    }
  }
  return problems
}

/**
 * A Style file against the contract: a known Style id, a list of departures, and for every page and
 * option the Style sets exactly one value from the option's list, written as a short lower-case
 * token. It names no option the contract lacks, and sets no body font, colour, role or logo (D127).
 */
export function checkStyle(
  style: { id?: unknown; departures?: unknown; values?: unknown },
  pages: readonly PageLike[],
): string[] {
  const problems: string[] = []
  const name = String(style.id)
  const styleOption = pages
    .flatMap((page) => page.options)
    .find((option) => option.kind === 'style')
  if (!idsOf(styleOption ?? ({} as OptionLike)).includes(name))
    problems.push(`${name}: not a Style of the contract`)
  if (
    !Array.isArray(style.departures) ||
    style.departures.some((d) => typeof d !== 'string' || d === '')
  ) {
    problems.push(`${name}: departures is not a list of lines`)
  }
  const values = style.values
  if (typeof values !== 'object' || values === null) return [...problems, `${name}: no values`]
  const record = values as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!pages.some((page) => page.id === key))
      problems.push(`${name}: names a page "${key}" the contract lacks`)
  }
  for (const page of pages) {
    const given = record[page.id]
    if (typeof given !== 'object' || given === null) {
      problems.push(`${name}.${page.id}: no values for the page`)
      continue
    }
    const set = given as Record<string, unknown>
    for (const key of Object.keys(set)) {
      const option = page.options.find((entry) => entry.id === key)
      if (option === undefined || option.kind !== 'choice') {
        problems.push(`${name}.${page.id}: names an option "${key}" the contract lacks`)
      } else if (option.brand === true) {
        problems.push(`${name}.${page.id}.${key}: a Style never sets the venue's brand`)
      }
    }
    for (const option of page.options) {
      if (option.kind !== 'choice' || option.brand === true) continue
      const at = `${name}.${page.id}.${option.id}`
      const value = set[option.id]
      if (value === undefined) problems.push(`${at}: no value`)
      else if (
        typeof value !== 'string' ||
        !DESIGN_TOKEN.test(value) ||
        value.length > DESIGN_TOKEN_MAX
      ) {
        problems.push(`${at}: "${String(value)}" is not a short lower-case token`)
      } else if (!idsOf(option).includes(value)) {
        problems.push(`${at}: "${value}" is not one of ${idsOf(option).join(', ')}`)
      }
    }
  }
  return problems
}
