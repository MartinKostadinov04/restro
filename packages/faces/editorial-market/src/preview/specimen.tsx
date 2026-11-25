// The specimen view (D130, D159): ONE part of the Editorial Market page, drawn with the face's own
// components and CSS and nothing around it, for a tile of the Design panel. The header alone, the
// section rail, a section title with a dish row, a few dish rows or cards, a dish open, a strip, a
// sheet's body, the bill lines, the tip row, the top of the receipt, the order bar: never the whole
// menu. It takes the same view model and design values the face takes (`FaceHostProps`), so a value
// swapped into the design shows here exactly as on a guest's phone.
//
// Admin only: it is exported through `@restro/editorial-market/preview`, which a guest page never
// imports (a dependency rule forbids it). It is a picture: nothing in it takes the focus or a pointer
// (`inert`, no pointer events, every click stopped before a handler or a link sees it), a dialog in
// it moves no focus and locks no scroll (`StillOverlay`), sticky parts are drawn in place, and
// nothing moves (no animation).
//
// Sizes. A part is laid out at the frame's width and its height follows its content: `onHeight` is
// told the height each time it changes, so the frame can be as tall as the part, and 0 when the part
// drew nothing. The parts that are a whole screen (a dish open over the menu, a sheet open) fill the
// frame's height instead, and tell `SPECIMEN_PHONE_HEIGHT` once drawn (`SPECIMEN_FIXED_PARTS`).
//
// Services. The parts with a service control (the header's Bill and Pay, an Add control, the order
// bar) draw the services with a still binding of their own (no host, no timers); the parts that are a sheet's body (the call, the bill, the bag, the
// tip, the receipt) need the demo host's state, which the frame binds (`specimenNeedsHost`).

import {
  choosePay,
  confirmationOf,
  type FaceHostProps,
  type GuestCommand,
  NO_TIP,
  type OrderLineView,
  type PaymentView,
  paySignedMoney,
  pickWhole,
  type ServiceBinding,
  type ServiceState,
  stringsFor,
  type TableBillView,
  type TipChoice,
  type ViewItem,
  type ViewModel,
  type ViewSection,
} from '@restro/shell'
import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { CategoryRail } from '../category-rail'
import { EDITORIAL_CSS } from '../css'
import { DishPage } from '../detail'
import { AllergenFooter } from '../footer'
import { Header } from '../header'
import { LayoutSwitch } from '../layout-switch'
import {
  allItems,
  bcp47,
  designAttributes,
  designVariables,
  isStrip,
  type Layout,
  NO_FILTERS,
  themeVariables,
} from '../model'
import { Overlay, StillOverlay } from '../overlay'
import type { PageContext } from '../parts'
import { SectionBlock } from '../section'
import { ServiceBar } from '../services/bag-bar'
import { BagSheet } from '../services/bag-sheet'
import { BillSheet } from '../services/bill-sheet'
import { CallSheet } from '../services/call-sheet'
import { HeaderTools } from '../services/header-tools'
import { PreviewMarker } from '../services/parts'
import { Confirmation } from '../services/pay-sheet'
import { ServicesProvider, useServicesRequired } from '../services/provider'
import { SERVICES_CSS } from '../services/services-css'
import { TipRow } from '../services/tip-row'

