import { describe, expect, it } from 'vitest'

import { newId } from '../ids'
import { PAYMENT_NUMBER_LENGTH, paymentNumberOf } from './payment-number'
import { REFERENCE_ALPHABET } from './send'

describe('the payment number (#114)', () => {
  it("is five letters of the references' alphabet, the same for the same payment", () => {
    const id = newId('py')
    const number = paymentNumberOf(id)
    expect(number).toHaveLength(PAYMENT_NUMBER_LENGTH)
    expect([...number].every((letter) => REFERENCE_ALPHABET.includes(letter))).toBe(true)
    expect(paymentNumberOf(id)).toBe(number)
  })

  it('tells payments apart, and holds no part of the id a guest could not know', () => {
    const numbers = new Set(Array.from({ length: 200 }, () => paymentNumberOf(newId('py'))))
    expect(numbers.size).toBeGreaterThan(190)
    expect(paymentNumberOf('py_fixed')).not.toContain('_')
  })
})
