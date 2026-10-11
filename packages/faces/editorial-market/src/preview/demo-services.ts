// A demo host for the service screens, for the admin's preview only (`@restro/editorial-market/
// preview`): it keeps a make-believe table in its own state, so the composer can show the bag, the
// bill, the waiter, the payment and the receipt working before any platform exists behind them.
// The guest page never imports this file (a dependency rule forbids it); a real host binds its own
// `ServiceBinding`.
//
// It behaves like a host would, slowly enough to see every state:
//   - an `order.send` is accepted after about 800 ms and becomes a guest round of the bill; its lines
//     go received, preparing, served on a timer. A repeat of the same `actionId` gets the first answer.
//   - one staff round is on the bill from the start;
//   - a waiter request is sent, then "on the way" a moment later; a cancel cancels it;
//   - `pay.quote` is a quote of the bill (a whole table, an equal share, or the guest's own items) with
//     a tip, 20 % VAT (a demo constant) and the code DEMO10; `pay.start` is accepted after a moment and
//     issues a receipt.
// `state.preview` is true, so every service sheet carries the "Preview" marker.
//
// All the money here is core's: integer minor units through `@restro/shell/money`, half-up, never a float.

import {
  type BillLineStatus,
  type BillLineView,
  type BillRoundView,
  type BillView,
  type CommandResult,
  type GuestCommand,
  type PayMethod,
  type PayQuote,
  type ReceiptView,
  type RequestView,
  resolveBag,
  type ServiceBinding,
  type ServiceState,
  type ViewModel,
  type ViewMoney,
  type ViewText,
} from '@restro/shell'
import {
  addMinor,
  percentOfMinor,
  ratioOfMinor,
  subtractMinor,
  viewMinor,
} from '@restro/shell/money'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** The demo's pace, in milliseconds. */
export const DEMO_DELAYS = {
  /** An order is accepted. */
  order: 800,
  /** A guest line goes from received to preparing, and from preparing to served. */
  preparing: 4000,
  served: 10_000,
  /** A waiter request is answered, and the waiter is on the way. */
  request: 300,
  onTheWay: 1500,
  /** A quote, a payment, a receipt action. */
  quote: 250,
  pay: 1400,
  receiptAction: 400,
} as const

/** The VAT rate of the demo, in whole percent (a demo constant: the real rate comes from the venue). */
const DEMO_VAT_PERCENT = 20
/** The tip the demo's host suggests when the guest has not chosen, and the tips it offers. */
const DEMO_DEFAULT_TIP_PERCENT = 10
const DEMO_TIP_PERCENTS = [5, 10, 15] as const
/** The one promo code of the demo: ten percent off. */
const DEMO_PROMO = 'DEMO10'
const DEMO_PROMO_PERCENT = 10
const DEMO_METHODS: readonly PayMethod[] = ['apple', 'google', 'card', 'waiter']

/** One line of a round, with the minor units behind its total. */
interface Line {
  readonly id: string
  readonly name: ViewText
  readonly options: readonly ViewText[]
  readonly qty: number
  readonly totalMinor: number
  readonly status: BillLineStatus
}

interface Round {
  readonly id: string
  readonly origin: 'guest' | 'staff'
  readonly time: string
  readonly actionId: string | null
  readonly lines: readonly Line[]
}

interface Store {
  readonly revision: number
  readonly rounds: readonly Round[]
  readonly requests: readonly RequestView[]
  readonly quote: PayQuote | null
  readonly receipt: ReceiptView | null
}

