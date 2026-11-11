// The simulated provider's hosted onboarding form, as a page of this app (#398). A real provider
// sends the owner to its own site to give the business, bank and ID details, and the site sends
// the owner back. The simulator has no site: it answers with an address on a host that does not
// exist (`https://connect.sim-pay.test/onboard/<account>`, packages/payments/sim-pay), so without a
// stand-in the owner lands on the browser's error page with no way out. This file turns that
// address into the page `app/sim-pay/onboard/[ref]`, which says in so many words that it stands in
// for the form and has a "Done" that goes back to the Paying settings the way a real form does.
//
// Why two guards. The worker will not build the simulated provider in production
// (`createSimPayProvider` throws), so in production no address like this is ever made. This file
// and the page refuse production too, because a page that finishes a payment account at one press
// would be a hole in the owner's settings if the worker's guard were ever misconfigured: each
// guard has to hold alone. An unknown or unset `PAYMENTS_ENV` offers nothing either.
import { z } from 'zod'

import type { PaymentsEnv } from '../notice-types'
import type { OnboardingConnector } from '../onboarding-types'

/** The host the simulator names in its hosted address; the page stands in for it. */
export const SIM_PAY_FORM_HOST = 'connect.sim-pay.test'

/** Where the stand-in page lives in the app. */
export const SIM_PAY_ONBOARDING_PATH = '/sim-pay/onboard'

/** The simulator's account reference, as the simulator makes it (`simacct_<run>_<n>`). */
export const SimAccountRefSchema = z.string().regex(/^simacct_[A-Za-z0-9_]{1,100}$/)

/** Whether the stand-in page exists here: everywhere but production, and only for a known environment. */
export function simPayOnboardingOffered(env: PaymentsEnv | null): boolean {
  return env !== null && env !== 'production'
}

/** The page's own address for an account and the venue connecting it. */
export function simPayOnboardingPage(
  accountRef: string,
  context: { venueId: string; returnUrl: string; refreshUrl: string },
): string {
  const query = new URLSearchParams({
    venue: context.venueId,
    return: context.returnUrl,
    refresh: context.refreshUrl,
  })
  return `${SIM_PAY_ONBOARDING_PATH}/${accountRef}?${query.toString()}`
}

export const onboarding: OnboardingConnector = {
  kind: 'sim-pay',
  offered: simPayOnboardingOffered,
  address(url, context) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return null
    }
    if (parsed.protocol !== 'https:' || parsed.host !== SIM_PAY_FORM_HOST) return null
    const match = /^\/onboard\/([^/]+)$/.exec(parsed.pathname)
    const account = SimAccountRefSchema.safeParse(match?.[1])
    return account.success ? simPayOnboardingPage(account.data, context) : null
  },
}
