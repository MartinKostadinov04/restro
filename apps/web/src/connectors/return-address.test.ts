// The guest page's return address (#114; D127, design §11): the provider's values come out of the
// address before the page asks for anything, and the card form is given a return address with
// nothing of the guest in it.

import { describe, expect, it, vi } from 'vitest'

import { cardFormFor, cardFormsByKind, cleanAddressBar, processorName } from './card-forms'
import { cardReturnUrl, cleanReturnAddress } from './return-address'

const SECRET = 'secret-placeholder'

describe('cleanReturnAddress', () => {
  it('takes the named keys out of the query and keeps the rest of the address', () => {
    const cleaned = cleanReturnAddress(
      `https://menu.example/m/club/bar?lang=bg&payment_intent=pi_3Abc&payment_intent_client_secret=${SECRET}&redirect_status=succeeded#t=tablecode`,
      ['payment_intent', 'payment_intent_client_secret', 'redirect_status'],
    )
    expect(cleaned.returned).toBe(true)
    expect(cleaned.href).toBe('https://menu.example/m/club/bar?lang=bg#t=tablecode')
    expect(cleaned.href).not.toContain('pi_3Abc')
  })

  it('answers that nothing came back for an ordinary address', () => {
    expect(
      cleanReturnAddress('https://menu.example/m/club/bar?lang=bg', ['payment_intent']),
    ).toEqual({
      href: null,
      returned: false,
    })
  })
})

describe("the card form's return address", () => {
  it('is this page with no query and no fragment', () => {
    expect(cardReturnUrl('https://menu.example/m/club/bar?lang=bg#t=tablecode')).toBe(
      'https://menu.example/m/club/bar',
    )
  })
})

describe("the providers' card forms, found by their folders", () => {
  it('knows the card form of each provider kind, and who processes the payment', () => {
    expect(cardFormFor('stripe')?.kind).toBe('stripe')
    expect(cardFormFor('sim-pay')?.kind).toBe('sim-pay')
    expect(cardFormFor('nothing')).toBeNull()
    expect(processorName('stripe')).toBe('Stripe')
    expect(processorName(null)).toBeNull()
    expect(processorName('nothing')).toBeNull()
  })

  it("refuses a module with no card form, or one in another provider's folder", () => {
    expect(() => cardFormsByKind({ './x/card-form.ts': {} })).toThrow('./x/card-form.ts')
    const form = cardFormFor('stripe')
    expect(() => cardFormsByKind({ './other/card-form.ts': { cardForm: form } })).toThrow(
      'names another kind',
    )
  })

  it("cleans the address bar of every provider's values before anything else, with replaceState", () => {
    const replaceState = vi.fn()
    const came = cleanAddressBar(
      {
        href: `https://menu.example/m/club/bar?payment_intent=pi_3Abc&payment_intent_client_secret=${SECRET}&redirect_status=succeeded#t=tablecode`,
      },
      { replaceState },
    )
    expect(came).toBe(true)
    expect(replaceState).toHaveBeenCalledTimes(1)
    const cleaned = String(replaceState.mock.calls[0]?.[2])
    expect(cleaned).toBe('https://menu.example/m/club/bar#t=tablecode')
    expect(cleaned).not.toMatch(/pi_3Abc|secret|redirect_status/)

    const untouched = vi.fn()
    expect(
      cleanAddressBar({ href: 'https://menu.example/m/club/bar' }, { replaceState: untouched }),
    ).toBe(false)
    expect(untouched).not.toHaveBeenCalled()
  })
})
