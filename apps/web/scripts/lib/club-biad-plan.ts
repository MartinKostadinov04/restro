// Club Biad's floor, ported into Restro's own model (D134: a plan is the venue's data, drawn by an
// agent from the venue's own floor plan, then adjusted by hand).
//
// Where it comes from: the club's earlier prototype, which traced the owner's photographed paper
// plan with OpenCV and kept the result as a calibrated homography plus 118 source-pixel anchors
// (`plan-trace.mjs`, `layout.mjs`, and the two notes `venue-plan-2026-10-27.md` and
// `plan-calibration.md`). The matrix and the anchors below are copied from those files unchanged,
// so the seed needs nothing outside this repository; the projection is the prototype's own
// `planPoint`, to the digit.
//
// **Nothing is hand-nudged after projecting.** Every anchor goes through the same homography, and
// the prototype's `planViewBox` is then scaled once, uniformly, into Restro's 10000x10000 plan
// grid. One scale, one offset, no per-spot correction: that is what makes this a port of a
// measured trace rather than a drawing of our own.
//
// What is deliberately left behind, because Restro's model has no place for it: the walls, the
// columns, the Bulgarian room notes (КУХНЯ, WC, ОХРАНА…) and the sofa blocks. A spot is a thing a
// party can be seated at; a column is not, and inventing a spot to stand for one would put a
// bookable table where there is a concrete pillar.
//
// Pure: no I/O, no database, no UI. `clubBiadFloor()` answers with the kinds, the spots and their
// areas, and the seed writes them through `applyService` (rule 1).

import { PLAN_GRID, SPOT_MIN_SIZE, type SpotShape, type SpotSymbol } from '@restro/core'

/**
 * The prototype's calibration: the planar homography fitted to the four visible paper corners of
 * the photograph (`plan-trace.mjs`, `photoCalibration.matrix`). Copied verbatim.
 */
const HOMOGRAPHY = {
  x: [1.4104249852480988, -0.01691469078249565, -52.198735754781566],
  y: [0.11235637274063114, 1.355298746183864, -229.36149040340604],
  w: [0.00010742278503867189, 2.7556374071068434e-5, 1.0],
} as const satisfies Record<'x' | 'y' | 'w', readonly [number, number, number]>

/**
 * One photo pixel through the homography, into the prototype's own plan plane. The factor 1.5 is
 * the prototype's (`layout.mjs`, `planPoint`): its plane is the rectified 1000x1414 reference
 * enlarged by half, which is also the plane `planViewBox` is written in.
 */
function planPoint(x: number, y: number): { readonly x: number; readonly y: number } {
  const [ax, bx, cx] = HOMOGRAPHY.x
  const [ay, by, cy] = HOMOGRAPHY.y
  const [aw, bw, cw] = HOMOGRAPHY.w
  const d = aw * x + bw * y + cw
  return { x: (1.5 * (ax * x + bx * y + cx)) / d, y: (1.5 * (ay * x + by * y + cy)) / d }
}

/**
 * How much one photo pixel is worth in the plan plane around (x, y). A homography is not a uniform
 * scale, so the prototype sizes each object by the local scale rather than by one number, and so
 * does this port (`layout.mjs`, `scaleAt`).
 */
