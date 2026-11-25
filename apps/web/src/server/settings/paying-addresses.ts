// Where the Paying section lives and where a provider's hosted form sends the owner back to it
// (#109, #398). Both the action that starts the connection and the page that stands in for the
// simulated provider's form need the very same addresses, so they come from here.
import { defaultQrBaseUrl } from '../env'
import { codeBaseUrl } from '../tables/address'

/** The Paying section of a venue, as the provider's form sends the owner back to it. */
const SECTION = 'tab=settings&section=paying'

/** What the provider's form is told: where to go back to, or where a timed-out link restarts. */
export type ReturnKind = 'return' | 'refresh'

/** Where this installation lives: the address the guest pages and the admin share, or null. */
export function payingInstallation(): {
  readonly base: string
  readonly guestHost: string
} | null {
  const base = codeBaseUrl(defaultQrBaseUrl())
  return base === null ? null : { base, guestHost: new URL(base).hostname }
}

/** The address the provider's form sends the owner to: back to the Paying section. */
export function payingReturnAddress(base: string, venueId: string, kind: ReturnKind): string {
  return `${base}/venues/${venueId}?${SECTION}&connection=${kind}`
}
