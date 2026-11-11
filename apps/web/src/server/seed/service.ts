// The two sides of the service write path that no screen and no server action can send, so that
// the demo seed (`scripts/seed-demo.ts`) can set a night up the way one really happens: a phone's
// own command, and the worker's reading of the POS. `settings/command.ts` is this same thing for
// the staff's commands — the part of a request's scope that needs no request, "so a dev seed can
// run a settings command the way the screens do" — and this file is its guest and worker twin.
//
// It lives in the web app's server code because that is one of the three places allowed to reach
// the service write path at all (dependency-cruiser's `core-service-only-from-service-callers`:
// `apps/worker`, `apps/web/app/api/` and `apps/web/src/server/`); a script is not one of them, and
// a guardrail only tightens (D67). Nothing in the app imports this file: the seeds under
// `apps/web/scripts/` are its only callers, and it adds no command of its own — every write still
// goes through `applyService`, with the same checks, provenance and Log entries as the real thing.
import { newId } from '@restro/core'
import {
  applyService,
  type ReservationSettingsView,
  readReservationNight,
  readReservationSettings,
  readStaffSettings,
  type ServiceActor,
  type ServiceOptions,
  type ServiceResult,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

/** The facts an accepted answer carries. */
export type SeedDetails = Extract<ServiceResult, { status: 'accepted' }>['details']

/** What a seeded command answers, in the shape `runSettingsCommand` uses. */
export type SeedResult =
  | { readonly ok: true; readonly details: SeedDetails }
  | { readonly ok: false; readonly error: string; readonly details?: SeedDetails }

/** The venue being seeded. */
export interface SeedScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: string
}

function answer(result: ServiceResult): SeedResult {
  return result.status === 'accepted'
    ? { ok: true, details: result.details }
    : { ok: false, error: result.code, details: result.details }
}

/**
 * One command as a phone at the table sends it. The context carries the table's code hash, the
 * same value the table row already holds, so the seed needs no plain code and the night's guest
 * rows are ordinary ones.
 */
export async function runGuestCommand(
  scope: SeedScope,
  command: unknown,
  at: { readonly tableCodeHash: string; readonly sittingId?: string },
): Promise<SeedResult> {
  const { result } = await applyService(scope.pool, command, {
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    origin: 'guest',
    actor: { kind: 'guest' },
    jobId: newId('jb'),
    tableCodeHash: at.tableCodeHash,
    ...(at.sittingId === undefined ? {} : { sittingId: at.sittingId }),
  })
  return answer(result)
}

/**
 * One command as the worker's sync sends it, on behalf of a POS instance: `reading.record` and the
 * rest of the worker's own commands.
 */
export async function runWorkerCommand(
  scope: SeedScope,
  command: unknown,
  by: { readonly integrationId: string },
  options?: ServiceOptions,
): Promise<SeedResult> {
  const { result } = await applyService(
    scope.pool,
    command,
    {
      tenantId: scope.tenantId,
      venueId: scope.venueId,
      origin: 'worker',
      actor: { kind: 'integration', integrationId: by.integrationId },
      jobId: newId('jb'),
    },
    options,
  )
  return answer(result)
}

/** The venue's reservation rules and the spots already on its floor, as Settings reads them. */
export async function readSeededReservations(scope: SeedScope): Promise<ReservationSettingsView> {
  return await readReservationSettings(scope.pool, scope.tenantId, scope.venueId)
}

/**
 * The people already on the venue's staff, by the name they are shown under: a seed run twice must
 * add nobody a second time (`staff.add` would happily make a second Весела).
 */
export async function readSeededStaff(
  scope: SeedScope,
  actor: ServiceActor,
): Promise<ReadonlySet<string>> {
  const read = await readStaffSettings(scope.pool, {
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    actor,
  })
  if (!read.ok) throw new Error(`the venue's staff could not be read: ${read.code}`)
  return new Set(read.settings.staff.map((person: { displayName: string }) => person.displayName))
}

/** How many reservations one service day already holds: a night that is set up is left alone. */
export async function countSeededNight(
  scope: SeedScope,
  actor: ServiceActor,
  day: string,
): Promise<number> {
  const read = await readReservationNight(scope.pool, {
    tenantId: scope.tenantId,
    venueId: scope.venueId,
    actor,
    day,
  })
  if (!read.ok) throw new Error(`the night could not be read: ${read.code}`)
  return read.night.rows.length + read.night.waiting.length + read.night.deleted.length
}
