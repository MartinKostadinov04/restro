'use server'

// "Done" on the page that stands in for the simulated provider's hosted form (#398). It does what
// the provider's own form does at its end, in the one place only the simulator has: the worker is
// told the owner finished (the worker holds the simulated account, so the web app cannot), and the
// owner's browser goes back to the Paying settings at `?connection=return`, where the account is
// read back the way it is after a real form.
//
// The guards, because a server action can be called without the page: the same environment check
// as the page (nothing in production), the signed-in person's own organisation and venue, and the
// two return addresses must be exactly what the settings would have sent for this venue, so a made-up
// link can send the owner nowhere else.
import { idSchema } from '@restro/core'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { askConnection } from '../../server/payments-connection'
import { revealConfig } from '../../server/reveal'
import { payingInstallation, payingReturnAddress } from '../../server/settings/paying-addresses'
import { inSettingsScope } from '../../server/settings/scope'
import { paymentsEnv } from '../notices'
import { SimAccountRefSchema, simPayOnboardingOffered } from './onboarding'

const Form = z.object({
  ref: SimAccountRefSchema,
  venue: idSchema('vn'),
  return: z.string(),
  refresh: z.string(),
})

/** What the page is told when it could not finish: a code the form words, never a throw. */
export type SimPayFormAnswer = { readonly ok: false; readonly error: string } | null

const INVALID = { ok: false, error: 'invalid' } as const

/**
 * Finishes the simulated form for the account and venue the page was opened for, then goes back to
 * the Paying settings. Every failure is an answer for the form to word, not a throw (the page
 * itself answers 404 to a link that is not this person's; a made-up call gets `invalid`).
 */
export async function finishSimPayFormAction(
  _previous: SimPayFormAnswer,
  formData: FormData,
): Promise<SimPayFormAnswer> {
  if (!simPayOnboardingOffered(paymentsEnv())) return INVALID
  const parsed = Form.safeParse(Object.fromEntries(formData))
  const where = payingInstallation()
  if (!parsed.success || where === null) return INVALID
  const { ref, venue } = parsed.data
  const back = payingReturnAddress(where.base, venue, 'return')
  if (
    parsed.data.return !== back ||
    parsed.data.refresh !== payingReturnAddress(where.base, venue, 'refresh')
  ) {
    return INVALID
  }

  const answer = await inSettingsScope(venue, async (scope) => {
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
      { action: 'finish_simulated', accountRef: ref, guestHost: where.guestHost },
    )
    return reply.ok
      ? ({ ok: true, details: {} } as const)
      : ({ ok: false, error: reply.error } as const)
  })
  // The owner is back at the Paying settings, which read the account back as after a real form.
  if (answer.ok) redirect(back)
  return { ok: false, error: answer.error }
}
