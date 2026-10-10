'use server'

// The composer's sold-out writes (brief S3-08, D46). A thin server action over
// `server/sold-out/service.ts`, in the shape of ./tag-actions.ts: it checks who is asking
// (`requireTenant`: the tenant is the person's organisation, never the request's), that the venue
// is theirs and that their role may mark items sold out, parses its input with Zod and calls the
// service, which writes through apply() (rule 1) and queues the job that remakes `live.json`.
// Then it revalidates the venue page so the client gets the fresh view in the same round trip.
// There is no input that means "on sale": `soldOut: false` only removes OUR mark (rule 5).
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { getPool } from '@/server/db'
import { enqueueJob } from '@/server/jobs'
import { logError } from '@/server/log'
import { canMarkSoldOut } from '@/server/roles'
import { requireTenant } from '@/server/session'
import { setItemsSoldOut } from '@/server/sold-out/service'
import { getVenue } from '@/server/venues'

import type { ActionResult } from './action-result'

const SetSoldOutInput = z.strictObject({
  venueId: idSchema('vn'),
  itemIds: z.array(idSchema('nd')).min(1).max(200),
  soldOut: z.boolean(),
})

/** Marks items sold out tonight, or takes the mark off again (owner or admin). */
export async function setItemsSoldOutAction(input: unknown): Promise<ActionResult> {
  const parsed = SetSoldOutInput.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const { venueId, itemIds, soldOut } = parsed.data
  try {
    const { organization, user } = await requireTenant()
    const venue = await getVenue(organization.id, venueId)
    if (!venue) return { ok: false, error: 'not_found' }
    const result = await setItemsSoldOut(
      {
        pool: getPool(),
        tenantId: organization.id,
        venueId,
        actor: `user:${user.id}`,
        canMark: canMarkSoldOut(organization.role),
      },
      { enqueue: enqueueJob },
      { itemIds, soldOut },
    )
    if (!result.ok) return result
    revalidatePath(`/venues/${venue.id}`)
    return result.liveQueued ? { ok: true } : { ok: true, warning: 'live_not_queued' }
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError('composer_sold_out_failed', error)
    return { ok: false, error: 'failed' }
  }
}
