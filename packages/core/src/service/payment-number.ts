// The payment number a guest shows the waiter on the Paid screen (#114, D127): five letters from
// the sent orders' reference alphabet, made from the payment's id, so no column holds it and the
// same id always gives the same number. A waiter finds the payment by it (it is not a secret and
// not unique by itself: with 24^5 values a busy night's payments do not clash in practice).

import { createHash } from 'node:crypto'

import { REFERENCE_ALPHABET } from './send'

/** The number's length in characters. */
export const PAYMENT_NUMBER_LENGTH = 5

/** The number of a payment, from its id (`py_…`). */
export function paymentNumberOf(paymentId: string): string {
  const digest = createHash('sha256').update(paymentId).digest()
  let number = ''
  for (let i = 0; i < PAYMENT_NUMBER_LENGTH; i++) {
    number += REFERENCE_ALPHABET[(digest[i] ?? 0) % REFERENCE_ALPHABET.length]
  }
  return number
}
