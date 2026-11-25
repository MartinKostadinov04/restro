// The floor plan, its spots and the venue's own spot kinds (ticket #323; D134, D141). Settings
// work: `settings.reservations`, so it needs the person's own sign-in and a PIN on a shared device
// never reaches it (D141, `isSettingsPermission`).
//
// Nothing here is deleted (CLAUDE.md's never-list): a plan, a spot or a kind taken off the floor
// gets its `removed_at`, so the plans of the last month still read as they were (D141) and a
// reservation that held a spot still names it.

import { floorPlans, spots, venueSpotKinds } from '@restro/db'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'

import { newId } from '../../ids'
import type { SpotSymbol } from '../../spot-shapes'
import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { hasSpotKind, readPlan, readSpot, refuse, spotsOfReservation } from './rows'

/** What a plan is saved with. */
export interface PlanSaveCommand {
  readonly planId?: string
  readonly name: string
  /** Make it the plan tonight's screens draw. The one it replaces stops being current. */
  readonly makeCurrent?: boolean
}

/**
 * Saves a floor plan: a new one with no `planId`, else a rename of the one named. Making it
 * current clears the venue's other current plan first, so the venue's single partial unique index
 * is never crossed by two rows at once; two of these commands queue on the venue's row, which the
 * engine holds for every command.
 */
