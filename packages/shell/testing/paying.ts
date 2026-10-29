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
import type {
  PaidLineView,
  PayingView,
  PaymentView,
  ServiceState,
  TableBillView,
} from '../src/services'
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
    paidLines: [],
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
    paidAt: null,
    timeZone: 'Europe/Sofia',
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
    captured: [
      of('captured', 'paid', {
        tipMinor: 250,
        amountMinor: 2500,
        paidAt: '2026-10-29T19:42:00.000Z',
      }),
    ],
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

/* ---------------------------------------------------------------------------------------------
 * Paid in the app, and the Payment confirmation (#197, D127 1.2 and 1.4)
 * ------------------------------------------------------------------------------------------- */

/** Two lines paid in the app in this sitting: a name, a quantity and an amount, never a payer. */
export const PAID_LINES: readonly PaidLineView[] = [
  { name: 'Gin & tonic', quantity: '2', amountMinor: 1800 },
  { name: 'Nachos', quantity: '1', amountMinor: 900 },
]

/**
 * What the Payment confirmation must never say or show (D127 1.4, Н-18 чл. 7а): "бон" and any form
 * of "фискален" (and its English), the tax office's header, VAT lines, a receipt number, a unique
 * sale number or a QR code.
 */
export const RECEIPT_LOOK: readonly RegExp[] = [
  /(?<!\p{L})бон/iu,
  /фискал/iu,
  /fiscal/i,
  /ЕИК|EIK/u,
  /ДДС|\bVAT\b/u,
  /УНП/u,
  /\bQR\b/i,
  /receipt (number|no\b)/i,
]

/** What a recorded Save did: the files it handed to the phone, and every link it made. */
export interface SaveRecord {
  /** A file the phone was handed to keep (a download). */
  readonly downloads: { readonly href: string; readonly name: string }[]
  /** Every object URL made and every one revoked. */
  readonly made: string[]
  readonly revoked: string[]
  /** The PNG blobs drawn. */
  readonly images: Blob[]
  /** Puts the browser's own functions back. */
  readonly restore: () => void
}

/**
 * Stands in for the phone's canvas, object URLs and link click, so a face's Save can be tested in
 * a DOM with none of them: it records what Save handed over and what links it made.
 */
export function recordSaving(): SaveRecord {
  const downloads: SaveRecord['downloads'] = []
  const made: string[] = []
  const revoked: string[] = []
  const images: Blob[] = []
  // The DOM's own classes, reached through the global scope: the shell compiles without the DOM.
  const dom = globalThis as unknown as {
    HTMLCanvasElement: { prototype: Record<string, unknown> }
    HTMLAnchorElement: {
      prototype: { click(this: { href: string; download: string }): void }
    }
  }
  const proto = dom.HTMLCanvasElement.prototype
  const anchor = dom.HTMLAnchorElement.prototype
  const before = {
    getContext: proto.getContext,
    toBlob: proto.toBlob,
    click: anchor.click,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  }
  const context = {
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => undefined,
    fillText: () => undefined,
    scale: () => undefined,
    measureText: (text: string) => ({ width: text.length * 7 }),
  }
  proto.getContext = () => context
  proto.toBlob = (done: (blob: Blob | null) => void) => {
    const blob = new Blob(['png'], { type: 'image/png' })
    images.push(blob)
    done(blob)
  }
  URL.createObjectURL = () => {
    const url = `blob:test/${made.length + 1}`
    made.push(url)
    return url
  }
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url)
  }
  anchor.click = function click(this: { href: string; download: string }) {
    downloads.push({ href: this.href, name: this.download })
  }
  return {
    downloads,
    made,
    revoked,
    images,
    restore: () => {
      proto.getContext = before.getContext
      proto.toBlob = before.toBlob
      anchor.click = before.click
      URL.createObjectURL = before.create
      URL.revokeObjectURL = before.revoke
    },
  }
}
