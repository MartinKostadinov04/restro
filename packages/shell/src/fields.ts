// R12 Custom fields: public custom fields go through `field_types`, in template order, into one
// `extraFields` slot. One formatter per field type in one table (the `satisfies` makes a missing
// type a compile error); no `switch` over types anywhere. The three types a snapshot cannot carry
// (`image`, `file`, `reference`) have no formatter by design. Every formatter returns null for a
// value with nothing to show, so an empty field collapses (R8).

import {
  type Currency,
  FIELD_VALUE_SCHEMAS,
  type FieldValueOf,
  formatMoney,
  type Locale,
  localeToBcp47,
  type SNAPSHOT_FIELD_TYPES,
} from '@restro/core'
import { weekdayName } from './schedule'
import type { Strings } from './strings'
import { pickText } from './text'

/** A custom-field type a snapshot can carry. */
export type SnapshotFieldType = (typeof SNAPSHOT_FIELD_TYPES)[number]

/** What a formatter needs besides the value. */
export interface FieldFormatContext {
  readonly locale: Locale
  readonly chain: readonly Locale[]
  readonly timeZone: string
  readonly currency: Currency
  /** The unit label from the field type (`%` for ABV), or null. */
  readonly unit: string | null
  readonly strings: Strings
}

/** A formatted value; `lang` is set only when the value is text in a known language. */
export interface FormattedField {
  readonly text: string
  readonly lang: Locale | null
}

type Formatter<K extends SnapshotFieldType> = (
  value: FieldValueOf<K>,
  context: FieldFormatContext,
) => FormattedField | null

const NBSP = ' '

const numberFormats = new Map<string, Intl.NumberFormat>()
const dateFormats = new Map<string, Intl.DateTimeFormat>()

function formatNumber(value: number, locale: Locale): string {
  const bcp47 = localeToBcp47(locale)
  let format = numberFormats.get(bcp47)
  if (format === undefined) {
    format = new Intl.NumberFormat(bcp47, { maximumFractionDigits: 6 })
    numberFormats.set(bcp47, format)
  }
  return format.format(value)
}

function formatDate(
  date: Date,
  locale: Locale,
  timeZone: string,
  style: 'date' | 'datetime',
): string {
  const key = `${locale}|${timeZone}|${style}`
  let format = dateFormats.get(key)
  if (format === undefined) {
    format = new Intl.DateTimeFormat(
      localeToBcp47(locale),
      style === 'date'
        ? { dateStyle: 'medium', timeZone }
        : { dateStyle: 'medium', timeStyle: 'short', timeZone },
    )
    dateFormats.set(key, format)
  }
  return format.format(date)
}

const plain = (text: string): FormattedField | null =>
  text.trim() === '' ? null : { text, lang: null }

const withUnit = (text: string, unit: string | null): string =>
  unit === null ? text : `${text}${NBSP}${unit}`

/** The formatter of each field type a snapshot can carry. */
export const FIELD_FORMATTERS = {
  short_text: (value) => plain(value),
  long_text: (value) => plain(value),
  localized_text: (value, { chain }) => {
    const picked = pickText(value, chain)
    return picked === null ? null : { text: picked.text, lang: picked.lang }
  },
  number: (value, { locale, unit }) => ({
    text: withUnit(formatNumber(value, locale), unit),
    lang: null,
  }),
  boolean: (value, { strings }) => ({ text: value ? strings.yes : strings.no, lang: strings.lang }),
  date: (value, { locale }) => ({
    text: formatDate(new Date(`${value}T00:00:00Z`), locale, 'UTC', 'date'),
    lang: null,
  }),
  datetime: (value, { locale, timeZone }) => ({
    text: formatDate(new Date(value), locale, timeZone, 'datetime'),
    lang: null,
  }),
  money: (value, { locale, currency }) => ({
    text: formatMoney(value.amount_minor, currency, locale),
    lang: null,
  }),
  measurement: (value, { locale, strings }) => ({
    text: withUnit(formatNumber(value.value, locale), strings.units[value.unit]),
    lang: null,
  }),
  range: (value, { locale, strings }) => {
    const span = `${formatNumber(value.start, locale)}–${formatNumber(value.end, locale)}`
    return {
      text: withUnit(span, value.unit === null ? null : strings.units[value.unit]),
      lang: null,
    }
  },
  tags: (value) => plain(value.join(', ')),
  enum: (value) => plain(value),
  enum_set: (value) => plain(value.join(', ')),
  availability: (value, { strings }) => {
    const bcp47 = localeToBcp47(strings.lang)
    const windows = value.rules.map((rule) => {
      const days = rule.days.map((day) => weekdayName(day, bcp47)).join(', ')
      return `${days} ${rule.from}–${rule.to}`
    })
    return plain(windows.join('; '))
  },
} as const satisfies { readonly [K in SnapshotFieldType]: Formatter<K> }

/**
 * Formats one custom-field value of the given type, or null when it is not a valid value of that
 * type or has nothing to show. The value is checked again here because the shell trusts nothing it
 * draws.
 */
export function formatField(
  type: SnapshotFieldType,
  value: unknown,
  context: FieldFormatContext,
): FormattedField | null {
  const parsed = FIELD_VALUE_SCHEMAS[type].safeParse(value)
  if (!parsed.success) return null
  const format = FIELD_FORMATTERS[type] as (
    value: unknown,
    context: FieldFormatContext,
  ) => FormattedField | null
  return format(parsed.data, context)
}
