import { describe, expect, it } from 'vitest'

import { mapModificators, mapPlaces } from './places.ts'
import {
  demoLanguages,
  demoModificators,
  demoPlaces,
  INTEGRATION_ID,
  VENUE_ID,
} from './test-data.ts'
import { allowedLocales, isEmptyText, localizedText, normaliseLocaleKey } from './text.ts'

describe('mapPlaces', () => {
  const places = mapPlaces(demoPlaces, { integrationId: INTEGRATION_ID, venueId: VENUE_ID })

  it('describes every demo place, ordered by place id, with text numbers and ids', () => {
    expect(places).toHaveLength(92)
    expect(places.map((p) => Number(p.placeId))).toStrictEqual(
      [...places.map((p) => Number(p.placeId))].sort((a, b) => a - b),
    )
    expect(places.find((p) => p.placeNum === 'VIP')).toBeDefined()
    expect(places.every((p) => typeof p.placeId === 'string')).toBe(true)
    const first = places.find((p) => p.placeId === '1330')
    expect(first).toMatchObject({ placeNum: '0', salonName: 'Accommodation', isPublic: true })
  })

  it('keeps the raw place as a venue-scoped source record', () => {
    const record = places[0]?.sourceRecord
    expect(record).toMatchObject({
      externalType: 'place',
      scope: `venue:${VENUE_ID}`,
      integrationId: INTEGRATION_ID,
    })
    expect(record?.id).toMatch(/^sr_[0-9A-Za-z]{22}$/)
    expect(
      mapPlaces(demoPlaces, { integrationId: INTEGRATION_ID, venueId: VENUE_ID }),
    ).toStrictEqual(places)
  })

  it('stores an integer place_num as text and a missing is_public as not public', () => {
    const [place] = mapPlaces([{ place_id: 5, place_num: 12, salon_name: ' ', is_public: null }], {
      integrationId: INTEGRATION_ID,
      venueId: VENUE_ID,
    })
    expect(place).toMatchObject({ placeId: '5', placeNum: '12', salonName: null, isPublic: false })
  })
})

describe('mapModificators', () => {
  it('describes the kitchen requests as master source records only, ordered by id', () => {
    const records = mapModificators(demoModificators, { integrationId: INTEGRATION_ID })
    expect(records).toHaveLength(42)
    expect(records.every((r) => r.externalType === 'modificator' && r.scope === 'master')).toBe(
      true,
    )
    expect(records.map((r) => Number(r.externalId))).toStrictEqual(
      [...records.map((r) => Number(r.externalId))].sort((a, b) => a - b),
    )
    expect(records.find((r) => r.externalId === '47')?.payload).toMatchObject({
      mod_name: 'Alternative Milk',
    })
  })
})

describe('localized text', () => {
  const context = {
    defaultLocale: 'bg_BG',
    allowed: allowedLocales(demoLanguages, 'bg_BG'),
  } as const

  it('normalises barsy language keys to our locales', () => {
    expect(normaliseLocaleKey('sr_RS@latin')).toBe('sr_RS')
    expect(normaliseLocaleKey('bg-BG')).toBe('bg_BG')
    expect(normaliseLocaleKey('xx_XX')).toBeNull()
    expect(normaliseLocaleKey('')).toBeNull()
  })

  it('the demo installation holds all eleven locales, sr_RS@latin included', () => {
    expect(allowedLocales(demoLanguages, 'bg_BG').size).toBe(11)
    expect(allowedLocales([], 'bg_BG').size).toBe(11)
    expect([...allowedLocales([{ lang_id: 'en_US' }], 'bg_BG')].sort()).toStrictEqual([
      'bg_BG',
      'en_US',
    ])
  })

  it('leaves out empty strings, whitespace and nulls; trims; falls back to the default language only', () => {
    expect(
      localizedText({ bg_BG: '', en_US: null, de_DE: '  Suppe ' }, null, context),
    ).toStrictEqual({
      de_DE: 'Suppe',
    })
    expect(localizedText({ bg_BG: '', en_US: 'Soup' }, 'Супа', context)).toStrictEqual({
      bg_BG: 'Супа',
      en_US: 'Soup',
    })
    expect(localizedText({ bg_BG: 'Чорба' }, 'Супа', context)).toStrictEqual({ bg_BG: 'Чорба' })
    expect(isEmptyText(localizedText(null, ' ', context))).toBe(true)
  })

  it('prefers sr_RS over sr_RS@latin when both are present', () => {
    expect(
      localizedText({ 'sr_RS@latin': 'Latinica', sr_RS: 'Ćirilica' }, null, context),
    ).toStrictEqual({ sr_RS: 'Ćirilica' })
  })
})
