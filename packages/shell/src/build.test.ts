import { LOCALES, type MenuSnapshot } from '@restro/core'
import { describe, expect, it, vi } from 'vitest'

import { fixture, fixtureId, snapshotFromSpec } from '../testing'
import { buildViewModel } from './build'
import type { ShellContextInput } from './context'
import { contrastRatio, MIN_TEXT_CONTRAST } from './palette'
import type { ViewItem, ViewModel, ViewSection } from './view-model'

const WEDNESDAY = '2026-10-07T20:30:00+03:00'
const NBSP = ' '

function build(name: string, context: Partial<ShellContextInput> = {}): ViewModel {
  const f = fixture(name)
  return buildViewModel(f.snapshot, f.overlay, { ...f.context, ...context })
}

function items(view: ViewModel): ViewItem[] {
  const walk = (sections: readonly ViewSection[]): ViewItem[] =>
    sections.flatMap((section) => [...section.items, ...walk(section.sections)])
  return walk(view.sections)
}

const bgen = (bg: string, en: string) => ({ bg_BG: bg, en_US: en })

function tiny(spec: Partial<Parameters<typeof snapshotFromSpec>[0]> = {}): MenuSnapshot {
  return snapshotFromSpec({
    locales: { default: 'bg_BG', available: ['bg_BG', 'en_US'] },
    sections: [
      {
        title: bgen('Напитки', 'Drinks'),
        items: [{ name: bgen('Вода', 'Water') }, { name: bgen('Сок', 'Juice') }],
      },
    ],
    ...spec,
  })
}

describe('R1 visibility', () => {
  it('shows a scheduled item as scheduled on qr and kiosk, with when it opens', () => {
    for (const channel of ['qr', 'kiosk'] as const) {
      const view = build('scheduled', { channel })
      const [shot, burger, water] = items(view)
      expect(shot?.state.code).toBe('scheduled')
      expect(shot?.state.label?.text).toBe('Fri from 22:00')
      expect(shot?.state.schedule).toMatchObject({ opensAt: '22:00', weekday: 5 })
      expect(burger?.state.code).toBe('available')
      expect(water?.state.code).toBe('available')
    }
  })

  it('leaves a scheduled item out on print and tv, and a section left empty with it', () => {
    for (const channel of ['print', 'tv'] as const) {
      const view = build('scheduled', { channel })
      expect(items(view).map((item) => item.name.text)).toEqual(['Burger', 'Water'])
    }
    const snapshot = tiny({
      sections: [
        {
          title: bgen('Нощно', 'Late'),
          items: [
            {
              name: bgen('Шот', 'Shot'),
              schedule: {
                timezone: 'Europe/Sofia',
                rules: [{ days: [5], from: '22:00', to: '23:00' }],
              },
            },
          ],
        },
        { title: bgen('Дневно', 'Day'), items: [{ name: bgen('Вода', 'Water') }] },
      ],
    })
    const view = buildViewModel(snapshot, null, {
      locale: 'en_US',
      now: WEDNESDAY,
      channel: 'print',
    })
    expect(view.sections.map((section) => section.title.text)).toEqual(['Day'])
  })

  it('treats a menu outside its schedule as every item scheduled, and says so', () => {
    const snapshot = tiny({
      menuAvailability: {
        timezone: 'Europe/Sofia',
        rules: [{ days: [1, 2, 3, 4, 5, 6, 7], from: '22:00', to: '23:00' }],
      },
    })
    const view = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    expect(view.menu.schedule?.text.text).toBe('from 22:00')
    expect(items(view).every((item) => item.state.code === 'scheduled')).toBe(true)
  })

  it('leaves a closed item out on print and tv even when it is also sold out', () => {
    const snapshot = tiny({
      sections: [
        {
          title: bgen('Нощно', 'Late'),
          items: [
            {
              name: bgen('Шот', 'Shot'),
              soldOut: true,
              schedule: {
                timezone: 'Europe/Sofia',
                rules: [{ days: [5], from: '22:00', to: '23:00' }],
              },
            },
            { name: bgen('Вода', 'Water') },
          ],
        },
      ],
    })
    const context = { locale: 'en_US', now: WEDNESDAY, soldOutDisplay: 'show' } as const
    const qr = buildViewModel(snapshot, null, { ...context, channel: 'qr' })
    expect(items(qr).map((item) => item.state.code)).toEqual(['sold_out', 'available'])
    const print = buildViewModel(snapshot, null, { ...context, channel: 'print' })
    expect(items(print).map((item) => item.name.text)).toEqual(['Water'])
  })

  it('does not put anything outside the snapshot on the menu', () => {
    const f = fixture('sold-out')
    const view = buildViewModel(f.snapshot, f.overlay, f.context)
    const known = new Set(Object.keys(f.snapshot.items))
    expect(items(view).every((item) => known.has(item.id))).toBe(true)
  })
})

