'use server'

// The plan editor's server actions (#397): thin wrappers over the plan commands, one change each.
// Every write goes through `applyService` (rule 1) as the signed-in person, with
// `settings.reservations`, so a PIN on a shared device never reaches them (D141).
//
// **A plan that refuses to lie.** The geometry of a spot is checked three times, and the person is
// told which rule met him every time, never a bare failure:
//   1. the screen keeps every drag inside the folder's rules (`plan-layout.ts`), so it rarely sends
//      a place that would be refused;
//   2. here, before the command, the shape folder's own check answers with its code
//      (`shape_off_plan`, `shape_not_square`, …) — the engine would otherwise answer only
//      `invalid_command`;
//   3. the database's constraints (`0050_floor_plan_shapes`) are the last word: a check it refuses
//      answers `plan_refused`, and a name another spot took meanwhile answers `spot_name_taken`.
import { idSchema, SPOT_SYMBOLS, SpotPlaceSchema } from '@restro/core'
import { postgresCode } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { INVALID, inSettingsScope, runSettingsCommand, type SettingsResult } from './scope'

const venueId = idSchema('vn')
const planId = idSchema('fp')
const spotId = idSchema('sp')
/** A spot kind's key: a code, never the words staff read. */
const kindKey = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/)
const seats = z.number().int().min(1).max(100).nullable()

const KindFields = {
  key: kindKey,
  label: z.string().trim().min(1).max(40),
  symbol: z.enum(SPOT_SYMBOLS),
  defaultSeats: seats,
}

const StartPlan = z.strictObject({
  venueId,
  name: z.string().trim().min(1).max(60),
  /** The kinds a venue with none starts from, in the owner's words; empty when it has some. */
  kinds: z.array(z.strictObject(KindFields)).max(8),
})

const SavePlan = z.strictObject({
  venueId,
  planId: planId.optional(),
  name: z.string().trim().min(1).max(60),
})

/** A spot as the editor sends it: the place is checked by the folder below, not here. */
const SaveSpot = z.strictObject({
  venueId,
  spotId: spotId.optional(),
  planId,
  name: z.string().trim().min(1).max(40),
  kind: kindKey,
  shape: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  seats,
  tableId: idSchema('tb').nullable(),
})

const RemoveSpot = z.strictObject({ venueId, spotId })
const SaveKind = z.strictObject({ venueId, ...KindFields })
const RemoveKind = z.strictObject({ venueId, key: kindKey })

/** Runs one command at the venue and refreshes the page on success. */
async function runAt(venue: string, command: Record<string, unknown>): Promise<SettingsResult> {
  return inSettingsScope(venue, async (scope) => {
    const result = await runSettingsCommand(scope, command)
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/**
 * Starts a venue's first plan: the plan itself, made current, and — for a venue with no kinds yet —
 * the kinds it starts from, so the first spot can be added at once. Each is its own command; a
 * kind is saved by its key, so a second press after a failure only fills in what is missing.
 */
export async function startPlanAction(input: unknown): Promise<SettingsResult> {
  const parsed = StartPlan.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, name, kinds } = parsed.data
  return inSettingsScope(venue, async (scope) => {
    for (const kind of kinds) {
      const saved = await runSettingsCommand(scope, {
        type: 'spot_kind.save',
        key: kind.key,
        label: kind.label,
        symbol: kind.symbol,
        defaultSeats: kind.defaultSeats,
      })
      if (!saved.ok) return saved
    }
    const result = await runSettingsCommand(scope, { type: 'plan.save', name, makeCurrent: true })
    revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** Names a plan, or adds another floor (no `planId`). */
export async function savePlanAction(input: unknown): Promise<SettingsResult> {
  const parsed = SavePlan.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, planId: id, name } = parsed.data
  return runAt(venue, { type: 'plan.save', name, ...(id === undefined ? {} : { planId: id }) })
}

/** Adds a spot (no `spotId`) or saves one: moved, resized, reshaped, renamed or re-linked. */
export async function saveSpotAction(input: unknown): Promise<SettingsResult> {
  const parsed = SaveSpot.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, x, y, width, height, rotation, shape, tableId, ...spot } = parsed.data
  const place = SpotPlaceSchema.safeParse({ shape, x, y, width, height, rotation })
  if (!place.success) {
    const code = place.error.issues[0]?.message
    return { ok: false, error: code?.startsWith('shape_') ? code : 'shape_numbers' }
  }
  return inSettingsScope(venue, async (scope) => {
    try {
      const result = await runSettingsCommand(scope, {
        type: 'spot.save',
        ...spot,
        ...place.data,
        // Left out, a spot names no Table: the engine looks up any `tableId` it is handed.
        ...(tableId === null ? {} : { tableId }),
      })
      if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
      return result
    } catch (error) {
      const code = postgresCode(error)
      if (code === '23514') return { ok: false, error: 'plan_refused' } as const
      if (code === '23505') return { ok: false, error: 'spot_name_taken' } as const
      throw error
    }
  })
}

/** Takes a spot off the plan. */
export async function removeSpotAction(input: unknown): Promise<SettingsResult> {
  const parsed = RemoveSpot.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(parsed.data.venueId, { type: 'spot.remove', spotId: parsed.data.spotId })
}

/** Adds or changes one of the venue's spot kinds. */
export async function saveSpotKindAction(input: unknown): Promise<SettingsResult> {
  const parsed = SaveKind.safeParse(input)
  if (!parsed.success) return INVALID
  const { venueId: venue, ...kind } = parsed.data
  return runAt(venue, { type: 'spot_kind.save', ...kind })
}

/** Takes one of the venue's spot kinds away; refused while spots are of it. */
export async function removeSpotKindAction(input: unknown): Promise<SettingsResult> {
  const parsed = RemoveKind.safeParse(input)
  if (!parsed.success) return INVALID
  return runAt(parsed.data.venueId, { type: 'spot_kind.remove', key: parsed.data.key })
}
