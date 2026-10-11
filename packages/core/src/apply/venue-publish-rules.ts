// setVenuePublishRules(): the writer for a venue's publishing rules (brief CF-09b, CF-04, D73),
// `venues.settings.publish` = {after_sync: 'auto' | 'manual', new_items: 'show' | 'hold'}:
//
//   after_sync   a sync that changed the menu publishes it by itself (`auto`), or waits until a
//                person presses Publish (`manual`);
//   new_items    items the till adds are shown at once (`show`) or kept hidden until a manager
//                has looked at them (`hold`).
//
// Rule 1 keeps every write of the venue's data in core/apply; the venue's Publishing tab ("Rules")
// calls this and nothing else. Before a venue saves its rules it reads the integration's old ones
// (`venuePublishRules`), so nothing changes until someone saves; a save writes both of the venue's
// own, which from then on win. The worker reads them for the venue its pull belongs to, so two
// venues on one catalogue each follow their own rule.
//
// One atomic `UPDATE` merged inside Postgres: other keys of `settings` (the theme, the guest
// features) are neither read nor rewritten here, so a save that lands at the same time as a design
// change cannot undo it. The venue row is locked first and must be live (D76, `lockLiveVenue`).

import { type DbPool, venues } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { idSchema } from '../ids'
import { type VenuePublishRules, VenuePublishRulesSchema } from '../sync-settings'
import { ProvisionError } from './provision'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

const InputSchema = z.strictObject({
  venueId: idSchema('vn'),
  rules: VenuePublishRulesSchema,
})

/** What `setVenuePublishRules` needs. */
export type SetVenuePublishRulesInput = z.input<typeof InputSchema>

/**
 * Saves the venue's publishing rules and returns them. Refuses malformed input
 * (`invalid_input`) and a venue the tenant does not have (`venue_missing`) before or without
 * writing. Idempotent. `settings.publish` is replaced by exactly the two rules, so a stray key in
 * it cannot linger.
 */
export async function setVenuePublishRules(
  pool: DbPool,
  tenantId: string,
  input: SetVenuePublishRulesInput,
): Promise<VenuePublishRules> {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) throw new ProvisionError('invalid_input', z.prettifyError(parsed.error))
  const { venueId, rules } = parsed.data
  const value = JSON.stringify(rules)
  return withTenantWrite(pool, tenantId, async (tx) => {
    // The row lock is taken for update at once (this writer updates the row, so a shared lock
    // would have to be upgraded and two saves could deadlock); a deleted venue is refused.
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    const rows = await tx
      .update(venues)
      .set({
        settings: sql`${venues.settings} || jsonb_build_object('publish', ${value}::jsonb)`,
      })
      .where(eq(venues.id, venueId))
      .returning({ id: venues.id })
    if (rows.length === 0) {
      throw new ProvisionError('venue_missing', `this tenant has no venue ${venueId}`)
    }
    return rules
  })
}