describe('R2 order', () => {
  it('keeps the snapshot order of sections, items, groups and options', () => {
    const f = fixture('deep-modifiers')
    const view = buildViewModel(f.snapshot, null, f.context)
    const [item] = items(view)
    const snapshotItem = Object.values(f.snapshot.items)[0]
    expect(item?.modifierGroups.map((group) => group.id)).toEqual(snapshotItem?.modifier_groups)
    for (const group of item?.modifierGroups ?? []) {
      expect(group.options.map((option) => option.id)).toEqual(
        f.snapshot.modifier_groups[group.id]?.options,
      )
    }
  })

  it('keeps 300 items in order', () => {
    const f = fixture('big-menu')
    const view = buildViewModel(f.snapshot, null, f.context)
    const expected = f.snapshot.menu.sections.flatMap((id) => f.snapshot.sections[id]?.items ?? [])
    expect(items(view).map((item) => item.id)).toEqual(expected)
    expect(expected).toHaveLength(300)
  })
})

describe('R3 language', () => {
  it('falls back from the requested language to the menu default to any available', () => {
    const view = build('six-languages', { locale: 'fr_FR' })
    const [lager, dark, wheat, wine] = items(view)
    expect(lager?.name).toEqual({ text: 'Blonde', lang: 'fr_FR' })
    expect(lager?.description).toMatchObject({ text: 'Леко и свежо', lang: 'bg_BG' })
    expect(dark?.name).toEqual({ text: 'Тъмна бира', lang: 'bg_BG' })
    // No French or Bulgarian: the first of the menu's languages that has a text (German).
    expect(wheat?.name).toEqual({ text: 'Weizen', lang: 'de_DE' })
    // No French and no Bulgarian: English is next in the menu's order.
    expect(wine?.name).toEqual({ text: 'House red', lang: 'en_US' })
    expect(view.sections[1]?.title).toEqual({ text: 'Wine', lang: 'en_US' })
  })

  it('uses the requested language when the text has it', () => {
    const view = build('six-languages', { locale: 'de_DE' })
    expect(items(view)[0]?.name).toEqual({ text: 'Helles', lang: 'de_DE' })
  })

  it('reads a text in a language the menu does not list rather than showing nothing', () => {
    const snapshot = tiny({
      sections: [{ title: { tr_TR: 'İçecek' }, items: [{ name: { tr_TR: 'Su' } }] }],
    })
    const view = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    expect(view.sections[0]?.title).toEqual({ text: 'İçecek', lang: 'tr_TR' })
  })

  it('answers in the menu default when the requested language is not offered', () => {
    const view = build('no-images', { locale: 'de_DE' })
    expect(view.locale).toBe('bg_BG')
    expect(items(view)[0]?.name.lang).toBe('bg_BG')
    expect(items(view)[0]?.price?.amount).toBe(`14,00${NBSP}€`)
  })

  it('leaves out text that is blank in every language instead of showing it empty', () => {
    const snapshot = tiny()
    const [firstId] = Object.keys(snapshot.items)
    const first = firstId === undefined ? undefined : snapshot.items[firstId]
    if (first !== undefined) first.name = { bg_BG: '   ' }
    const view = buildViewModel(snapshot, null, { locale: 'bg_BG', now: WEDNESDAY })
    expect(items(view).map((item) => item.name.text)).toEqual(['Сок'])
  })
})

