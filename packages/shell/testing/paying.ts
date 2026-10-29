// Paying scenarios for the contract tests of every face (#114, D127): the host's state for a table
// bill and for each stage of this phone's payment, with what the face has to draw for it. A face's
// own test renders the face with each scenario and checks the same few things:
//
// - the card form slot is mounted (once) exactly while the card is awaited (`slot`);
// - "Paid" and the payment number show only for a captured payment (`paid`), never for any other;
// - the screen the shell chose (`screen`) is the one that shows, with the shell's words.
//
// Nothing here knows a provider: the form is the page's, and a face imports no provider library.

import type { PayScreen } from '../src/paying'
import type { PayingView, PaymentView, ServiceState, TableBillView } from '../src/services'
import { EMPTY_SERVICE_STATE, PAYMENT_STATES } from '../src/services'

const bn = (n: number) => `bn_${String(n).padStart(22, '0')}`

/** A table bill of two lines, €12.50 and €10.00, as the POS reads it. */
export function payingBill(changes: Partial<TableBillView> = {}): TableBillView {
  const lines = [
    {
      id: bn(1),
      name: { en_US: 'House wine', bg_BG: 'Домашно вино' },
      quantity: '1',
      amountMinor: 1250,
      beingPaid: false,
    },
    {
      id: bn(2),
      name: { en_US: 'Mojito', bg_BG: 'Мохито' },
      quantity: '1',
      amountMinor: 1000,
      beingPaid: false,
    },
  ]
  return {
    readAgoSeconds: 4,
    complete: true,
    currency: 'EUR',
    totalMinor: 2250,
    paidMinor: 0,
    owedMinor: 2250,
    parts: [{ id: 'bill-1', beingPaid: false, totalMinor: 2250, paidMinor: 0, lines }],
    ...changes,
  }
}

/** Paying on at the venue; the smallest card payment is €0.50; tips are offered. */
export function payingView(changes: Partial<PayingView> = {}): PayingView {
  return {
    state: 'on',
    minCardMinor: 50,
    processor: 'Stripe',
    venueName: 'Club X',
    electronicReceipt: false,
    recent: null,
    ...changes,
  }
}

/** A host state with the table's bill and paying on, and no payment of this phone's. */
export function payingState(changes: Partial<ServiceState> = {}): ServiceState {
  return {
    ...EMPTY_SERVICE_STATE,
    tableBill: payingBill(),
    paying: payingView(),
    ordering: { state: 'on', tips: true },
    ...changes,
  }
}

/** This phone's payment at a stage. */
export function payment(changes: Partial<PaymentView> = {}): PaymentView {
  return {
    id: 'py_0000000000000000000001',
    mode: 'bill',
    number: 'K7Q4M',
    state: 'awaiting_guest',
    reason: null,
    currency: 'EUR',
    amountMinor: 2250,
    tipMinor: 0,
    lines: [
      { name: 'House wine', quantity: '1', amountMinor: 1250 },
      { name: 'Mojito', quantity: '1', amountMinor: 1000 },
    ],
    form: { confirmSeconds: 120 },
    ...changes,
  }
}

/** One stage of a payment and what a face has to draw for it. */
export interface PayScenario {
  readonly name: string
  readonly payment: PaymentView
  /** The shell's screen for it (`payScreen`). */
  readonly screen: PayScreen['kind']
  /** The card form slot is mounted. */
  readonly slot: boolean
  /** "Paid" and the payment number show. */
  readonly paid: boolean
}

/** Every state of a payment, and the releases the guide words. */
export function payScenarios(): readonly PayScenario[] {
  const of = (
    state: PaymentView['state'],
    screen: PayScreen['kind'],
    changes: Partial<PaymentView> = {},
  ): PayScenario => ({
    name:
      changes.reason === undefined || changes.reason === null
        ? state
        : `${state}:${changes.reason}`,
    payment: payment({
      state,
      form: state === 'awaiting_guest' ? { confirmSeconds: 120 } : null,
      ...changes,
    }),
    screen,
    slot: state === 'awaiting_guest' && screen === 'card',
    paid: screen === 'paid',
  })
  const byState: Record<PaymentView['state'], PayScenario[]> = {
    requested: [of('requested', 'preparing', { amountMinor: null })],
    priced: [of('priced', 'preparing')],
    awaiting_guest: [of('awaiting_guest', 'card')],
    held: [of('held', 'waiting')],
    queued: [of('queued', 'waiting')],
    isolated: [of('isolated', 'waiting')],
    entered: [of('entered', 'waiting')],
    checked: [of('checked', 'waiting')],
    closed: [of('closed', 'waiting')],
    cancelling: [of('cancelling', 'waiting')],
    captured: [of('captured', 'paid', { tipMinor: 250, amountMinor: 2500 })],
    released: [
      of('released', 'ended', { reason: 'busy' }),
      of('released', 'ended', { reason: 'check_failed' }),
      of('released', 'ended', { reason: 'expired' }),
      of('released', 'ended', { reason: 'paying_paused' }),
      of('released', 'ended', { reason: 'item_unavailable' }),
    ],
    unconfirmed: [of('unconfirmed', 'checking')],
    stranded: [of('stranded', 'checking')],
    capture_failed: [of('capture_failed', 'checking')],
  }
  return PAYMENT_STATES.flatMap((state) => byState[state])
}
