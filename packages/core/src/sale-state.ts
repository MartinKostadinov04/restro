// Where an item stands on sale, as the admin shows it (brief S3-08, D46): the composer's rows and
// the item sheet read the resolved `for_sale` flag the same way, so they share this one function.
// Pure.

import type { ResolvedField } from './resolve/types'

/** The layer prefix of a service day's sold-out marks (`edition:service:<date>`). */
const SERVICE_EDITION_PREFIX = 'edition:service:'

/**
 * Why an item is off sale when something other than a manager's "sold out tonight" mark says so:
 * `till` (the till's own flag) or `other` (another layer or edition). Ours cannot undo either
 * (rule 5).
 */
export type OffSaleBy = 'till' | 'other'

/** An item's sale state for the admin. */
export interface SaleState {
  /**
   * A manager's mark (`for_sale = false` in the current service edition) is what takes it off
   * sale. It lapses by itself when the service day ends.
   */
  readonly soldOutTonight: boolean
  /** Off sale for another reason: no control may put it back on sale. */
  readonly offSale: OffSaleBy | null
}

/**
 * The sale state from the item's resolved `for_sale` field. The menu must have been resolved with
 * the live editions (`liveEditions`: the venue's and the current service day's), so a mark of an
 * earlier day is not in it. `all_true` names the first layer that says false and checks the till
 * first, so a mark that sits under the till's own flag reads as the till's: `soldOutTonight` is false
 * and the mark is not offered for removal (it would change nothing).
 */
export function saleStateOf(field: ResolvedField | undefined): SaleState {
  if (field?.value !== false) return { soldOutTonight: false, offSale: null }
  const layer = field.layer
  if (typeof layer === 'string' && layer.startsWith(SERVICE_EDITION_PREFIX)) {
    return { soldOutTonight: true, offSale: null }
  }
  return { soldOutTonight: false, offSale: layer === 'till' ? 'till' : 'other' }
}
