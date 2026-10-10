// Properties of the shell (brief S3-02): same inputs give the same view model, no text is ever
// empty, order is the snapshot's, an overlay can only make items less available, and money text
// parses back to the minor units it came from.

import { ALLERGENS, decimalToMinor, LOCALES, type Locale, type LocalizedText } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { type ItemSpec, type SectionSpec, snapshotFromSpec } from '../testing'
import { buildViewModel } from './build'
import { CHANNELS, type ShellContextInput } from './context'
import { viewDelta, viewMoney, viewPrice } from './money'
import { stringsFor } from './strings'
import type { ItemState, ViewItem, ViewModel, ViewSection } from './view-model'

const locale = fc.constantFrom(...LOCALES)

const text = fc.string({ minLength: 1, maxLength: 24 }).filter((value) => value.trim() !== '')

const localizedText = fc.uniqueArray(locale, { minLength: 1, maxLength: 4 }).chain((keys) =>
  fc.tuple(...keys.map(() => text)).map((values) => {
    const out: LocalizedText = {}
    keys.forEach((key, index) => {
      out[key] = values[index] ?? 'x'
    })
    return out
  }),
)

const clock = (minutes: number) =>
  minutes === 1440
    ? '24:00'
    : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const schedule = fc.record({
  timezone: fc.constant('Europe/Sofia'),
  rules: fc.array(
    fc
      .record({
        days: fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 7 }),
        from: fc.integer({ min: 0, max: 1439 }),
        to: fc.integer({ min: 0, max: 1440 }),
      })
      .filter((rule) => rule.from !== rule.to)
      .map((rule) => ({ days: rule.days, from: clock(rule.from), to: clock(rule.to) })),
    { minLength: 1, maxLength: 2 },
  ),
})

const item: fc.Arbitrary<ItemSpec> = fc.record({
  name: localizedText,
  description: fc.oneof(fc.constant({}), localizedText),
  price: fc.option(fc.integer({ min: 0, max: 100_000 }), { nil: null }),
  allergens: fc.subarray([...ALLERGENS]),
  soldOut: fc.boolean(),
  schedule: fc.option(schedule, { nil: null }),
  askWaiter: fc.boolean(),
})

const section: fc.Arbitrary<SectionSpec> = fc.record({
  title: localizedText,
  items: fc.array(item, { minLength: 1, maxLength: 5 }),
})

const locales = fc
  .record({
    available: fc.uniqueArray(locale, { minLength: 1, maxLength: 6 }),
    pick: fc.nat(),
  })
  .map(({ available, pick }) => ({
    default: available[pick % available.length] as Locale,
    available,
  }))

const snapshot = fc
  .record({ locales, sections: fc.array(section, { minLength: 1, maxLength: 4 }) })
  .map((spec) => snapshotFromSpec(spec))

