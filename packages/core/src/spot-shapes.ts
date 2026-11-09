// The shape folder (ticket #327; D134): every shape a spot on a floor plan may be drawn as, with
// the numbers each one allows. A venue's plan is its own data, not program code (D134, log 1.29),
// so a club's floor is drawn by picking shapes out of this folder and giving them numbers — no
// release, and no drawing file.
//
// **A stored shape is never markup.** The folder holds no path, no SVG, no HTML and no style
// string: a shape is a *name* out of a fixed list, and the numbers beside it are checked whole
// numbers. The screen looks the name up in its own table of components (`plan-shape.tsx`), so the
// worst a wrong row can do is fail this check and not be drawn. Nothing read out of the database
// reaches a staff screen as markup, which is the first acceptance criterion of #327 and the reason
// the folder lives here rather than in the screen.
//
// Pure: no I/O, no UI. It runs in the worker, on the web server and in the browser — the write
// path checks a spot against it (`spot.save`), the read side checks every row it hands a screen,
// and the screen draws from the same names.

import { z } from 'zod'

/**
 * The plan's own grid. A plan carries no size of its own: the screen reads the box its spots take
 * up and fits that. The grid is only the bound a number may not leave, so one mistyped spot can
 * never push the plan a thousand screens wide.
 */
export const PLAN_GRID = 10_000

/** The smallest a spot may be drawn, in grid units: below this nobody could tap it. */
export const SPOT_MIN_SIZE = 2

/**
 * How our own component rounds a shape's corners. A name, never a number of pixels: the screen
 * holds the one table that turns it into a class, so two spots of the same shape always draw the
 * same.
 */
export const SPOT_CORNERS = ['square', 'soft', 'full'] as const

/** One corner treatment. */
export type SpotCorner = (typeof SPOT_CORNERS)[number]

/** Every shape in the folder, in the order a legend lists them. */
export const SPOT_SHAPES = ['rect', 'circle', 'booth', 'pill'] as const

/** One shape's name. */
export type SpotShape = (typeof SPOT_SHAPES)[number]

/** What the folder knows about one shape. */
export interface SpotShapeDefinition {
  /** How the screen rounds it. */
  readonly corner: SpotCorner
  /**
   * The shape is drawn round, so its numbers must describe a square. An oval table is the `pill`,
   * which says so by its name; a `circle` whose width and height differ would draw as something
   * its name does not promise, so it is refused instead.
   */
  readonly square: boolean
  /**
   * Turning it changes how it reads. A circle turned by 40 degrees is the same circle, so a
   * rotation on one is refused: two rows that draw the same thing must not be able to differ.
   */
  readonly turnable: boolean
}

/**
 * The folder itself. `satisfies` holds it to `SPOT_SHAPES`, so a shape added to the list and
 * forgotten here fails the build rather than reaching a screen with no definition.
 */
export const SPOT_SHAPE_FOLDER = {
  /** A square-cornered rectangle: a table, a standing area, a dance floor's edge. */
  rect: { corner: 'square', square: false, turnable: true },
  /** A round table, a stool, a high top. */
  circle: { corner: 'full', square: true, turnable: false },
  /** A booth: a rectangle with soft corners, as a club draws its sofas. */
  booth: { corner: 'soft', square: false, turnable: true },
  /** Rounded at both ends: a bar counter, a standing strip, an oval table. */
  pill: { corner: 'full', square: false, turnable: true },
} as const satisfies Record<SpotShape, SpotShapeDefinition>

/** True for a name the folder holds. */
export function isSpotShape(value: unknown): value is SpotShape {
  return typeof value === 'string' && (SPOT_SHAPES as readonly string[]).includes(value)
}

/** One shape's definition, or null for a name the folder does not hold. */
export function spotShapeOf(value: unknown): SpotShapeDefinition | null {
  return isSpotShape(value) ? SPOT_SHAPE_FOLDER[value] : null
}

/**
 * The symbols a venue's own spot kinds are drawn with in the legend and on a spot (D134: a kind
 * carries a legend symbol, a filter and default seats, and no rule beyond those). A name out of a
 * fixed list for the same reason the shapes are: the screen holds the table of components, and a
 * venue can never put a picture of its own — let alone markup — where staff read a plan.
 */
export const SPOT_SYMBOLS = [
  /** A table: the everyday spot. */
  'table',
  /** A booth or a sofa (сепаре). */
  'booth',
  /** A bar stool or a high top. */
  'stool',
  /** A standing place: no seats, people stand. */
  'standing',
  /** A bar counter. */
  'counter',
  /** Anything a club calls its own: the plain mark. */
  'dot',
] as const

/** One legend symbol's name. */
export type SpotSymbol = (typeof SPOT_SYMBOLS)[number]

/** True for a symbol the list holds. */
export function isSpotSymbol(value: unknown): value is SpotSymbol {
  return typeof value === 'string' && (SPOT_SYMBOLS as readonly string[]).includes(value)
}

/** The symbol of a kind, or the plain mark where the row names one we do not draw. */
export function spotSymbolOf(value: unknown): SpotSymbol {
  return isSpotSymbol(value) ? value : 'dot'
}

