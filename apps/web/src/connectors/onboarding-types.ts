// What the web app asks of a payment provider's hosted onboarding form (#398). A real provider's
// form lives on its own site and needs nothing here. The simulated provider has no site, so its
// folder stands one in inside the app (`./sim-pay/onboarding.ts`); `./onboarding.ts` finds those.
import type { PaymentsEnv } from './notice-types'

/** What the owner's Connect press told the provider, and for which venue. */
export interface OnboardingContext {
  readonly venueId: string
  /** Where the form sends the owner back to when done. */
  readonly returnUrl: string
  /** Where a timed-out link restarts. */
  readonly refreshUrl: string
}

/** A provider whose hosted form is a page of this app. */
export interface OnboardingConnector {
  readonly kind: string
  /** In which deployments the stand-in page exists. */
  offered(env: PaymentsEnv): boolean
  /**
   * The app address (path and query) standing for the provider's hosted address `url`, or null
   * when `url` is not this provider's.
   */
  address(url: string, context: OnboardingContext): string | null
}