describe('R4 money', () => {
  it('formats minor units for the locale and the snapshot currency', () => {
    const bg = build('long-names', { locale: 'bg_BG' })
    const en = build('long-names', { locale: 'en_US' })
    expect(items(bg)[1]?.price).toMatchObject({ minor: 1250, amount: `12,50${NBSP}€`, from: false })
    expect(items(en)[1]?.price).toMatchObject({ minor: 1250, amount: '€12.50', text: '€12.50' })
  })

  it('shows price_from as "from …"', () => {
    const bg = items(build('deep-modifiers', { locale: 'bg_BG' }))[0]
    const en = items(build('deep-modifiers', { locale: 'en_US' }))[0]
    expect(bg?.price).toMatchObject({ minor: 1300, from: true, text: `от 13,00${NBSP}€` })
    expect(en?.price).toMatchObject({ minor: 1300, from: true, text: 'from €13.00' })
  })

  it('shows option deltas as +3,00 € and nothing for a free option', () => {
    const snapshot = tiny({
      sections: [
        {
          title: bgen('Коктейли', 'Cocktails'),
          items: [
            {
              name: bgen('Негрони', 'Negroni'),
              groups: [
                {
                  name: bgen('Джин', 'Gin'),
                  min: 0,
                  max: 1,
                  options: [
                    { name: bgen('Стандартен', 'Standard'), delta: 0 },
                    { name: bgen('Премиум', 'Premium'), delta: 300 },
                    { name: bgen('Без цена', 'Unpriced') },
                  ],
                },
              ],
            },
          ],
        },
      ],
    })
    const bg = buildViewModel(snapshot, null, { locale: 'bg_BG', now: WEDNESDAY })
    const options = items(bg)[0]?.modifierGroups[0]?.options ?? []
    expect(options.map((option) => option.delta?.text ?? null)).toEqual([
      null,
      `+3,00${NBSP}€`,
      null,
    ])
    const en = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    expect(items(en)[0]?.modifierGroups[0]?.options[1]?.delta?.text).toBe('+€3.00')
  })

  it('has no price slot for an unpriced item (R7: price when priced)', () => {
    expect(items(build('long-names'))[2]?.price).toBeNull()
  })
})

