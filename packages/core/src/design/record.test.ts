// The design record's pure rules (D129, D130): what reads as a record, what a venue without one
// reads as, the words the old sliders map to, and which change sets may carry a save.
import { describe, expect, it } from 'vitest'

import { ChangeSetSchema } from '../change-set'
import { newId } from '../ids'
import { DESIGN_PAGES } from './contract'
import {
  BASIC_DESIGN_VALUES,
  CORNER_RADIUS,
  cornersOfRadius,
  DEFAULT_DESIGN,
  DEPTH_SHADOW,
  DesignContentSchema,
  DesignRecordSchema,
  depthOfShadow,
  designContentOf,
  designThemeOf,
  readDesign,
  readDesignRecord,
  sameDesign,
} from './record'

const COLOURS = { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' }

const provenance = {
  layer: 'manual',
  source: 'manual',
  actor: 'user:us_test',
  job_id: 'jb_test',
  change_set_id: null,
}
const record = (fields: Record<string, unknown> = {}) => ({
  ...DEFAULT_DESIGN,
  revision: 3,
  provenance,
  ...fields,
})

describe('Basic’s values', () => {
  it('hold the first value of every choice option of the contract, and nothing else', () => {
    for (const page of DESIGN_PAGES) {
      const values = BASIC_DESIGN_VALUES[page.id] as Record<string, string>
      const choices = page.options.filter((option) => option.kind === 'choice')
      expect(Object.keys(values).sort(), page.id).toEqual(choices.map((c) => c.id).sort())
      for (const option of choices) expect(values[option.id]).toBe(option.values[0].id)
    }
  })
})

describe('reading a venue’s settings', () => {
  it('gives Basic at revision 0 to a venue with no record', () => {
    for (const settings of [{}, null, undefined, 'x', [], { theme: { brand: '#aabbcc' } }]) {
      expect(readDesign(settings), JSON.stringify(settings)).toEqual({
        revision: 0,
        design: DEFAULT_DESIGN,
      })
      expect(readDesignRecord(settings)).toBeNull()
    }
  })

  it('reads a record, without its revision and provenance in the design', () => {
    const settings = { design: record({ colors: COLOURS }) }
    expect(readDesignRecord(settings)?.provenance).toEqual(provenance)
    expect(readDesign(settings)).toEqual({
      revision: 3,
      design: { ...DEFAULT_DESIGN, colors: COLOURS },
    })
  })

  it('reads an option added after the record was saved as Basic’s value', () => {
    const { items, ...pages } = BASIC_DESIGN_VALUES
    const { layout: _layout, ...otherItems } = items
    const settings = { design: record({ values: { ...pages, items: otherItems } }) }
    expect(readDesign(settings).design.values).toEqual(BASIC_DESIGN_VALUES)
    const noPage = { design: record({ values: pages }) }
    expect(readDesign(noPage).design.values).toEqual(BASIC_DESIGN_VALUES)
  })

  it('reads a stored value that is not a record as Basic, keeping its revision for the next save', () => {
    const settings = { design: record({ style: 'nope' }) }
    expect(readDesignRecord(settings)).toBeNull()
    expect(readDesign(settings)).toEqual({ revision: 3, design: DEFAULT_DESIGN })
    expect(readDesign({ design: { revision: 'x' } }).revision).toBe(0)
    expect(readDesign({ design: { revision: -2 } }).revision).toBe(0)
  })
})

describe('the record’s schema', () => {
  it('refuses a value off the contract, an unknown option and an unknown page', () => {
    const { general, items } = BASIC_DESIGN_VALUES
    for (const values of [
      { ...BASIC_DESIGN_VALUES, items: { ...items, layout: 'grid' } },
      { ...BASIC_DESIGN_VALUES, general: { ...general, sparkle: 'on' } },
      { ...BASIC_DESIGN_VALUES, footer: {} },
    ]) {
      expect(DesignContentSchema.safeParse({ ...DEFAULT_DESIGN, values }).success).toBe(false)
      expect(DesignRecordSchema.safeParse(record({ values })).success).toBe(false)
    }
  })

  it('holds three colours or one brand colour, never both', () => {
    const both = { ...DEFAULT_DESIGN, colors: COLOURS, brand: '#2563eb' }
    expect(DesignContentSchema.safeParse(both).success).toBe(false)
    expect(DesignRecordSchema.safeParse(record(both)).success).toBe(false)
  })

  it('refuses a record without its provenance, or by an actor a design cannot have', () => {
    const { provenance: _none, ...without } = record()
    expect(DesignRecordSchema.safeParse(without).success).toBe(false)
    for (const actor of ['integration:in_x', 'someone', '']) {
      expect(
        DesignRecordSchema.safeParse(record({ provenance: { ...provenance, actor } })).success,
        actor,
      ).toBe(false)
    }
  })
})

describe('the old sliders’ words', () => {
  it('map each word’s own amount back to that word', () => {
    for (const [word, radius] of Object.entries(CORNER_RADIUS)) {
      expect(cornersOfRadius(radius)).toBe(word)
    }
    for (const [word, shadow] of Object.entries(DEPTH_SHADOW)) {
      expect(depthOfShadow(shadow)).toBe(word)
    }
  })

  it('take the nearest word, a tie going to the larger', () => {
    const corners: [number, string][] = [
      [1, 'square'],
      [3, 'square'],
      [4, 'soft'],
      [6, 'soft'],
      [11, 'soft'],
      [12, 'round'],
      [18, 'round'],
      [20, 'extra'],
      [32, 'extra'],
    ]
    for (const [radius, word] of corners) expect(cornersOfRadius(radius), `${radius}`).toBe(word)
    expect(depthOfShadow(0.4)).toBe('none')
    expect(depthOfShadow(0.5)).toBe('low')
    expect(depthOfShadow(5)).toBe('low')
  })
})

describe('a design as a look', () => {
  it('Basic with no colours is the look a venue has by default', () => {
    expect(designThemeOf(DEFAULT_DESIGN)).toEqual({
      logo_asset_id: null,
      font: 'inter',
      radius: 8,
      shadow: 1,
      scheme: 'auto',
    })
  })

  it('carries the colours, roles, logo and the words as numbers', () => {
    const logo = newId('as')
    const overrides = { dark: { border: '#334455' } }
    const design = {
      ...DEFAULT_DESIGN,
      colors: COLOURS,
      overrides,
      logo_asset_id: logo,
      values: {
        ...BASIC_DESIGN_VALUES,
        general: {
          ...BASIC_DESIGN_VALUES.general,
          body_font: 'lora',
          corners: 'extra',
          depth: 'none',
          screen: 'dark',
        },
      },
    } as typeof DEFAULT_DESIGN
    expect(designThemeOf(design)).toEqual({
      colors: COLOURS,
      overrides,
      logo_asset_id: logo,
      font: 'lora',
      radius: 24,
      shadow: 0,
      scheme: 'dark',
    })
  })

  it('compares by content, whatever the order of the keys', () => {
    const a = { ...DEFAULT_DESIGN, colors: COLOURS }
    const b = designContentOf({
      logo_asset_id: null,
      colors: { tertiary: '#e0a43a', primary: '#f5f1ea', secondary: '#e7e0d4' },
      values: BASIC_DESIGN_VALUES,
      style: 'basic',
    })
    expect(sameDesign(a, b)).toBe(true)
    expect(sameDesign(a, DEFAULT_DESIGN)).toBe(false)
  })
})

describe('the change set that saves a design', () => {
  const set = (fields: Record<string, unknown> = {}) => ({
    id: newId('cs'),
    source: 'manual',
    jobId: newId('jb'),
    actor: 'user:us_test',
    observedAt: '2026-10-30T10:00:00Z',
    ops: [{ op: 'setDesign', venueId: newId('vn'), expectedRevision: 0, design: DEFAULT_DESIGN }],
    ...fields,
  })

  it('is the manual source’s, by a person or the system', () => {
    expect(ChangeSetSchema.safeParse(set()).success).toBe(true)
    expect(ChangeSetSchema.safeParse(set({ actor: 'system' })).success).toBe(true)
  })

  it('never comes from a till, nor names an integration as its actor', () => {
    expect(ChangeSetSchema.safeParse(set({ source: 'till:in_x' })).success).toBe(false)
    expect(ChangeSetSchema.safeParse(set({ actor: 'integration:in_x' })).success).toBe(false)
  })

  it('names a whole number revision and a design on the contract', () => {
    const op = { op: 'setDesign', venueId: newId('vn'), design: DEFAULT_DESIGN }
    expect(ChangeSetSchema.safeParse(set({ ops: [op] })).success).toBe(false)
    for (const expectedRevision of [-1, 1.5, '1']) {
      expect(
        ChangeSetSchema.safeParse(set({ ops: [{ ...op, expectedRevision }] })).success,
        String(expectedRevision),
      ).toBe(false)
    }
    const offContract = {
      ...DEFAULT_DESIGN,
      values: {
        ...BASIC_DESIGN_VALUES,
        items: { ...BASIC_DESIGN_VALUES.items, layout: 'grid' },
      },
    }
    expect(
      ChangeSetSchema.safeParse(set({ ops: [{ ...op, expectedRevision: 0, design: offContract }] }))
        .success,
    ).toBe(false)
  })
})
