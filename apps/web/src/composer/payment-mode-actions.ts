'use server'

// The composer's payment-mode write for a selection of items (#218; D113, D122 §5): the selection
// bar's "Payment mode…". In the shape of ./tag-actions.ts: it checks who is asking (requireTenant),
// that the venue is theirs, parses its input with Zod and hands it to core's `setItemPaymentMode`,
// one atomic change set for `apply()` (rule 1). Then it revalidates the venue page.
import { idSchema, PAYMENT_MODES } from '@restro/core'
import { ApplyError, PaymentModeError, setItemPaymentMode } from '@restro/core/apply'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { readItemPayFirstDefault } from '@/server/composer/pay-first'
import { getPool } from '@/server/db'
import { logError } from '@/server/log'
import { requireTenant } from '@/server/session'
import { onSharedDevice } from '@/server/staff/shared-device'
import { getVenue } from '@/server/venues'

import type { ActionResult } from './action-result'

const SetItemPaymentModeInput = z.strictObject({
  venueId: idSchema('vn'),
  itemIds: z.array(idSchema('nd')).min(1).max(1000),
  /** `null` = same as the venue. */
  mode: z.enum(PAYMENT_MODES).nullable(),
})

/** Sets the payment mode of a selection of items, or takes it away: every item changes, or none. */
export async function setItemPaymentModeAction(input: unknown): Promise<ActionResult> {
  const parsed = SetItemPaymentModeInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, itemIds, mode } = parsed.data
  try {
    const { organization, user, sessionId } = await requireTenant()
    if (await onSharedDevice({ tenantId: organization.id, sessionId })) {
      return { ok: false, error: 'not_allowed' }
    }
    const venue = await getVenue(organization.id, venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    // Where pay first can't take effect the row isn't on the screen: refuse a request that made it up.
    if ((await readItemPayFirstDefault(getPool(), organization.id, venue)) === null) {
      return { ok: false, error: 'invalid' }
    }
    try {
      await setItemPaymentMode(getPool(), organization.id, {
        venueId: venue.id,
        itemIds,
        mode,
        actor: `user:${user.id}`,
      })
    } catch (error) {
      if (error instanceof ApplyError && error.code === 'change_set_rejected') {
        const codes = error.rejected.map((rejection) => rejection.code).join(',')
        logError('composer_payment_mode_rejected', new Error(`rejected: ${codes}`))
        return { ok: false, error: 'rejected' }
      }
      if (error instanceof PaymentModeError) {
        return { ok: false, error: error.code === 'unknown_item' ? 'not_found' : 'invalid' }
      }
      if (error instanceof ApplyError) return { ok: false, error: 'invalid' }
      throw error
    }
    revalidatePath(`/venues/${venue.id}`)
    return { ok: true }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('composer_payment_mode_failed', error)
    return { ok: false, error: 'failed' }
  }
}
