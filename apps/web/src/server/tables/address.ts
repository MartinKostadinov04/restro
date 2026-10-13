// Where a table's code leads (D94): `<this installation's address>/t/<token>`. The installation's
// address is developer configuration (`PUBLIC_BASE_URL`, else `BETTER_AUTH_URL`, see
// server/env.ts), not an owner setting: a venue no longer saves a base address or an own-link
// pattern of its own (`venues.settings.qr` stays in core but is not read here). Custom domains
// (DM1) come later and will be added here.
import { checkBaseUrl, ourAddress } from '@restro/core'

/** The installation's address as codes use it (checked, no trailing slash), or null when it has none. */
export function codeBaseUrl(configured: string | null): string | null {
  if (configured === null) return null
  const checked = checkBaseUrl(configured)
  return checked.ok ? checked.value : null
}

/** The address a code carries, or null when the installation has no usable address. */
export function codeAddress(baseUrl: string | null, token: string): string | null {
  return baseUrl === null ? null : ourAddress(baseUrl, token)
}
