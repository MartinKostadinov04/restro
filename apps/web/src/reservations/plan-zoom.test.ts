// The plan's opening zoom (S17 of the 11-18 screen round): on a phone the plan opens at the zoom
// where its smallest spot is a 44 px target (Restro's floor, D123), on its first spot. Pure
// arithmetic, so unit tests; the drawn result at 390 px is `e2e/reservations-plan.spec.ts`'s.
import { describe, expect, it } from 'vitest'

import {
  holdInFrame,
  openingScale,
  openingView,
  PLAN_TOUCH_FLOOR_PX,
  PLAN_ZOOM_MAX,
  planOpening,
} from './plan-zoom'

const ROOM = { x: 0, y: 0, width: 1000, height: 800 }
const spot = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe('the zoom a plan opens at on a phone', () => {
  it('draws the smallest spot at least 44 px on its shorter side', () => {
    // A 20-unit stool in a 1,000-unit room on a 358 px frame is 7.16 px at the whole room.
    const scale = openingScale(20, 1000, 358)
    expect((20 / 1000) * 358 * scale).toBeGreaterThanOrEqual(PLAN_TOUCH_FLOOR_PX)
  })

  it('never opens smaller than the whole room, and never past the largest zoom', () => {
    expect(openingScale(400, 1000, 358)).toBe(1)
    expect(openingScale(1, 1000, 358)).toBe(PLAN_ZOOM_MAX)
  })

  it('opens whole where nothing can be measured', () => {
    expect(openingScale(0, 1000, 358)).toBe(1)
    expect(openingScale(20, 1000, 0)).toBe(1)
  })
})

describe('where a plan opens', () => {
  it('has nothing to open on without spots', () => {
    expect(planOpening('pl_1:2026-11-19', [], ROOM)).toBeNull()
  })

  it('takes the smallest side of any spot, and the first spot in the venue’s order', () => {
    const opening = planOpening(
      'pl_1:2026-11-19',
      [spot(500, 400, 60, 40), spot(100, 100, 20, 30)],
      ROOM,
    )
    expect(opening?.smallestSide).toBe(20)
    expect(opening?.first).toEqual({ x: 530, y: 420 })
  })

  it('puts the first spot in the middle of the frame', () => {
    const opening = planOpening('k', [spot(480, 380, 40, 40)], ROOM)
    if (opening === null) throw new Error('no opening')
    const frame = { width: 358, height: 500 }
    const view = openingView(opening, frame)
    const unit = (frame.width * view.scale) / ROOM.width
    // The spot's middle (500, 400) lands on the frame's middle.
    expect(view.x + 500 * unit).toBeCloseTo(frame.width / 2)
    expect(view.y + 400 * unit).toBeCloseTo(frame.height / 2)
  })

  it('opens on the room’s start where the first spot is in its corner, with no empty space', () => {
    const opening = planOpening('k', [spot(0, 0, 40, 40)], ROOM)
    if (opening === null) throw new Error('no opening')
    expect(openingView(opening, { width: 358, height: 500 })).toMatchObject({ x: 0, y: 0 })
  })
})

describe('the opening view and the frame', () => {
  const frame = { width: 358, height: 500 }
  // A tall room is drawn taller than the frame, a wide one shorter: the hold measures the room.
  const rooms: readonly (readonly [string, typeof ROOM])[] = [
    ['a tall room', { x: 0, y: 0, width: 400, height: 1200 }],
    ['a wide room', { x: 0, y: 0, width: 4000, height: 600 }],
  ]
  for (const [what, room] of rooms) {
    it(`is already held in the frame, for ${what}`, () => {
      for (const at of [
        spot(0, 0, 20, 20),
        spot(180, 560, 20, 20),
        spot(room.width - 20, room.height - 20, 20, 20),
      ]) {
        const opening = planOpening('k', [at], room)
        if (opening === null) throw new Error('no opening')
        const view = openingView(opening, frame)
        expect(holdInFrame(view, frame, room)).toEqual(view)
      }
    })
  }

  it('lets a room drawn shorter than the frame go no further than its own height allows', () => {
    // A 4,000 × 600 room on a 358 px frame at 1× is 53.7 px tall: pushed up, its bottom edge stops
    // at the frame's middle.
    const room = { width: 4000, height: 600 }
    const held = holdInFrame({ scale: 1, x: 0, y: -1000 }, frame, room)
    expect(held.y).toBeCloseTo(frame.height / 2 - (358 * 600) / 4000)
  })
})
