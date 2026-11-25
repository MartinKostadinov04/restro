// Laying out a floor plan (#397): the arithmetic of the plan editor in Settings › Reservations.
//
// The shape folder (`spot-shapes.ts`) says what a stored spot may be; this module turns what a
// person does on the editor — drag, resize, pick another shape, add a spot — into numbers the folder
// accepts. Every function here answers with a place that `checkSpotPlace` passes, whatever it is
// handed (`plan-layout.test.ts` holds that as a property), so a drag can never produce a save the
// database refuses. The database stays the last word: its constraints (`0050_floor_plan_shapes`)
// are the same rules, and the write path checks them again.
//
// Pure: no I/O, no UI. It runs in the browser while a spot is dragged and on the server before a
// save.

import {
  PLAN_GRID,
  SPOT_MIN_SIZE,
  type SpotPlace,
  type SpotShape,
  type SpotSymbol,
  spotShapeOf,
} from './spot-shapes'

/** A rectangle in the plan's own grid units. */
export interface PlanBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** The smallest room the editor draws: an empty plan is this, so a first spot has room. */
export const ROOM_MIN = { width: 80, height: 60 } as const

/** Free space the editor keeps right of and below the furthest spot, so the room can grow. */
export const ROOM_SPARE = 20

/** The whole grid: the bound a place may never leave. */
const GRID: PlanBox = { x: 0, y: 0, width: PLAN_GRID, height: PLAN_GRID }

const clamp = (value: number, least: number, most: number) =>
  value < least ? least : value > most ? most : value

/** A whole number, with anything that is not a finite number read as `fallback`. */
const whole = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.round(value) : fallback

/**
 * The room the editor draws, from the origin: the minimum room, or the spots' far edges plus spare
 * space, never past the grid. The origin stays at 0 so a spot's numbers are its place.
 */
export function editorRoom(places: readonly PlanBox[]): PlanBox {
  let right: number = ROOM_MIN.width
  let bottom: number = ROOM_MIN.height
  for (const place of places) {
    right = Math.max(right, place.x + place.width + ROOM_SPARE)
    bottom = Math.max(bottom, place.y + place.height + ROOM_SPARE)
  }
  return { x: 0, y: 0, width: Math.min(PLAN_GRID, right), height: Math.min(PLAN_GRID, bottom) }
}

/** What `fitPlace` is handed: any numbers, and a shape name. */
export interface PlaceDraft {
  readonly shape: SpotShape
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation?: number
}

/** The bound, within the grid and big enough for the smallest spot. */
function boundOf(bound: PlanBox | undefined): PlanBox {
  const box = bound ?? GRID
  const width = clamp(whole(box.width, PLAN_GRID), SPOT_MIN_SIZE, PLAN_GRID)
  const height = clamp(whole(box.height, PLAN_GRID), SPOT_MIN_SIZE, PLAN_GRID)
  return { x: 0, y: 0, width, height }
}

/**
 * Puts a place inside the folder's rules and the bound: whole numbers, at least the smallest size,
 * inside the bound, a round shape square and unturned, a rotation between 0 and 359. A place that
 * was already right comes back unchanged.
 */
export function fitPlace(draft: PlaceDraft, bound?: PlanBox): SpotPlace {
  const room = boundOf(bound)
  const folder = spotShapeOf(draft.shape)
  const shape: SpotShape = folder === null ? 'rect' : draft.shape
  const square = folder?.square ?? false
  const turnable = folder?.turnable ?? true
  let width = clamp(whole(draft.width, SPOT_MIN_SIZE), SPOT_MIN_SIZE, room.width)
  let height = clamp(whole(draft.height, SPOT_MIN_SIZE), SPOT_MIN_SIZE, room.height)
  if (square) {
    const side = clamp(Math.max(width, height), SPOT_MIN_SIZE, Math.min(room.width, room.height))
    width = side
    height = side
  }
  const x = clamp(whole(draft.x, 0), 0, room.width - width)
  const y = clamp(whole(draft.y, 0), 0, room.height - height)
  const turned = ((whole(draft.rotation ?? 0, 0) % 360) + 360) % 360
  return { shape, x, y, width, height, rotation: turnable ? turned : 0 }
}

/** The place moved by whole grid units, kept inside the bound. */
export function movePlace(place: SpotPlace, dx: number, dy: number, bound?: PlanBox): SpotPlace {
  return fitPlace({ ...place, x: place.x + whole(dx, 0), y: place.y + whole(dy, 0) }, bound)
}

/**
 * The place grown or shrunk from its top-left corner, which stays where it is: the far edges stop
 * at the bound instead of pushing the spot back. A round shape grows by the larger of the two.
 */
