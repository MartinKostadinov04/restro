// The owner's paying choices on the service write path (#116; D127, #104, #198): the smallest card
// payment and the venue's legal details, each a settings change that needs `settings.connect_payments`
// and a sign-in of the last 15 minutes (D125 2.2). It merges into the venue's settings under the
// venue's row lock (core/apply's `patchPayingSettingsIn`) and is one `settings.changed` `record` Log
// entry naming the keys that changed, never their values (a legal name or a link is the venue's).
// The provider's smallest charge comes from the web app's server action, which knows the venue's
// provider; the browser never names it.

import { z } from 'zod'

import { PayingSettingsError, patchPayingSettingsIn } from '../apply/paying-settings'
import { LegalDetailsSchema } from '../legal-details'
import { MIN_CARD_MAX_MINOR } from '../paying-settings'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'

/** `settings.paying_set`'s payload: the keys to change; a key left out stays. */
export const SetPayingSchema = z.strictObject({
  type: z.literal('settings.paying_set'),
  changes: z.strictObject({
    minCardMinor: z.number().int().positive().max(MIN_CARD_MAX_MINOR).nullable().optional(),
    legalDetails: LegalDetailsSchema.nullable().optional(),
  }),
  /** The provider's smallest card payment for the venue's currency, minor units. */
  providerMinMinor: z.number().int().nonnegative(),
})

/** `settings.paying_set`. */
export async function setPayingChoices(
  stx: ServiceTx,
  command: z.infer<typeof SetPayingSchema>,
): Promise<ServiceResult> {
  try {
    const done = await patchPayingSettingsIn(
      stx.tx,
      stx.venueId,
      command.changes,
      command.providerMinMinor,
    )
    if (done.changed.length > 0) {
      await stx.log({
        kind: 'settings.changed',
        reason: 'paying',
        details: { keys: done.changed.join(',') },
      })
    }
    return accepted(null, { details: { changed: done.changed.length > 0 } })
  } catch (error) {
    if (error instanceof PayingSettingsError && error.code === 'invalid_input') {
      return refused(null, 'invalid_settings', { problem: error.message.slice(0, 200) })
    }
    throw error
  }
}