/** Where a spot sits on its plan and how it is drawn: the folder's checked numbers. */
export interface SpotPlace {
  readonly shape: SpotShape
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** Degrees clockwise, 0 to 359; always 0 on a shape the folder does not turn. */
  readonly rotation: number
}

/** Why a place was refused. The screen and the write path both answer with the code. */
export const SPOT_PLACE_REFUSALS = [
  /** The shape is not one of the folder's names. */
  'shape_unknown',
  /** A number is missing, not whole, or outside the plan's grid. */
  'shape_numbers',
  /** The spot would hang off the plan's grid. */
  'shape_off_plan',
  /** A round shape was given a width and a height that differ. */
  'shape_not_square',
  /** A shape nothing is gained by turning was given a rotation. */
  'shape_not_turnable',
] as const

/** One refusal code. */
export type SpotPlaceRefusal = (typeof SPOT_PLACE_REFUSALS)[number]

const unit = z.number().int().min(0).max(PLAN_GRID)
const size = z.number().int().min(SPOT_MIN_SIZE).max(PLAN_GRID)

/**
 * The fields a spot's place is made of. Spread into a command's own schema (`spot.save`), so the
 * write path and the read side check the very same numbers rather than two copies of them.
 */
export const SPOT_PLACE_FIELDS = {
  shape: z.string(),
  x: unit,
  y: unit,
  width: size,
  height: size,
  rotation: z.number().int().min(0).max(359).optional(),
} as const

/** A place as it is given, before the folder's cross-field rules. */
export interface SpotPlaceInput {
  readonly shape: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation?: number | undefined
}

/**
 * The folder's cross-field rules, as a Zod refiner: the shape is one of ours, the spot sits inside
 * the grid, a circle is round, and a shape nothing is gained by turning carries no rotation. Every
 * message is one of `SPOT_PLACE_REFUSALS`, so a refusal reaches the screen by its name.
 */
export function spotPlaceIssues(value: SpotPlaceInput, ctx: z.RefinementCtx): void {
  const shape = spotShapeOf(value.shape)
  if (shape === null) {
    ctx.addIssue({ code: 'custom', message: 'shape_unknown', path: ['shape'] })
    return
  }
  if (value.x + value.width > PLAN_GRID || value.y + value.height > PLAN_GRID) {
    ctx.addIssue({ code: 'custom', message: 'shape_off_plan', path: ['x'] })
  }
  if (shape.square && value.width !== value.height) {
    ctx.addIssue({ code: 'custom', message: 'shape_not_square', path: ['width'] })
  }
  if (!shape.turnable && (value.rotation ?? 0) !== 0) {
    ctx.addIssue({ code: 'custom', message: 'shape_not_turnable', path: ['rotation'] })
  }
}

/**
 * A spot's place, checked against the folder. Zod at the boundary (conventions): the write path
 * spreads its fields onto `spot.save`, and the read side runs every stored row through it before a
 * screen is handed the numbers. `rotation` may be left out, which reads as none.
 */
export const SpotPlaceSchema = z.strictObject(SPOT_PLACE_FIELDS).superRefine(spotPlaceIssues)

/** A place that passed the folder's check, or the first code that refused it. */
export type SpotPlaceCheck =
  | { readonly ok: true; readonly place: SpotPlace }
  | { readonly ok: false; readonly code: SpotPlaceRefusal }

/**
 * Checks one stored row's geometry. The read side calls this per spot: a row the folder refuses is
 * left off the plan and counted, never drawn from numbers nobody checked.
 */
export function checkSpotPlace(value: unknown): SpotPlaceCheck {
  const parsed = SpotPlaceSchema.safeParse(value)
  if (parsed.success) {
    const { shape, x, y, width, height, rotation } = parsed.data
    return {
      ok: true,
      place: { shape: shape as SpotShape, x, y, width, height, rotation: rotation ?? 0 },
    }
  }
  const first = parsed.error.issues[0]
  const named = (SPOT_PLACE_REFUSALS as readonly string[]).includes(first?.message ?? '')
  return { ok: false, code: named ? (first?.message as SpotPlaceRefusal) : 'shape_numbers' }
}

/**
 * The box a set of spots takes up, as the screen's own view box: the smallest rectangle holding
 * them with a margin of one spot's breath around it, so nothing sits against the edge. An empty
 * plan gets a small square, so the screen has something to draw its empty state inside.
 */
export function planExtent(
  places: readonly Pick<SpotPlace, 'x' | 'y' | 'width' | 'height'>[],
  margin = 20,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  if (places.length === 0) return { x: 0, y: 0, width: 100, height: 100 }
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const place of places) {
    left = Math.min(left, place.x)
    top = Math.min(top, place.y)
    right = Math.max(right, place.x + place.width)
    bottom = Math.max(bottom, place.y + place.height)
  }
  // The origin never goes negative, and the size is measured from the edges that were kept: a plan
  // drawn tight to the origin keeps the same margin on both sides instead of hanging off to one.
  const x = Math.max(0, left - margin)
  const y = Math.max(0, top - margin)
  return { x, y, width: right + margin - x, height: bottom + margin - y }
}
