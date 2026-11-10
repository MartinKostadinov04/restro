// Reading a design that was written against another version of the option list (D130; designer
// audit DA-15, DA-33, DA-28). The list keeps moving: an option is added, removed or renamed, and
// what was stored before that stays stored. `readDesignValues` is therefore total — every block
// reads as a whole, drawable design — while everything written still goes through the strict
// `DesignValuesSchema`.
//
// The records built here are the ones migration 0051 wrote (its `overrides` is carried over
// whenever it is a JSON object, junk inside and all): the cases are B3's `overrides*` rows of the
// audit's `apps/web/src/da-b3/migration-0045.test.ts`.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { DESIGN_PAGES, type DesignValues } from './contract'
import {
  BASIC_DESIGN_VALUES,
  DEFAULT_DESIGN,
  hasInvalidDesign,
  readDesign,
  readDesignRecord,
  readDesignToShow,
} from './record'
import { DesignValuesSchema, readDesignValues } from './schema'

const COLOURS = { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' }
const LOGO = `as_${'L'.repeat(22)}`

/** A design that is not Basic in three places, so a fallback to Basic's value shows. */
const CHOSEN: DesignValues = {
  ...BASIC_DESIGN_VALUES,
  general: { ...BASIC_DESIGN_VALUES.general, corners: 'round', screen: 'dark' },
  items: { ...BASIC_DESIGN_VALUES.items, layout: 'two' },
}

/**
 * The record migration 0051 writes: it carries `overrides` over exactly when the stored theme held
 * a JSON object there (`jsonb_typeof(...) = 'object'`), whatever is inside it, and drops anything
 * else. Everything else of the record is Basic's, with the venue's colours and logo.
 */
function record(overrides: unknown, values: DesignValues = CHOSEN): Record<string, unknown> {
  const carried = typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)
  return {
    revision: 1,
    style: 'basic',
    values,
    colors: COLOURS,
    logo_asset_id: LOGO,
    ...(carried ? { overrides } : {}),
    provenance: {
      layer: 'manual',
      source: 'manual',
      actor: 'system',
      job_id: 'migration:0051_design_record',
      change_set_id: null,
    },
  }
}

const settingsWith = (design: unknown) => ({ design })

/** A page of a block a test is about to change (every page of `CHOSEN` is there). */
function page(block: Record<string, unknown>, id: string): Record<string, unknown> {
  const own = block[id]
  if (own === undefined) throw new Error(`no page ${id}`)
  return own as Record<string, unknown>
}

