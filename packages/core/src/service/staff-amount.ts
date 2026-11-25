// A payment's amount as a reader without `night.view_full` may see it: the bill without the tip.
// Staff never see tips (decision log 3.4), and a total next to its lines gives the tip away, so
// the tip is taken off here, in core, before anything leaves it (#220).

import { subtractMinor } from '../money'

/**
 * `amountMinor` less `tipMinor`, in minor units (rule 8). Null stays null. A tip larger than the
 * amount is data that should not exist; a read must not throw, so it reads as no amount left.
 */
export function withoutTipMinor(amountMinor: number | null, tipMinor: number): number | null {
  if (amountMinor === null) return null
  return tipMinor > amountMinor ? 0 : subtractMinor(amountMinor, tipMinor)
}
