// @vitest-environment jsdom

// Stripe's card form on the guest page (#114, D127): it loads Stripe's library with the venue's
// account, mounts the Payment Element from the form values, confirms with no redirect unless Stripe
// needs one, shows Stripe's own text for a card error, reports `returned` and decides no outcome.

import { describe, expect, it, vi } from 'vitest'

import { type ElementsLike, mountStripeCardForm, type StripeLoader } from './card-form'

const VALUES = { clientSecret: 'secret-placeholder', account: 'acct_1A2b3C' }
const PROPS = { label: 'Pay €22.50', buttonClass: 'rq-pay' }

/** A Stripe whose Elements and confirmation the test controls. */
function fakeStripe(confirm: () => Promise<{ error?: { message?: string } }>) {
  const created: { mounted: HTMLElement | null; destroyed: boolean }[] = []
  const confirmations: Parameters<
    NonNullable<Awaited<ReturnType<StripeLoader>>>['confirmPayment']
  >[0][] = []
  const options: { clientSecret: string }[] = []
  const elements: ElementsLike = {
    create: () => {
      const element = { mounted: null as HTMLElement | null, destroyed: false }
      created.push(element)
      return {
        mount: (target) => {
          element.mounted = target
        },
        destroy: () => {
          element.destroyed = true
        },
      }
    },
  }
  const load = vi.fn<StripeLoader>(async () => ({
    elements: (given) => {
      options.push(given)
      return elements
    },
    confirmPayment: async (given) => {
      confirmations.push(given)
      return confirm()
    },
  }))
  return { load, created, confirmations, options }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function context(
  over: { values?: Record<string, string>; publishableKey?: string | undefined } = {},
) {
  return {
    values: VALUES,
    publishableKey: 'pk_test_123',
    returnUrl: 'https://menu.example/m/club/bar',
    onReturned: vi.fn(),
    markRedirect: vi.fn<(on: boolean) => void>(),
    ...over,
  }
}

describe('mounting', () => {
  it("loads Stripe with the venue's account, mounts the Payment Element from the client secret and enables the button", async () => {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, context(), stripe.load)
    const button = target.querySelector('button') as HTMLButtonElement
    expect(button.textContent).toBe('Pay €22.50')
    expect(button.className).toBe('rq-pay')
    expect(button.disabled).toBe(true)
    await flush()
    expect(stripe.load).toHaveBeenCalledWith('pk_test_123', { stripeAccount: 'acct_1A2b3C' })
    expect(stripe.options).toEqual([{ clientSecret: 'secret-placeholder' }])
    expect(stripe.created[0]?.mounted).toBe(target.querySelector('[data-slot="pay.form.element"]'))
    expect(button.disabled).toBe(false)
  })

  it("loads nothing for values it does not know, or without the platform's publishable key", async () => {
    for (const bad of [
      context({ values: { clientSecret: 'x' } }),
      context({ values: { ...VALUES, account: 'not-an-account' } }),
      context({ publishableKey: undefined }),
      context({ publishableKey: '' }),
    ]) {
      const stripe = fakeStripe(async () => ({}))
      const target = document.createElement('div')
      mountStripeCardForm(target, PROPS, bad, stripe.load)
      await flush()
      expect(stripe.load).not.toHaveBeenCalled()
      expect((target.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it("follows the face's label and takes the form away", async () => {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    const handle = mountStripeCardForm(target, PROPS, context(), stripe.load)
    await flush()
    handle.update({ label: 'Pay €25.00', buttonClass: 'other' })
    const button = target.querySelector('button') as HTMLButtonElement
    expect(button.textContent).toBe('Pay €25.00')
    expect(button.className).toBe('other')
    handle.unmount()
    expect(stripe.created[0]?.destroyed).toBe(true)
    expect(target.childElementCount).toBe(0)
  })
})

describe('confirming', () => {
  it('confirms with no redirect unless Stripe needs one, then only reports that the guest returned', async () => {
    const stripe = fakeStripe(async () => ({}))
    const ctx = context()
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, ctx, stripe.load)
    await flush()
    ;(target.querySelector('button') as HTMLButtonElement).click()
    await flush()
    expect(stripe.confirmations).toHaveLength(1)
    expect(stripe.confirmations[0]).toMatchObject({
      redirect: 'if_required',
      confirmParams: { return_url: 'https://menu.example/m/club/bar' },
    })
    // The marker of a redirect is set while Stripe may leave the page and cleared when it did not.
    expect(ctx.markRedirect.mock.calls.map((call) => call[0])).toEqual([true, false])
    expect(ctx.onReturned).toHaveBeenCalledTimes(1)
    // No second payment from a second tap while the host reads the hold.
    expect((target.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows Stripe's own text for a card error and reports nothing", async () => {
    const stripe = fakeStripe(async () => ({ error: { message: 'Your card was declined.' } }))
    const ctx = context()
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, ctx, stripe.load)
    await flush()
    ;(target.querySelector('button') as HTMLButtonElement).click()
    await flush()
    const message = target.querySelector('[role="alert"]') as HTMLElement
    expect(message.textContent).toBe('Your card was declined.')
    expect(message.hidden).toBe(false)
    expect(ctx.onReturned).not.toHaveBeenCalled()
    // The guest may try another card.
    expect((target.querySelector('button') as HTMLButtonElement).disabled).toBe(false)
  })

  it('lets the guest try again when the confirmation itself fails', async () => {
    const stripe = fakeStripe(async () => {
      throw new Error('network')
    })
    const ctx = context()
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, ctx, stripe.load)
    await flush()
    ;(target.querySelector('button') as HTMLButtonElement).click()
    await flush()
    expect(ctx.onReturned).not.toHaveBeenCalled()
    expect((target.querySelector('button') as HTMLButtonElement).disabled).toBe(false)
    expect(ctx.markRedirect).toHaveBeenLastCalledWith(false)
  })
})
