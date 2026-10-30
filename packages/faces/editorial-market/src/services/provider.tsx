// The services layer of the face: the table's shared order, the service sheets that live in the
// address (`#bag`, `#tab`, `#call`, `#pay`) and the way a command goes to the host. It is a
// provider around the whole face, so a quick-add button in a card, the buttons in the header, the
// bar at the bottom and the sheets all share one order.
//
// The face never succeeds on its own (D72). The order is the table's (D117, D121): every phone at
// the table sees and edits the same lines, and the face draws `state.order` and sends `order.add`,
// `order.change`, `order.remove`, `order.undo`, `order.restore` and `order.send`; it keeps no bag
// of its own. A bill is only what `state.tableBill` holds; a waiter is "on the way" only when a
// request of the host's says so; a payment is "paid" only after the host accepted it and issued a
// receipt. Without `services`, or for a service the view model has switched off (R15), nothing
// here draws.

import {
  ANSWER_LOST_CODE,
  type BagLine,
  type CommandResult,
  DUPLICATE_ASK_SECONDS,
  type GuestCommand,
  type GuestStrings,
  isOutOfStock,
  itemsById,
  LOST_SEND_HOLD_MS,
  type Locale,
  minutesSinceSent,
  type OrderLineView,
  type ResolvedBag,
  refusalText,
  refusedOutOfStock,
  resolveBag,
  type SentOrderView,
  type ServiceBinding,
  type ServiceState,
  type ServiceStrings,
  stringsFor,
  type TableOrderView,
  type ViewFeatures,
  type ViewItem,
  type ViewModel,
} from '@restro/shell'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { type HashRoute, useHashRoute } from '../use-dish-route'
import { newActionId, type Outcome, runCommand } from './command'

/* ---------------------------------------------------------------------------------------------
 * Sheets
 * ------------------------------------------------------------------------------------------- */

/** The service sheets, by their address. */
export const SHEETS = ['bag', 'tab', 'call', 'pay'] as const

/** One service sheet. */
export type Sheet = (typeof SHEETS)[number]

function sheetOf(value: string | null): Sheet | null {
  return SHEETS.find((name) => name === value) ?? null
}

const SHEET_ROUTE: HashRoute = {
  parse: (hash) => sheetOf(hash.slice(1)),
  format: (id) => `#${id}`,
  stateKey: 'rmSheet',
  replaceWhenOpen: true,
}

/** Whether the view model lets the guest have this sheet (R15: a switched-off service has no page at all). */
export function sheetAllowed(features: ViewFeatures, sheet: Sheet): boolean {
  switch (sheet) {
    case 'bag':
      return features.ordering
    case 'tab':
      return features.bill
    case 'call':
      return features.callWaiter !== null
    case 'pay':
      return features.pay
  }
}

/** Whether the face draws anything of the services for this view model and binding. */
export function servicesShown(view: ViewModel, services: ServiceBinding | undefined): boolean {
  if (services === undefined) return false
  const { features } = view
  return features.callWaiter !== null || features.bill || features.ordering || features.pay
}

/** Whether the bar at the bottom of the page (the waiter and the bag) is drawn. */
export function serviceBarShown(view: ViewModel, services: ServiceBinding | undefined): boolean {
  return services !== undefined && (view.features.callWaiter !== null || view.features.ordering)
}

/* ---------------------------------------------------------------------------------------------
 * The table's order
 * ------------------------------------------------------------------------------------------- */

/** A command before its action id is made (one per kind, as the union says). */
export type CommandDraft = GuestCommand extends infer C
  ? C extends GuestCommand
    ? Omit<C, 'actionId'>
    : never
  : never

/** The duplicate check that is open: the sent order it names and how long ago it went. */
export interface DuplicateAsk {
  readonly of: string
  readonly minutes: number | null
}

/** The order as the face draws it: the host's lines with names and estimates from the view. */
export interface OrderDraw {
  /** The host's lines (empty before the host has an order, or while the phone has no pass). */
  readonly lines: readonly OrderLineView[]
  readonly removed: NonNullable<TableOrderView['removed']>
  readonly earlier: TableOrderView['earlier']
  /** The host has an order (its lines may be none); false while the phone has no pass. */
  readonly known: boolean
  /** The lines looked up in the view (key = the line's id) with the estimate. */
  readonly resolved: ResolvedBag
  /** Out of stock now: sold out on the menu, or named by the POS when it refused the last Send. */
  readonly soldOut: (itemId: string) => boolean
  /** A line a Send leaves out: held, still saving, pay-first, sold out or gone from the view. */
  readonly sendable: (entry: ResolvedBag['lines'][number]) => boolean
  /** How many things the next Send carries (the quantities of the sendable lines). */
  readonly sendCount: number
  /** Some on-the-bill line stays back (sold out), so the button says "Send the other N". */
  readonly keptBack: boolean
  /** How many things are on the order (the quantities of all its lines). */
  readonly count: number
}