describe('readDesignValues: a block from an older or newer option list', () => {
  it('takes every value the contract still lists, and Basic’s for the rest (D130)', () => {
    const added = structuredClone(CHOSEN) as Record<string, unknown>
    delete page(added, 'items').layout
    expect(readDesignValues(added).items.layout).toBe(BASIC_DESIGN_VALUES.items.layout)
    expect(readDesignValues(added).general).toEqual(CHOSEN.general)

    const renamed = structuredClone(CHOSEN) as Record<string, unknown>
    page(renamed, 'general').corners = 'rounded'
    expect(readDesignValues(renamed).general.corners).toBe(BASIC_DESIGN_VALUES.general.corners)
    expect(readDesignValues(renamed).general.screen).toBe('dark')
    expect(readDesignValues(renamed).items).toEqual(CHOSEN.items)
  })

  it('drops an option, and a page, the contract no longer lists', () => {
    const retired = structuredClone(CHOSEN) as Record<string, unknown>
    page(retired, 'items').sparkle = 'on'
    retired.footer = { colour: 'red' }
    expect(readDesignValues(retired)).toEqual(CHOSEN)
  })

  it('never throws, whatever is stored, and always gives a drawable design', () => {
    for (const stored of [undefined, null, 'basic', [], 42, { general: 'dark' }, { values: {} }]) {
      const values = readDesignValues(stored)
      expect(DesignValuesSchema.safeParse(values).success).toBe(true)
      expect(values).toEqual(BASIC_DESIGN_VALUES)
    }
  })

  it('falls back to the values the caller gives before Basic’s', () => {
    const missing = { general: {} }
    expect(readDesignValues(missing, CHOSEN).general.corners).toBe('round')
    // A fallback that is itself off the list is not trusted either.
    const odd = readDesignValues(missing, { general: { corners: 'rounded' } } as never)
    expect(odd.general.corners).toBe(BASIC_DESIGN_VALUES.general.corners)
  })

  it('reads its own output back unchanged (a read is settled, not a step)', () => {
    const once = readDesignValues({ ...CHOSEN, footer: {} })
    expect(readDesignValues(once)).toEqual(once)
  })

  // DA-15's property: a block from any version of the option list reads as a drawable design, and
  // every value the contract still lists is kept as it was stored.
  it('holds for any older or newer block (property)', () => {
    const pageIds = DESIGN_PAGES.map((page) => page.id)
    const choiceIds = (pageId: string) =>
      (DESIGN_PAGES.find((page) => page.id === pageId)?.options ?? []).flatMap((option) =>
        option.kind === 'choice' ? [option.id] : [],
      )
    const mutation = fc.oneof(
      fc.record({ kind: fc.constant('dropPage' as const), page: fc.constantFrom(...pageIds) }),
      fc.record({
        kind: fc.constant('dropOption' as const),
        page: fc.constantFrom(...pageIds),
        index: fc.nat(20),
      }),
      fc.record({
        kind: fc.constant('renameValue' as const),
        page: fc.constantFrom(...pageIds),
        index: fc.nat(20),
        value: fc.oneof(fc.string(), fc.constant(7), fc.constant(null)),
      }),
      fc.record({
        kind: fc.constant('addOption' as const),
        page: fc.constantFrom(...pageIds),
        name: fc.string({ minLength: 1 }),
      }),
      fc.record({ kind: fc.constant('addPage' as const), name: fc.string({ minLength: 1 }) }),
      fc.record({ kind: fc.constant('breakPage' as const), page: fc.constantFrom(...pageIds) }),
    )
    fc.assert(
      fc.property(fc.array(mutation, { maxLength: 8 }), (mutations) => {
        const block = structuredClone(CHOSEN) as Record<string, unknown>
        for (const change of mutations) {
          if (change.kind === 'addPage') {
            block[change.name] = { a: 'b' }
            continue
          }
          if (change.kind === 'dropPage') {
            delete block[change.page]
            continue
          }
          if (change.kind === 'breakPage') {
            block[change.page] = 'not a page'
            continue
          }
          const held = block[change.page]
          if (typeof held !== 'object' || held === null) continue
          const own = held as Record<string, unknown>
          if (change.kind === 'addOption') {
            own[change.name] = 'whatever'
            continue
          }
          const ids = choiceIds(change.page)
          const id = ids[change.index % Math.max(ids.length, 1)]
          if (id === undefined) continue
          if (change.kind === 'dropOption') delete own[id]
          else own[id] = change.value
        }
        const values = readDesignValues(block) as unknown as Record<string, Record<string, string>>
        // Drawable: the strict schema, the renderer's own, accepts it.
        expect(DesignValuesSchema.safeParse(values).success).toBe(true)
        // Nothing invented: a value the block still holds, and the contract still lists, is kept.
        for (const pageId of pageIds) {
          const stored = block[pageId]
          if (typeof stored !== 'object' || stored === null) continue
          for (const id of choiceIds(pageId)) {
            const was = (stored as Record<string, unknown>)[id]
            const listed = DesignValuesSchema.safeParse({
              ...BASIC_DESIGN_VALUES,
              [pageId]: {
                ...(BASIC_DESIGN_VALUES as unknown as Record<string, object>)[pageId],
                [id]: was,
              },
            }).success
            if (listed) expect(values[pageId]?.[id]).toBe(was)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})

describe('readDesignToShow: a stored record that does not parse (DA-33, DA-28)', () => {
  it('gives a valid record as it is, and Basic for a venue that has none', () => {
    const valid = settingsWith(record(undefined))
    expect(readDesignToShow(valid)).toEqual({
      revision: 1,
      design: { style: 'basic', values: CHOSEN, colors: COLOURS, logo_asset_id: LOGO },
      repair: false,
    })
    expect(readDesignToShow({})).toEqual({ revision: 0, design: DEFAULT_DESIGN, repair: false })
  })

  it('reads the colours, the logo and every value it can out of a row the contract moved past', () => {
    const moved = structuredClone(CHOSEN) as Record<string, unknown>
    page(moved, 'general').corners = 'rounded'
    const settings = settingsWith(record(undefined, moved as unknown as DesignValues))
    // The plain read (what `apply` compares against, what the publisher would draw) stays Basic.
    expect(readDesign(settings).design).toEqual(DEFAULT_DESIGN)
    expect(hasInvalidDesign(settings)).toBe(true)
    const shown = readDesignToShow(settings)
    expect(shown.repair).toBe(true)
    expect(shown.revision).toBe(1)
    expect(shown.design.colors).toEqual(COLOURS)
    expect(shown.design.logo_asset_id).toBe(LOGO)
    expect(shown.design.values.general.screen).toBe('dark')
    expect(shown.design.values.items.layout).toBe('two')
    expect(shown.design.values.general.corners).toBe(BASIC_DESIGN_VALUES.general.corners)
    expect(DesignValuesSchema.safeParse(shown.design.values).success).toBe(true)
  })

  // B3's `overrides*` cases: what migration 0051 carried over from a hand-edited theme.
  const CARRIED: Record<string, unknown> = {
    overridesSchemeString: { light: 'red' },
    overridesBadHex: { light: { accent: 'not-a-colour' } },
    overridesUnknownScheme: { sepia: {} },
    overridesNested: { light: { accent: { deep: [1] } } },
    overridesUnknownRole: { light: { glow: '#ffffff' } },
  }

  it('still refuses such a record, so the publisher still says to save the design again', () => {
    for (const [name, overrides] of Object.entries(CARRIED)) {
      const settings = settingsWith(record(overrides))
      expect(readDesignRecord(settings), name).toBeNull()
      expect(hasInvalidDesign(settings), name).toBe(true)
    }
    // The two shapes 0051 did not carry (not objects) leave a record that reads.
    for (const overrides of ['x', [{ light: {} }]]) {
      expect(readDesignRecord(settingsWith(record(overrides)))).not.toBeNull()
    }
  })

  it('shows the look without the junk inside the overrides, never plain Basic', () => {
    for (const [name, overrides] of Object.entries(CARRIED)) {
      const shown = readDesignToShow(settingsWith(record(overrides)))
      expect(shown.repair, name).toBe(true)
      expect(shown.design.colors, name).toEqual(COLOURS)
      expect(shown.design.values, name).toEqual(CHOSEN)
      expect(shown.design.overrides, name).toBeUndefined()
      expect(shown.design, name).not.toEqual(DEFAULT_DESIGN)
    }
  })

  it('keeps the Advanced roles that are colours and drops the rest', () => {
    const shown = readDesignToShow(
      settingsWith(
        record({
          light: { accent: '#112233', glow: '#ffffff', text: 'red' },
          dark: { surface: 'nope' },
          sepia: { accent: '#000000' },
        }),
      ),
    )
    expect(shown.design.overrides).toEqual({ light: { accent: '#112233' } })
  })

  it('reads a brand-only row, and a row that is not an object at all', () => {
    const brandOnly = readDesignToShow(
      settingsWith({ ...record({ light: 'red' }), colors: undefined, brand: '#2563EB' }),
    )
    expect(brandOnly.design.brand).toBe('#2563eb')
    expect(brandOnly.design.colors).toBeUndefined()
    for (const stored of [null, [], 'text', 42, { revision: 'x' }]) {
      const shown = readDesignToShow(settingsWith(stored))
      expect(shown.repair).toBe(true)
      expect(shown.design).toEqual(DEFAULT_DESIGN)
      expect(shown.revision).toBe(0)
    }
  })
})
