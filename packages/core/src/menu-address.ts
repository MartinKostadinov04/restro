// The public address of a venue's menu (D68, brief CF-14): `/m/<slug>-<code>`, the pattern Claude's
// artifacts and Notion use. The code (`public-id.ts`) finds the venue; the slug in front of it is
// readable decoration that may change or be missing. `menuPath` is the only place that builds the
// string and `parseMenuParam` the only one that reads it, so no other code assembles or splits an
// address by hand. Pure: no I/O.

import { isVenueSlug } from './guest-files'
import { isPublicId, PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from './public-id'

/** The parts of a venue its public address is made of. */
export interface MenuAddressParts {
  readonly slug: string
  readonly publicId: string
}

/**
 * The canonical path of a venue's menu: `/m/<slug>-<publicId>`. The query string (`?t=`, `?lang=`)
 * is the caller's to add. A public code that is not one is a bug and throws. A slug that is not a
 * slug (it cannot happen through our writers) is left out, giving `/m/<publicId>`, which still
 * finds the menu: the slug is decoration.
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
