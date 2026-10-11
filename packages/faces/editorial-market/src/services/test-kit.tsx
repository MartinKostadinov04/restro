// What the tests of the service screens share: a menu that can be ordered from, a fake host whose
// answers the test controls (so "pending" can be looked at before the answer comes), builders for
// the host's state, and the page set-up of the other jsdom tests. Used by tests only.

import {
  type BillLineStatus,
  type BillLineView,
  type BillRoundView,
  type BillView,
  type CommandResult,
  EMPTY_SERVICE_STATE,
  type GuestCommand,
  type PayQuote,
  type ReceiptView,
  type RequestView,
  SERVICE_KINDS,
  type ServiceBinding,
  type ServiceState,
  type ViewItem,
  type ViewModel,
  type ViewMoney,
  type ViewText,
} from '@restro/shell'
import { type Fixture, snapshotFromSpec } from '@restro/shell/testing'
import { act, render } from '@testing-library/react'

import { EditorialMarketFace, type EditorialMarketFaceProps } from '../face'
import { itemsOf, viewOf } from '../test-views'

/** jsdom has no `matchMedia`; `reduceMotion` is what the guest's device says. */
export function stubMatchMedia(reduceMotion: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduceMotion && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** A clean page: instant sheets, an empty address, no scroll lock left over. */
export function resetPage() {
  stubMatchMedia(true)
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  document.body.style.overflow = ''
}

const both = (en: string, bg: string) => ({ en_US: en, bg_BG: bg })

/** The menu the service tests order from. Item ids are in the order below, from `nd_…02`. */
export function orderingFixture(): Fixture {
  return {
    name: 'ordering',
    note: 'Every service on; a plain dish, a dish with a required and an optional group, a sold-out dish, an ask-the-waiter dish.',
    snapshot: snapshotFromSpec({
      locales: { default: 'en_US', available: ['en_US', 'bg_BG'] },
      menuTitle: both('Late Menu', 'Късно меню'),
      features: {
        filters: false,
        call_waiter: { enabled: true, kinds: [...SERVICE_KINDS] },
        bill: true,
        ordering: true,
        pay: true,
      },
      sections: [
        {
          title: both('Food', 'Храна'),
          items: [
            { name: both('Hummus', 'Хумус'), price: 700 },
            {
              name: both('Bowl', 'Боул'),
              price: 1000,
              groups: [
                {
                  name: both('Size', 'Размер'),
                  min: 1,
                  max: 1,
                  options: [
                    { name: both('Regular', 'Стандартна'), delta: null },
                    { name: both('Large', 'Голяма'), delta: 250 },
                  ],
                },
                {
                  name: both('Extras', 'Добавки'),
                  min: 0,
                  max: 2,
                  options: [
                    { name: both('Avocado', 'Авокадо'), delta: 180 },
                    { name: both('Egg', 'Яйце'), delta: 120 },
                  ],
                },
              ],
            },
            { name: both('Steak', 'Стек'), price: 2400, soldOut: true },
            { name: both('Vodka', 'Водка'), price: 12000, askWaiter: true },
          ],
        },
        {
          title: both('Drinks', 'Напитки'),
          items: [{ name: both('Mojito', 'Мохито'), price: 1000 }],
        },
      ],
    }),
    overlay: null,
    context: {
      locale: 'en_US',
      now: '2026-10-07T20:30:00+03:00',
      orderingEnabled: true,
      tableToken: 'test-table-token',
      capabilities: { callWaiter: true, bill: true, ordering: true, pay: true },
    },
  }
}

/** The ordering menu as a view model. */
export function orderingView(locale: 'en_US' | 'bg_BG' = 'en_US'): ViewModel {
  const fixture = orderingFixture()
  return viewOf({ ...fixture, context: { ...fixture.context, locale } })
}

/** An item of the ordering menu, by its English name. */
export function itemNamed(view: ViewModel, name: string): ViewItem {
  const found = itemsOf(view).find((item) => item.name.text === name)
  if (found === undefined) throw new Error(`the test menu has no ${name}`)
  return found
}

/* ---------------------------------------------------------------------------------------------
 * The host's state, built by hand
 * ------------------------------------------------------------------------------------------- */

/** An amount with its text ("€12.50"), made without a division. Small amounts only (no thousands). */
export function eur(minor: number): ViewMoney {
  const digits = String(minor).padStart(3, '0')
  return { minor, currency: 'EUR', text: `€${digits.slice(0, -2)}.${digits.slice(-2)}` }
}

export const text = (value: string, lang: ViewText['lang'] = 'en_US'): ViewText => ({
  text: value,
  lang,
})

export function billLine(
  id: string,
  name: string,
  qty: number,
  minor: number,
  status: BillLineStatus = 'received',
): BillLineView {
  return { id, name: text(name), qty, total: eur(minor), status, options: [] }
}

export function billRound(
  id: string,
  origin: 'guest' | 'staff',
  lines: readonly BillLineView[],
  actionId: string | null = null,
  time = '19:42',
): BillRoundView {
  return { id, origin, time, actionId, lines }
}

/** A bill; the total is the host's (given), not a sum. */
export function billOf(rounds: readonly BillRoundView[], totalMinor: number): BillView {
  return { revision: 1, rounds, total: eur(totalMinor), updatedAt: '2026-10-07T20:30:00+03:00' }
}

export function request(
  id: string,
  actionId: string,
  kind: RequestView['kind'],
  status: RequestView['status'],
): RequestView {
  return { id, actionId, kind, status, note: '' }
}

export function quoteOf(changes: Partial<PayQuote> = {}): PayQuote {
  return {
    id: 'q-1',
    scope: 'full',
    people: null,
    subtotal: eur(2000),
    tipOptions: [
      { percent: 5, amount: eur(100) },
      { percent: 10, amount: eur(200) },
      { percent: 15, amount: eur(300) },
    ],
    tip: eur(200),
    vat: [{ rate: '20%', amount: eur(333) }],
    total: eur(2200),
    methods: ['apple', 'google', 'card', 'waiter'],
    promo: null,
    ...changes,
  }
}

export function receiptOf(changes: Partial<ReceiptView> = {}): ReceiptView {
  return {
    id: 'rc-1',
    reference: 'R-0001',
    fiscalReference: 'FR-123',
    venueName: 'Test venue',
    tableLabel: '12',
    issuedAt: '07.10.2026 21:00',
    lines: [billLine('l1', 'Hummus', 2, 1400, 'served')],
    vat: [{ rate: '20%', amount: eur(233) }],
    tip: eur(140),
    total: eur(1540),
    method: 'card',
    actions: { pdf: true, email: true, print: true },
    ...changes,
  }
}

/* ---------------------------------------------------------------------------------------------
 * The fake host
 * ------------------------------------------------------------------------------------------- */

/** One command the face sent, waiting for the test to answer it. */
export interface Call {
  readonly command: GuestCommand
  /** Answers it; the status is `accepted` and the `actionId` its own unless the test says otherwise. */
  readonly answer: (result?: Partial<CommandResult>) => void
  /** The host throws instead of answering. */
  readonly fail: (error?: Error) => void
}

export interface FakeHost {
  /** Every command sent, in order. */
  readonly calls: Call[]
  /** The binding to give the face, with the state as it is now. */
  readonly binding: () => ServiceBinding
  readonly state: () => ServiceState
  readonly set: (patch: Partial<ServiceState>) => void
  /** The calls of one kind. */
  readonly of: <K extends GuestCommand['kind']>(
    kind: K,
  ) => (Call & { command: Extract<GuestCommand, { kind: K }> })[]
}

/** A host that records every command and answers only when the test says so. */
export function fakeHost(initial: Partial<ServiceState> = {}): FakeHost {
  let state: ServiceState = { ...EMPTY_SERVICE_STATE, ...initial }
  const calls: Call[] = []
  const dispatch = (command: GuestCommand) =>
    new Promise<CommandResult>((resolve, reject) => {
      calls.push({
        command,
        answer: (result = {}) =>
          resolve({
            actionId: command.actionId,
            status: 'accepted',
            message: null,
            ref: null,
            ...result,
          }),
        fail: (error = new Error('the host failed')) => reject(error),
      })
    })
  return {
    calls,
    binding: () => ({ state, dispatch }),
    state: () => state,
    set: (patch) => {
      state = { ...state, ...patch }
    },
    of: <K extends GuestCommand['kind']>(kind: K) =>
      calls.filter((call) => call.command.kind === kind) as (Call & {
        command: Extract<GuestCommand, { kind: K }>
      })[],
  }
}

/** The face on a page with a fake host; `update` gives it the host's new state, as a host would. */
export function drawFace(
  host: FakeHost,
  view: ViewModel = orderingView(),
  props: Partial<EditorialMarketFaceProps> = {},
) {
  const element = (nextView: ViewModel) => (
    <EditorialMarketFace view={nextView} services={host.binding()} {...props} />
  )
  const result = render(element(view))
  let current = view
  return {
    ...result,
    /** The host's state changed (or the view did): the face is given the new binding. */
    update(patch: Partial<ServiceState> = {}, nextView: ViewModel = current) {
      host.set(patch)
      current = nextView
      act(() => result.rerender(element(nextView)))
    },
  }
}