describe('R5 state', () => {
  it('shows sold out by snapshot or overlay, with the words', () => {
    const view = build('sold-out')
    expect(items(view).map((item) => item.state.code)).toEqual(['sold_out', 'sold_out', 'sold_out'])
    expect(items(view)[0]?.state.label).toEqual({ text: 'Sold out', lang: 'en_US' })
    expect(items(build('sold-out', { locale: 'bg_BG' }))[0]?.state.label?.text).toBe('Изчерпано')
  })

  it('lets the overlay make an item less available, never more', () => {
    const f = fixture('sold-out')
    const [, negroni] = Object.keys(f.snapshot.items)
    expect(f.snapshot.items[negroni ?? '']?.availability.state).toBe('sold_out')
    // An empty overlay does not put the sold-out item back on sale.
    const view = buildViewModel(f.snapshot, { version: 1, items: {} }, f.context)
    expect(items(view)[1]?.state.code).toBe('sold_out')
    const none = buildViewModel(f.snapshot, null, f.context)
    expect(items(none).map((item) => item.state.code)).toEqual([
      'available',
      'sold_out',
      'available',
    ])
  })

  it('still applies an overlay made for another snapshot version: it can only add caution (S3-10)', () => {
    const f = fixture('sold-out')
    const matched = buildViewModel(f.snapshot, f.overlay, f.context)
    const version = f.snapshot.snapshot.version
    for (const other of [version + 1, version + 7, Math.max(1, version - 1)]) {
      const overlay = { ...(f.overlay ?? { items: {} }), version: other }
      // Sold-out marks belong to the service day, not to a version: the same marks apply.
      const view = buildViewModel(f.snapshot, overlay, f.context)
      expect(items(view).map((item) => item.state.code)).toEqual(
        items(matched).map((item) => item.state.code),
      )
      expect(items(view).map((item) => item.state.code)).toEqual([
        'sold_out',
        'sold_out',
        'sold_out',
      ])
    }

    // A mismatched overlay that has no marks does not put the snapshot's sold-out item back on
    // sale, and one that names an item the snapshot lacks adds nothing to the menu.
    const unrelated = {
      version: version + 3,
      items: { [fixtureId('nd', 9999)]: { sold_out: true as const } },
    }
    const view = buildViewModel(f.snapshot, unrelated, f.context)
    expect(items(view).map((item) => item.state.code)).toEqual([
      'available',
      'sold_out',
      'available',
    ])
    expect(items(view)).toHaveLength(items(buildViewModel(f.snapshot, null, f.context)).length)
  })

  it('ignores overlay entries for items that are not in the snapshot', () => {
    const f = fixture('sold-out')
    const overlay = { version: 1, items: { [fixtureId('nd', 9999)]: { sold_out: true as const } } }
    const view = buildViewModel(f.snapshot, overlay, f.context)
    expect(items(view).map((item) => item.state.code)).toEqual([
      'available',
      'sold_out',
      'available',
    ])
  })

  it('applies the menu setting: hide leaves sold-out items out, show keeps them', () => {
    const shown = build('sold-out', { soldOutDisplay: 'show' })
    expect(items(shown)).toHaveLength(3)
    const hidden = build('sold-out', { soldOutDisplay: 'hide' })
    expect(items(hidden)).toHaveLength(0)
    expect(hidden.sections).toHaveLength(0)

    const f = fixture('big-menu')
    const partly = buildViewModel(f.snapshot, null, { ...f.context, soldOutDisplay: 'hide' })
    expect(items(partly).every((item) => item.state.code !== 'sold_out')).toBe(true)
    expect(items(partly).length).toBeLessThan(300)
  })

  it('treats a state it does not know as unavailable, never as available', () => {
    const snapshot = tiny()
    const [id] = Object.keys(snapshot.items)
    const item = id === undefined ? undefined : snapshot.items[id]
    if (item !== undefined) (item.availability as { state: string }).state = 'archived'
    const view = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    expect(items(view)[0]?.state.code).toBe('unavailable')
    expect(items(view)[0]?.state.label?.text).toBe('Unavailable')
    expect(items(view)[0]?.order.controls).toBe(false)
  })

  it('ranks sold out above scheduled for the same item', () => {
    const snapshot = tiny({
      sections: [
        {
          title: bgen('Нощно', 'Late'),
          items: [
            {
              name: bgen('Шот', 'Shot'),
              soldOut: true,
              schedule: {
                timezone: 'Europe/Sofia',
                rules: [{ days: [5], from: '22:00', to: '23:00' }],
              },
            },
          ],
        },
      ],
    })
    const view = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    expect(items(view)[0]?.state.code).toBe('sold_out')
  })
})

