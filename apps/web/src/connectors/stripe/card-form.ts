// Stripe's card form on the guest page (#114; D127 "The card form is loaded by the page into a slot
// the template places"; design §11). The only code that imports `@stripe/stripe-js`.
//
// - It loads Stripe's library only when a payment awaits the card (`@stripe/stripe-js/pure` does not
//   inject the script on import), initialised with the venue's account (`stripeAccount`): the
//   payment is a direct charge on the venue's own Stripe account.
//   https://docs.stripe.com/connect/direct-charges.md?platform=web&ui=elements
// - It mounts the Payment Element from the form values the server gave (the intent's client secret
//   and the account id) and confirms with `confirmPayment({ redirect: 'if_required' })`. With cards
//   only, the bank's check opens inside the page and nothing redirects; the `return_url` covers a
//   redirect if one ever happens (return-address.ts).
//   https://docs.stripe.com/payments/payment-element.md
// - It never decides an outcome. Stripe's own text shows a card error; when confirmation finishes
//   without an error it only reports `returned`, and Restro reads the hold from Stripe (D127 2.3).
//   The face's screen follows the payment's state, not this form.

import type { PayFormHandle, PayFormProps } from '@restro/shell'
import { loadStripe } from '@stripe/stripe-js/pure'
import { z } from 'zod'

import type { CardFormConnector, CardFormContext } from '../card-form-types'

/** The values the server gives for this provider's form: the client secret and the account. */
const FormValuesSchema = z.object({
  clientSecret: z.string().min(1).max(2_000),
  account: z.string().regex(/^acct_[A-Za-z0-9]+$/),
})

/** What Stripe's form needs: the page's context and the platform's publishable key. */
export interface StripeFormContext extends CardFormContext {
  /** The platform's publishable key (a public value, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`). */
  readonly publishableKey: string | undefined
}

/** Stripe's library, replaceable in a test. */
export type StripeLoader = (
  publishableKey: string,
  options: { stripeAccount: string },
) => Promise<{
  elements: (options: { clientSecret: string; locale: string }) => ElementsLike
  confirmPayment: (options: {
    elements: ElementsLike
    confirmParams: { return_url: string }
    redirect: 'if_required'
  }) => Promise<{ error?: { message?: string } }>
} | null>

/** The part of Stripe's Elements the form uses. */
export interface ElementsLike {
  create: (type: 'payment', options?: Record<string, unknown>) => PaymentElementLike
}

/** The part of the Payment Element the form uses. */
export interface PaymentElementLike {
  mount: (target: HTMLElement) => void
  destroy: () => void
  /** Stripe's `ready` (the form is drawn and can take a card) and `loaderror` events. */
  on: (event: 'ready' | 'loaderror', handler: () => void) => void
}

const defaultLoader = loadStripe as unknown as StripeLoader

/** Mounts Stripe's card form into `target`. A value Stripe's library refuses shows nothing. */
export function mountStripeCardForm(
  target: HTMLElement,
  props: PayFormProps,
  context: StripeFormContext,
  load: StripeLoader = defaultLoader,
): PayFormHandle {
  const values = FormValuesSchema.safeParse(context.values)
  const document = target.ownerDocument
  const holder = document.createElement('div')
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.disabled = true
  button.className = props.buttonClass
  button.textContent = props.label
  button.dataset.slot = 'pay.form.submit'
  holder.dataset.slot = 'pay.form.element'
  target.replaceChildren(holder, message, button)

  let alive = true
  let failedText = props.failedText
  let element: PaymentElementLike | null = null
  /**
   * The form could not be drawn: the guest is told so in the page's words (a placeholder until
   * Martin's are in) and the reason goes to the console, which holds no personal data and no key.
   */
  const fail = (reason: string) => {
    console.error(`card form: ${reason}`)
    message.textContent = failedText
    message.hidden = failedText === ''
    button.disabled = true
  }
  if (!values.success) {
    fail('the form values were not what the provider gives')
    return { update: () => {}, unmount: () => target.replaceChildren() }
  }
  if (context.publishableKey === undefined || context.publishableKey === '') {
    fail('no publishable key is set')
    return { update: () => {}, unmount: () => target.replaceChildren() }
  }
  const { clientSecret, account } = values.data

  let stripe: Awaited<ReturnType<StripeLoader>> = null
  let elements: ElementsLike | null = null
  void (async () => {
    stripe = await load(context.publishableKey ?? '', { stripeAccount: account }).catch(() => null)
    if (!alive) return
    if (stripe === null) {
      fail('the provider’s library did not load')
      return
    }
    // The guest's language for the form's own text; a card error stays in the provider's text.
    elements = stripe.elements({ clientSecret, locale: props.locale })
    element = elements.create('payment', { layout: 'tabs' })
    // The button works once the form is drawn (`ready`), not once it is mounted.
    element.on('ready', () => {
      if (alive) button.disabled = false
    })
    element.on('loaderror', () => {
      if (alive) fail('the card form did not load')
    })
    element.mount(holder)
  })()

  button.addEventListener('click', () => {
    if (stripe === null || elements === null || button.disabled) return
    const current = stripe
    const group = elements
    button.disabled = true
    message.hidden = true
    context.markRedirect(true)
    void current
      .confirmPayment({
        elements: group,
        confirmParams: { return_url: context.returnUrl },
        redirect: 'if_required',
      })
      .then(
        (result) => {
          context.markRedirect(false)
          if (!alive) return
          if (result.error !== undefined) {
            // Stripe's own text for a card error (D127): Restro adds nothing.
            message.textContent = result.error.message ?? ''
            message.hidden = message.textContent === ''
            button.disabled = false
            return
          }
          context.onReturned()
        },
        () => {
          context.markRedirect(false)
          if (alive) button.disabled = false
        },
      )
  })

  return {
    update: (next) => {
      button.textContent = next.label
      button.className = next.buttonClass
      failedText = next.failedText
    },
    unmount: () => {
      alive = false
      element?.destroy()
      target.replaceChildren()
    },
  }
}

/** What Stripe adds to the return address after a redirect (https://docs.stripe.com/payments/payment-element/migration.md). */
const RETURN_KEYS = [
  'payment_intent',
  'payment_intent_client_secret',
  'setup_intent',
  'setup_intent_client_secret',
  'redirect_status',
] as const

/** Stripe's card form, as the page's registry finds it (`connectors/card-forms.ts`). */
export const cardForm: CardFormConnector = {
  kind: 'stripe',
  processor: 'Stripe',
  returnKeys: RETURN_KEYS,
  mount: (target, props, context) =>
    mountStripeCardForm(target, props, {
      ...context,
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    }),
}
