// The geometry of a linked group's outline on the plan (D160 §1, decision log 1.7; ticket #540).
// Pure, so it is tested without a screen. Everything here is arithmetic on the checked whole
// numbers of the shape folder (`SpotPlace`): nothing stored becomes markup (`plan-shape.tsx`).
//
// One outline is the **union** of the party's spots, each grown by one `pad` and rounded: tables of
// different shapes, turned or not, need no special case, because a spot is only ever a rounded box.
// Two spots are one cluster when their grown boxes touch, so a party on four adjoining tables has
// one outline and a party with a table at the far end of the room has a second, the same outline,
// round that table alone ("each separate table or cluster of the group gets the same outline").
import type { SpotCorner, SpotPlace } from '@restro/core'
import { SPOT_SHAPE_FOLDER } from '@restro/core'

/** A box on the plan, in grid units. */
export interface Box {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The smallest box holding the spot as it is drawn, turned about its middle (as CSS does). */
export function turnedBox(place: SpotPlace): Box {
  const radians = (place.rotation * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const width = place.width * cos + place.height * sin
  const height = place.width * sin + place.height * cos
  const centreX = place.x + place.width / 2
  const centreY = place.y + place.height / 2
  return { x: centreX - width / 2, y: centreY - height / 2, width, height }
}

/** Whether two boxes, each grown by `pad`, touch: the test for one cluster. */
function near(a: Box, b: Box, pad: number): boolean {
  return (
    a.x - pad <= b.x + b.width + pad &&
    b.x - pad <= a.x + a.width + pad &&
    a.y - pad <= b.y + b.height + pad &&
    b.y - pad <= a.y + a.height + pad
  )
}

/** One spot of a group, as the outline needs it. */
export interface OutlineSpot {
  readonly id: string
  readonly place: SpotPlace
}

/** One connected part of a group's outline: the spots it surrounds and the box that holds them. */
export interface OutlineCluster {
  readonly spots: readonly OutlineSpot[]
  /** The box of the spots, grown by the pad: where the party's name is hung. */
  readonly box: Box
}

/**
 * The clusters of a group's spots, in the plan's order of their first spot. Spots are joined while
 * their grown boxes touch, through any chain of them.
 */
export function outlineClusters(
  spots: readonly OutlineSpot[],
  pad: number,
): readonly OutlineCluster[] {
  const boxes = spots.map((spot) => turnedBox(spot.place))
  const parent = spots.map((_, index) => index)
  const root = (index: number): number => {
    let at = index
    while (parent[at] !== at) at = parent[at] ?? at
    return at
  }
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      if (a !== undefined && b !== undefined && near(a, b, pad)) {
        parent[root(j)] = root(i)
      }
    }
  }
  const byRoot = new Map<number, number[]>()
  spots.forEach((_, index) => {
    const at = root(index)
    byRoot.set(at, [...(byRoot.get(at) ?? []), index])
  })
  return [...byRoot.values()].map((members) => {
    let left = Number.POSITIVE_INFINITY
    let top = Number.POSITIVE_INFINITY
    let right = Number.NEGATIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (const index of members) {
      const box = boxes[index]
      if (box === undefined) continue
      left = Math.min(left, box.x)
      top = Math.min(top, box.y)
      right = Math.max(right, box.x + box.width)
      bottom = Math.max(bottom, box.y + box.height)
    }
    return {
      spots: members.flatMap((index) => {
        const spot = spots[index]
        return spot === undefined ? [] : [spot]
      }),
      box: {
        x: left - pad,
        y: top - pad,
        width: right - left + 2 * pad,
        height: bottom - top + 2 * pad,
      },
    }
  })
}

/** The corner radius of a spot grown by `pad`, in grid units: the folder's corner name, grown. */
export function grownRadius(corner: SpotCorner, place: SpotPlace, pad: number): number {
  const shorter = Math.min(place.width, place.height)
  if (corner === 'full') return shorter / 2 + pad
  if (corner === 'soft') return pad * 2
  return pad
}

/** One spot grown by `pad`, as a rounded box turned about its middle. */
export interface GrownSpot {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly radius: number
  /** Degrees about the box's middle; 0 for none. */
  readonly rotation: number
  readonly centreX: number
  readonly centreY: number
}

export function grownSpot(place: SpotPlace, pad: number): GrownSpot {
  return {
    x: place.x - pad,
    y: place.y - pad,
    width: place.width + 2 * pad,
    height: place.height + 2 * pad,
    radius: grownRadius(SPOT_SHAPE_FOLDER[place.shape].corner, place, pad),
    rotation: place.rotation,
    centreX: place.x + place.width / 2,
    centreY: place.y + place.height / 2,
  }
}
