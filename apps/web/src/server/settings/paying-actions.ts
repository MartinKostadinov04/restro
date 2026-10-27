'use server'

// The Paying section's account actions (#109; the screens are #116, at `?tab=settings&section=paying`).
// Each is a person's settings change: `settings.connect_payments` and a sign-in of the last 15 minutes
// (D125 2.2), refused `sign_in_again` otherwise and worded by the screen. The provider is the
// worker's alone: connecting, refreshing the link and reading the account back on return ask it over
// the private network, and only the provider's hosted onboarding address comes back to the browser
// (no key, no account id). Disconnecting and the owner's ticks of the checks Restro cannot read
// (D125 2.3) are service commands, run here as the signed-in person.
import { idSchema, OWNER_TICKS } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { defaultQrBaseUrl } from '../env'
import { askConnection, type ConnectionAsk } from '../payments-connection'
import { revealConfig } from '../reveal'
import { codeBaseUrl } from '../tables/address'
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

/** The owner came back from the provider's form: the account is read back and recorded. */
export async function finishConnectionAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return ask(parsed.data.venueId, (where) => ({ action: 'return', guestHost: where.guestHost }))
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