/** Every part the specimen view draws. */
export const SPECIMEN_PARTS = [
  /** The header alone: the logo, the venue's title, its tools (the Bill and Pay pills too). */
  'header',
  /** The section rail alone, four sections, the first marked. */
  'rail',
  /** The header and the rail under it. */
  'header-rail',
  /** One section title with the first dish row under it. */
  'section',
  /** One section title and two dish rows. */
  'section-two',
  /** The layout switch (when the menu lets guests switch) above a section title and two dishes. */
  'switch',
  /** One dish row. */
  'dish-row',
  /** Three dish rows. */
  'dish-rows',
  /** Two dishes. */
  'two-dishes',
  /** Four dishes (two columns need four). */
  'four-dishes',
  /** One dish row with a long description. */
  'dish-long',
  /** One dish with its allergens, and the footer that explains them. */
  'dish-allergens',
  /** One dish as a card, with its photo and its Add button. */
  'dish-card',
  /** One dish row with its Add control. */
  'dish-add',
  /** One strip of section cards. */
  'strip',
  /** A dish, open over two dish rows: a sheet, or its own page. */
  'dish-open',
  /** The foot of the screen with the order bar, over two dish rows. */
  'order-bar',
  /** The Call a waiter sheet, open over two dish rows. */
  'call-sheet',
  /** The Call a waiter sheet's kinds. */
  'call-kinds',
  /** The foot of the Call a waiter sheet with its main button. */
  'call-foot',
  /** The bill's lines and its total. */
  'bill-lines',
  /** Two lines of the open bag. */
  'bag-lines',
  /** The tip choice. */
  'tip',
  /** The receipt's top: the venue and when. */
  'receipt-top',
] as const

export type SpecimenPart = (typeof SPECIMEN_PARTS)[number]

/** The parts that are a whole screen: they fill the frame's height rather than setting it. */
export const SPECIMEN_FIXED_PARTS: ReadonlySet<SpecimenPart> = new Set(['dish-open', 'call-sheet'])

/** How tall a whole-screen part is drawn, at the 320 px a tile lays out at: a small phone. */
export const SPECIMEN_PHONE_HEIGHT = 560

/** The parts that are a sheet's body: they read the demo host's state (the bill, the call). */
const HOSTED: ReadonlySet<SpecimenPart> = new Set([
  'call-sheet',
  'call-kinds',
  'call-foot',
  'bill-lines',
  'bag-lines',
  'tip',
  'receipt-top',
])

/** The parts that draw a service control: the view model must have the guest services on. */
const SERVED: ReadonlySet<SpecimenPart> = new Set([
  ...HOSTED,
  'header',
  'header-rail',
  'dish-card',
  'dish-add',
  'order-bar',
])

/** Whether the frame must bind the demo host (`useDemoServices`) for this part: only a sheet's body. */
export function specimenNeedsHost(part: SpecimenPart): boolean {
  return HOSTED.has(part)
}

/** Whether this part draws a service control, so its view model needs the guest services on. */
export function specimenNeedsServices(part: SpecimenPart): boolean {
  return SERVED.has(part)
}

/** How many dishes each dish part draws. */
const DISHES: Partial<Record<SpecimenPart, number>> = {
  section: 1,
  'section-two': 2,
  switch: 2,
  'dish-row': 1,
  // More than the tile shows: Density's tiles are a window of one height, so a tighter value shows more.
  'dish-rows': 6,
  'two-dishes': 2,
  'four-dishes': 4,
  'dish-long': 1,
  'dish-allergens': 1,
  'dish-card': 1,
  'dish-add': 1,
  'dish-open': 2,
  'order-bar': 2,
  'call-sheet': 2,
}

/** The parts drawn without the section's title above their dishes. */
const HEADLESS: ReadonlySet<SpecimenPart> = new Set([
  'dish-row',
  'dish-rows',
  'two-dishes',
  'four-dishes',
  'dish-long',
  'dish-allergens',
  'dish-card',
  'dish-add',
  'strip',
  'dish-open',
  'order-bar',
  'call-sheet',
])

/**
 * The preview's own rules, after the face's: the part sets its own height, sticky parts are drawn in
 * place, nothing moves, and the space a whole page keeps around a section or the footer is trimmed.
 */
const SPECIMEN_CSS = `
.rm[data-specimen] {
  position: relative;
  display: flow-root;
}
.rm[data-specimen]:not([data-specimen-fixed]) {
  min-height: 0;
}
.rm[data-specimen],
.rm[data-specimen] * {
  pointer-events: none !important;
}
.rm[data-specimen] *,
.rm[data-specimen] *::before,
.rm[data-specimen] *::after {
  animation: none !important;
  transition: none !important;
}
.rm[data-specimen] .rm-sections,
.rm[data-specimen] .rm-overlay-panel:not(.is-detail) > .rm-overlay-head {
  position: static;
}
.rm[data-specimen] .ro-bagbar {
  position: absolute;
}
.rm[data-specimen] .rm-section {
  padding-top: calc(14px * var(--rm-space));
  padding-bottom: calc(14px * var(--rm-space));
}
.rm[data-specimen-headless] .rm-section-head {
  display: none;
}
.rm[data-specimen] .rm-footer {
  margin-top: 0;
}
.rm[data-specimen] [data-specimen-panel] {
  max-height: none;
  overflow: visible;
  padding-top: 4px;
  padding-bottom: 4px;
  border-radius: 0;
  box-shadow: none;
}
`

