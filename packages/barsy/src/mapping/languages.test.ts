// The language report of a mapping run (D77, adjustments I3): the languages the installation
// offers and how many guest-facing texts hold text in each.
import { LOCALES } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { mapCatalogue } from './catalogue.ts'
import { config, input } from './test-data.ts'

describe('mapCatalogue: the language report', () => {
  const result = mapCatalogue(input(), config())

  it('lists the installation’s languages as our locale keys, in LOCALES order', () => {
    const { offered } = result.languages
    expect(offered.length).toBeGreaterThan(0)
    expect(new Set(offered).size).toBe(offered.length)
    expect(offered).toEqual(LOCALES.filter((locale) => offered.includes(locale)))
  })

  it('counts every guest-facing text once, filled or not, and never more filled than texts', () => {
    const { filled, total } = result.languages
    // Names and descriptions of sections, items, option groups and options.
    const texts = (result.changeSet?.ops ?? []).filter(
      (op) =>
        (op.op === 'setField' || op.op === 'clearField') &&
        ['title', 'name', 'description'].includes(op.fieldKey) &&
        op.scope === 'master',
    )
    expect(total).toBe(texts.length)
    expect(total).toBeGreaterThan(0)
    for (const [locale, count] of Object.entries(filled)) {
      expect(LOCALES).toContain(locale)
      expect(count).toBeGreaterThan(0)
      expect(count).toBeLessThanOrEqual(total)
    }
    // The demo holds Bulgarian names for its items: the main language is well filled.
    expect(filled.bg_BG ?? 0).toBeGreaterThan(total / 2)
  })

  it('offers every locale when the installation lists no languages', () => {
    const empty = mapCatalogue({ ...input(), languages: [] }, config())
    expect(empty.languages.offered).toEqual([...LOCALES])
  })
})