/** What the screens get from the provider. */
export interface Services {
  readonly view: ViewModel
  readonly state: ServiceState
  /** The confirmed table's label ("12"), or null. */
  readonly tableLabel: string | null
  /** The host's binding: the form slot and the payment's controls (#114). */
  readonly binding: ServiceBinding
  readonly words: ServiceStrings
  readonly guest: GuestStrings
  readonly locale: Locale
  readonly features: ViewFeatures
  /** Sends a command; never throws. */
  readonly run: (command: GuestCommand) => Promise<Outcome>
  readonly items: ReadonlyMap<string, ViewItem>
  readonly order: OrderDraw
  /** Notes and options reach the POS's ticket (#78); otherwise the face draws no note field. */
  readonly notesAndOptions: boolean
  /** The last refusal's words, or null. */
  readonly notice: string | null
  readonly dismissNotice: () => void
  /** Puts an item on the table's order. */
  readonly add: (
    item: ViewItem,
    pick?: {
      readonly optionIds?: OrderLineView['optionIds']
      readonly qty?: number
      readonly note?: string
    },
  ) => Promise<CommandResult | null>
  readonly change: (lineId: string, delta: number) => Promise<CommandResult | null>
  readonly remove: (lineId: string) => Promise<CommandResult | null>
  readonly undo: (lineId: string) => Promise<CommandResult | null>
  readonly restore: (setAsideAt: number) => Promise<CommandResult | null>
  /** Ordering controls for this item: the service is on (R15) and the item has controls (R11). */
  readonly canOrder: (item: ViewItem) => boolean
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  /** A Send is with the host. */
  readonly sending: boolean
  /** The duplicate check, while it is open. */
  readonly asked: DuplicateAsk | null
  readonly cancelAsk: () => void
  /** Sends the order's sendable lines; `confirmDuplicateOf` is the sent order "Send another" names. */
  readonly sendOrder: (confirmDuplicateOf?: string) => Promise<void>
  /** The last Send's answer was lost: the host's word, or this face's until the host's state says it (D120). */
  readonly sendLost: { readonly ref: string | null } | null
  readonly sentOrders: readonly SentOrderView[]
  /** The sheet that is drawn (it stays drawn while it slides out), or null. */
  readonly sheet: Sheet | null
  readonly leaving: boolean
  readonly openSheet: (sheet: Sheet, opener?: HTMLElement | null) => void
  readonly closeSheet: () => void
}

const ServicesContext = createContext<Services | null>(null)

/** The services of the face, or null when there are none to draw (not bound). */
export function useServices(): Services | null {
  return useContext(ServicesContext)
}

/** The services, for a component that is only ever drawn inside the provider. */
export function useServicesRequired(): Services {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('a service screen was drawn without services')
  return services
}

/** Whether the bag's place in the bar has something to open: the order, a sent order, or why it is hidden. */
export function orderBusy(
  o: Pick<Services, 'order' | 'sentOrders' | 'state' | 'sendLost'>,
): boolean {
  return (
    o.order.lines.length > 0 ||
    o.order.removed.length > 0 ||
    o.order.earlier !== null ||
    o.sentOrders.length > 0 ||
    o.sendLost !== null ||
    o.state.location?.state === 'needed'
  )
}

/* ---------------------------------------------------------------------------------------------
 * The provider
 * ------------------------------------------------------------------------------------------- */

export function ServicesProvider({
  view,
  services,
  tableLabel,
  openDish,
  children,
}: {
  readonly view: ViewModel
  /** The confirmed table's label, or null. */
  readonly tableLabel: string | null
  /** The host's binding, or undefined: the face then draws no service at all. */
  readonly services: ServiceBinding | undefined
  /** Opens the dish page (the element that asked gets the focus back). */
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  readonly children: ReactNode
}) {
  if (!servicesShown(view, services) || services === undefined) return <>{children}</>
  return (
    <ActiveServices view={view} services={services} tableLabel={tableLabel} openDish={openDish}>
      {children}
    </ActiveServices>
  )
}

const LOST_WITHOUT_REF = { ref: null }
const NO_LINES: readonly OrderLineView[] = []
const NO_SENT: readonly SentOrderView[] = []
const NO_REMOVED: NonNullable<TableOrderView['removed']> = []