/** What the specimen view takes: what the face takes, the part, and where to report its height. */
export type EditorialSpecimenProps = FaceHostProps & {
  readonly part: SpecimenPart
  /** Told the part's height in CSS pixels whenever it changes (not for a whole-screen part). */
  readonly onHeight?: (height: number) => void
}

const nothing = () => undefined

/** The answer to a command from a still part: nothing happens (a picture is not used). */
async function refuse(command: GuestCommand) {
  return { actionId: command.actionId, status: 'rejected' as const, message: null, ref: null }
}

/** The state of the still binding: ordering on, nothing on the table yet. */
const STILL_STATE: ServiceState = {
  revision: 1,
  preview: true,
  bill: null,
  requests: [],
  order: { lines: [], removed: [], earlier: null },
  sentOrders: [],
  ordering: { state: 'on', tips: true, notesAndOptions: true },
}

/** An order line for a dish, as the table's order holds it. */
function lineOf(item: ViewItem, index: number): OrderLineView {
  return {
    id: `specimen-line-${index + 1}`,
    itemId: item.id,
    optionIds: [],
    qty: 1,
    note: '',
    mode: 'on_bill',
    held: false,
    pending: false,
  }
}

/** The lines on the table's order for a part: one for the order bar, two for the bag. */
const ORDER_LINES: Partial<Record<SpecimenPart, number>> = { 'order-bar': 1, 'bag-lines': 2 }

/** The binding a part draws with: the frame's host, or the still one, with the part's order lines. */
function bindingOf(
  part: SpecimenPart,
  given: ServiceBinding | undefined,
  dishes: readonly ViewItem[],
): ServiceBinding | undefined {
  if (!SERVED.has(part)) return undefined
  const binding = given ?? { state: STILL_STATE, dispatch: refuse }
  const lines = dishes.slice(0, ORDER_LINES[part] ?? 0).map(lineOf)
  return { ...binding, state: { ...binding.state, order: { lines, removed: [], earlier: null } } }
}

/**
 * The first section, holding just these dishes and no sub-section; a strip keeps its own cards. Any
 * other part draws the dishes as the usual list, even where the venue's first section is a strip:
 * a strip's cards keep their own spacing, frame and size, so Density, Frame or Layout would show
 * nothing.
 */
function sectionOf(
  view: ViewModel,
  dishes: readonly ViewItem[],
  strip: boolean,
): ViewSection | null {
  const first = (strip ? view.sections.find(isStrip) : undefined) ?? view.sections[0]
  if (first === undefined) return null
  if (!strip)
    return { ...first, items: dishes, sections: [], hints: { ...first.hints, layout: 'vertical' } }
  const cards = allItems([first]).slice(0, 3)
  return {
    ...first,
    items: cards.length > 0 ? cards : dishes,
    sections: [],
    hints: { ...first.hints, layout: 'horizontal' },
  }
}

/**
 * The view a part draws: a card's tile always draws the dish as a card; the call's foot is drawn with
 * the waiter as its only kind, so its button stands ready as it does once a kind is chosen, with
 * nothing pressed.
 */
function partView(view: ViewModel, part: SpecimenPart): ViewModel {
  if (part === 'dish-card') {
    return { ...view, design: { ...view.design, items: { ...view.design.items, frame: 'cards' } } }
  }
  const call = view.features.callWaiter
  if (part === 'call-foot' && call !== null) {
    return { ...view, features: { ...view.features, callWaiter: { ...call, kinds: ['waiter'] } } }
  }
  return view
}

