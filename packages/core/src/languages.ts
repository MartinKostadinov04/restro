// One central source of a venue's menu languages (D77; adjustments L1). Every workflow that needs
// to know which languages a venue's menu has (the sync's text language, a new venue's list, the
// settings lists with coverage, the composer's language tabs, the resolver's checks, the
// publisher's locales) asks `venueLanguages`; nothing reads `venues.enabled_locales` on its own
// (scripts/enabled-locales.test.ts keeps it so).
//
// The facts: the venue's main language and the languages its owner switched on
// (`venues.default_locale`, `venues.enabled_locales`) and, for a venue fed by a till, the
// connector's report of which languages the till offers and how many guest-facing texts it fills
// in each (`venues.settings.languages_report`, written by `recordLanguageReport` after every
// complete full read). The rule (D77): a language the till fills for about 20% of the texts or
// more counts as a menu language; a language the owner switched on is never removed; one main
// language per venue. A hand-made venue has no report, so its languages are its owner's (D91).
// The language of a till's untagged text is not decided here: it is the connector instance's
// setting (D82).
//
// Pure: no I/O.

import { z } from 'zod'

import { isLocale, LOCALES, type Locale, LocaleSchema } from './locales'

/** From this share of filled guest-facing texts on, a language the till offers counts (D77). */
export const LANGUAGE_COVERAGE_THRESHOLD = 0.2

/** The key of the connector's report in `venues.settings`. */
export const LANGUAGE_REPORT_KEY = 'languages_report'

/**
 * What a connector reports after a complete full read (D77): the languages the till offers, as
 * our locale keys, and how many guest-facing texts (names and descriptions of sections, items
 * and options) the till fills in each, out of how many there are. Stored snake_case.
 */
export const LanguageReportSchema = z.strictObject({
  /** When the till was read, ISO 8601 with an offset. */
  reported_at: z.iso.datetime({ offset: true }),
  offered: z.array(LocaleSchema).max(LOCALES.length),
  filled: z.partialRecord(LocaleSchema, z.int().nonnegative()),
  total: z.int().nonnegative(),
})

export type LanguageReport = z.output<typeof LanguageReportSchema>

/** What `venueLanguages` reads of a venue: the columns and the settings that hold the report. */
export interface VenueLanguageFacts {
  readonly defaultLocale: string
  readonly enabledLocales: readonly string[]
  /** `venues.settings`; only the connector's report is read from it. */
  readonly settings?: Readonly<Record<string, unknown>> | null | undefined
}

/** A venue's menu languages, decided once for every workflow. */
export interface VenueLanguages {
  /** The main language (D77): guests see it first, every title needs text in it. */
  readonly main: Locale
  /** Every menu language: the main one first, then the rest in `LOCALES` order. */
  readonly all: readonly Locale[]
  /** The owner's own list (switched on by hand, the main one included); a report never removes one. */
  readonly owned: readonly Locale[]
  /** The languages that count because the till fills them (from the report); none without one. */
  readonly fromTill: readonly Locale[]
  /**
   * The share of guest-facing texts the till fills per offered language, 0 to 1, for the settings
   * lists; null without a report (a hand-made venue, or a till venue before its first complete read).
   */
  readonly coverage: Readonly<Partial<Record<Locale, number>>> | null
  readonly report: LanguageReport | null
}

/** The given locales, each once, in `LOCALES` order. */
function inLocaleOrder(locales: Iterable<Locale>): Locale[] {
  const wanted = new Set(locales)
  return LOCALES.filter((locale) => wanted.has(locale))
}

/** The connector's report held in a venue's settings, or null when there is none or it is unreadable. */
export function languageReportOf(settings: unknown): LanguageReport | null {
  if (typeof settings !== 'object' || settings === null) return null
  const parsed = LanguageReportSchema.safeParse(
    (settings as Readonly<Record<string, unknown>>)[LANGUAGE_REPORT_KEY],
  )
  return parsed.success ? parsed.data : null
}

/** The share of texts filled per offered language (0 to 1), in `LOCALES` order. */
export function coverageOf(report: LanguageReport): Partial<Record<Locale, number>> {
  const coverage: Partial<Record<Locale, number>> = {}
  for (const locale of inLocaleOrder(report.offered)) {
    coverage[locale] =
      report.total === 0 ? 0 : Math.min(1, (report.filled[locale] ?? 0) / report.total)
  }
  return coverage
}

/** The venue's menu languages (see the header). */
export function venueLanguages(venue: VenueLanguageFacts): VenueLanguages {
  const switchedOn = inLocaleOrder(venue.enabledLocales.filter(isLocale))
  const main: Locale = isLocale(venue.defaultLocale)
    ? venue.defaultLocale
    : (switchedOn[0] ?? 'bg_BG')
  const owned = inLocaleOrder([main, ...switchedOn])
  const report = languageReportOf(venue.settings)
  const coverage = report === null ? null : coverageOf(report)
  const fromTill =
    coverage === null
      ? []
      : inLocaleOrder(
          (Object.entries(coverage) as [Locale, number][])
            .filter(([, share]) => share >= LANGUAGE_COVERAGE_THRESHOLD)
            .map(([locale]) => locale),
        )
  const rest = inLocaleOrder([...owned, ...fromTill]).filter((locale) => locale !== main)
  return { main, all: [main, ...rest], owned, fromTill, coverage, report }
}
