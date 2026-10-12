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
import {
  type VenuePublishRules,
  VenuePublishRulesSchema,
  type VenueSyncSettings,
  VenueSyncSettingsSchema,
} from '../sync-settings'
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

const SyncInputSchema = z.strictObject({
  venueId: idSchema('vn'),
  sync: VenueSyncSettingsSchema,
})

/** What `setVenueSyncSettings` needs. */
export type SetVenueSyncSettingsInput = z.input<typeof SyncInputSchema>

/**
 * Saves the venue's sync mode (D82, D96: Settings › Publish, "Automation settings"): `auto` with
 * the change-check interval and the daily full-read time in the venue's own time zone, or
 * `manual`. `settings.sync` is replaced by exactly these three keys. Refuses malformed input
 * (`invalid_input`), a venue the tenant does not have (`venue_missing`) and a deleted one
 * (`venue_archived`). The worker's tick reads it on its next minute.
 */
export async function setVenueSyncSettings(
  pool: DbPool,
  tenantId: string,
  input: SetVenueSyncSettingsInput,
): Promise<VenueSyncSettings> {
  const parsed = SyncInputSchema.safeParse(input)
  if (!parsed.success) throw new ProvisionError('invalid_input', z.prettifyError(parsed.error))
  const { venueId, sync } = parsed.data
  const value = JSON.stringify(sync)
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    await tx
      .update(venues)
      .set({ settings: sql`${venues.settings} || jsonb_build_object('sync', ${value}::jsonb)` })
      .where(eq(venues.id, venueId))
    return sync
  })
}

/**
 * Sets or clears the venue's pause of automatic publishing (T76, brief S3-05): `true` after a
 * rollback, `false` once a person published again. Kept inside `settings.publish` next to
 * `after_sync`, which it never touches. A deleted venue is refused (`venue_archived`); the flag
 * is written on the venue even when it inherited the integration's old one, so from then on only
 * the venue's own counts.
 */
export async function setVenueAutoPublishPaused(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  paused: boolean,
): Promise<boolean> {
  if (!idSchema('vn').safeParse(venueId).success) {
    throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  }
  return withTenantWrite(pool, tenantId, async (tx) => {
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    const rows = await tx
      .update(venues)
      .set({
        settings: sql`${venues.settings} || jsonb_build_object('publish',
          (case when jsonb_typeof(${venues.settings} -> 'publish') = 'object'
            then ${venues.settings} -> 'publish' else '{}'::jsonb end)
          || jsonb_build_object('auto_paused', ${paused}::boolean))`,
      })
      .where(eq(venues.id, venueId))
      .returning({ id: venues.id })
    return rows.length > 0
  })
}
