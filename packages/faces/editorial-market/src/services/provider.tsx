// The services layer of the face: the guest's bag, the service sheets that live in the address
// (`#bag`, `#tab`, `#call`, `#pay`) and the way a command goes to the host. It is a
// provider around the whole face, so a quick-add button in a card, the buttons in the header, the
// bar at the bottom and the sheets all share one bag.
//
// The face never succeeds on its own (D72). The bag is a draft the guest keeps until the host says
// "accepted"; a bill is only what `state.bill` holds; a waiter is "on the way" only when a request
// of the host's says so; a payment is "paid" only after the host accepted it and issued a receipt.
// Without `services`, or for a service the view model has switched off (R15), nothing here draws.

import {
  ANSWER_LOST_CODE,
  type BagAction,
  type BagLine,
  bagReducer,
  type GuestCommand,
  type GuestStrings,
  type Locale,
  OFFLINE_CODE,
  orderLines,
  type ResolvedBag,
  resolveBag,
  type ServiceBinding,
  type ServiceState,
  type ServiceStrings,
  stringsFor,
  type ViewFeatures,
  type ViewItem,
  type ViewModel,
  type ViewText,
} from '@restro/shell'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import { type HashRoute, useHashRoute } from '../use-dish-route'
import {
  LOST_SEND_HOLD_MS,
  newActionId,
  type Outcome,
  runCommand,
  SERVICE_TIMEOUT_MS,
} from './command'

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
 * Sending the bag
 * ------------------------------------------------------------------------------------------- */

/** Where sending the bag stands. */
export type SendState =
  /** Nothing is being sent. */
  | { readonly status: 'idle' }
  /** Waiting for the host. `received`: the host has the order and has not said yes or no. */
  | { readonly status: 'pending'; readonly received: boolean }
  /**
   * No usable answer (an error, a timeout, a lost answer): the order may already be in the POS, so
   * the sheet says D120's line (call a waiter) and offers no re-send until the hold is over, the
   * bag changes or the host's bill shows the order. Never "Try again".
   */
  | { readonly status: 'failed' }
  /** The host said no. The bag is kept. */
  | { readonly status: 'rejected'; readonly message: ViewText | null; readonly ref: string | null }
  /** The host said yes and the venue shows no bill to open: tell the guest so. */
  | { readonly status: 'sent'; readonly ref: string | null }

const IDLE: SendState = { status: 'idle' }

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
  readonly bag: readonly BagLine[]
  readonly resolved: ResolvedBag
  readonly editBag: (action: BagAction) => void
  /** Ordering controls for this item: the service is on (R15) and the item has controls (R11). */
  readonly canOrder: (item: ViewItem) => boolean
  /** The bag line being edited on the dish page, or null. */
  readonly editing: BagLine | null
  readonly edit: (line: BagLine, opener: HTMLElement) => void
  readonly stopEditing: () => void
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  readonly send: SendState
  readonly sendBag: () => void
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

/* ---------------------------------------------------------------------------------------------
 * The provider
 * ------------------------------------------------------------------------------------------- */

export function ServicesProvider({
  view,
  services,
  tableLabel,
  openDish,
  dishOpen,
  children,
}: {
  readonly view: ViewModel
  /** The confirmed table's label, or null. */
  readonly tableLabel: string | null
  /** The host's binding, or undefined: the face then draws no service at all. */
  readonly services: ServiceBinding | undefined
  /** Opens the dish page (the element that asked gets the focus back). */
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  /** The dish page is open. */
  readonly dishOpen: boolean
  readonly children: ReactNode
}) {
  if (!servicesShown(view, services) || services === undefined) return <>{children}</>
  return (
    <ActiveServices
      view={view}
      services={services}
      tableLabel={tableLabel}
      openDish={openDish}
      dishOpen={dishOpen}
    >
      {children}
    </ActiveServices>
  )
}

