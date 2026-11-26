// The guest's own link to his booking (#579), as the guest emails carry it. Pure, and apart from the
// job so a dev script (the e2e fixture) can work out the same link without the worker's config.

import { guestBookingLinkPath } from '@restro/core'
import { guestLinkHashesEqual, guestLinkToken, guestLinkTokenHash } from '@restro/core/service'

/** How the worker writes a guest's own booking link (#579). */
export interface GuestLinkConfig {
  /** GUEST_LINK_KEY. A secret. */
  readonly key: string
  /** The address the guest pages are served from, without a trailing slash. */
  readonly baseUrl: string
}

/** What the link is made of: the stored hash of its token and the venue's address. */
export interface GuestLinkParts {
  readonly tokenHash: string | null
  readonly organization: string | null
  readonly venue: string
}

/**
 * The guest's own link to the booking (#579), or undefined: no key here, a booking with no link
 * (staff took it), or a stored hash the key does not give (the key was changed since), which would
 * be a link that opens nothing. The token is worked out again from the reservation's id; it is
 * never stored or logged.
 */
export function guestLinkOf(
  reservationId: string,
  news: { readonly linkParts?: GuestLinkParts },
  config: GuestLinkConfig | null,
): string | undefined {
  const parts = news.linkParts
  if (config === null || parts === undefined || parts.tokenHash === null) return undefined
  if (parts.organization === null) return undefined
  const token = guestLinkToken(config.key, reservationId)
  if (!guestLinkHashesEqual(parts.tokenHash, guestLinkTokenHash(token))) return undefined
  try {
    const path = guestBookingLinkPath(
      { organization: parts.organization, venue: parts.venue },
      token,
    )
    return `${config.baseUrl}${path}`
  } catch {
    // A slug that is not one cannot come from our writers; the email goes without the link.
    return undefined
  }
}
