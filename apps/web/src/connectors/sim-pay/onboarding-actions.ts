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
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'

import { askConnection } from '../../server/payments-connection'
import { revealConfig } from '../../server/reveal'
import { payingInstallation, payingReturnAddress } from '../../server/settings/paying-addresses'
import { inSettingsScope } from '../../server/settings/scope'
import { paymentsEnv } from '../notices'
import { SIM_PAY_ONBOARDING_PATH, SimAccountRefSchema, simPayOnboardingOffered } from './onboarding'

const Form = z.object({
  ref: SimAccountRefSchema,
  venue: idSchema('vn'),
  return: z.string(),
  refresh: z.string(),
})

/** What the page says went wrong, by the worker's code; anything else is `failed`. */
export type SimPayFormProblem =
  | 'not_connecting'
  | 'not_simulated'
  | 'account_mismatch'
  | 'payments_off'
  | 'failed'

const KNOWN: readonly string[] = [
  'not_connecting',
  'not_simulated',
  'account_mismatch',
  'payments_off',
]

/** The problem to show for a worker's code. */
export function problemOf(code: string): SimPayFormProblem {
  return KNOWN.includes(code) ? (code as SimPayFormProblem) : 'failed'
}

/** Finishes the simulated form for the account and venue the page was opened for, then goes back. */
export async function finishSimPayFormAction(formData: FormData): Promise<void> {
  if (!simPayOnboardingOffered(paymentsEnv())) notFound()
  const parsed = Form.safeParse(Object.fromEntries(formData))
  const where = payingInstallation()
  if (!parsed.success || where === null) notFound()
  const { ref, venue } = parsed.data
  const back = payingReturnAddress(where.base, venue, 'return')
  if (
    parsed.data.return !== back ||
    parsed.data.refresh !== payingReturnAddress(where.base, venue, 'refresh')
  ) {
    notFound()
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
  if (answer.ok) redirect(back)
  const retry = new URLSearchParams({
    venue,
    return: back,
    refresh: parsed.data.refresh,
    problem: problemOf(answer.error),
  })
  redirect(`${SIM_PAY_ONBOARDING_PATH}/${ref}?${retry.toString()}`)
}
