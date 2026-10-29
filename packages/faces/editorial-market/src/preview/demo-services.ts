// A demo host for the service screens, for the admin's preview only (`@restro/editorial-market/
// preview`): it keeps a make-believe table in its own state, so the composer can show the bag, the
// bill, the waiter and the payment working before any platform exists behind them.
// The guest page never imports this file (a dependency rule forbids it); a real host binds its own
// `ServiceBinding`.
//
// It behaves like a host would, slowly enough to see every state:
//   - an `order.send` is accepted after about 800 ms and becomes a guest round of the bill; its lines
//     go received, preparing, served on a timer. A repeat of the same `actionId` gets the first answer.
//   - one staff round is on the bill from the start;
//   - a waiter request is sent, then "on the way" a moment later; a cancel cancels it;
//   - the bill is also the table's bill for paying (`tableBill`); `pay.start` of ticked lines starts a
//     payment that waits for the card (the demo's form is a button in the form slot, no provider),
//     then is held, and captured a moment later: the paid lines leave the bill. `pay.cancel` before
//     the card lets it go.
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
  type PayFormSlot,
  type PaymentView,
  type RequestView,
  resolveBag,
  type ServiceBinding,
  type ServiceState,
  type TableBillLineView,
  type TableBillView,
  type ViewModel,
  type ViewMoney,
  type ViewText,
} from '@restro/shell'
import { addMinor, ratioOfMinor, viewMinor } from '@restro/shell/money'
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
  /** A payment is accepted, held and captured. */
  pay: 400,
  hold: 900,
  capture: 1400,
} as const

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
  readonly payment: PaymentView | null
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
  return { revision: 1, rounds: [staff], requests: [], payment: null }
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
    ordering: { state: 'on', tips: true },
    paying: {
      state: 'on',
      minCardMinor: 50,
      processor: 'Demo',
      venueName: 'Demo venue',
      legal: {
        name: 'Demo venue EOOD',
        eik: '123456789',
        address: 'Sofia, 1 Vitosha Blvd',
        privacyUrl: 'https://example.com/privacy',
      },
      electronicReceipt: false,
      recent: null,
    },
    payment: store.payment,
    tableBill: tableBillOf(store, view),
  }
}

/** The demo bill as the table's bill for paying: the POS-like lines with their own amounts. */
function tableBillOf(store: Store, view: ViewModel): TableBillView | null {
  const lines = store.rounds.flatMap((round) =>
    round.lines
      .filter((line) => line.status !== 'cancelled')
      .map((line) => ({
        id: line.id,
        name: { [view.locale]: line.name.text } as NonNullable<TableBillLineView['name']>,
        quantity: String(line.qty),
        amountMinor: line.totalMinor,
        beingPaid: false,
      })),
  )
  if (lines.length === 0) return null
  const total = sum(lines.map((line) => line.amountMinor))
  return {
    readAgoSeconds: 0,
    complete: true,
    currency: 'EUR',
    totalMinor: total,
    paidMinor: 0,
    owedMinor: total,
    parts: [{ id: 'demo-bill', beingPaid: false, totalMinor: total, paidMinor: 0, lines }],
    paidLines: [],
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
  /** The bill lines of the payment in hand: they leave the bill once it is captured. */
  const paidLines = useRef<ReadonlySet<string>>(new Set())

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

        case 'pay.start': {
          await wait(DEMO_DELAYS.pay)
          const picked = new Set(command.seen.map((line) => line.lineId))
          const lines = storeRef.current.rounds
            .flatMap((round) => round.lines)
            .filter((line) => picked.has(line.id))
          if (lines.length === 0 || storeRef.current.payment !== null) {
            return answer(
              command,
              'rejected',
              say('Demo: the bill changed.', 'Демо: сметката се промени.'),
            )
          }
          const linesMinor = sum(lines.map(lineTotal))
          const tipMinor =
            command.tipMinor ??
            (command.tipPercent === null ? 0 : ratioOfMinor(linesMinor, command.tipPercent, 100))
          const payment: PaymentView = {
            id: nextId('py-demo'),
            mode: 'bill',
            number: 'DEMO7',
            state: 'awaiting_guest',
            reason: null,
            currency: 'EUR',
            amountMinor: addMinor(linesMinor, tipMinor),
            tipMinor,
            lines: lines.map((line) => ({
              name: { [now.locale]: line.name.text } as NonNullable<TableBillLineView['name']>,
              quantity: String(line.qty),
              amountMinor: line.totalMinor,
            })),
            paidAt: null,
            receiptEmailed: null,
            receiptEmail: null,
            timeZone: 'Europe/Sofia',
            form: { confirmSeconds: 120 },
          }
          paidLines.current = picked
          commit((current) => ({ ...current, payment }))
          return answer(command, 'accepted')
        }

        case 'pay.returned':
          return answer(command, 'accepted')

        case 'pay.cancel': {
          const current = storeRef.current.payment
          if (current === null || current.state !== 'awaiting_guest') {
            return answer(command, 'rejected')
          }
          commit((state) => ({
            ...state,
            payment: { ...current, state: 'released', reason: 'cancelled', form: null },
          }))
          return answer(command, 'accepted')
        }

        // The table's shared order (#75): this template keeps its own bag, so the demo has none.
        case 'order.add':
        case 'order.change':
        case 'order.remove':
        case 'order.undo':
        case 'order.restore':
        // The location check (#76) runs only on a real table, never in the preview.
        case 'location.check':
          return answer(command, 'rejected')
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

  // The demo has no provider: its "card form" is one button. Pressing it holds the card, then the
  // payment is captured a moment later and the paid lines leave the bill.
  const payForm = useMemo<PayFormSlot>(
    () => ({
      mount(target, props) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = props.buttonClass
        button.textContent = props.label
        button.dataset.slot = 'pay.form.submit'
        button.addEventListener('click', () => {
          button.disabled = true
          const current = storeRef.current.payment
          if (current === null) return
          commit((state) => ({ ...state, payment: { ...current, state: 'held', form: null } }))
          later(DEMO_DELAYS.capture - DEMO_DELAYS.hold, () => {
            commit((state) => ({
              ...state,
              payment: state.payment === null ? null : { ...state.payment, state: 'captured' },
              rounds: state.rounds.map((round) => ({
                ...round,
                lines: round.lines.filter((line) => !paidLines.current.has(line.id)),
              })),
            }))
          })
        })
        ;(target as HTMLElement).replaceChildren(button)
        return {
          update: (next) => {
            button.textContent = next.label
          },
          unmount: () => (target as HTMLElement).replaceChildren(),
        }
      },
    }),
    [commit, later],
  )
  const payControls = useMemo(
    () => ({ dismiss: () => commit((state) => ({ ...state, payment: null })) }),
    [commit],
  )

  const state = useMemo(() => stateOf(store, view), [store, view])
  return useMemo(
    () => ({ state, dispatch, payForm, payControls }),
    [state, dispatch, payForm, payControls],
  )
}
