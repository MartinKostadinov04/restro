// One owner-settings command on the service write path, as the signed-in person (#87): the part of
// `scope.ts` that needs no request (no cookies, no headers), so a dev seed can run a settings
// command the way the screens do. `scope.ts` re-exports it.
import { newId } from '@restro/core'
import {
  applyService,
  type ServiceActor,
  type ServiceOptions,
  type ServiceResult,
} from '@restro/core/service'
import type { DbPool } from '@restro/db'

/** The facts an accepted answer carries. */
export type ResultDetails = Extract<ServiceResult, { status: 'accepted' }>['details']

/** What an owner-settings action answers. */
export type SettingsResult<Extra extends object = object> =
  | ({ readonly ok: true; readonly details: ResultDetails } & Extra)
  | { readonly ok: false; readonly error: string; readonly details?: ResultDetails }

/** Who acts at which venue. */
export interface SettingsScope {
  readonly pool: DbPool
  readonly tenantId: string
  readonly venueId: string
  readonly userId: string
  readonly sessionId: string
  /** When the account last entered its password: its session's start. */
  readonly signedInAt: Date
  /** True when the account belongs to Restro's admin team. */
  readonly operator: boolean
}

/** The actor a command names: the account with its session, or Restro's admin team. */
export function actorOf(scope: SettingsScope, own = false): ServiceActor {
  return scope.operator && !own
    ? { kind: 'operator', userId: scope.userId }
    : { kind: 'user', userId: scope.userId, sessionId: scope.sessionId }
}

/**
 * Applies one command as the signed-in person (`own`: as the account itself, never as Restro's
 * admin team) and answers in the shape the screens use.
 */
export async function runSettingsCommand(
  scope: SettingsScope,
  command: unknown,
  options: { readonly own?: boolean; readonly service?: ServiceOptions } = {},
): Promise<SettingsResult> {
  const { result } = await applyService(
    scope.pool,
    command,
    {
      tenantId: scope.tenantId,
      venueId: scope.venueId,
      origin: 'staff',
      actor: actorOf(scope, options.own),
      jobId: newId('jb'),
      signedInAt: scope.signedInAt,
    },
    options.service,
  )
  return result.status === 'accepted'
    ? { ok: true, details: result.details }
    : { ok: false, error: result.code, details: result.details }
}
