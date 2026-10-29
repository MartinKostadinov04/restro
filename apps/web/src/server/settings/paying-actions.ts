'use server'

// The Paying section's account actions (#109; the screens are #116, at `?tab=settings&section=paying`).
// Each is a person's settings change: `settings.connect_payments` and a sign-in of the last 15 minutes
// (D125 2.2), refused `sign_in_again` otherwise and worded by the screen. The provider is the
// worker's alone: connecting, refreshing the link and reading the account back on return ask it over
// the private network, and only the provider's hosted onboarding address comes back to the browser
// (no key, no account id). Disconnecting and the owner's ticks of the checks Restro cannot read
// (D125 2.3) are service commands, run here as the signed-in person.
import { CURRENCIES, type Currency, idSchema, OWNER_TICKS } from '@restro/core'
import { readPayingConnection } from '@restro/core/service'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { providerOf } from '../../connectors/providers'
import { defaultQrBaseUrl } from '../env'
import { askConnection, type ConnectionAsk } from '../payments-connection'
import { revealConfig } from '../reveal'
import { codeBaseUrl } from '../tables/address'
import { getVenue } from '../venues'
import { INVALID, inSettingsScope, runSettingsCommand, type SettingsResult } from './scope'

const venueId = idSchema('vn')
const OnVenue = z.strictObject({ venueId })
const Tick = z.strictObject({ venueId, check: z.enum(OWNER_TICKS), done: z.boolean() })

/** The Paying section of a venue, as the provider's form sends the owner back to it. */
const SECTION = 'tab=settings&section=paying'

/** The onboarding address to open, or a refusal. */
export type ConnectLinkResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: string }

/** Where this installation lives: the address the guest pages and the admin share, or null. */
function installation(): { readonly base: string; readonly guestHost: string } | null {
  const base = codeBaseUrl(defaultQrBaseUrl())
  return base === null ? null : { base, guestHost: new URL(base).hostname }
}

/** Asks the worker something about the venue's account, as the signed-in person. */
async function ask(
  venue: string,
  build: (where: { base: string; guestHost: string }, venueId: string) => ConnectionAsk,
): Promise<SettingsResult<{ url?: string; state?: string }>> {
  return inSettingsScope(venue, async (scope) => {
    const where = installation()
    if (where === null) return { ok: false, error: 'no_address' } as const
    const reply = await askConnection(
      revealConfig(),
      {
        tenantId: scope.tenantId,
        venueId: scope.venueId,
        actor: {
          userId: scope.userId,
          sessionId: scope.sessionId,
          signedInAt: scope.signedInAt,
          operator: scope.operator,
        },
      },
      build(where, scope.venueId),
    )
    if (!reply.ok) return { ok: false, error: reply.error } as const
    revalidatePath(`/venues/${scope.venueId}`)
    return {
      ok: true,
      details: {},
      ...(reply.url === undefined ? {} : { url: reply.url }),
      ...(reply.state === undefined ? {} : { state: reply.state }),
    } as const
  }) as Promise<SettingsResult<{ url?: string; state?: string }>>
}

/**
 * Connect, refresh the link, or "Reconnect": the provider's hosted onboarding address to send the
 * owner to. The same action serves all three; the account's state decides what the worker does.
 */
export async function startConnectionAction(input: unknown): Promise<ConnectLinkResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await ask(parsed.data.venueId, (where, id) => ({
    action: 'start',
    returnUrl: `${where.base}/venues/${id}?${SECTION}&connection=return`,
    refreshUrl: `${where.base}/venues/${id}?${SECTION}&connection=refresh`,
    guestHost: where.guestHost,
  }))
  if (!result.ok) return { ok: false, error: result.error }
  return result.url === undefined
    ? { ok: false, error: 'connection_failed' }
    : { ok: true, url: result.url }
}

/**
 * The owner came back from the provider's form: the account is read back and recorded. `ready`
 * says whether the provider now allows card payments on it (the screen's "connected" or "needs a
 * few more details" toast).
 */
export async function finishConnectionAction(
  input: unknown,
): Promise<SettingsResult<{ ready: boolean }>> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const read = await ask(parsed.data.venueId, (where) => ({
    action: 'return',
    guestHost: where.guestHost,
  }))
  if (!read.ok) return { ok: false, error: read.error }
  const ready = await inSettingsScope(parsed.data.venueId, async (scope) => {
    const connection = await readPayingConnection(scope.pool, scope.tenantId, scope.venueId)
    return { ok: true, details: {}, ready: connection.checks.cardPayments } as const
  })
  return { ok: true, details: read.details, ready: ready.ok && 'ready' in ready && ready.ready }
}

/** Stops Restro using the account; refused while any payment of the venue is not final. */
export async function disconnectPayingAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, { type: 'payment_account.disconnect' })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** The owner says a check Restro cannot read is done (or takes it back). */
export async function tickPayingCheckAction(input: unknown): Promise<SettingsResult> {
  const parsed = Tick.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, {
      type: 'payment_account.tick',
      check: parsed.data.check,
      done: parsed.data.done,
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

const Save = z.strictObject({
  venueId,
  /** The keys to change: the smallest card payment (minor units, null for the provider's) and the legal details. */
  changes: z.strictObject({
    minCardMinor: z.number().int().nullable().optional(),
    legalDetails: z.unknown().optional(),
  }),
})

/**
 * Saves the smallest card payment and/or the venue's legal details (#104, #198). The provider's
 * smallest charge is the server's to name, from the venue's own account (or this deployment's
 * provider before it connects), never the browser's. The service path refuses a value below it
 * or above €1,000, and one that is not a full set of details.
 */
export async function savePayingAction(input: unknown): Promise<SettingsResult> {
  const parsed = Save.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const venue = await getVenue(scope.tenantId, scope.venueId)
    if (venue === null) return { ok: false, error: 'venue_missing' } as const
    const connection = await readPayingConnection(scope.pool, scope.tenantId, scope.venueId)
    const currency = CURRENCIES.find((c): c is Currency => c === venue.currency) ?? 'EUR'
    const provider = providerOf(connection.providerKind)
    // Without a known provider there is no minimum to hold the amount to: nothing is saved.
    if (provider === null) return { ok: false, error: 'no_provider' } as const
    const providerMinMinor = provider.minimumMinor(currency)
    const result = await runSettingsCommand(scope, {
      type: 'settings.paying_set',
      changes: parsed.data.changes,
      providerMinMinor,
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}
