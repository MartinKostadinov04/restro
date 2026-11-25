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
  PayingLegal,
  PayingView,
  PaymentView,
  ServiceState,
  ShareEnd,
  ShareHoldView,
  ShareView,
  TableBillView,
} from '../src/services'
import { EMPTY_SERVICE_STATE, PAYMENT_STATES } from '../src/services'
import type { ShareScreen } from '../src/sharing'

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

/** The venue's legal details as the pay screen shows them (#198): the contract tests look for these. */
export const PAYING_LEGAL: PayingLegal = {
  name: 'Club X EOOD',
  eik: '123456789',
  address: 'Sofia, 1 Vitosha Blvd',
  privacyUrl: 'https://club-x.example/privacy',
}

/** Paying on at the venue; the smallest card payment is €0.50; tips are offered. */
export function payingView(changes: Partial<PayingView> = {}): PayingView {
  return {
    state: 'on',
    minCardMinor: 50,
    processor: 'Stripe',
    venueName: 'Club X',
    legal: PAYING_LEGAL,
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
      { name: { en_US: 'House wine', bg_BG: 'Домашно вино' }, quantity: '1', amountMinor: 1250 },
      { name: { en_US: 'Mojito', bg_BG: 'Мохито' }, quantity: '1', amountMinor: 1000 },
    ],
    paidAt: null,
    receiptEmailed: null,
    receiptEmail: null,
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
 * A group payment of the table: "Split the amount" (#544, D160 §3)
 * ------------------------------------------------------------------------------------------- */

/**
 * The table's group payment as the host sends it: €109.00 shared, €27.50 held by one other phone,
 * €81.50 left, the smallest card payment €0.50, and the share with about nine minutes to run.
 */
export function shareView(changes: Partial<ShareView> = {}): ShareView {
  return {
    id: 'py_0000000000000000000009',
    number: 'R3T8W',
    state: 'awaiting_guest',
    reason: null,
    currency: 'EUR',
    sharedMinor: 10_900,
    heldMinor: 2_750,
    claimedMinor: 2_750,
    leftMinor: 8_150,
    minimumMinor: 50,
    endsAt: '2026-11-25T23:30:00.000Z',
    holds: 1,
    lines: [
      {
        name: { en_US: 'House wine', bg_BG: 'Домашно вино' },
        quantity: '2',
        amountMinor: 2_500,
      },
      { name: { en_US: 'Mojito', bg_BG: 'Мохито' }, quantity: '1', amountMinor: 1_000 },
    ],
    mine: null,
    timeZone: 'Europe/Sofia',
    ...changes,
  }
}

/** This phone's own part of the share: €40.00 with no tip, at the card form. */
export function shareHold(changes: Partial<ShareHoldView> = {}): ShareHoldView {
  return {
    state: 'awaiting_guest',
    reason: null,
    amountMinor: 4_000,
    tipMinor: 0,
    form: { confirmSeconds: 120 },
    ...changes,
  }
}

/** One stage of a group payment and what a face has to draw for it. */
export interface ShareScenario {
  readonly name: string
  readonly share: ShareView
  /** The shell's screen for it (`shareScreen`), written out here rather than computed. */
  readonly screen: ShareScreen['kind']
  /** The card form slot is mounted. */
  readonly slot: boolean
  /** "Paid" and the payment number show. */
  readonly paid: boolean
  /** Which ending, on the screens that are one. */
  readonly end?: ShareEnd
  /** "Start again" shows. */
  readonly again?: boolean
  /** "Take my part back" shows. */
  readonly takeBack?: boolean
}

/**
 * Every state a group payment reaches, on a phone that has taken no part of it and on one that has
 * (#544): what is drawn is written out here, so a face is tested against the ticket rather than
 * against the shell's own `shareScreen`.
 */
export function shareScenarios(): readonly ShareScenario[] {
  const only = (
    state: ShareView['state'],
    screen: ShareScreen['kind'],
    changes: Partial<ShareView> = {},
  ): ShareScenario => ({
    name: changes.reason == null ? `share:${state}` : `share:${state}:${changes.reason}`,
    share: shareView({ state, ...changes }),
    screen,
    slot: false,
    paid: false,
  })
  const mine = (
    hold: ShareHoldView['state'],
    screen: ShareScreen['kind'],
    changes: {
      readonly share?: Partial<ShareView>
      readonly hold?: Partial<ShareHoldView>
      readonly name?: string
    } = {},
  ): ShareScenario => ({
    name: `mine:${changes.name ?? hold}`,
    share: shareView({
      ...changes.share,
      mine: shareHold({
        state: hold,
        form: hold === 'awaiting_guest' ? { confirmSeconds: 120 } : null,
        ...changes.hold,
      }),
    }),
    screen,
    slot: screen === 'card',
    paid: screen === 'paid',
    takeBack:
      (hold === 'awaiting_guest' || hold === 'held') &&
      (changes.share?.state ?? 'awaiting_guest') === 'awaiting_guest',
  })
  return [
    // A phone that has taken no part follows the share itself.
    only('requested', 'preparing'),
    only('priced', 'preparing'),
    only('awaiting_guest', 'open'),
    only('held', 'closing'),
    only('queued', 'closing'),
    only('isolated', 'closing'),
    only('entered', 'closing'),
    only('checked', 'closing'),
    only('closed', 'closing'),
    only('cancelling', 'closing'),
    only('captured', 'settled'),
    only('unconfirmed', 'checking'),
    only('stranded', 'checking'),
    only('capture_failed', 'checking'),
    { ...only('released', 'ended', { reason: 'expired' }), end: 'expired' },
    { ...only('released', 'ended', { reason: 'cancelled' }), end: 'cancelled' },
    { ...only('released', 'ended', { reason: 'withdrawn' }), end: 'withdrawn' },
    {
      ...only('released', 'ended', { reason: 'bill_changed' }),
      end: 'bill_changed',
      again: true,
    },
    { ...only('released', 'ended'), end: 'other' },
    // A phone that has taken one follows its own part, because that is what its card did.
    mine('requested', 'preparing'),
    mine('awaiting_guest', 'card'),
    mine('awaiting_guest', 'preparing', { name: 'awaiting_guest:no-form', hold: { form: null } }),
    mine('held', 'waiting'),
    mine('held', 'closing', { name: 'held:closing', share: { state: 'closed' } }),
    mine('releasing', 'releasing'),
    mine('captured', 'paid', {
      name: 'captured',
      share: { state: 'captured', heldMinor: 10_900, claimedMinor: 10_900, leftMinor: 0 },
      hold: { tipMinor: 250 },
    }),
    mine('capture_failed', 'checking', { share: { state: 'unconfirmed' } }),
    // A part given back while the others still take theirs: back to the share, not to an ending.
    mine('released', 'open', { name: 'released:gathering', hold: { reason: 'withdrawn' } }),
    {
      ...mine('released', 'ended', {
        name: 'released:expired',
        share: { state: 'released', reason: 'expired' },
        hold: { reason: 'expired' },
      }),
      end: 'expired',
    },
  ]
}

/* ---------------------------------------------------------------------------------------------
 * Paid in the app, and the Payment confirmation (#197, D127 1.2 and 1.4)
 * ------------------------------------------------------------------------------------------- */

/** Two lines paid in the app in this sitting: a name, a quantity and an amount, never a payer. */
export const PAID_LINES: readonly PaidLineView[] = [
  { name: { en_US: 'Gin & tonic', bg_BG: 'Джин тоник' }, quantity: '2', amountMinor: 1800 },
  { name: { en_US: 'Nachos', bg_BG: 'Начос' }, quantity: '1', amountMinor: 900 },
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