describe('R6 allergens', () => {
  it('gives each item its allergens with codes, numbers and names in the language', () => {
    const view = build('long-names', { locale: 'bg_BG' })
    const mojito = items(view)[1]
    expect(mojito?.allergens).toEqual([
      { code: 'eggs', number: 3, label: { text: 'Яйца', lang: 'bg_BG' } },
      { code: 'milk', number: 7, label: { text: 'Мляко', lang: 'bg_BG' } },
    ])
    expect(items(build('long-names', { locale: 'en_US' }))[1]?.allergens[0]?.label.text).toBe(
      'Eggs',
    )
  })

  it('includes the legend of what is on the menu, numbered in the EU order', () => {
    const view = build('long-names', { locale: 'en_US' })
    expect(
      view.allergenLegend.map((entry) => [entry.number, entry.code, entry.label.text]),
    ).toEqual([
      [3, 'eggs', 'Eggs'],
      [7, 'milk', 'Milk'],
      [8, 'nuts', 'Nuts'],
      [12, 'sulphites', 'Sulphites'],
    ])
  })

  it('leaves an allergen out of the legend when its only items are not shown', () => {
    const shown = build('sold-out', { soldOutDisplay: 'show' })
    expect(shown.allergenLegend.map((entry) => entry.code)).toEqual(['eggs', 'sulphites'])
    expect(build('sold-out', { soldOutDisplay: 'hide' }).allergenLegend).toEqual([])
  })
})

describe('R7/R8 required and empty slots', () => {
  it('always has name and state, and collapses what is empty', () => {
    const view = build('no-images')
    for (const item of items(view)) {
      expect(item.name.text.length).toBeGreaterThan(0)
      expect(item.state.code).toBeDefined()
      expect(item.description).toBeNull()
      expect(item.badges).toEqual([])
      expect(item.portion).toBeNull()
      expect(item.dietary).toEqual([])
      expect(item.tags).toEqual([])
      expect(item.extraFields).toEqual([])
      expect(item.modifierGroups).toEqual([])
    }
  })

  it('never uses placeholder text for an empty value', () => {
    const json = JSON.stringify(build('no-images'))
    expect(json).not.toMatch(/no value|n\/a|placeholder|undefined/i)
  })
})

describe('R9 text length', () => {
  it('never shortens a name', () => {
    const view = build('long-names', { locale: 'en_US' })
    expect(items(view)[0]?.name.text).toHaveLength(60)
    expect(items(build('long-names', { locale: 'bg_BG' }))[0]?.name.text).toHaveLength(60)
  })

  it('lets only qr and kiosk cut a description', () => {
    const f = fixture('tags-dietary')
    const description = (channel: 'qr' | 'kiosk' | 'print' | 'tv') =>
      items(buildViewModel(f.snapshot, null, { ...f.context, channel }))[0]?.description
        ?.truncatable
    expect(description('qr')).toBe(true)
    expect(description('kiosk')).toBe(true)
    expect(description('print')).toBe(false)
    expect(description('tv')).toBe(false)
  })
})

describe('R10 images', () => {
  it('picks the declared variant at 1x and the next larger on a dense screen', () => {
    const f = fixture('with-images')
    const at = (variant: 'thumb' | 'card' | 'full', density: number) =>
      items(
        buildViewModel(f.snapshot, null, { ...f.context, images: { item: { variant, density } } }),
      )[0]?.image
    expect(at('card', 1)?.src).toMatch(/\/w640\.webp$/)
    expect(at('card', 1)).toMatchObject({ variant: 'card', width: 640 })
    expect(at('card', 2)).toMatchObject({ variant: 'full', width: 1280 })
    expect(at('thumb', 2)).toMatchObject({ variant: 'card' })
    expect(at('thumb', 1)).toMatchObject({ variant: 'thumb', width: 320 })
    expect(at('full', 3)).toMatchObject({ variant: 'full' })
  })

  it('passes the focal point through, and the original proportions', () => {
    const view = build('with-images')
    const [plain, focal] = items(view)
    expect(plain?.image).toMatchObject({
      focal: null,
      objectPosition: '50% 50%',
      sourceWidth: 1600,
      sourceHeight: 1200,
    })
    expect(focal?.image).toMatchObject({ focal: { x: 0.3, y: 0.75 }, objectPosition: '30% 75%' })
  })

  it('lists the distinct files of the asset, narrowest first, for a srcset', () => {
    const [plain] = items(build('with-images'))
    const files = plain?.image?.variants ?? []
    expect(files.length).toBeGreaterThan(0)
    expect(files.map((file) => file.width)).toEqual(
      [...files.map((file) => file.width)].sort((a, b) => a - b),
    )
    expect(new Set(files.map((file) => file.src)).size).toBe(files.length)
    expect(files.map((file) => file.src)).toContain(plain?.image?.src)
    for (const file of files) expect(file.src).toMatch(/^\/a\/as_[0-9A-Za-z]+\/w\d+\.webp$/)
  })

  it('describes the picture with its own text, else the item name', () => {
    const [negroni, margarita] = items(build('with-images', { locale: 'en_US' }))
    expect(negroni?.image?.alt).toEqual({ text: 'Negroni on ice', lang: 'en_US' })
    expect(margarita?.image?.alt).toEqual({ text: 'Margarita', lang: 'en_US' })
  })

  it('flags an item without an image', () => {
    const [, , water] = items(build('with-images'))
    expect(water).toMatchObject({ image: null, noImage: true })
    expect(items(build('no-images')).every((item) => item.noImage)).toBe(true)
  })
})

