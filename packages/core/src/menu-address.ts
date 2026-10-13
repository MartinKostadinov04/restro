// The public address of a venue's menu. Since D84 it is `/m/<organisation>/<venue>`: the
// organisation's slug (unique platform-wide) and the venue's address name (unique in its
// organisation), both readable, both renameable with the old names redirecting. The address of
// before, `/m/<slug>-<code>` (D68), keeps working: its code (`public-id.ts`) finds the venue and
// the page moves to the new address. `guestMenuPath` and `menuPath` are the only places that
// build the strings and `parseMenuParam` the only one that reads the old one, so no other code
// assembles or splits an address by hand. Pure: no I/O.

import { isOrganizationSlug, isVenueSlug } from './guest-files'
import { isPublicId, PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from './public-id'

/** The parts of a venue's address (D84): its organisation's slug and its own. */
export interface GuestAddressParts {
  readonly organization: string
  readonly venue: string
}

/**
 * The canonical path of a venue's menu: `/m/<organisation>/<venue>` (D84). The query string
 * (`?t=`, `?lang=`) is the caller's to add. Parts that are not slugs cannot come from our
 * writers and throw.
 */
export function guestMenuPath(address: GuestAddressParts): string {
  if (!isOrganizationSlug(address.organization) || !isVenueSlug(address.venue)) {
    throw new TypeError('a guest address is made of an organisation slug and a venue slug')
  }
  return `/m/${address.organization}/${address.venue}`
}

/** The parts of a venue its public address of before D84 is made of. */
export interface MenuAddressParts {
  readonly slug: string
  readonly publicId: string
}

/**
 * The path of a venue's menu as it was before D84: `/m/<slug>-<publicId>`. Still built for the
 * files and links of before (a printed code of 2026 leads here and the page moves on). The query
 * string (`?t=`, `?lang=`) is the caller's to add. A public code that is not one is a bug and
 * throws. A slug that is not a slug (it cannot happen through our writers) is left out, giving
 * `/m/<publicId>`, which still finds the menu: the slug is decoration.
 */
export function menuPath(venue: MenuAddressParts): string {
  if (!isPublicId(venue.publicId)) {
    throw new TypeError('a venue public code is 12 characters of a-z and 0-9')
  }
  return isVenueSlug(venue.slug) ? `/m/${venue.slug}-${venue.publicId}` : `/m/${venue.publicId}`
}

/**
 * The venue's public code in the route parameter of `/m/[venue]`, or null for an address that
 * names no venue. The code is the last 12 characters when they follow a `-`, or the whole
 * parameter when it is exactly 12 characters. The slug part is never read: a stale slug, a
 * mistyped one and none at all find the same venue. Upper-case letters are not part of a code.
 */
export function parseMenuParam(param: string): string | null {
  if (typeof param !== 'string') return null
  if (PUBLIC_ID_PATTERN.test(param)) return param
  const dash = param.length - PUBLIC_ID_LENGTH - 1
  if (dash < 0 || param[dash] !== '-') return null
  const code = param.slice(dash + 1)
  return PUBLIC_ID_PATTERN.test(code) ? code : null
}
