// The shape folder (#327, D134). What is pinned here is the first acceptance criterion of the
// ticket: **nothing a venue stores can reach a staff screen as anything but a name out of our own
// list and checked whole numbers.** A stored row is data, never markup and never a drawing, so a
// shape the folder does not hold, a number outside the grid, a circle that is not round or a
// rotation on a shape nothing is gained by turning is refused here — before any screen sees it.
//
// The screen's own half of that criterion is `apps/web/src/reservations/plan-markup.test.tsx`:
// together they say the stored string is checked on the way out and never rendered as markup.
import { SPOT_SHAPES as DB_SPOT_SHAPES, SPOT_SYMBOLS as DB_SPOT_SYMBOLS } from '@restro/db'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  checkSpotPlace,
  isSpotShape,
  isSpotSymbol,
  PLAN_GRID,
  planExtent,
  SPOT_MIN_SIZE,
  SPOT_SHAPE_FOLDER,
  SPOT_SHAPES,
  SPOT_SYMBOLS,
  spotShapeOf,
  spotSymbolOf,
} from './spot-shapes'

/** A place every rule of the folder is happy with, to vary one field at a time. */
const FINE = { shape: 'rect', x: 10, y: 20, width: 80, height: 60, rotation: 0 } as const

describe('the shape folder', () => {
  it('holds a definition for every shape in the list, and nothing else', () => {
    expect(Object.keys(SPOT_SHAPE_FOLDER).sort()).toEqual([...SPOT_SHAPES].sort())
    for (const shape of SPOT_SHAPES) {
      const definition = SPOT_SHAPE_FOLDER[shape]
      expect(['square', 'soft', 'full']).toContain(definition.corner)
      expect(typeof definition.square).toBe('boolean')
      expect(typeof definition.turnable).toBe('boolean')
    }
  })

  it('holds no markup, no path and no style: a shape is a name and three flags', () => {
    const written = JSON.stringify({ SPOT_SHAPE_FOLDER, SPOT_SHAPES, SPOT_SYMBOLS })
    for (const forbidden of ['<', '>', 'svg', 'path', 'style', 'url(', 'http', 'px', '#']) {
      expect(written).not.toContain(forbidden)
    }
  })

  // The database cannot import core (core depends on it), so its check constraints carry the two
  // lists written out. This is the guardrail the schema's own comment promises: a shape or a symbol
  // added on one side and forgotten on the other fails here instead of at a venue's insert.
  it('agrees with the lists the database checks its columns against', () => {
    expect([...DB_SPOT_SHAPES]).toEqual([...SPOT_SHAPES])
    expect([...DB_SPOT_SYMBOLS]).toEqual([...SPOT_SYMBOLS])
  })

  it('knows its own names and refuses every other', () => {
    expect(isSpotShape('booth')).toBe(true)
    expect(spotShapeOf('pill')).toBe(SPOT_SHAPE_FOLDER.pill)
    for (const outside of ['', 'square', 'RECT', 'rect ', '<svg/>', 'circle;', null, 7, {}]) {
      expect(isSpotShape(outside)).toBe(false)
      expect(spotShapeOf(outside)).toBeNull()
    }
  })

  it('reads a legend symbol only from its own list, and falls back to the plain mark', () => {
    expect(isSpotSymbol('stool')).toBe(true)
    expect(isSpotSymbol('<img src=x>')).toBe(false)
    expect(spotSymbolOf('counter')).toBe('counter')
    expect(spotSymbolOf('🍸')).toBe('dot')
    expect(spotSymbolOf(undefined)).toBe('dot')
  })
})

