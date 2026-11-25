// Quantities and amounts inside the engine (rule 8). A quantity is held in thousandths, from and
// to decimal text; an amount is integer minor units, and every split goes through the money
// module so nothing is lost or made up.

import { decimalToMinor, minorToDecimal, ratioOfMinor, subtractMinor } from '@restro/core'

import { PosRefusal } from './errors'

/** Thousandths per unit of quantity. */
export const QUANTITY_SCALE = 3
const PER_UNIT = 1000

/** Decimal text ("2", "0.5") to thousandths; refuses anything else as a bad request. */
export function parseQuantity(text: string): number {
  if (!/^(0|[1-9]\d{0,8})(\.\d{1,3})?$/.test(text)) {
    throw new PosRefusal('bad_request', `not a quantity of at most three decimals: ${text}`)
  }
  const thousandths = decimalToMinor(text, QUANTITY_SCALE)
  if (thousandths === 0) throw new PosRefusal('bad_request', 'a quantity is above zero')
  return thousandths
}

/** Thousandths to the shortest decimal text: 2000 → "2", 500 → "0.5". */
export function quantityText(thousandths: number): string {
  const text = minorToDecimal(thousandths, QUANTITY_SCALE)
  return text.replace(/\.?0+$/, '')
}

/** The amount of `thousandths` of a unit priced `unitPriceMinor`, rounded half-up. */
export function amountOf(unitPriceMinor: number, thousandths: number): number {
  return ratioOfMinor(unitPriceMinor, thousandths, PER_UNIT)
}

/**
 * Splits a row's amount when `taken` of its `quantity` thousandths leave it: the part taken is
 * the proportional share, rounded half-up, and the rest is what remains, so the two always add
 * up to the amount exactly.
 */
export function splitAmount(
  amountMinor: number,
  taken: number,
  quantity: number,
): { taken: number; rest: number } {
  const part = ratioOfMinor(amountMinor, taken, quantity)
  return { taken: part, rest: subtractMinor(amountMinor, part) }
}