/** A click in a picture does nothing: no handler, no link (the rail's `#section` addresses). */
function stopClick(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/** The Editorial Market page cut down to one part. */
export function EditorialSpecimen(props: EditorialSpecimenProps) {
  const {
    part,
    assetBase = '/cdn',
    languages = [],
    tableLabel = null,
    fontStacks,
    scheme = 'auto',
    services,
    onHeight,
  } = props
  const view = useMemo(() => partView(props.view, part), [props.view, part])
  const locale = view.locale
  const strings = stringsFor(locale).guest
  const layout: Layout = view.layout.default
  const allergenNames = view.design.labels?.allergens === 'names'
  const ctx = useMemo<PageContext>(
    () => ({
      locale,
      strings,
      assetBase,
      layout,
      bleedPhotos: view.design.photos?.frame !== 'inset',
      allergenNames,
      isVisible: () => true,
      openDish: nothing,
      openAllergens: nothing,
    }),
    [locale, strings, assetBase, layout, view.design, allergenNames],
  )
  // The menu's first dishes in reading order, whatever their sections: the same dish leads every
  // tile of a page.
  const dishes = useMemo(
    () => allItems(view.sections).slice(0, DISHES[part] ?? 2),
    [view.sections, part],
  )
  const binding = useMemo(() => bindingOf(part, services, dishes), [part, services, dishes])

  const fixed = SPECIMEN_FIXED_PARTS.has(part)
  const root = useRef<HTMLDivElement>(null)
  const told = useRef(onHeight)
  told.current = onHeight
  useLayoutEffect(() => {
    const element = root.current
    if (element === null) return undefined
    if (fixed) {
      told.current?.(SPECIMEN_PHONE_HEIGHT)
      return undefined
    }
    let last = -1
    const measure = () => {
      const height = Math.max(0, Math.ceil(element.getBoundingClientRect().height))
      if (height === last) return
      last = height
      told.current?.(height)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [fixed])

  const css = `${binding === undefined ? EDITORIAL_CSS : EDITORIAL_CSS + SERVICES_CSS}${SPECIMEN_CSS}`
  return (
    <div
      ref={root}
      className="rm"
      inert
      onClickCapture={stopClick}
      // A part that moves the focus on opening (the receipt's title) gives it straight back: an inert
      // root already refuses it in a browser; this holds wherever inert is not drawn.
      onFocusCapture={(event) => {
        if (event.target instanceof HTMLElement) event.target.blur()
      }}
      data-face="editorial-market"
      data-specimen={part}
      data-specimen-fixed={fixed ? '' : undefined}
      data-specimen-headless={HEADLESS.has(part) ? '' : undefined}
      data-layout={layout}
      data-scheme={scheme}
      data-services={part === 'order-bar' ? 'bar' : undefined}
      {...designAttributes(view.design)}
      lang={bcp47(locale)}
      style={
        {
          ...themeVariables(view.theme, fontStacks),
          ...designVariables(view.design, fontStacks),
        } as CSSProperties
      }
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: constant stylesheets of the face and this file, no user input */}
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <StillOverlay.Provider value>
        <ServicesProvider
          view={view}
          assetBase={assetBase}
          services={binding}
          tableLabel={tableLabel}
          openDish={nothing}
        >
          <Part
            part={part}
            view={view}
            ctx={ctx}
            dishes={dishes}
            languages={languages}
            tableLabel={tableLabel}
          />
        </ServicesProvider>
      </StillOverlay.Provider>
    </div>
  )
}

function Part({
  part,
  view,
  ctx,
  dishes,
  languages,
  tableLabel,
}: {
  readonly part: SpecimenPart
  readonly view: ViewModel
  readonly ctx: PageContext
  readonly dishes: readonly ViewItem[]
  readonly languages: NonNullable<FaceHostProps['languages']>
  readonly tableLabel: string | null
}) {
  const { strings, locale } = ctx
  const header = (
    <Header
      view={view}
      ctx={ctx}
      tableLabel={tableLabel}
      languages={languages}
      onLanguageChange={undefined}
      hasFilters={
        view.features.filters && (view.filters.dietary.length > 0 || view.filters.tags.length > 0)
      }
      onOpenFilters={nothing}
      tools={<HeaderTools />}
    />
  )
  const rail = (
    <CategoryRail
      sections={view.sections.slice(0, 4)}
      filters={NO_FILTERS}
      label={strings.sections}
      page={locale}
    />
  )
  const section = sectionOf(view, dishes, part === 'strip')
  const block = (tools?: ReactNode) =>
    section === null ? null : (
      <main>
        <SectionBlock section={section} ctx={ctx} filters={NO_FILTERS} first tools={tools} />
      </main>
    )

  switch (part) {
    case 'header':
      return header
    case 'rail':
      return rail
    case 'header-rail':
      return (
        <>
          {header}
          {rail}
        </>
      )
    case 'switch':
      return block(
        view.layout.guestSwitch ? (
          <LayoutSwitch layout={ctx.layout} onChange={nothing} strings={ctx.strings} />
        ) : null,
      )
    case 'dish-allergens':
      return (
        <>
          {block()}
          <AllergenFooter view={view} strings={strings} allergenNames={ctx.allergenNames} />
        </>
      )
    case 'dish-open': {
      const dish = dishes[0]
      return (
        <>
          {block()}
          {dish === undefined ? null : (
            <DishPage
              item={dish}
              ctx={ctx}
              kind={view.design.dish?.kind === 'page' ? 'page' : 'sheet'}
              leaving={false}
              onClose={nothing}
            />
          )}
        </>
      )
    }
    case 'order-bar':
      return (
        <>
          {block()}
          <ServiceBar />
        </>
      )
    case 'call-sheet':
      return (
        <>
          {block()}
          <CallOverlay />
        </>
      )
    case 'call-kinds':
      return (
        <StillPanel pick='[data-design-part="call.kinds"]'>
          <CallSheet />
        </StillPanel>
      )
    case 'call-foot':
      return (
        <StillPanel pick='[data-design-part="call"] > .ro-primary'>
          <CallSheet />
        </StillPanel>
      )
    case 'bill-lines':
      return (
        <StillPanel pick='[data-design-part="bill.lines"], [data-design-part="bill.total"]'>
          <BillSheet />
        </StillPanel>
      )
    case 'bag-lines':
      return (
        <StillPanel pick=".ro-lines">
          <BagSheet />
        </StillPanel>
      )
    case 'tip':
      return (
        <StillPanel>
          <TipPart />
        </StillPanel>
      )
    case 'receipt-top':
      return (
        <StillPanel pick={RECEIPT_TOP}>
          <ReceiptPart />
        </StillPanel>
      )
    default:
      return block()
  }
}

/** The top of the receipt: its title, the venue (its logo or name) and when. */
const RECEIPT_TOP =
  '.ro-confirm > h3, .ro-confirm-logo, [data-design-part="receipt.venue"], [data-slot="pay.confirmation.when"]'

/** The Call a waiter sheet, open, as the face's sheets draw it (services/sheets.tsx). */
function CallOverlay() {
  const o = useServicesRequired()
  return (
    <Overlay title={o.words.callServer} closeLabel={o.guest.close} onClose={nothing}>
      <PreviewMarker show={o.state.preview} words={o.words} />
      <CallSheet />
    </Overlay>
  )
}

/** The room kept around the cut-out part of a sheet's body, in CSS pixels. */
const CROP_MARGIN = 12

interface Cut {
  readonly top: number
  readonly height: number
}

/**
 * A sheet's body drawn in place: the sheets' panel, in the page, not over it. With `pick`, only the
 * elements it selects are shown, cut out of the body with a little room around them; where none is
 * laid out (no layout at all, as in a test), the whole body shows.
 */
function StillPanel({ pick, children }: { readonly pick?: string; readonly children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null)
  const [cut, setCut] = useState<Cut | null>(null)

  useLayoutEffect(() => {
    const box = inner.current
    if (box === null || pick === undefined) return undefined
    const measure = () => {
      const base = box.getBoundingClientRect().top
      let top = Number.POSITIVE_INFINITY
      let bottom = Number.NEGATIVE_INFINITY
      for (const element of box.querySelectorAll(pick)) {
        const rect = element.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        top = Math.min(top, rect.top - base)
        bottom = Math.max(bottom, rect.bottom - base)
      }
      const from = Math.max(0, Math.floor(top - CROP_MARGIN))
      const next: Cut | null = Number.isFinite(top)
        ? { top: from, height: Math.ceil(bottom + CROP_MARGIN - from) }
        : null
      setCut((now) =>
        now !== null && next !== null && now.top === next.top && now.height === next.height
          ? now
          : next,
      )
    }
    measure()
    const watchers: { disconnect(): void }[] = []
    if (typeof ResizeObserver !== 'undefined') {
      const resized = new ResizeObserver(measure)
      resized.observe(box)
      watchers.push(resized)
    }
    if (typeof MutationObserver !== 'undefined') {
      const changed = new MutationObserver(measure)
      changed.observe(box, { subtree: true, childList: true, characterData: true })
      watchers.push(changed)
    }
    return () => {
      for (const watcher of watchers) watcher.disconnect()
    }
  }, [pick])

  return (
    <div className="rm-overlay-panel" data-design-part="sheet" data-specimen-panel="">
      <div
        data-specimen-cut={cut === null ? undefined : ''}
        style={cut === null ? undefined : { height: cut.height, overflow: 'hidden' }}
      >
        <div
          ref={inner}
          style={cut === null ? undefined : { transform: `translateY(${-cut.top}px)` }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** The pay sheet's tip row, for the whole bill, nothing chosen: the amounts show on Rows. */
function TipPart() {
  const o = useServicesRequired()
  const bill: TableBillView | null = o.state.tableBill ?? null
  const [tip, setTip] = useState<TipChoice>(NO_TIP)
  const [other, setOther] = useState('')
  const money = useMemo(
    () => (minor: number) => paySignedMoney(minor, bill?.currency ?? 'EUR', o.locale),
    [bill?.currency, o.locale],
  )
  const totals = useMemo(
    () => choosePay(bill === null ? new Map() : pickWhole(new Map(), bill), tip, true),
    [bill, tip],
  )
  return (
    <div className="ro-sheet" data-design-part="pay">
      <TipRow
        tip={tip}
        other={other}
        totals={totals}
        money={money}
        onTip={setTip}
        onOther={setOther}
      />
    </div>
  )
}

/** When the receipt's demo payment was taken: a fixed time, so the picture never changes by itself. */
const PAID_AT = '2026-01-01T19:42:00.000Z'

/** The demo bill as a captured payment of all its lines, no tip: what the receipt draws. */
function paymentOf(bill: TableBillView): PaymentView {
  return {
    id: 'specimen-payment',
    mode: 'bill',
    number: 'D-1042',
    state: 'captured',
    reason: null,
    currency: bill.currency,
    amountMinor: bill.totalMinor,
    tipMinor: 0,
    lines: bill.parts.flatMap((piece) =>
      piece.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
      })),
    ),
    paidAt: PAID_AT,
    receiptEmailed: null,
    receiptEmail: null,
    timeZone: 'Europe/Sofia',
    form: null,
  }
}

/** The Payment confirmation of the demo bill, as the paid screen opens it. */
function ReceiptPart() {
  const o = useServicesRequired()
  const bill = o.state.tableBill ?? null
  const w = o.words.paying
  const venueName = o.state.paying?.venueName ?? null
  const confirmation = useMemo(
    () =>
      bill === null
        ? null
        : confirmationOf({
            payment: paymentOf(bill),
            venueName,
            locale: o.locale,
            words: w,
            otherItem: o.words.otherItem,
          }),
    [bill, venueName, o.locale, w, o.words.otherItem],
  )
  if (confirmation === null) return null
  return (
    <Confirmation
      view={confirmation}
      id="ro-specimen-confirmation"
      closeLabel={w.sameNo}
      failedText={w.confirmSaveFailed}
      onClose={nothing}
    />
  )
}