const clock = (locale: string) =>
  new Date().toLocaleTimeString(locale.replace('_', '-'), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** The staff round the table starts with: water, wine and bread. */
function startingStore(view: ViewModel): Store {
  const bulgarian = view.locale === 'bg_BG'
  const text = (en: string, bg: string): ViewText => ({
    text: bulgarian ? bg : en,
    lang: view.locale,
  })
  const staff: Round = {
    id: 'demo-staff-1',
    origin: 'staff',
    time: '19:42',
    actionId: null,
    lines: [
      {
        id: 'demo-w1',
        name: text('Still water 750 ml', 'Минерална вода 750 мл'),
        options: [],
        qty: 1,
        totalMinor: 450,
        status: 'served',
      },
      {
        id: 'demo-w2',
        name: text('Glass of house wine', 'Чаша домашно вино'),
        options: [],
        qty: 2,
        totalMinor: 1400,
        status: 'served',
      },
      {
        id: 'demo-w3',
        name: text('Bread & butter', 'Хляб с масло'),
        options: [],
        qty: 1,
        totalMinor: 380,
        status: 'preparing',
      },
    ],
  }
  return { revision: 1, rounds: [staff], requests: [], quote: null, receipt: null }
}

const lineTotal = (line: Line) => (line.status === 'cancelled' ? 0 : line.totalMinor)
const sum = (amounts: readonly number[]) =>
  amounts.reduce((total, amount) => addMinor(total, amount), 0)
const billMinor = (rounds: readonly Round[]) => sum(rounds.flatMap((r) => r.lines.map(lineTotal)))
const mineMinor = (rounds: readonly Round[]) =>
  billMinor(rounds.filter((round) => round.origin === 'guest'))

/** The demo store as the state a face draws. */
function stateOf(store: Store, view: ViewModel): ServiceState {
  const money = (minor: number): ViewMoney => viewMinor(minor, view.currency, view.locale)
  const lineView = (line: Line): BillLineView => ({
    id: line.id,
    name: line.name,
    qty: line.qty,
    total: money(line.totalMinor),
    status: line.status,
    options: line.options,
  })
  const rounds: BillRoundView[] = store.rounds.map((round) => ({
    id: round.id,
    origin: round.origin,
    time: round.time,
    actionId: round.actionId,
    lines: round.lines.map(lineView),
  }))
  const bill: BillView | null =
    rounds.length === 0
      ? null
      : {
          revision: store.revision,
          rounds,
          total: money(billMinor(store.rounds)),
          updatedAt: '',
        }
  return {
    revision: store.revision,
    preview: true,
    bill,
    requests: store.requests,
    quote: store.quote,
    receipt: store.receipt,
  }
}

/** A quote of the demo bill: a whole table, an equal share or the guest's own items, with a tip, VAT and a code. */
function quoteOf(
  store: Store,
  view: ViewModel,
  id: string,
  command: Extract<GuestCommand, { kind: 'pay.quote' }>,
): PayQuote {
  const money = (minor: number): ViewMoney => viewMinor(minor, view.currency, view.locale)
  const bulgarian = view.locale === 'bg_BG'
  const whole = billMinor(store.rounds)
  const scoped =
    command.scope === 'full'
      ? whole
      : command.scope === 'split'
        ? ratioOfMinor(whole, 1, command.people ?? 2)
        : mineMinor(store.rounds)

  const code = command.promo ?? ''
  const accepted = code.toUpperCase() === DEMO_PROMO
  const subtotal = accepted
    ? subtractMinor(scoped, percentOfMinor(scoped, DEMO_PROMO_PERCENT))
    : scoped
  const tipMinor =
    command.tipMinor !== null
      ? command.tipMinor
      : percentOfMinor(subtotal, command.tipPercent ?? DEMO_DEFAULT_TIP_PERCENT)

  const promoMessage = (en: string, bg: string): ViewText => ({
    text: bulgarian ? bg : en,
    lang: view.locale,
  })
  return {
    id,
    scope: command.scope,
    people: command.scope === 'split' ? command.people : null,
    subtotal: money(subtotal),
    tipOptions: DEMO_TIP_PERCENTS.map((percent) => ({
      percent,
      amount: money(percentOfMinor(subtotal, percent)),
    })),
    tip: money(tipMinor),
    vat: [
      {
        rate: `${DEMO_VAT_PERCENT}%`,
        amount: money(ratioOfMinor(subtotal, DEMO_VAT_PERCENT, 100 + DEMO_VAT_PERCENT)),
      },
    ],
    total: money(addMinor(subtotal, tipMinor)),
    methods: DEMO_METHODS,
    promo: {
      code,
      accepted,
      message:
        code === ''
          ? null
          : accepted
            ? promoMessage('Demo code: 10% off', 'Демо код: 10% отстъпка')
            : promoMessage('Demo: try DEMO10', 'Демо: опитайте DEMO10'),
    },
  }
}

/** The receipt of a payment of the demo bill. */
function receiptOf(
  store: Store,
  view: ViewModel,
  id: string,
  quote: PayQuote,
  method: PayMethod,
): ReceiptView {
  const bulgarian = view.locale === 'bg_BG'
  const money = (minor: number): ViewMoney => viewMinor(minor, view.currency, view.locale)
  const covered =
    quote.scope === 'mine' ? store.rounds.filter((round) => round.origin === 'guest') : store.rounds
  const lines: BillLineView[] =
    quote.scope === 'split'
      ? [
          {
            id: 'demo-share',
            name: {
              text: bulgarian
                ? `Равен дял (${quote.people ?? 2} души)`
                : `Equal share (${quote.people ?? 2} people)`,
              lang: view.locale,
            },
            qty: 1,
            total: quote.subtotal,
            status: 'served',
            options: [],
          },
        ]
      : covered.flatMap((round) =>
          round.lines.map((line) => ({
            id: line.id,
            name: line.name,
            qty: line.qty,
            total: money(line.totalMinor),
            status: line.status,
            options: line.options,
          })),
        )
  return {
    id,
    reference: `R-${id.slice(-4).toUpperCase()}`,
    fiscalReference: `FR-${id.slice(-4).toUpperCase()}`,
    venueName: bulgarian ? 'Демо заведение' : 'Demo venue',
    tableLabel: '12',
    issuedAt: new Date().toLocaleString(view.locale.replace('_', '-')),
    lines,
    vat: quote.vat,
    tip: quote.tip,
    total: quote.total,
    method,
    actions: { pdf: true, email: true, print: true },
  }
}

/**
 * A demo host: its own state (`preview: true`), and a `dispatch` that answers like a platform would.
 * The state is the make-believe table of `startingStore`; everything the guest does changes it
 * through the commands, never through the face.
 */
export function useDemoServices(view: ViewModel): ServiceBinding {
  const [store, setStore] = useState<Store>(() => startingStore(view))
  const storeRef = useRef(store)
  const viewRef = useRef(view)
  viewRef.current = view
  const timers = useRef(new Set<number>())
  // What each action was answered, by `actionId`: a repeat gets the same promise (idempotency).
  const handled = useRef(new Map<string, Promise<CommandResult>>())
  const counter = useRef(0)

  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) window.clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const commit = useCallback((change: (now: Store) => Store) => {
    const next = change(storeRef.current)
    storeRef.current = { ...next, revision: next.revision + 1 }
    setStore(storeRef.current)
  }, [])

  const later = useCallback((ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      run()
    }, ms)
    timers.current.add(timer)
  }, [])

  const wait = useCallback(
    (ms: number) => new Promise<void>((resolve) => later(ms, resolve)),
    [later],
  )

  const nextId = useCallback((prefix: string) => {
    counter.current += 1
    return `${prefix}-${counter.current.toString(36).padStart(4, '0')}`
  }, [])

  const setLineStatus = useCallback(
    (roundId: string, status: BillLineStatus) =>
      commit((now) => ({
        ...now,
        rounds: now.rounds.map((round) =>
          round.id === roundId && round.origin === 'guest'
            ? { ...round, lines: round.lines.map((line) => ({ ...line, status })) }
            : round,
        ),
      })),
    [commit],
  )

  const answer = useCallback(
    (command: GuestCommand, status: CommandResult['status'], message: ViewText | null = null) => {
      return {
        actionId: command.actionId,
        status,
        message,
        ref: status === 'accepted' ? nextId('ref').toUpperCase() : null,
      }
    },
    [nextId],
  )

  const handle = useCallback(
    async (command: GuestCommand): Promise<CommandResult> => {
      const now = viewRef.current
      const bulgarian = now.locale === 'bg_BG'
      const say = (en: string, bg: string): ViewText => ({
        text: bulgarian ? bg : en,
        lang: now.locale,
      })

      switch (command.kind) {
        case 'order.send': {
          await wait(DEMO_DELAYS.order)
          const resolved = resolveBag(
            now,
            command.lines.map((line, index) => ({ ...line, key: `${command.actionId}-${index}` })),
          )
          if (!resolved.canSend) {
            return answer(
              command,
              'rejected',
              say(
                'Demo kitchen: something is no longer available.',
                'Демо кухня: нещо вече не е налично.',
              ),
            )
          }
          const roundId = nextId('demo-round')
          const lines: Line[] = resolved.lines.map((entry, index) => ({
            id: `${roundId}-${index}`,
            name: entry.item?.name ?? say('Item', 'Артикул'),
            options: entry.options.map((option) => option.name),
            qty: entry.line.qty,
            totalMinor: entry.total?.minor ?? 0,
            status: 'received',
          }))
          commit((current) => ({
            ...current,
            rounds: [
              ...current.rounds,
              {
                id: roundId,
                origin: 'guest',
                time: clock(now.locale),
                actionId: command.actionId,
                lines,
              },
            ],
          }))
          later(DEMO_DELAYS.preparing, () => setLineStatus(roundId, 'preparing'))
          later(DEMO_DELAYS.served, () => setLineStatus(roundId, 'served'))
          return answer(command, 'accepted')
        }

        case 'service.request': {
          await wait(DEMO_DELAYS.request)
          const id = nextId('demo-request')
          const request: RequestView = {
            id,
            actionId: command.actionId,
            kind: command.request,
            status: 'sent',
            note: command.note,
          }
          commit((current) => ({ ...current, requests: [...current.requests, request] }))
          later(DEMO_DELAYS.onTheWay, () =>
            commit((current) => ({
              ...current,
              requests: current.requests.map((r) =>
                r.id === id && r.status === 'sent' ? { ...r, status: 'on_the_way' } : r,
              ),
            })),
          )
          return answer(command, 'accepted')
        }

        case 'service.cancel': {
          await wait(DEMO_DELAYS.request)
          commit((current) => ({
            ...current,
            requests: current.requests.map((r) =>
              r.id === command.requestId && ['sent', 'accepted', 'on_the_way'].includes(r.status)
                ? { ...r, status: 'cancelled' }
                : r,
            ),
          }))
          return answer(command, 'accepted')
        }

        case 'pay.quote': {
          await wait(DEMO_DELAYS.quote)
          const quote = quoteOf(storeRef.current, now, nextId('demo-quote'), command)
          commit((current) => ({ ...current, quote }))
          return answer(command, 'accepted')
        }

        case 'pay.start': {
          await wait(DEMO_DELAYS.pay)
          const quote = storeRef.current.quote
          if (quote === null || quote.id !== command.quoteId) {
            return answer(
              command,
              'rejected',
              say('Demo: this quote has expired.', 'Демо: офертата е изтекла.'),
            )
          }
          const receipt = receiptOf(
            storeRef.current,
            now,
            nextId('demo-receipt'),
            quote,
            command.method,
          )
          commit((current) => ({
            ...current,
            receipt,
            // Paying the whole table settles the bill.
            rounds: quote.scope === 'full' ? [] : current.rounds,
            quote: null,
          }))
          return answer(command, 'accepted')
        }

        case 'receipt.action': {
          await wait(DEMO_DELAYS.receiptAction)
          return answer(
            command,
            'accepted',
            say('Demo: sent to your phone.', 'Демо: изпратено към телефона ви.'),
          )
        }
      }
    },
    [wait, answer, nextId, commit, later, setLineStatus],
  )

  const dispatch = useCallback(
    (command: GuestCommand): Promise<CommandResult> => {
      // A repeat of an action, even while the first is still being answered, gets the first answer.
      const known = handled.current.get(command.actionId)
      if (known !== undefined) return known
      const answered = handle(command)
      handled.current.set(command.actionId, answered)
      return answered
    },
    [handle],
  )

  const state = useMemo(() => stateOf(store, view), [store, view])
  return useMemo(() => ({ state, dispatch }), [state, dispatch])
}