describe('R11 ordering', () => {
  const ordering = { orderingEnabled: true, tableToken: 'fixture-table-token' } as const

  it('shows no ordering controls in Stage 3 (ordering off)', () => {
    const view = build('ask-waiter', { orderingEnabled: false })
    expect(view.ordering.enabled).toBe(false)
    expect(items(view).map((item) => item.order.controls)).toEqual([false, false])
  })

  it('computes controls for an orderable, available item with ordering on and a table', () => {
    const view = build('ask-waiter', ordering)
    expect(view.ordering.enabled).toBe(true)
    expect(items(view).map((item) => item.order.controls)).toEqual([false, true])
  })

  it('needs the table token, a channel that orders, and an available item', () => {
    expect(build('ask-waiter', { ...ordering, tableToken: null }).ordering.enabled).toBe(false)
    expect(build('ask-waiter', { ...ordering, channel: 'print' }).ordering.enabled).toBe(false)
    expect(build('ask-waiter', { ...ordering, channel: 'kiosk' }).ordering.enabled).toBe(true)
    const sold = build('sold-out', ordering)
    expect(items(sold).every((item) => !item.order.controls)).toBe(true)
  })

  it('shows "Ask your waiter" for an ask_waiter item, with its price', () => {
    const [bottle, shot] = items(build('ask-waiter'))
    expect(bottle?.order.askWaiter).toEqual({ text: 'Ask your waiter', lang: 'en_US' })
    expect(bottle?.price?.minor).toBe(12000)
    expect(shot?.order.askWaiter).toBeNull()
    expect(items(build('ask-waiter', { locale: 'bg_BG' }))[0]?.order.askWaiter?.text).toBe(
      'Попитайте сервитьора',
    )
    expect(items(build('ask-waiter', { channel: 'print' }))[0]?.order.askWaiter).toBeNull()
  })
})

describe('R12 custom fields', () => {
  it('lists public fields in template order, formatted by type', () => {
    const [negroni, hummus] = items(build('tags-dietary', { locale: 'bg_BG' }))
    expect(negroni?.extraFields.map((field) => field.key)).toEqual([
      'abv',
      'origin',
      'vegan_friendly',
    ])
    expect(negroni?.extraFields[0]).toMatchObject({
      type: 'number',
      label: { text: 'Алкохол', lang: 'bg_BG' },
      text: `24${NBSP}%`,
      lang: null,
    })
    expect(negroni?.extraFields[1]).toMatchObject({ text: 'Italy', lang: null })
    expect(negroni?.extraFields[2]).toMatchObject({ text: 'Да', lang: 'bg_BG' })
    expect(hummus?.extraFields.map((field) => field.key)).toEqual(['origin'])
  })

  it('leaves out a field the item has no value for', () => {
    expect(items(build('no-images')).every((item) => item.extraFields.length === 0)).toBe(true)
  })
})

