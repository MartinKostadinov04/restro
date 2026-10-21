import { describe, expect, it } from 'vitest'

import {
  LANGUAGE_COVERAGE_THRESHOLD,
  LANGUAGE_REPORT_KEY,
  type LanguageReport,
  languageReportOf,
  venueLanguages,
} from './languages'

const report = (over: Partial<LanguageReport> = {}): LanguageReport => ({
  reported_at: '2026-10-12T20:00:00.000Z',
  offered: ['bg_BG', 'en_US', 'de_DE', 'ru_RU'],
  filled: { bg_BG: 50, en_US: 30, de_DE: 12, ru_RU: 1 },
  total: 50,
  ...over,
})

describe('venueLanguages', () => {
  it('a hand-made venue (no report): the owner’s languages, the main one first, in LOCALES order', () => {
    const languages = venueLanguages({
      defaultLocale: 'en_US',
      enabledLocales: ['de_DE', 'en_US', 'bg_BG'],
    })
    expect(languages).toEqual({
      main: 'en_US',
      all: ['en_US', 'bg_BG', 'de_DE'],
      owned: ['bg_BG', 'en_US', 'de_DE'],
      fromTill: [],
      coverage: null,
      report: null,
    })
  })

  it('a till venue: a language the till fills for 20% of the texts or more counts; a thin one does not', () => {
    const languages = venueLanguages({
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG'],
      settings: { [LANGUAGE_REPORT_KEY]: report() },
    })
    expect(languages.main).toBe('bg_BG')
    // de_DE: 12 of 50 = 24% counts; ru_RU: 1 of 50 = 2% does not.
    expect(languages.fromTill).toEqual(['bg_BG', 'en_US', 'de_DE'])
    expect(languages.all).toEqual(['bg_BG', 'en_US', 'de_DE'])
    expect(languages.coverage).toEqual({ bg_BG: 1, en_US: 0.6, de_DE: 0.24, ru_RU: 0.02 })
    expect(languages.report).toEqual(report())
    expect(LANGUAGE_COVERAGE_THRESHOLD).toBe(0.2)
  })

  it('never removes a language the owner switched on, however thin the till fills it', () => {
    const languages = venueLanguages({
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG', 'ru_RU', 'tr_TR'],
      settings: { [LANGUAGE_REPORT_KEY]: report() },
    })
    expect(languages.owned).toEqual(['bg_BG', 'ru_RU', 'tr_TR'])
    expect(languages.all).toEqual(['bg_BG', 'en_US', 'de_DE', 'ru_RU', 'tr_TR'])
  })

  it('a report of nothing (an empty till) adds no language', () => {
    const languages = venueLanguages({
      defaultLocale: 'bg_BG',
      enabledLocales: ['bg_BG', 'en_US'],
      settings: { [LANGUAGE_REPORT_KEY]: report({ filled: {}, total: 0 }) },
    })
    expect(languages.fromTill).toEqual([])
    expect(languages.all).toEqual(['bg_BG', 'en_US'])
    expect(languages.coverage).toEqual({ bg_BG: 0, en_US: 0, de_DE: 0, ru_RU: 0 })
  })

  it('ignores an unreadable report and unknown locales, and falls back for a bad main language', () => {
    expect(languageReportOf({ [LANGUAGE_REPORT_KEY]: { offered: 'bg_BG' } })).toBeNull()
    expect(languageReportOf(null)).toBeNull()
    const languages = venueLanguages({
      defaultLocale: 'xx_XX',
      enabledLocales: ['en_US', 'xx_XX', 'en_US'],
      settings: { [LANGUAGE_REPORT_KEY]: { offered: ['bg_BG'] } },
    })
    expect(languages).toMatchObject({ main: 'en_US', all: ['en_US'], coverage: null })
    expect(venueLanguages({ defaultLocale: '', enabledLocales: [] }).all).toEqual(['bg_BG'])
  })
})
