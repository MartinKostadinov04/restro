// The Club Biad port, checked against the real model it came from and against what the plan grid
// will take. Pure: no database, no fixture. What it holds the port to is the prototype's own
// record (`docs/venue-plan-2026-10-27.md`, `docs/plan-calibration.md`): the numbers that are real
// reservable places, the aliases the paper prints over the old data, and the three bars' seat
// counts — so a re-port that quietly invents or loses a place fails here.
import { checkSpotPlace, PLAN_GRID } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { CLUB_BIAD_KINDS, clubBiadFloor } from './club-biad-plan'

const floor = clubBiadFloor()
const names = floor.spots.map((spot) => spot.name)

describe('the Club Biad floor', () => {
  it('ports every anchor of the paper plan and nothing else', () => {
    // 118 anchors on the paper: 76 tables and booths that take orders, and the three bars'
    // 42 stools (16 + 15 + 11).
    expect(floor.spots).toHaveLength(118)
    expect(floor.spots.filter((spot) => spot.takesOrders)).toHaveLength(76)
    expect(floor.spots.filter((spot) => spot.kind === 'stool')).toHaveLength(42)
  })

  it('gives every spot its own name, short enough to store', () => {
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0)
      expect(name.length).toBeLessThanOrEqual(40)
      expect(name.trim()).toBe(name)
    }
  })

  it('puts every spot where the write path and the plan view will take it', () => {
    for (const spot of floor.spots) {
      const checked = checkSpotPlace({
        shape: spot.shape,
        x: spot.x,
        y: spot.y,
        width: spot.width,
        height: spot.height,
      })
      expect(checked, `${spot.name} (${spot.shape})`).toMatchObject({ ok: true })
      expect(Number.isInteger(spot.x) && Number.isInteger(spot.y)).toBe(true)
      expect(spot.x + spot.width).toBeLessThanOrEqual(PLAN_GRID)
      expect(spot.y + spot.height).toBeLessThanOrEqual(PLAN_GRID)
    }
  })

  it('draws every round spot round', () => {
    for (const spot of floor.spots.filter((one) => one.shape === 'circle')) {
      expect(spot.width, spot.name).toBe(spot.height)
    }
  })

  it('reads as a room rather than a scatter or a smudge', () => {
    // The whole club goes through one projection and one uniform fit, so the only ways this can
    // come out wrong are a collapse (every anchor on top of the next) or a fold (two anchors on
    // the same point). The spots cover a wide box and no two of them share a centre.
    const xs = floor.spots.map((spot) => spot.x)
    const ys = floor.spots.map((spot) => spot.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(PLAN_GRID * 0.35)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(PLAN_GRID * 0.45)
    const centres = floor.spots.map(
      (spot) => `${spot.x + spot.width / 2},${spot.y + spot.height / 2}`,
    )
    expect(new Set(centres).size).toBe(centres.length)
  })

  it('makes the sixteen booths booths', () => {
    for (let number = 1; number <= 16; number += 1) {
      const booth = floor.spots.find((spot) => spot.name === String(number))
      expect(booth, `booth ${number}`).toBeDefined()
      expect(booth?.kind).toBe('booth')
      expect(booth?.shape).toBe('booth')
      expect(booth?.takesOrders).toBe(true)
    }
  })

  it('prints the labels of the paper over the old data, and merges 40 with 41', () => {
    expect(names).toContain('40/41')
    expect(names).not.toContain('40')
    expect(names).not.toContain('41')
    // 64a/65a are the paper's 84/85, the second 55 is what the old data called 56, and the paper
    // prints 0 where the old data said 28.
    expect(names).toContain('84')
    expect(names).toContain('85')
    expect(names).toContain('0')
    expect(names).not.toContain('28')
    expect(names).not.toContain('56')
    // The paper prints the same number on two objects three times; each pair is told apart by a
    // Cyrillic letter, never merged into one place.
    for (const pair of ['53', '55', '59']) {
      expect(names).toContain(`${pair} А`)
      expect(names).toContain(`${pair} Б`)
    }
  })

  it('seats the three bars as they really stand, with no gap for a legacy alias', () => {
    // The old metadata numbered seats that are not chairs (Bar 1 had a 13, 14 and 19, Bar 3 an 8,
    // 9 and 13). The port counts the physical stools instead, so each bar runs 1..n unbroken and
    // nothing of the old numbering survives as a hole or an extra.
    for (const [bar, seats] of [
      [1, 16],
      [2, 15],
      [3, 11],
    ] as const) {
      const mine = names
        .filter((name) => name.startsWith(`Бар ${bar} · стол `))
        .map((name) => Number(name.slice(`Бар ${bar} · стол `.length)))
        .sort((a, b) => a - b)
      expect(mine, `bar ${bar}`).toEqual(Array.from({ length: seats }, (_, index) => index + 1))
    }
  })

  it('takes no order at a bar stool', () => {
    for (const stool of floor.spots.filter((spot) => spot.kind === 'stool')) {
      expect(stool.takesOrders, stool.name).toBe(false)
      expect(stool.shape).toBe('circle')
    }
  })

  it('invents no capacity the prototype does not state', () => {
    // The prototype says the capacities are still to be confirmed, so no spot carries a number of
    // its own: each falls back to its kind's default.
    for (const spot of floor.spots) expect(spot.seats, spot.name).toBeNull()
    expect(CLUB_BIAD_KINDS.map((kind) => kind.defaultSeats)).toEqual([4, 6, 1, null])
  })

  it('names every spot a kind the venue defines, and every ordering spot an Area', () => {
    const kinds = new Set(CLUB_BIAD_KINDS.map((kind) => kind.key))
    for (const spot of floor.spots) {
      expect(kinds.has(spot.kind), `${spot.name}: ${spot.kind}`).toBe(true)
      expect(spot.area.length).toBeGreaterThan(0)
      // `areas` is the Areas the venue needs: the parts of the club where orders are taken. A bar
      // stool sits at its own bar, which is no Area because no order is taken at it.
      if (spot.takesOrders) expect(floor.areas).toContain(spot.area)
    }
    expect(floor.areas.length).toBeGreaterThan(1)
  })
})