export async function savePlan(stx: ServiceTx, command: PlanSaveCommand): Promise<ServiceResult> {
  const existing = command.planId === undefined ? null : await readPlan(stx, command.planId)
  if (command.planId !== undefined && existing === null) return refuse('plan_missing')
  const planId = existing?.id ?? newId('fp')
  const makeCurrent = command.makeCurrent ?? existing?.isCurrent ?? false
  if (makeCurrent) {
    await stx.tx
      .update(floorPlans)
      .set({ isCurrent: false, ...stx.provenance, updatedAt: sql`now()` })
      .where(
        and(
          eq(floorPlans.venueId, stx.venueId),
          eq(floorPlans.isCurrent, true),
          ne(floorPlans.id, planId),
        ),
      )
  }
  if (existing === null) {
    await stx.tx.insert(floorPlans).values({
      id: planId,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      name: command.name,
      isCurrent: makeCurrent,
      ...stx.provenance,
    })
  } else {
    await stx.tx
      .update(floorPlans)
      .set({ name: command.name, isCurrent: makeCurrent, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(floorPlans.id, planId))
  }
  await stx.log({
    kind: 'plan.changed',
    toState: makeCurrent ? 'current' : 'kept',
    reason: existing === null ? 'created' : 'renamed',
    details: { planId, name: command.name },
  })
  return accepted(null, { details: { planId, current: makeCurrent } })
}

/**
 * Takes a plan off the floor. Its spots stay as they are: a spot is removed by its own command, so
 * a plan put away by mistake can be made current again without redrawing it.
 */
export async function removePlan(
  stx: ServiceTx,
  command: { readonly planId: string },
): Promise<ServiceResult> {
  const plan = await readPlan(stx, command.planId)
  if (plan === null) return refuse('plan_missing')
  await stx.tx
    .update(floorPlans)
    .set({
      removedAt: sql`now()`,
      isCurrent: false,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(floorPlans.id, plan.id))
  await stx.log({
    kind: 'plan.changed',
    fromState: plan.isCurrent ? 'current' : 'kept',
    toState: 'removed',
    details: { planId: plan.id, name: plan.name },
  })
  return accepted(null, { details: { planId: plan.id } })
}

/** What a spot is saved with: its place out of the shape folder (#327), and what it is called. */
export interface SpotSaveCommand {
  readonly spotId?: string
  readonly planId: string
  readonly name: string
  readonly kind: string
  readonly shape: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly rotation?: number
  readonly seats?: number | null
  /** The Table orders at this spot go onto, as Restro's own `tb_` id (rule 3). */
  readonly tableId?: string | null
}

/**
 * Saves a spot on a plan: a new one with no `spotId`, else the one named, moved, renamed or
 * re-linked. The plan and the kind must be the venue's own (`plan_missing`, `spot_kind_missing`),
 * and the name must be free among the spots still on the floor (`spot_name_taken`) — checked here
 * so the person is told which rule he met, rather than being handed the index's error.
 */
export async function saveSpot(stx: ServiceTx, command: SpotSaveCommand): Promise<ServiceResult> {
  const plan = await readPlan(stx, command.planId)
  if (plan === null) return refuse('plan_missing')
  if (!(await hasSpotKind(stx, command.kind))) return refuse('spot_kind_missing')
  const existing = command.spotId === undefined ? null : await readSpot(stx, command.spotId)
  if (command.spotId !== undefined && existing === null) return refuse('spot_missing')
  const [clash] = await stx.tx
    .select({ id: spots.id })
    .from(spots)
    .where(
      and(eq(spots.venueId, stx.venueId), eq(spots.name, command.name), isNull(spots.removedAt)),
    )
  if (clash !== undefined && clash.id !== existing?.id) return refuse('spot_name_taken')
  const spotId = existing?.id ?? newId('sp')
  const values = {
    planId: plan.id,
    name: command.name,
    kind: command.kind,
    shape: command.shape,
    x: command.x,
    y: command.y,
    width: command.width,
    height: command.height,
    rotation: command.rotation ?? 0,
    seats: command.seats ?? null,
    tableId: command.tableId ?? null,
  }
  if (existing === null) {
    await stx.tx.insert(spots).values({
      id: spotId,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      ...values,
      ...stx.provenance,
    })
  } else {
    await stx.tx
      .update(spots)
      .set({ ...values, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(spots.id, spotId))
  }
  await stx.log({
    kind: 'spot.changed',
    tableId: values.tableId ?? undefined,
    toState: existing === null ? 'created' : 'changed',
    details: { spotId, planId: plan.id, name: values.name, spotKind: values.kind },
  })
  return accepted(null, { details: { spotId, planId: plan.id } })
}

/**
 * Sets a spot's seats and nothing else about it (ticket #325; D134, log 1.22), for a caller that
 * changes the number alone without carrying the spot's whole geometry. The plan editor (#397) sends
 * the whole spot through `spot.save` instead. Empty seats put the spot back on its kind's default. The number is a warning's input only ("more guests than
 * seats"): nothing here ever refuses a party for being larger.
 */
export async function setSpotSeats(
  stx: ServiceTx,
  command: { readonly spotId: string; readonly seats: number | null },
): Promise<ServiceResult> {
  const spot = await readSpot(stx, command.spotId)
  if (spot === null) return refuse('spot_missing')
  if (spot.seats === command.seats) return accepted(null, { details: { spotId: spot.id } })
  await stx.tx
    .update(spots)
    .set({ seats: command.seats, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(spots.id, spot.id))
  await stx.log({
    kind: 'spot.changed',
    tableId: spot.tableId ?? undefined,
    toState: 'seats',
    details: { spotId: spot.id, planId: spot.planId, name: spot.name, seats: command.seats },
  })
  return accepted(null, { details: { spotId: spot.id } })
}

/**
 * Takes a spot off its plan. What held it stays held: the rows of `reservation_spots` are the
 * record of where a party sat, and a removed spot simply stops being offered (its name is free
 * again, because the venue's name index counts only the spots still there).
 */
export async function removeSpot(
  stx: ServiceTx,
  command: { readonly spotId: string },
): Promise<ServiceResult> {
  const spot = await readSpot(stx, command.spotId)
  if (spot === null) return refuse('spot_missing')
  await stx.tx
    .update(spots)
    .set({ removedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(spots.id, spot.id))
  await stx.log({
    kind: 'spot.changed',
    tableId: spot.tableId ?? undefined,
    toState: 'removed',
    details: { spotId: spot.id, planId: spot.planId, name: spot.name },
  })
  return accepted(null, { details: { spotId: spot.id } })
}

/** What a spot kind is saved with. */
export interface SpotKindSaveCommand {
  readonly key: string
  readonly label: string
  /** Its legend symbol, one of the folder's names (#327); left out keeps the plain mark. */
  readonly symbol?: SpotSymbol
  /** Whether the plan offers it as a filter (D134); left out keeps it offered. */
  readonly filters?: boolean
  readonly defaultSeats?: number | null
  readonly sortKey?: string
}

/**
 * Saves one of the venue's own spot kinds, by its key: the words staff see and how many places a
 * spot of that kind has unless the spot says otherwise. A kind that had been removed comes back.
 */
export async function saveSpotKind(
  stx: ServiceTx,
  command: SpotKindSaveCommand,
): Promise<ServiceResult> {
  const values = {
    label: command.label,
    defaultSeats: command.defaultSeats ?? null,
    removedAt: null,
    ...(command.symbol === undefined ? {} : { symbol: command.symbol }),
    ...(command.filters === undefined ? {} : { filters: command.filters }),
    ...(command.sortKey === undefined ? {} : { sortKey: command.sortKey }),
  }
  await stx.tx
    .insert(venueSpotKinds)
    .values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      key: command.key,
      sortKey: command.sortKey ?? 'a0',
      symbol: command.symbol ?? 'dot',
      filters: command.filters ?? true,
      ...values,
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [venueSpotKinds.tenantId, venueSpotKinds.venueId, venueSpotKinds.key],
      set: { ...values, ...stx.provenance, updatedAt: sql`now()` },
    })
  await stx.log({
    kind: 'spot.changed',
    toState: 'kind_saved',
    details: { spotKind: command.key, label: command.label },
  })
  return accepted(null, { details: { spotKind: command.key } })
}

/**
 * Takes one of the venue's spot kinds away. Refused `spot_kind_in_use` while spots on the floor
 * are still of it: a spot whose kind had vanished would have no number of places and no words,
 * and nothing in the plan may be left in that state.
 */
export async function removeSpotKind(
  stx: ServiceTx,
  command: { readonly key: string },
): Promise<ServiceResult> {
  if (!(await hasSpotKind(stx, command.key))) return refuse('spot_kind_missing')
  const [inUse] = await stx.tx
    .select({ id: spots.id })
    .from(spots)
    .where(
      and(eq(spots.venueId, stx.venueId), eq(spots.kind, command.key), isNull(spots.removedAt)),
    )
  if (inUse !== undefined) return refuse('spot_kind_in_use')
  await stx.tx
    .update(venueSpotKinds)
    .set({ removedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(and(eq(venueSpotKinds.venueId, stx.venueId), eq(venueSpotKinds.key, command.key)))
  await stx.log({
    kind: 'spot.changed',
    toState: 'kind_removed',
    details: { spotKind: command.key },
  })
  return accepted(null, { details: { spotKind: command.key } })
}

/** The spots one reservation holds, as their ids: what a Log entry names them by. */
export async function heldSpotIds(stx: ServiceTx, reservationId: string): Promise<string[]> {
  const held = await spotsOfReservation(stx, reservationId)
  return held.map((row) => row.spotId)
}
