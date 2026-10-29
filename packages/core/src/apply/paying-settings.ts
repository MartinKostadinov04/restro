// patchPayingSettingsIn(): the one writer of a venue's paying settings, `venues.settings.paying`
// (the smallest card payment, D127, #104), and of its legal details, `venues.settings.legalDetails`
// (#198). Rule 1 keeps every write of the venue's data in core/apply; the service command
// `settings.paying_set` (the owner's Paying screen, #116) calls this and nothing else does.

import { paymentAccounts, venues } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { type LegalDetails, LegalDetailsSchema, readLegalDetails } from '../legal-details'
import { PayingSettingsSchema, readPayingSettings } from '../paying-settings'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** Why `patchPayingSettingsIn` refused. */
export type PayingSettingsErrorCode =
  /** The input does not pass its checks, or sits below the provider's minimum; nothing was written. */
  | 'invalid_input'
  /** The tenant has no such venue. */
  | 'venue_not_found'
  /** The venue was deleted (D76). */
  | 'venue_archived'

/** Thrown by `patchPayingSettingsIn`. */
export class PayingSettingsError extends Error {
  override name = 'PayingSettingsError'
  readonly code: PayingSettingsErrorCode

  constructor(code: PayingSettingsErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** What the owner's Paying screen changes: a key left out stays. */
export interface PayingPatch {
  /** The smallest card payment, or null for the provider's own minimum. */
  readonly minCardMinor?: number | null
  /** The venue's legal details (#198), or null to clear them. */
  readonly legalDetails?: LegalDetails | null
}

/** What `patchPayingSettingsIn` changed. */
export interface PayingPatched {
  /** The keys whose value changed (`minCardMinor`, `legalDetails`). */
  readonly changed: readonly (keyof PayingPatch)[]
}

/**
 * Changes some of the owner's paying choices inside the caller's transaction, under the venue's
 * row lock: the smallest card payment (`venues.settings.paying`, never below the provider's
 * minimum, `providerMinMinor`) and the legal details (`venues.settings.legalDetails`). The service
 * write path's `settings.paying_set` calls it and writes the Log entry beside it; nothing else
 * does. Throws `PayingSettingsError` for a value that does not pass its checks or a venue that is
 * gone; nothing is written then.
 */
export async function patchPayingSettingsIn(
  tx: WriteTx,
  venueId: string,
  patch: PayingPatch,
  providerMinMinor: number,
): Promise<PayingPatched> {
  const locked = await lockLiveVenue(tx, venueId, 'update')
  if (locked.refused !== null) {
    throw new PayingSettingsError(
      locked.refused === 'venue_archived' ? 'venue_archived' : 'venue_not_found',
      venueRefusalText(venueId, locked.refused),
    )
  }
  const { settings } = locked.venue
  const changed: (keyof PayingPatch)[] = []
  const next: Record<string, unknown> = { ...settings }

  if (patch.minCardMinor !== undefined) {
    const paying = PayingSettingsSchema.safeParse({ minCardMinor: patch.minCardMinor })
    if (!paying.success)
      throw new PayingSettingsError('invalid_input', z.prettifyError(paying.error))
    if (paying.data.minCardMinor !== null && paying.data.minCardMinor < providerMinMinor) {
      throw new PayingSettingsError(
        'invalid_input',
        `the smallest card payment must be at least the provider's minimum (${providerMinMinor})`,
      )
    }
    if (paying.data.minCardMinor !== readPayingSettings(settings).minCardMinor) {
      changed.push('minCardMinor')
      if (paying.data.minCardMinor === null) delete next.paying
      else next.paying = paying.data
    }
  }

  if (patch.legalDetails !== undefined) {
    const legal =
      patch.legalDetails === null ? null : LegalDetailsSchema.safeParse(patch.legalDetails)
    if (legal !== null && !legal.success) {
      throw new PayingSettingsError('invalid_input', z.prettifyError(legal.error))
    }
    const after = legal === null ? null : legal.data
    // Clearing them would turn card payments off with no signal to the staff (#198): the owner
    // disconnects the account first, or replaces the details.
    if (after === null && readLegalDetails(settings) !== null) {
      const [connected] = await tx
        .select({ venueId: paymentAccounts.venueId })
        .from(paymentAccounts)
        .where(and(eq(paymentAccounts.venueId, venueId), eq(paymentAccounts.state, 'connected')))
      if (connected !== undefined) {
        throw new PayingSettingsError(
          'invalid_input',
          'the legal details cannot be cleared while the venue has a connected payment account',
        )
      }
    }
    if (JSON.stringify(after) !== JSON.stringify(readLegalDetails(settings))) {
      changed.push('legalDetails')
      if (after === null) delete next.legalDetails
      else next.legalDetails = after
    }
  }

  if (changed.length > 0)
    await tx.update(venues).set({ settings: next }).where(eq(venues.id, venueId))
  return { changed }
}
