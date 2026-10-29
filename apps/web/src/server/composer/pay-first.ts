// What the composer needs of pay first (#218; D113, D122 §5, §8): the venue's item default, where pay
// first can take effect, or null where it can't (card payments off, or no POS of the venue that can
// open a bill for the first items). The selection bar's "Payment mode…" shows only when this is set.
import { type PaymentMode, readPayFirstSettings } from '@restro/core'
import { payFirstPossibleAt } from '@restro/core/service'
import { type DbPool, type Venue, withTenant } from '@restro/db'

export async function readItemPayFirstDefault(
  pool: DbPool,
  tenantId: string,
  venue: Pick<Venue, 'id' | 'settings'>,
): Promise<PaymentMode | null> {
  const possible = await withTenant(pool, tenantId, (tx) => payFirstPossibleAt(tx, venue.id))
  return possible ? readPayFirstSettings(venue.settings).itemMode : null
}