function ActiveServices({
  view,
  services,
  tableLabel,
  openDish,
  dishOpen,
  children,
}: {
  readonly view: ViewModel
  readonly tableLabel: string | null
  readonly services: ServiceBinding
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  readonly dishOpen: boolean
  readonly children: ReactNode
}) {
  const { state } = services
  const { features } = view
  const strings = stringsFor(view.locale)

  const [bag, editBag] = useReducer(bagReducer, [])
  const resolved = useMemo(() => resolveBag(view, bag), [view, bag])
  const [editing, setEditing] = useState<BagLine | null>(null)
  const [send, setSend] = useState<SendState>(IDLE)
  const route = useHashRoute(SHEET_ROUTE)

  // The latest of everything an async handler reads when it finishes.
  const latest = useRef({ services, view, bag, features, sheet: null as Sheet | null })
  const alive = useRef(true)
  // The send in hand: the bag it was made from, the action it is, and the lines it carried.
  const attempt = useRef<{
    readonly fingerprint: string
    readonly actionId: string
    readonly sent: readonly BagLine[]
  } | null>(null)
  const sending = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const shown = sheetOf(route.shownId)
  const sheet = shown !== null && sheetAllowed(features, shown) ? shown : null
  latest.current = { services, view, bag, features, sheet }

  // The screen the face has open, for the host's polls (RR-52, D121): the bag asks every 2 seconds,
  // the bill (and paying from it) reads the bill fresh, anything else is the menu.
  const setScreen = services.setScreen
  const screen = sheet === 'bag' ? 'bag' : sheet === 'tab' || sheet === 'pay' ? 'bill' : 'menu'
  useEffect(() => setScreen?.(screen), [setScreen, screen])

  const run = useCallback(
    (command: GuestCommand) => runCommand((c) => latest.current.services.dispatch(c), command),
    [],
  )

  const { open: openRoute, close: closeSheet, hide: hideSheet } = route
  const openSheet = useCallback(
    (name: Sheet, opener: HTMLElement | null = null) => openRoute(name, opener),
    [openRoute],
  )

  /**
   * The host accepted the order (or its bill shows it): the lines it carried leave the bag (what the
   * guest added meanwhile stays), and the bill opens.
   */
  const accepted = useCallback(
    (sent: readonly BagLine[], ref: string | null) => {
      attempt.current = null
      editBag({ type: 'spend', lines: sent })
      const { features: now, sheet: open } = latest.current
      if (now.bill) {
        setSend(IDLE)
        // Only if the guest is still on the bag: a bill that jumps up over the menu later would be a surprise.
        if (open === 'bag') openRoute('tab', null)
      } else {
        setSend({ status: 'sent', ref })
      }
    },
    [openRoute],
  )

  const sendBag = useCallback(async () => {
    if (sending.current) return // two quick taps are one send
    const { view: nowView, bag: nowBag } = latest.current
    if (!resolveBag(nowView, nowBag).canSend) return
    const lines = orderLines(nowBag)
    const fingerprint = JSON.stringify(lines)
    // The same bag again is the same action; a changed bag is a new one.
    const actionId =
      attempt.current?.fingerprint === fingerprint ? attempt.current.actionId : newActionId()
    attempt.current = { fingerprint, actionId, sent: nowBag }
    // Send is blocked while the phone is offline, never queued (D121); the sheet greys the button.
    if (latest.current.services.state.offline === true) return
    sending.current = true
    setSend({ status: 'pending', received: false })
    let outcome: Outcome
    try {
      outcome = await run({ kind: 'order.send', actionId, lines })
    } finally {
      sending.current = false
    }
    // The guest changed the bag meanwhile, or left: this answer is about another bag.
    if (!alive.current || attempt.current?.actionId !== actionId) return
    if (!outcome.ok) {
      setSend({ status: 'failed' })
      return
    }
    const { result } = outcome
    if (result.status === 'pending' && result.code === ANSWER_LOST_CODE) {
      // The host's own client says the answer was lost (or the Send was not made: see its state).
      setSend({ status: 'failed' })
      return
    }
    if (result.status === 'rejected' && result.code === OFFLINE_CODE) {
      // The host did not make the Send (offline): nothing was sent, the weak-connection line speaks.
      attempt.current = null
      setSend(IDLE)
      return
    }
    if (result.status === 'accepted') {
      accepted(nowBag, result.ref)
    } else if (result.status === 'rejected') {
      attempt.current = null // a definite no: whatever is sent next is a new action
      setSend({ status: 'rejected', message: result.message, ref: result.ref })
    } else {
      setSend({ status: 'pending', received: true })
    }
  }, [run, accepted])

  // The host has the order but has not decided: after a while the guest may try again (same `actionId`).
  useEffect(() => {
    if (send.status !== 'pending' || !send.received) return
    const timer = window.setTimeout(
      () =>
        setSend((now) => (now.status === 'pending' && now.received ? { status: 'failed' } : now)),
      SERVICE_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [send])

  // A lost Send holds the bag for a few minutes (D120), then the guest may send again.
  useEffect(() => {
    if (send.status !== 'failed') return
    const timer = window.setTimeout(
      () => setSend((now) => (now.status === 'failed' ? IDLE : now)),
      LOST_SEND_HOLD_MS,
    )
    return () => window.clearTimeout(timer)
  }, [send])

  // The host's own bill shows the order (matched by its `actionId`): that is an acceptance as good
  // as the answer, and it settles a send whose answer never came.
  useEffect(() => {
    const current = attempt.current
    if (current === null || (send.status !== 'pending' && send.status !== 'failed')) return
    if (state.bill?.rounds.some((round) => round.actionId === current.actionId) === true) {
      accepted(current.sent, null)
    }
  }, [state.bill, send.status, accepted])

  // A message about a bag that has since changed is stale.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the bag changes; it does not read it
  useEffect(() => {
    setSend((now) => (now.status === 'rejected' || now.status === 'failed' ? IDLE : now))
  }, [bag])

  // "Sent to the kitchen" is for the guest who is looking at the bag when the host says yes; it is
  // gone once they leave the bag or start another one.
  useEffect(() => {
    if (send.status === 'sent' && (bag.length > 0 || sheet !== 'bag')) setSend(IDLE)
  }, [send, bag, sheet])

  const edit = useCallback(
    (line: BagLine, opener: HTMLElement) => {
      setEditing(line)
      hideSheet() // the dish page opens over the bag; going back to the bag's address brings it back
      openDish(line.itemId, opener)
    },
    [hideSheet, openDish],
  )
  const stopEditing = useCallback(() => setEditing(null), [])
  // An edit that was abandoned (the dish page closed) must not come back the next time the dish opens.
  useEffect(() => {
    if (!dishOpen) setEditing(null)
  }, [dishOpen])

  // Escape closes the sheet.
  useEffect(() => {
    if (sheet === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, closeSheet])

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
      words: strings.services,
      guest: strings.guest,
      locale: view.locale,
      features,
      run,
      bag,
      resolved,
      editBag,
      canOrder,
      editing,
      edit,
      stopEditing,
      openDish,
      send,
      sendBag,
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
      strings,
      features,
      run,
      bag,
      resolved,
      canOrder,
      editing,
      edit,
      stopEditing,
      openDish,
      send,
      sendBag,
      sheet,
      route.leaving,
      openSheet,
      closeSheet,
    ],
  )

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}
