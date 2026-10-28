// The simulated provider's "card form" on the guest page (#114; #108): no card, no frame and no
// script, a single button that says the guest came back, for the end-to-end checks that play the
// guest at the form through the worker's harness. Never offered in production: the route and the
// worker refuse the simulator there, so no payment of this kind exists to ask for it.

import type { PayFormHandle, PayFormProps } from '@restro/shell'

import type { CardFormConnector, CardFormContext } from '../card-form-types'

/** Mounts the simulator's form into `target`. */
export function mountSimCardForm(
  target: HTMLElement,
  props: PayFormProps,
  context: Pick<CardFormContext, 'onReturned'>,
): PayFormHandle {
  const button = target.ownerDocument.createElement('button')
  button.type = 'button'
  button.className = props.buttonClass
  button.textContent = props.label
  button.dataset.slot = 'pay.form.submit'
  button.addEventListener('click', () => {
    button.disabled = true
    context.onReturned()
  })
  target.replaceChildren(button)
  return {
    update: (next) => {
      button.textContent = next.label
      button.className = next.buttonClass
    },
    unmount: () => target.replaceChildren(),
  }
}

/** The simulator's card form, as the page's registry finds it. */
export const cardForm: CardFormConnector = {
  kind: 'sim-pay',
  processor: 'Simulated payments',
  returnKeys: [],
  mount: mountSimCardForm,
}