function scaleAt(x: number, y: number): number {
  const a = planPoint(x, y)
  const b = planPoint(x + 1, y)
  const c = planPoint(x, y + 1)
  return (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 4
}

/** The prototype's whole-club view box in the plan plane (`layout.mjs`, `planViewBox`). */
const VIEW_BOX = { x: 75, y: 60, width: 1350, height: 1990 } as const

/** How much of the plan grid is left empty around the club, in grid units. */
const MARGIN = 200

/**
 * One anchor of the paper plan: the number printed on it, its photo pixel, and `rect` where the
 * printed object is a rectangle rather than a circle (`layout.mjs`, `points`). Copied verbatim and
 * in the prototype's order, so a future re-port can be diffed against it.
 */
const POINTS: readonly (readonly [string, number, number, 'rect'?])[] = [
  ['5', 143, 320],
  ['6', 215, 315],
  ['7', 285, 312],
  ['4', 146, 388],
  ['8', 287, 382],
  ['3', 127, 433],
  ['46', 171, 447],
  ['49', 219, 363, 'rect'],
  ['48', 219, 384, 'rect'],
  ['47', 220, 437, 'rect'],
  ['50', 263, 437],
  ['51', 307, 441],
  ['45', 220, 484, 'rect'],
  ['44', 220, 516, 'rect'],
  ['43', 222, 556, 'rect'],
  ['42', 225, 590, 'rect'],
  ['101', 288, 534],
  ['52', 287, 475, 'rect'],
  ['53a', 363, 477],
  ['53b', 389, 477],
  ['54', 334, 505, 'rect'],
  ['55', 358, 515, 'rect'],
  ['56', 358, 537, 'rect'],
  ['61', 393, 545, 'rect'],
  ['64a', 434, 502],
  ['65a', 462, 502],
  ['9', 548, 519],
  ['10', 610, 515],
  ['39', 267, 598],
  ['40', 314, 604, 'rect'],
  ['59a', 344, 587],
  ['59b', 366, 587],
  ['60', 419, 584],
  ['63', 464, 584, 'rect'],
  ['77', 518, 586],
  ['80', 568, 580],
  ['81', 594, 580],
  ['82', 621, 590, 'rect'],
  ['37', 193, 636],
  ['34', 183, 677],
  ['33', 186, 722],
  ['32', 183, 767],
  ['2', 142, 750],
  ['1', 143, 803],
  ['62', 324, 636, 'rect'],
  ['67', 334, 665, 'rect'],
  ['68', 334, 722, 'rect'],
  ['65b', 393, 618],
  ['64b', 436, 621],
  ['66', 385, 649, 'rect'],
  ['69', 383, 698, 'rect'],
  ['70', 383, 745, 'rect'],
  ['76', 528, 625],
  ['75', 528, 650],
  ['83', 519, 700, 'rect'],
  ['74', 531, 746],
  ['73', 532, 773],
  ['11', 609, 642],
  ['12', 608, 713],
  ['13', 605, 791],
  ['31', 215, 779],
  ['29', 285, 774, 'rect'],
  ['28', 297, 808, 'rect'],
  ['24', 340, 787],
  ['25.1', 354, 820, 'rect'],
  ['25', 333, 853, 'rect'],
  ['22', 429, 766],
  ['19', 403, 807],
  ['18', 448, 810],
  ['17', 489, 811],
  ['71', 526, 810],
  ['72', 552, 810],
  ['26', 382, 845],
  ['16', 436, 875],
  ['15', 517, 875],
  ['14', 594, 875],
]

/** The booths (сепарета): the paper's large circles, numbers 1 to 16. */
const BOOTHS: ReadonlySet<string> = new Set(
  Array.from({ length: 16 }, (_, index) => String(index + 1)),
)

/** The square tables that stand at a sofa run (`layout.mjs`, `sofaTables`). */
const SOFA_TABLES: ReadonlySet<string> = new Set([
  '44',
  '43',
  '53a',
  '53b',
  '64a',
  '65a',
  '59a',
  '59b',
  '60',
  '63',
  '77',
  '80',
  '81',
  '76',
  '75',
  '74',
  '73',
  '66',
  '69',
  '67',
  '68',
  '22',
  '24',
  '19',
  '18',
  '17',
])

/** The long, low tables the paper draws wider than deep (`layout.mjs`, `wide`). */
const WIDE: ReadonlySet<string> = new Set(['45', '42', '29'])

/** The three rectangles the paper draws deeper than wide, each its own size. */
const TALL: Readonly<Record<string, readonly [number, number]>> = {
  '40': [30, 54],
  '52': [27, 48],
  '70': [24, 48],
}

/**
 * What the paper prints over an old metadata number (`layout.mjs`, `renamed`). 40 and 41 are one
 * physical object, so it is one spot named `40/41`; 64a/65a show the paper's 84/85; the second 55
 * is the object the old data called 56; and the paper prints 0 where the old data said 28.
 */
const RENAMED: Readonly<Record<string, string>> = {
  '40': '40/41',
  '64a': '84',
  '65a': '85',
  '56': '55',
  '28': '0',
}

/**
 * The paper prints the same number on two different physical objects three times (53, 55 and 59):
 * the prototype's own note says they "remain separate physical objects except for the explicitly
 * merged 40/41". A spot's name is unique in its venue (D134), so the two objects of each pair get
 * the Cyrillic А and Б after the printed number, in plan order (upper first): a hostess can say
 * "петдесет и три А" out loud, which is what D134 asks of a name. Nothing else is renamed.
 */
const PAIRS: Readonly<Record<string, readonly [string, string]>> = {
  '53': ['53a', '53b'],
  '59': ['59a', '59b'],
  '55': ['55', '56'],
}

/** The Cyrillic letters the two objects of a pair are told apart by. */
const PAIR_LETTERS = ['А', 'Б'] as const

/**
 * The bar stools, exactly as the prototype generates them (`layout.mjs`, `stools`): `[bar, the
 * number printed on the seat, photo x, photo y]`. The prototype's unverified extra seats (Bar 1
 * seat-13, seat-14, seat-19 and Bar 3 seat-8, seat-9, seat-13) are **not** here and must not
 * become spots: its note calls them legacy ids that were never real reservable places. What is
 * left is the paper's own numbering — Bar 1 shows 1 to 16, Bar 2 shows 1 to 15, and Bar 3 shows
 * eleven physical seats numbered 1 to 11.
 */
function stoolAnchors(): readonly (readonly [number, number, number, number])[] {
  const seats: (readonly [number, number, number, number])[] = []
  for (let index = 0; index < 9; index += 1) seats.push([1, 13 - index, 175, 478 + index * 15])
  for (let index = 0; index < 3; index += 1) seats.push([1, 16 - index, 113 + index * 19, 466])
  for (let index = 0; index < 4; index += 1) seats.push([1, 1 + index, 115 + index * 17, 612])
  for (let index = 0; index < 4; index += 1) seats.push([2, 12 + index, 256 + index * 14, 644])
  for (let index = 0; index < 7; index += 1) seats.push([2, 11 - index, 241, 657 + index * 11])
  for (let index = 0; index < 4; index += 1) seats.push([2, 4 - index, 259 + index * 13, 739])
  for (let index = 0; index < 7; index += 1) seats.push([3, 9 - index, 498, 660 + index * 13])
  seats.push([3, 11, 461, 646], [3, 10, 480, 646], [3, 1, 465, 753], [3, 2, 482, 753])
  return seats
}

/** How many seats the paper says a spot has: nothing. The club's capacities are unconfirmed. */
const SEATS_UNKNOWN = null

/** One of the venue's own kinds of spot (D134: a symbol, a filter and default seats, no rule). */
export interface ClubBiadKind {
  readonly key: string
  readonly label: string
  readonly symbol: SpotSymbol
  readonly filters: boolean
  readonly defaultSeats: number | null
  readonly sortKey: string
}

/**
 * Club Biad's own kinds of spot. The default seats are the kind's, not the paper's: the prototype
 * states no capacity anywhere and says so ("капацитетите предстои да се потвърдят"), so no spot
 * carries a number of its own and every one falls back to these. The club corrects them per spot
 * in its reservation settings when it has counted the chairs.
 *
 * `standing` holds no spot yet: the paper draws no standing area, and D134 lets the venue define
 * the kind before it draws one. It is here so the club can put the dance-floor edge on the plan
 * without a release.
 */
export const CLUB_BIAD_KINDS: readonly ClubBiadKind[] = [
  { key: 'table', label: 'Маси', symbol: 'table', filters: true, defaultSeats: 4, sortKey: 'a0' },
  {
    key: 'booth',
    label: 'Сепарета',
    symbol: 'booth',
    filters: true,
    defaultSeats: 6,
    sortKey: 'a1',
  },
  {
    key: 'stool',
    label: 'Бар столове',
    symbol: 'stool',
    filters: true,
    defaultSeats: 1,
    sortKey: 'a2',
  },
  {
    key: 'standing',
    label: 'Правостоящи',
    symbol: 'standing',
    filters: true,
    defaultSeats: null,
    sortKey: 'a3',
  },
]

/** One ported spot, in the plan grid's own units. */
export interface ClubBiadSpot {
  readonly name: string
  readonly kind: string
  readonly shape: SpotShape
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly seats: number | null
  /**
   * Whether orders are taken here, so the seed gives it a Table and a code (D134, log 1.68: a QR
   * code belongs to a table; a stool never gets one).
   */
  readonly takesOrders: boolean
  /** The part of the club the paper puts it in: the venue's Area, in the club's own words. */
  readonly area: string
}

/** The one uniform fit of the prototype's view box into the plan grid. */
function fit(): { readonly scale: number; readonly offsetX: number; readonly offsetY: number } {
  const scale = (PLAN_GRID - 2 * MARGIN) / Math.max(VIEW_BOX.width, VIEW_BOX.height)
  return {
    scale,
    offsetX: (PLAN_GRID - VIEW_BOX.width * scale) / 2,
    offsetY: (PLAN_GRID - VIEW_BOX.height * scale) / 2,
  }
}

/** A size in the plan plane, in whole grid units and never below the smallest tappable spot. */
function gridSize(value: number, scale: number): number {
  return Math.max(SPOT_MIN_SIZE, Math.round(value * scale))
}

/**
 * A spot's top-left corner from its centre, clamped into the grid. The clamp is a guard, not a
 * nudge: every anchor of this plan sits well inside the view box, and `clubBiadFloor` throws if
 * one ever did not.
 */
function corner(centre: number, size: number): number {
  return Math.min(Math.max(0, Math.round(centre - size / 2)), PLAN_GRID - size)
}

/** Which part of the club a table anchor belongs to (`layout.mjs`, `zone`). */
function areaOf(px: number, py: number): string {
  if (py < 450) return 'Горен салон'
  if (px > 510) return 'Сцена'
  if (py > 770) return 'Долен салон'
  if (px < 345) return 'Бар 1 / 2'
  return 'Бар 3'
}

/** The name the paper prints on a table anchor, pairs told apart (see `PAIRS`). */
function tableName(number: string): string {
  for (const [printed, members] of Object.entries(PAIRS)) {
    const index = members.indexOf(number)
    if (index !== -1) return `${printed} ${PAIR_LETTERS[index]}`
  }
  return RENAMED[number] ?? number.replace(/[ab]$/, '')
}

/** The shape and size, in the plan plane, of one table anchor: the prototype's own conventions. */
function tableShape(
  number: string,
  printed: 'rect' | undefined,
  scale: number,
): { readonly shape: SpotShape; readonly width: number; readonly height: number } {
  // A booth is the paper's large circle; Restro draws a сепаре as a soft-cornered rectangle, which
  // is what the shape folder's `booth` is for, so the circle's diameter becomes its side.
  if (BOOTHS.has(number)) {
    const side = 54 * scale
    return { shape: 'booth', width: side, height: side }
  }
  const tall = TALL[number]
  if (tall !== undefined) return { shape: 'rect', width: tall[0] * scale, height: tall[1] * scale }
  // The long low ones read as an oval on the paper: the folder's `pill`.
  if (WIDE.has(number)) return { shape: 'pill', width: 48 * scale, height: 24 * scale }
  // A square table, at a sofa run or printed as a rectangle.
  if (SOFA_TABLES.has(number) || printed === 'rect') {
    const side = 30 * scale
    return { shape: 'rect', width: side, height: side }
  }
  // Everything else is one of the paper's small circles.
  const diameter = 28 * scale
  return { shape: 'circle', width: diameter, height: diameter }
}

/** Club Biad's floor: the kinds, the spots and the areas the spots that take orders sit in. */
export function clubBiadFloor(): {
  readonly kinds: readonly ClubBiadKind[]
  readonly spots: readonly ClubBiadSpot[]
  readonly areas: readonly string[]
} {
  const { scale, offsetX, offsetY } = fit()
  const spots: ClubBiadSpot[] = []
  const toGrid = (px: number, py: number) => {
    const point = planPoint(px, py)
    return {
      x: offsetX + (point.x - VIEW_BOX.x) * scale,
      y: offsetY + (point.y - VIEW_BOX.y) * scale,
    }
  }

  for (const [number, px, py, printed] of POINTS) {
    const local = scaleAt(px, py)
    const shape = tableShape(number, printed, local)
    const centre = toGrid(px, py)
    const width = gridSize(shape.width, scale)
    // A circle is round, so one number serves both sides (the shape folder refuses anything else).
    const height = shape.shape === 'circle' ? width : gridSize(shape.height, scale)
    spots.push({
      name: tableName(number),
      kind: BOOTHS.has(number) ? 'booth' : 'table',
      shape: shape.shape,
      x: corner(centre.x, width),
      y: corner(centre.y, height),
      width,
      height,
      seats: SEATS_UNKNOWN,
      takesOrders: true,
      area: areaOf(px, py),
    })
  }

  for (const [bar, seat, px, py] of stoolAnchors()) {
    const diameter = gridSize(16 * scaleAt(px, py), scale)
    const centre = toGrid(px, py)
    spots.push({
      name: `Бар ${bar} · стол ${seat}`,
      kind: 'stool',
      shape: 'circle',
      x: corner(centre.x, diameter),
      y: corner(centre.y, diameter),
      width: diameter,
      height: diameter,
      seats: SEATS_UNKNOWN,
      // A stool is not a table, so it never carries a code (D134, log 1.68).
      takesOrders: false,
      area: `Бар ${bar}`,
    })
  }

  const names = new Set<string>()
  for (const spot of spots) {
    if (names.has(spot.name)) throw new Error(`two spots would be called "${spot.name}"`)
    names.add(spot.name)
    if (spot.name.length > 40) throw new Error(`"${spot.name}" is longer than a spot's name may be`)
    if (
      spot.x < 0 ||
      spot.y < 0 ||
      spot.x + spot.width > PLAN_GRID ||
      spot.y + spot.height > PLAN_GRID
    ) {
      throw new Error(`"${spot.name}" would hang off the plan's grid`)
    }
  }

  const areas: string[] = []
  for (const spot of spots) {
    if (spot.takesOrders && !areas.includes(spot.area)) areas.push(spot.area)
  }
  return { kinds: CLUB_BIAD_KINDS, spots, areas }
}