const now = fc
  .integer({ min: Date.UTC(2026, 0, 1), max: Date.UTC(2027, 0, 1) })
  .map((ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'))

const context: fc.Arbitrary<ShellContextInput> = fc.record({
  locale,
  now,
  channel: fc.constantFrom(...CHANNELS),
  soldOutDisplay: fc.constantFrom('show' as const, 'hide' as const),
  orderingEnabled: fc.boolean(),
  tableToken: fc.constantFrom(null, 'table-token'),
})

function items(view: ViewModel): ViewItem[] {
  const walk = (sections: readonly ViewSection[]): ViewItem[] =>
    sections.flatMap((entry) => [...entry.items, ...walk(entry.sections)])
  return walk(view.sections)
}

function isSubsequence(part: readonly string[], whole: readonly string[]): boolean {
  let at = 0
  for (const value of whole) if (value === part[at]) at++
  return at === part.length
}

/** Every `{text, lang}` pair anywhere in a value. */
function texts(value: unknown, found: { text: string; lang: unknown }[] = []) {
  if (Array.isArray(value)) {
    for (const entry of value) texts(entry, found)
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.text === 'string' && 'lang' in record) {
      found.push({ text: record.text, lang: record.lang })
    }
    for (const entry of Object.values(record)) texts(entry, found)
  }
  return found
}

const RANK: Record<ItemState, number> = { available: 0, scheduled: 1, sold_out: 2, unavailable: 3 }

describe('properties of buildViewModel', () => {
  it('same inputs give a deep-equal view model (R14)', () => {
    fc.assert(
      fc.property(snapshot, context, (snap, ctx) => {
        const a = buildViewModel(snap, null, ctx)
        const b = buildViewModel(structuredClone(snap), null, structuredClone(ctx))
        expect(b).toEqual(a)
        expect(JSON.parse(JSON.stringify(a))).toEqual(a)
      }),
      { numRuns: 100 },
    )
  })

  it('no text is ever empty, and each carries a real language (R3)', () => {
    fc.assert(
      fc.property(snapshot, context, (snap, ctx) => {
        const found = texts(buildViewModel(snap, null, ctx))
        expect(found.length).toBeGreaterThan(0)
        for (const entry of found) {
          expect(entry.text.trim()).not.toBe('')
          expect(LOCALES as readonly unknown[]).toContain(entry.lang)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('sections and items keep the snapshot order (R2)', () => {
    fc.assert(
      fc.property(snapshot, context, (snap, ctx) => {
        const view = buildViewModel(snap, null, ctx)
        expect(
          isSubsequence(
            view.sections.map((entry) => entry.id),
            snap.menu.sections,
          ),
        ).toBe(true)
        for (const entry of view.sections) {
          const listed = snap.sections[entry.id]?.items ?? []
          expect(
            isSubsequence(
              entry.items.map((i) => i.id),
              listed,
            ),
          ).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('shows everything, in exactly the snapshot order, when nothing is hidden (R2)', () => {
    fc.assert(
      fc.property(snapshot, context, (snap, ctx) => {
        const view = buildViewModel(snap, null, { ...ctx, channel: 'qr', soldOutDisplay: 'show' })
        expect(view.sections.map((entry) => entry.id)).toEqual(snap.menu.sections)
        for (const entry of view.sections) {
          expect(entry.items.map((i) => i.id)).toEqual(snap.sections[entry.id]?.items)
        }
      }),
      { numRuns: 100 },
    )
  })

  it('an overlay can only make items less available (R5)', () => {
    const overlayed = snapshot.chain((snap) =>
      fc.record({
        snap: fc.constant(snap),
        marked: fc.subarray(Object.keys(snap.items)),
        ctx: context,
      }),
    )
    fc.assert(
      fc.property(overlayed, ({ snap, marked, ctx }) => {
        const overlay = {
          version: snap.snapshot.version,
          items: Object.fromEntries(marked.map((id) => [id, { sold_out: true as const }])),
        }
        // Everything stays on the menu so the two views can be compared item by item.
        const open = {
          ...ctx,
          channel: 'qr' as const,
          soldOutDisplay: 'show' as const,
          orderingEnabled: true,
          tableToken: 'table-token',
        }
        const without = items(buildViewModel(snap, null, open))
        const withOverlay = items(buildViewModel(snap, overlay, open))
        expect(withOverlay.map((i) => i.id)).toEqual(without.map((i) => i.id))
        withOverlay.forEach((after, index) => {
          const before = without[index] as ViewItem
          expect(RANK[after.state.code]).toBeGreaterThanOrEqual(RANK[before.state.code])
          if (after.order.controls) expect(before.order.controls).toBe(true)
          if (!marked.includes(after.id)) expect(after.state.code).toBe(before.state.code)
          if (marked.includes(after.id)) {
            expect(['sold_out', 'unavailable']).toContain(after.state.code)
            expect(after.order.controls).toBe(false)
          }
        })

        // With any setting and channel, the overlay never adds an item to the menu.
        const base = new Set(items(buildViewModel(snap, null, ctx)).map((i) => i.id))
        for (const added of items(buildViewModel(snap, overlay, ctx))) {
          expect(base.has(added.id)).toBe(true)
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('money text (R4)', () => {
  const minor = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })

  /** The digits of a formatted amount, read back as minor units (two fraction digits). */
  const parse = (label: string) => decimalToMinor(`${label.replace(/\D/g, '')}e-2`)

  it('parses back to the same minor units for every locale', () => {
    fc.assert(
      fc.property(minor, locale, (amount, lang) => {
        const shown = viewMoney({ amount_minor: amount, currency: 'EUR' }, 'EUR', lang)
        expect(shown.minor).toBe(amount)
        expect(parse(shown.text)).toBe(amount)
      }),
      { numRuns: 500 },
    )
  })

  it('does so for prices, "from" prices and option deltas', () => {
    fc.assert(
      fc.property(minor, minor, fc.boolean(), locale, (a, b, from, lang) => {
        const strings = stringsFor(lang)
        const money = (amount: number) => ({ amount_minor: amount, currency: 'EUR' as const })
        const price = viewPrice(money(a), from ? money(b) : null, 'EUR', lang, strings)
        expect(price).not.toBeNull()
        expect(price?.from).toBe(from)
        expect(parse(price?.text ?? '')).toBe(from ? b : a)
        expect(parse(price?.amount ?? '')).toBe(from ? b : a)
        const delta = viewDelta(money(b), 'EUR', lang)
        if (b === 0) expect(delta).toBeNull()
        else {
          expect(delta?.text.startsWith('+')).toBe(true)
          expect(parse(delta?.text ?? '')).toBe(b)
        }
      }),
      { numRuns: 300 },
    )
  })
})