describe('R13 theme', () => {
  it('turns the palette into steps and readable semantic colours', () => {
    const { theme } = build('no-images')
    expect(Object.keys(theme.palette)).toHaveLength(11)
    const { colors } = theme
    for (const [text, on] of [
      [colors.text, colors.background],
      [colors.text, colors.surface],
      [colors.muted, colors.surface],
      [colors.onAccent, colors.accent],
    ] as const) {
      expect(contrastRatio(text, on)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
    expect(theme).toMatchObject({ font: 'Inter', radius: 8, shadow: 1, logo: null })
  })

  it('carries the same colours for a dark screen, readable too', () => {
    const { colorsDark } = build('no-images').theme
    for (const [text, on] of [
      [colorsDark.text, colorsDark.background],
      [colorsDark.text, colorsDark.surface],
      [colorsDark.muted, colorsDark.surface],
      [colorsDark.accentText, colorsDark.surface],
      [colorsDark.onAccent, colorsDark.accent],
    ] as const) {
      expect(contrastRatio(text, on)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })

  it('gives a section colour hint a readable text colour', () => {
    const snapshot = tiny({
      sections: [
        { title: bgen('Бар', 'Bar'), color: '#ffe066', items: [{ name: bgen('Вода', 'Water') }] },
      ],
    })
    const view = buildViewModel(snapshot, null, { locale: 'en_US', now: WEDNESDAY })
    const hints = view.sections[0]?.hints
    expect(hints?.color).toBe('#ffe066')
    expect(contrastRatio(hints?.onColor ?? '#fff', '#ffe066')).toBeGreaterThanOrEqual(
      MIN_TEXT_CONTRAST,
    )
  })
})

describe('R14 determinism', () => {
  it('gives deep-equal view models for equal inputs, and does not touch them', () => {
    const f = fixture('tags-dietary')
    const before = structuredClone({ snapshot: f.snapshot, overlay: f.overlay, context: f.context })
    const a = buildViewModel(f.snapshot, f.overlay, f.context)
    const b = buildViewModel(
      structuredClone(f.snapshot),
      structuredClone(f.overlay),
      structuredClone(f.context),
    )
    expect(a).toEqual(b)
    expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    expect({ snapshot: f.snapshot, overlay: f.overlay, context: f.context }).toEqual(before)
  })

  it('reads neither the clock nor a random source', () => {
    const now = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('the shell read the clock')
    })
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('the shell used a random number')
    })
    try {
      for (const name of ['scheduled', 'six-languages', 'with-images']) {
        expect(() => build(name)).not.toThrow()
      }
    } finally {
      now.mockRestore()
      random.mockRestore()
    }
  })

  it('does not depend on the system time (only on context.now)', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2000-01-01T00:00:00Z'))
      const early = build('scheduled')
      vi.setSystemTime(new Date('2035-06-15T12:00:00Z'))
      const late = build('scheduled')
      expect(late).toEqual(early)
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves with the context time', () => {
    const friday = build('scheduled', { now: '2026-10-09T22:30:00+03:00' })
    expect(items(friday)[0]?.state.code).toBe('available')
    const wednesday = build('scheduled', { now: WEDNESDAY })
    expect(items(wednesday)[0]?.state.code).toBe('scheduled')
  })

  it('refuses a malformed context', () => {
    const f = fixture('no-images')
    expect(() => buildViewModel(f.snapshot, null, { locale: 'bg_BG', now: 'yesterday' })).toThrow()
    expect(() =>
      buildViewModel(f.snapshot, null, { locale: 'xx_XX' as never, now: WEDNESDAY }),
    ).toThrow()
    expect(() =>
      buildViewModel(f.snapshot, null, { locale: 'bg_BG', now: WEDNESDAY, timeZone: 'Mars/Base' }),
    ).toThrow()
  })

  it('defaults to qr, Europe/Sofia, ordering off and sold-out items shown', () => {
    const f = fixture('no-images')
    const view = buildViewModel(f.snapshot, null, { locale: 'bg_BG', now: WEDNESDAY })
    expect(view.channel).toBe('qr')
    expect(view.ordering.enabled).toBe(false)
  })
})