function ActiveServices({
  view,
  services,
  tableLabel,
  openDish,
  children,
}: {
  readonly view: ViewModel
  readonly tableLabel: string | null
  readonly services: ServiceBinding
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  readonly children: ReactNode
}) {
  const { state } = services
  const { features } = view
  const strings = stringsFor(view.locale)
  const words = strings.services
  const route = useHashRoute(SHEET_ROUTE)

  // The latest of everything an async handler reads when it finishes.
  const latest = useRef({ services, view, features, sheet: null as Sheet | null })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const shown = sheetOf(route.shownId)
  const sheet = shown !== null && sheetAllowed(features, shown) ? shown : null
  latest.current = { services, view, features, sheet }

  // The screen the face has open, for the host's polls (RR-52, D121): the bag asks every 2 seconds,
  // the bill (and paying from it) reads the bill fresh, anything else is the menu.
  const setScreen = services.setScreen
  const screen = sheet === 'bag' ? 'bag' : sheet === 'tab' || sheet === 'pay' ? 'bill' : 'menu'
  useEffect(() => setScreen?.(screen), [setScreen, screen])

  const run = useCallback(
    (command: GuestCommand) => runCommand((c) => latest.current.services.dispatch(c), command),
    [],
  )

  const { open: openRoute, close: closeSheet } = route
  const openSheet = useCallback(
    (name: Sheet, opener: HTMLElement | null = null) => openRoute(name, opener),
    [openRoute],
  )

  /* --- the order, as the host has it ---------------------------------------------------- */
  const items = useMemo(() => itemsById(view), [view])
  const refused = useMemo(() => refusedOutOfStock(state.sentOrders), [state.sentOrders])
  const order = useMemo<OrderDraw>(() => {
    const lines = state.order?.lines ?? NO_LINES
    const bag: readonly BagLine[] = lines.map((line) => ({
      key: line.id,
      itemId: line.itemId,
      qty: line.qty,
      optionIds: line.optionIds,
      note: line.note,
    }))
    const resolved = resolveBag(view, bag)
    const soldOut = (itemId: string) => isOutOfStock(itemId, items.get(itemId), refused)
    const sendable = (entry: ResolvedBag['lines'][number]) => {
      const line = lines.find((candidate) => candidate.id === entry.line.key)
      return (
        line !== undefined &&
        line.mode === 'on_bill' &&
        !line.held &&
        !line.pending &&
        entry.available &&
        !soldOut(line.itemId)
      )
    }
    // A line the next Send takes is on the bill and free; the ones that stay back are held, saving,
    // pay-first (ordered from the waiter) or out of stock. Only the last kind changes the button.
    const live = resolved.lines.filter((entry) => {
      const line = lines.find((candidate) => candidate.id === entry.line.key)
      return line !== undefined && line.mode === 'on_bill' && !line.held && !line.pending
    })
    const taking = live.filter(sendable)
    return {
      lines,
      removed: state.order?.removed ?? NO_REMOVED,
      earlier: state.order?.earlier ?? null,
      known: state.order != null,
      resolved,
      soldOut,
      sendable,
      sendCount: taking.reduce((sum, entry) => sum + entry.line.qty, 0),
      keptBack: live.length > taking.length,
      count: resolved.count,
    }
  }, [state.order, view, items, refused])

  /* --- commands on the order ------------------------------------------------------------ */
  const [notice, setNotice] = useState<string | null>(null)
  const dismissNotice = useCallback(() => setNotice(null), [])
  // The last Send's answer was lost, before the host's state says so (it draws the line from then).
  // It is no notice: the line is `state.sendLost`'s, and this only bridges the moment before it.
  const [answerLost, setAnswerLost] = useState(false)
  const hostLost = state.sendLost != null
  const hostSaid = useRef(false)
  useEffect(() => {
    if (hostLost) hostSaid.current = true
    else if (hostSaid.current) {
      hostSaid.current = false
      setAnswerLost(false)
    }
  }, [hostLost])
  // A host that never says it still lets the guest send again after the hold (D120).
  useEffect(() => {
    if (!answerLost) return
    const timer = setTimeout(() => setAnswerLost(false), LOST_SEND_HOLD_MS)
    return () => clearTimeout(timer)
  }, [answerLost])
  const sendLost = state.sendLost ?? (answerLost ? LOST_WITHOUT_REF : null)

  const [sending, setSending] = useState(false)
  const sendingNow = useRef(false)
  const [asked, setAsked] = useState<DuplicateAsk | null>(null)
  // The duplicate check closes itself (D117).
  useEffect(() => {
    if (asked === null) return
    const timer = setTimeout(() => setAsked(null), DUPLICATE_ASK_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [asked])
  const cancelAsk = useCallback(() => setAsked(null), [])

  /** Sends one order command; a refusal is worded here (the location panel answers its own codes). */
  const act = useCallback(
    async (draft: CommandDraft): Promise<CommandResult | null> => {
      setNotice(null)
      const command = { ...draft, actionId: newActionId() } as GuestCommand
      const isSend = command.kind === 'order.send'
      if (isSend) setAnswerLost(false)
      const outcome = await run(command)
      if (!alive.current) return null
      if (!outcome.ok) {
        // A Send with no usable answer: the order may already be in the POS, so D120's line speaks
        // and the guest is never offered "Try again".
        if (isSend) setAnswerLost(true)
        else setNotice(words.refusedOther)
        return null
      }
      const { result } = outcome
      if (isSend && result.status === 'pending' && result.code === ANSWER_LOST_CODE) {
        setAnswerLost(true)
        return result
      }
      if (result.status === 'rejected') {
        const code = result.code ?? null
        // The location sheet answers these itself (the consent screen, the failed check), and the
        // order sheet the duplicate check.
        if (
          code === 'location_needed' ||
          code === 'location_failed' ||
          code === 'duplicate_order'
        ) {
          return result
        }
        const named =
          code === 'item_unavailable' && result.subjectId != null
            ? items.get(result.subjectId)?.name.text
            : undefined
        setNotice(
          named !== undefined
            ? words.itemUnavailableNamed(named)
            : refusalText(words, code, { command: command.kind }),
        )
      }
      return result
    },
    [run, words, items],
  )

  const add = useCallback<Services['add']>(
    (item, pick = {}) =>
      act({
        kind: 'order.add',
        itemId: item.id,
        optionIds: [...(pick.optionIds ?? [])],
        qty: pick.qty ?? 1,
        note: pick.note ?? '',
      }),
    [act],
  )
  const change = useCallback(
    (lineId: string, delta: number) => act({ kind: 'order.change', lineId, delta }),
    [act],
  )
  const remove = useCallback((lineId: string) => act({ kind: 'order.remove', lineId }), [act])
  const undo = useCallback((lineId: string) => act({ kind: 'order.undo', lineId }), [act])
  const restore = useCallback(
    (setAsideAt: number) => act({ kind: 'order.restore', setAsideAt }),
    [act],
  )

  const sendOrder = useCallback(
    async (confirmDuplicateOf?: string) => {
      if (sendingNow.current) return // two quick taps are one send
      const taking = order.resolved.lines.filter(order.sendable)
      if (taking.length === 0) return
      // Send is blocked while the phone is offline, never queued (D121); the sheet greys the button.
      if (latest.current.services.state.offline === true) return
      sendingNow.current = true
      setAsked(null)
      setSending(true)
      try {
        const result = await act({
          kind: 'order.send',
          lines: taking.map((entry) => ({
            itemId: entry.line.itemId,
            optionIds: [...entry.line.optionIds],
            qty: entry.line.qty,
            note: entry.line.note,
          })),
          ...(confirmDuplicateOf === undefined ? {} : { confirmDuplicateOf }),
        })
        if (result?.code === 'duplicate_order' && result.subjectId != null && alive.current) {
          setAsked({
            of: result.subjectId,
            minutes: minutesSinceSent(
              latest.current.services.state.sentOrders ?? [],
              result.subjectId,
              Date.now(),
            ),
          })
        }
      } finally {
        sendingNow.current = false
        if (alive.current) setSending(false)
      }
    },
    [act, order],
  )

  // Escape closes the sheet, unless the location sheet is over it: that one is the top and takes the key.
  const locationUp =
    services?.location !== undefined && state.location != null && state.location.prompt !== 'none'
  useEffect(() => {
    if (sheet === null || locationUp) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, closeSheet, locationUp])

  const canOrder = useCallback(
    (item: ViewItem) => features.ordering && item.order.controls,
    [features.ordering],
  )

  const value = useMemo<Services>(
    () => ({
      view,
      state,
      tableLabel,
      binding: services,
      words,
      guest: strings.guest,
      locale: view.locale,
      features,
      run,
      items,
      order,
      notesAndOptions: state.ordering?.notesAndOptions === true,
      notice,
      dismissNotice,
      add,
      change,
      remove,
      undo,
      restore,
      canOrder,
      openDish,
      sending,
      asked,
      cancelAsk,
      sendOrder,
      sendLost,
      sentOrders: state.sentOrders ?? NO_SENT,
      sheet,
      leaving: route.leaving,
      openSheet,
      closeSheet,
    }),
    [
      view,
      state,
      tableLabel,
      services,
      words,
      strings,
      features,
      run,
      items,
      order,
      notice,
      dismissNotice,
      add,
      change,
      remove,
      undo,
      restore,
      canOrder,
      openDish,
      sending,
      asked,
      cancelAsk,
      sendOrder,
      sendLost,
      sheet,
      route.leaving,
      openSheet,
      closeSheet,
    ],
  )

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
