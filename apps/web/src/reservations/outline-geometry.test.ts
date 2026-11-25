import type { SpotPlace } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { grownSpot, outlineClusters, turnedBox } from './outline-geometry'

const place = (x: number, y: number, width: number, height: number, rotation = 0): SpotPlace => ({
  shape: 'rect',
  x,
  y,
  width,
  height,
  rotation,
})
const at = (id: string, one: SpotPlace) => ({ id, place: one })

describe('outlineClusters (D160 §1, decision log 1.7)', () => {
  it('joins four adjoining tables into one outline', () => {
    const four = [0, 1, 2, 3].map((n) => at(`sp_${n}`, place(40 + n * 100, 40, 80, 80)))
    const clusters = outlineClusters(four, 20)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.spots).toHaveLength(4)
  })

  it('gives a table that stands apart the same outline on its own', () => {
    const spots = [
      at('sp_1', place(40, 40, 80, 80)),
      at('sp_2', place(140, 40, 80, 80)),
      at('sp_3', place(40, 400, 80, 80)),
    ]
    const clusters = outlineClusters(spots, 20)
    expect(clusters.map((one) => one.spots.map((spot) => spot.id))).toEqual([
      ['sp_1', 'sp_2'],
      ['sp_3'],
    ])
  })

  it('joins by a chain, however the tables are shaped or turned', () => {
    const spots = [
      at('sp_1', place(40, 40, 80, 80)),
      at('sp_2', place(150, 60, 120, 40, 40)),
      at('sp_3', place(280, 40, 80, 80)),
    ]
    expect(outlineClusters(spots, 20)).toHaveLength(1)
  })

  it('holds the cluster in a box grown by the pad, where the name hangs', () => {
    const [cluster] = outlineClusters([at('sp_1', place(40, 40, 80, 60))], 20)
    expect(cluster?.box).toEqual({ x: 20, y: 20, width: 120, height: 100 })
  })
})

describe('turnedBox and grownSpot', () => {
  it('holds a turned spot in the box it is drawn in', () => {
    const box = turnedBox(place(0, 0, 100, 20, 90))
    expect(Math.round(box.width)).toBe(20)
    expect(Math.round(box.height)).toBe(100)
    expect(Math.round(box.x + box.width / 2)).toBe(50)
  })

  it('grows a spot by the pad and rounds it by its corner name', () => {
    const grown = grownSpot(place(100, 100, 80, 80), 20)
    expect(grown).toMatchObject({ x: 80, y: 80, width: 120, height: 120, radius: 20 })
    expect(grownSpot({ ...place(0, 0, 80, 40), shape: 'pill' }, 20).radius).toBe(40)
    expect(grownSpot({ ...place(0, 0, 80, 40), shape: 'booth' }, 20).radius).toBe(40)
  })
})