describe('a stored place, checked', () => {
  it('takes a whole place and gives back exactly the checked numbers', () => {
    const checked = checkSpotPlace(FINE)
    expect(checked).toEqual({ ok: true, place: { ...FINE } })
  })

  it('reads a missing rotation as none', () => {
    const withoutRotation = { shape: 'rect', x: 10, y: 20, width: 80, height: 60 } as const
    expect(checkSpotPlace(withoutRotation)).toEqual({
      ok: true,
      place: { ...withoutRotation, rotation: 0 },
    })
  })

  // A shape outside the folder: the ticket's own first case.
  it('refuses a shape the folder does not hold', () => {
    for (const shape of ['', 'square', 'svg', '<svg onload=1>', 'rect;drop table', 'Circle']) {
      expect(checkSpotPlace({ ...FINE, shape })).toEqual({ ok: false, code: 'shape_unknown' })
    }
  })

  // Numbers out of range: the ticket's second case.
  it('refuses a number that is missing, not whole, or outside the grid', () => {
    const bad: readonly Record<string, unknown>[] = [
      { x: -1 },
      { y: -1 },
      { x: PLAN_GRID + 1 },
      { x: 1.5 },
      { y: Number.NaN },
      { width: Number.POSITIVE_INFINITY },
      { width: SPOT_MIN_SIZE - 1 },
      { height: 0 },
      { height: PLAN_GRID + 1 },
      { rotation: -1 },
      { rotation: 360 },
      { rotation: 10.5 },
      { x: '10' },
      { width: null },
      { height: undefined },
    ]
    for (const over of bad) {
      expect(checkSpotPlace({ ...FINE, ...over }).ok, JSON.stringify(over)).toBe(false)
    }
  })

  it('refuses a spot that would hang off the plan', () => {
    expect(checkSpotPlace({ ...FINE, x: PLAN_GRID - 10, width: 80 })).toEqual({
      ok: false,
      code: 'shape_off_plan',
    })
    expect(checkSpotPlace({ ...FINE, y: PLAN_GRID - 10, height: 80 })).toEqual({
      ok: false,
      code: 'shape_off_plan',
    })
  })

  it('refuses a circle that is not round, and a circle that is turned', () => {
    expect(checkSpotPlace({ ...FINE, shape: 'circle', width: 80, height: 60 })).toEqual({
      ok: false,
      code: 'shape_not_square',
    })
    expect(
      checkSpotPlace({ ...FINE, shape: 'circle', width: 80, height: 80, rotation: 40 }),
    ).toEqual({ ok: false, code: 'shape_not_turnable' })
    expect(checkSpotPlace({ ...FINE, shape: 'circle', width: 80, height: 80 }).ok).toBe(true)
  })

  it('refuses a field nobody asked for, so a row cannot smuggle one through', () => {
    expect(checkSpotPlace({ ...FINE, className: 'bg-[url(x)]' }).ok).toBe(false)
    expect(checkSpotPlace({ ...FINE, html: '<b>x</b>' }).ok).toBe(false)
  })

  it('refuses anything that is not an object of those fields', () => {
    for (const value of [null, undefined, '', 'rect', 7, [], [FINE]]) {
      expect(checkSpotPlace(value).ok).toBe(false)
    }
  })

  it('never lets anything but a folder name and whole numbers through (property)', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            shape: fc.oneof(
              fc.constantFrom(...SPOT_SHAPES),
              fc.string(),
              fc.constant('<svg onload=alert(1)>'),
            ),
            x: fc.oneof(fc.integer(), fc.double(), fc.string()),
            y: fc.oneof(fc.integer(), fc.double(), fc.string()),
            width: fc.oneof(fc.integer(), fc.double()),
            height: fc.oneof(fc.integer(), fc.double()),
            rotation: fc.oneof(fc.integer(), fc.double()),
          },
          { requiredKeys: ['shape', 'x', 'y', 'width', 'height'] },
        ),
        (row) => {
          const checked = checkSpotPlace(row)
          if (!checked.ok) return
          const { place } = checked
          expect(SPOT_SHAPES).toContain(place.shape)
          for (const value of [place.x, place.y, place.width, place.height, place.rotation]) {
            expect(Number.isSafeInteger(value)).toBe(true)
          }
          expect(place.x).toBeGreaterThanOrEqual(0)
          expect(place.y).toBeGreaterThanOrEqual(0)
          expect(place.x + place.width).toBeLessThanOrEqual(PLAN_GRID)
          expect(place.y + place.height).toBeLessThanOrEqual(PLAN_GRID)
          expect(place.rotation).toBeGreaterThanOrEqual(0)
          expect(place.rotation).toBeLessThan(360)
          const shape = SPOT_SHAPE_FOLDER[place.shape]
          if (shape.square) expect(place.width).toBe(place.height)
          if (!shape.turnable) expect(place.rotation).toBe(0)
        },
      ),
      { numRuns: 400 },
    )
  })
})

describe('the box a plan takes up', () => {
  it('gives an empty plan a small square to draw its empty state in', () => {
    expect(planExtent([])).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('holds every spot with a margin around it', () => {
    const box = planExtent(
      [
        { x: 100, y: 200, width: 80, height: 40 },
        { x: 300, y: 100, width: 60, height: 60 },
      ],
      20,
    )
    expect(box).toEqual({ x: 80, y: 80, width: 300, height: 180 })
  })

  it("never starts before the plan's own origin", () => {
    expect(planExtent([{ x: 0, y: 0, width: 10, height: 10 }], 20)).toMatchObject({ x: 0, y: 0 })
  })

  it('holds every place it is given (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: 0, max: 5000 }),
            y: fc.integer({ min: 0, max: 5000 }),
            width: fc.integer({ min: 2, max: 500 }),
            height: fc.integer({ min: 2, max: 500 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (places) => {
          const box = planExtent(places)
          for (const place of places) {
            expect(place.x).toBeGreaterThanOrEqual(box.x)
            expect(place.y).toBeGreaterThanOrEqual(box.y)
            expect(place.x + place.width).toBeLessThanOrEqual(box.x + box.width)
            expect(place.y + place.height).toBeLessThanOrEqual(box.y + box.height)
          }
          expect(box.width).toBeGreaterThan(0)
          expect(box.height).toBeGreaterThan(0)
        },
      ),
    )
  })
})
