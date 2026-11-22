// What Tonight's read-only server actions share (night-actions.ts, payment-actions.ts): the scope
// of the signed-in account for one of its venues, and the try that turns a failed read into one
// answer. One copy, so a fix to who reads (the person a shared device remembers, the tenant) reaches
// every read (screen round 11-18, C6). Not a 'use server' file: nothing here is an action.
import { getTranslations } from 'next-intl/server'

import { logError } from '../log'
import { requireTenant } from '../session'
import { rememberedAtSharedDevice } from '../staff/service'
import { getVenue } from '../venues'
import type { NightScope } from './night-load'
import type { Frame } from './night-view'

/** What a read answers: the data and the frame, or that it could not be read. */
export type ReadAnswer<T> =
  | ({ readonly ok: true; readonly frame: Frame } & T)
  | { readonly ok: false }

export const FAILED = { ok: false } as const

/**
 * The scope of the signed-in account for one of its venues, or null. The tenant is the person's
 * organisation, never the request's; another tenant's venue comes back as null (row-level security).
 */
export async function scopeOf(id: string): Promise<NightScope | null> {
  const { organization, user, sessionId } = await requireTenant()
  const venue = await getVenue(organization.id, id)
  if (!venue) return null
  return {
    tenantId: organization.id,
    venue,
    actor: { kind: 'user', userId: user.id, sessionId },
    remembered: await rememberedAtSharedDevice({
      tenantId: organization.id,
      venueId: venue.id,
      sessionId,
    }),
    sourceNone: (await getTranslations('tonight'))('source_none'),
  }
}

/** Runs one read: a refusal or a throw is FAILED (logged as `event`); control flow is rethrown. */
export async function answer<T>(
  event: string,
  read: () => Promise<ReadAnswer<T> | { readonly ok: false; readonly code?: string }>,
): Promise<ReadAnswer<T>> {
  try {
    const result = await read()
    return result.ok ? result : FAILED
  } catch (error) {
    // redirect() and notFound() are control flow, not failures.
    if (error instanceof Error && 'digest' in error) throw error
    logError(event, error)
    return FAILED
  }
}
