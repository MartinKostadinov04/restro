// What every owner-settings server action shares (#87): who is asking, that the venue is theirs, and
// one call into the service write path. The tenant is the person's organisation, never the request's;
// the actor is the signed-in account (Restro's admin team acts as `operator`, except where a command
// is the account's own session). A settings change takes the person's own sign-in of the last 15
// minutes: the service path refuses `sign_in_again` and the screen asks for the password. The answer
// is plain data: accepted with the path's details, or refused with its code (D72); the screen words
// the code.
import { getPool } from '../db'
import { logError } from '../log'
import { requireTenant } from '../session'
import { isOperator } from '../staff/service'
import { getVenue } from '../venues'
import type { SettingsResult, SettingsScope } from './command'

export {
  actorOf,
  type ResultDetails,
  runSettingsCommand,
  type SettingsResult,
  type SettingsScope,
} from './command'

/** Answers for the failures every action can have. */
export const INVALID: SettingsResult = { ok: false, error: 'invalid' }
const NOT_FOUND: SettingsResult = { ok: false, error: 'venue_missing' }

/**
 * Runs `work` for a venue of the signed-in person's organisation. Another tenant's venue and a
 * made-up id both come back as `venue_missing` (row-level security); anything unexpected is
 * logged without detail and answered `failed`.
 */
export async function inSettingsScope<R extends SettingsResult>(
  venueId: string,
  work: (scope: SettingsScope) => Promise<R>,
): Promise<R | SettingsResult> {
  try {
    const { organization, user, sessionId, signedInAt } = await requireTenant()
    const venue = await getVenue(organization.id, venueId)
    if (!venue) return NOT_FOUND
    return await work({
      pool: getPool(),
      tenantId: organization.id,
      venueId: venue.id,
      userId: user.id,
      sessionId,
      signedInAt,
      operator: await isOperator(user.id),
    })
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('owner_settings_action_failed', error)
    return { ok: false, error: 'failed' }
  }
}