describe('tags, dietary labels and badges', () => {
  it('resolves tag ids to localized labels and lists the tags on the menu', () => {
    const view = build('tags-dietary', { locale: 'bg_BG' })
    const [negroni] = items(view)
    expect(negroni?.tags.map((tag) => [tag.id, tag.label.text, tag.label.lang])).toEqual([
      [fixtureId('tg', 1), 'Фирмено', 'bg_BG'],
      [fixtureId('tg', 2), 'Spicy', 'en_US'],
    ])
    expect(view.filters.tags.map((tag) => tag.label.text)).toEqual(['Фирмено', 'Spicy'])
  })

  it('names dietary labels in the language and lists them for the filter', () => {
    const bg = build('tags-dietary', { locale: 'bg_BG' })
    expect(items(bg)[0]?.dietary.map((d) => d.label.text)).toEqual(['Веган', 'Без глутен'])
    const en = build('tags-dietary', { locale: 'en_US' })
    expect(items(en)[0]?.dietary.map((d) => d.label.text)).toEqual(['Vegan', 'Gluten-free'])
    expect(en.filters.dietary.map((d) => d.code)).toEqual(['vegan', 'vegetarian', 'gluten_free'])
  })

  it('passes the new badge through and shows a portion', () => {
    const bg = items(build('tags-dietary', { locale: 'bg_BG' }))[0]
    expect(bg?.badges).toEqual([{ kind: 'new', label: { text: 'Ново', lang: 'bg_BG' } }])
    expect(bg?.portion).toEqual({ value: 90, unit: 'ml', text: `90${NBSP}мл` })
    expect(items(build('tags-dietary', { locale: 'en_US' }))[0]?.badges[0]?.label.text).toBe('New')
  })

  it('does not repeat a dietary label or tag as a badge', () => {
    const f = fixture('tags-dietary')
    const [id] = Object.keys(f.snapshot.items)
    const item = id === undefined ? undefined : f.snapshot.items[id]
    if (item !== undefined)
      item.badges = ['new', 'vegan', 'halal', fixtureId('tg', 1), fixtureId('tg', 2)]
    const [negroni] = items(buildViewModel(f.snapshot, null, f.context))
    // vegan and both tags are in their own slots already; halal is only a badge.
    expect(negroni?.badges.map((badge) => badge.kind)).toEqual(['new', 'dietary'])
    expect(negroni?.badges[1]).toMatchObject({ kind: 'dietary', code: 'halal' })
  })

  it('has no filters for a menu without tags or dietary labels', () => {
    expect(build('no-images').filters).toEqual({ tags: [], dietary: [] })
  })
})

describe('ids (rule 3)', () => {
  it('shows only nd_, as_ and tg_ ids anywhere in the view model', () => {
    for (const name of ['tags-dietary', 'with-images', 'deep-modifiers', 'sold-out']) {
      const json = JSON.stringify(build(name))
      const kinds = new Set([...json.matchAll(/\b([a-z]{2})_[0-9A-Za-z]{22}\b/g)].map((m) => m[1]))
      for (const kind of kinds) expect(['nd', 'as', 'tg']).toContain(kind)
    }
  })
})

describe('every language the shell can be asked for', () => {
  it('builds a view model for each of the 11 locales without throwing', () => {
    const f = fixture('six-languages')
    for (const locale of LOCALES) {
      const view = buildViewModel(f.snapshot, null, { ...f.context, locale })
      expect(items(view).length).toBeGreaterThan(0)
    }
  })
})