export function resizePlace(place: SpotPlace, dw: number, dh: number, bound?: PlanBox): SpotPlace {
  const room = boundOf(bound)
  const square = spotShapeOf(place.shape)?.square ?? false
  const roomRight = Math.max(SPOT_MIN_SIZE, room.width - place.x)
  const roomBelow = Math.max(SPOT_MIN_SIZE, room.height - place.y)
  if (square) {
    const grow = Math.abs(whole(dw, 0)) >= Math.abs(whole(dh, 0)) ? whole(dw, 0) : whole(dh, 0)
    const side = clamp(place.width + grow, SPOT_MIN_SIZE, Math.min(roomRight, roomBelow))
    return fitPlace({ ...place, width: side, height: side }, room)
  }
  return fitPlace(
    {
      ...place,
      width: clamp(place.width + whole(dw, 0), SPOT_MIN_SIZE, roomRight),
      height: clamp(place.height + whole(dh, 0), SPOT_MIN_SIZE, roomBelow),
    },
    room,
  )
}

/**
 * The place drawn as another shape: a round one becomes square (by its larger side) and loses its
 * rotation, so picking "round" never asks for a second fix.
 */
export function reshapePlace(place: SpotPlace, shape: SpotShape, bound?: PlanBox): SpotPlace {
  return fitPlace({ ...place, shape }, bound)
}

/** How a new spot of a kind with this symbol is first drawn: a shape and a size. */
export const NEW_SPOT_LOOK: Record<
  SpotSymbol,
  { readonly shape: SpotShape; readonly width: number; readonly height: number }
> = {
  table: { shape: 'rect', width: 10, height: 10 },
  booth: { shape: 'booth', width: 16, height: 10 },
  stool: { shape: 'circle', width: 6, height: 6 },
  standing: { shape: 'rect', width: 16, height: 12 },
  counter: { shape: 'pill', width: 24, height: 6 },
  dot: { shape: 'rect', width: 8, height: 8 },
}

/** The space left between a new spot and the ones already there. */
const GAP = 2

const overlaps = (a: PlanBox, b: PlanBox) =>
  a.x < b.x + b.width + GAP &&
  b.x < a.x + a.width + GAP &&
  a.y < b.y + b.height + GAP &&
  b.y < a.y + a.height + GAP

/**
 * Where a new spot goes: the first free place, reading the room like a page (left to right, top to
 * bottom), clear of every spot by a small gap; with no room left, a new row below the lowest spot.
 * Always a place the folder accepts.
 */
export function freePlace(
  taken: readonly PlanBox[],
  look: { readonly shape: SpotShape; readonly width: number; readonly height: number },
): SpotPlace {
  const room = editorRoom(taken)
  const first = fitPlace({ ...look, x: GAP, y: GAP })
  // The only places worth trying are the room's own start and just past another spot's far edge:
  // anywhere else slides to one of these without meeting anything new.
  const starts = (edges: number[]) => [...new Set([GAP, ...edges])].sort((a, b) => a - b)
  const xs = starts(taken.map((other) => other.x + other.width + GAP))
  const ys = starts(taken.map((other) => other.y + other.height + GAP))
  for (const y of ys) {
    if (y + first.height > room.height - GAP) break
    for (const x of xs) {
      if (x + first.width > room.width - GAP) break
      const box = { ...first, x, y }
      if (!taken.some((other) => overlaps(box, other))) return fitPlace(box)
    }
  }
  const lowest = taken.reduce((most, other) => Math.max(most, other.y + other.height), 0)
  return fitPlace({ ...first, x: GAP, y: lowest + GAP * 2 })
}

/** The longest name a spot may have (the command's own bound). */
export const SPOT_NAME_MAX = 40

/**
 * The first free name of the form "Маса 4" for a new spot of a kind: the smallest number after the
 * kind's own words that no spot on the floor is called yet, compared without case.
 */
export function nextSpotName(label: string, names: readonly string[]): string {
  const taken = new Set(names.map((name) => name.trim().toLocaleLowerCase()))
  const base = label.trim().slice(0, SPOT_NAME_MAX - 4) || '#'
  for (let n = 1; ; n += 1) {
    const name = `${base} ${n}`
    if (!taken.has(name.toLocaleLowerCase())) return name
  }
}

/**
 * The key a new spot kind is saved under: its symbol's name while that is free, else the symbol
 * with the first free number ("table_2"). Keys are codes, never the words staff read, so a
 * Bulgarian label never has to become one.
 */
export function newKindKey(symbol: SpotSymbol, keys: readonly string[]): string {
  const taken = new Set(keys)
  if (!taken.has(symbol)) return symbol
  for (let n = 2; ; n += 1) {
    const key = `${symbol}_${n}`
    if (!taken.has(key)) return key
  }
}
