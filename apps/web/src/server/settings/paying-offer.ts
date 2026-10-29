// Whether the Paying section is listed at a venue (#116, D122 §3): only where a POS serving the
// venue declares that it closes a bill with a payment type and moves lines to a payment table.
// Never at a hand-made venue. Reads only.
import { readPayingOffer } from '@restro/core/service'

import { getPool } from '../db'

/** True when paying can be offered at the venue. */
export async function payingOffered(tenantId: string, venueId: string): Promise<boolean> {
  return (await readPayingOffer(getPool(), tenantId, venueId)).offered
}
