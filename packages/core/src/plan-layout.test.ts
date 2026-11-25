// Laying out a floor plan (#397). The one promise of the module, held as a property: whatever the
// editor is handed — a drag past the edge, a resize to nothing, a round table stretched, NaN — the
// place it answers with is one the shape folder accepts, so a drag never becomes a save the
// database refuses. The rest pins the behaviour a person sees: a new spot lands clear of the others,
// a name and a kind key are the first free ones.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  editorRoom,
  fitPlace,
  freePlace,
  movePlace,
  NEW_SPOT_LOOK,
  newKindKey,
  nextSpotName,
  type PlanBox,
  ROOM_MIN,
  ROOM_SPARE,
  reshapePlace,
  resizePlace,
} from './plan-layout'
import {
  checkSpotPlace,
  PLAN_GRID,
  SPOT_MIN_SIZE,
  SPOT_SHAPES,
  SPOT_SYMBOLS,
  type SpotPlace,
} from './spot-shapes'

/** Any number a pointer or a field could produce, including the ones nobody should. */
const anyNumber = fc.oneof(
  fc.integer({ min: -2 * PLAN_GRID, max: 2 * PLAN_GRID }),
  fc.double({ min: -2 * PLAN_GRID, max: 2 * PLAN_GRID, noNaN: false }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
)
const anyShape = fc.constantFrom(...SPOT_SHAPES)
const anyBound = fc.record({
  x: fc.constant(0),
  y: fc.constant(0),
  width: fc.integer({ min: 1, max: 2 * PLAN_GRID }),
  height: fc.integer({ min: 1, max: 2 * PLAN_GRID }),
})
const anyDraft = fc.record({
  shape: anyShape,
  x: anyNumber,
  y: anyNumber,
  width: anyNumber,
  height: anyNumber,
  rotation: anyNumber,
})

/** A place the folder already accepts, to start a move or a resize from. */
const anyPlace = anyDraft.map((draft) => fitPlace(draft))

const accepted = (place: SpotPlace) => {
  const check = checkSpotPlace(place)
  expect(check).toEqual({ ok: true, place })
}

const inside = (place: SpotPlace, bound: PlanBox) => {
  const width = Math.min(PLAN_GRID, Math.max(SPOT_MIN_SIZE, bound.width))
  const height = Math.min(PLAN_GRID, Math.max(SPOT_MIN_SIZE, bound.height))
  expect(place.x + place.width).toBeLessThanOrEqual(width)
  expect(place.y + place.height).toBeLessThanOrEqual(height)
}

describe('every place the editor makes is one the folder accepts', () => {
  it('fitPlace, for any numbers and any bound', () => {
    fc.assert(
      fc.property(anyDraft, anyBound, (draft, bound) => {
        const place = fitPlace(draft, bound)
        accepted(place)
        inside(place, bound)
      }),
    )
  })

  it('movePlace, by any distance', () => {
    fc.assert(
      fc.property(anyPlace, anyNumber, anyNumber, anyBound, (place, dx, dy, bound) => {
        const moved = movePlace(place, dx, dy, bound)
        accepted(moved)
        inside(moved, bound)
        expect([moved.width, moved.height, moved.shape]).toEqual([
          fitPlace(place, bound).width,
          fitPlace(place, bound).height,
          place.shape,
        ])
      }),
    )
  })

  it('resizePlace, by any amount', () => {
    fc.assert(
      fc.property(anyPlace, anyNumber, anyNumber, anyBound, (place, dw, dh, bound) => {
        const resized = resizePlace(place, dw, dh, bound)
        accepted(resized)
        inside(resized, bound)
      }),
    )
  })

  it('reshapePlace, to any shape', () => {
    fc.assert(
      fc.property(anyPlace, anyShape, (place, shape) => {
        const reshaped = reshapePlace(place, shape)
        accepted(reshaped)
        expect(reshaped.shape).toBe(shape)
      }),
    )
  })

  it('freePlace, among any spots', () => {
    fc.assert(
      fc.property(
        fc.array(anyPlace, { maxLength: 30 }),
        fc.constantFrom(...SPOT_SYMBOLS),
        (taken, symbol) => {
          const place = freePlace(taken, NEW_SPOT_LOOK[symbol])
          accepted(place)
        },
      ),
    )
  })
})

describe('what a person sees', () => {
  it('leaves a place that was already right exactly as it was', () => {
    const place: SpotPlace = { shape: 'booth', x: 12, y: 30, width: 16, height: 10, rotation: 90 }
    expect(fitPlace(place)).toEqual(place)
  })

  it('stops a drag at the edge of the room instead of refusing it', () => {
    const place: SpotPlace = { shape: 'rect', x: 70, y: 50, width: 10, height: 10, rotation: 0 }
    const room = { x: 0, y: 0, width: 80, height: 60 }
    expect(movePlace(place, 30, 30, room)).toMatchObject({ x: 70, y: 50 })
    expect(movePlace(place, -500, -500, room)).toMatchObject({ x: 0, y: 0 })
  })

  it('keeps the top-left corner still while resizing, and stops at the edge', () => {
    const place: SpotPlace = { shape: 'rect', x: 60, y: 10, width: 10, height: 10, rotation: 0 }
    const room = { x: 0, y: 0, width: 80, height: 60 }
    expect(resizePlace(place, 50, 5, room)).toEqual({ ...place, width: 20, height: 15 })
    expect(resizePlace(place, -50, -50, room)).toEqual({
      ...place,
      width: SPOT_MIN_SIZE,
      height: SPOT_MIN_SIZE,
    })
  })

  it('makes a round table square by its larger side and takes its turn away', () => {
    const place: SpotPlace = { shape: 'rect', x: 0, y: 0, width: 12, height: 8, rotation: 45 }
    expect(reshapePlace(place, 'circle')).toEqual({
      shape: 'circle',
      x: 0,
      y: 0,
      width: 12,
      height: 12,
      rotation: 0,
    })
    expect(resizePlace(reshapePlace(place, 'circle'), 4, 0)).toMatchObject({
      width: 16,
      height: 16,
    })
  })

  it('draws an empty room at its minimum, and grows it with spare room past the last spot', () => {
    expect(editorRoom([])).toEqual({ x: 0, y: 0, ...ROOM_MIN })
    expect(editorRoom([{ x: 100, y: 5, width: 10, height: 10 }])).toEqual({
      x: 0,
      y: 0,
      width: 110 + ROOM_SPARE,
      height: ROOM_MIN.height,
    })
    expect(editorRoom([{ x: PLAN_GRID - 10, y: 0, width: 10, height: 10 }]).width).toBe(PLAN_GRID)
  })

  it('puts a new spot clear of every spot already there', () => {
    const taken: PlanBox[] = []
    for (let n = 0; n < 40; n += 1) {
      const place = freePlace(taken, NEW_SPOT_LOOK.table)
      for (const other of taken) {
        const apart =
          place.x >= other.x + other.width ||
          other.x >= place.x + place.width ||
          place.y >= other.y + other.height ||
          other.y >= place.y + place.height
        expect(apart).toBe(true)
      }
      taken.push(place)
    }
  })

  it('names a new spot with the first free number, without case', () => {
    expect(nextSpotName('Маса', [])).toBe('Маса 1')
    expect(nextSpotName('Маса', ['маса 1', 'Маса 2', 'Маса 4'])).toBe('Маса 3')
    expect(nextSpotName('x'.repeat(60), []).length).toBeLessThanOrEqual(40)
  })

  it('keys a new kind by its symbol, then by the first free number', () => {
    expect(newKindKey('table', [])).toBe('table')
    expect(newKindKey('table', ['table', 'table_2'])).toBe('table_3')
    expect(newKindKey('booth', ['table'])).toBe('booth')
  })
})
