// The simulated POS (#51 design §2): a pure state machine with an injected clock and a seeded
// random source, and no I/O. It answers the POS-shaped calls of `calls.ts` for outside apps, and
// offers the waiter's side as `engine.waiter.*` (design §2.5). It claims nothing about any real
// POS: the facts of D122 §1 are built in, every other behaviour is a switch (`../switches.ts`),
// and anything neither defines throws `UndefinedBehaviour` (HTTP 501 on the wire).
//
// A refused or undefined write changes nothing: the state is restored before the answer.

import { addMinor, subtractMinor } from '@restro/core'

import { type ProfileName, type SimSwitches, switchesOf } from '../switches'
import {
  isReadMethod,
  type Page,
  type PaymentIn,
  type RowIn,
  type SimCall,
  type SimMethod,
} from './calls'
import { type Clock, ManualClock } from './clock'
import { PosRefusal, SimSetupError, UndefinedBehaviour } from './errors'
import { type FaultKind, FaultPlan, type SimFault } from './faults'
import { makeId } from './ids'
import { type Random, seededRandom } from './random'
import { DEFAULT_SCENARIO, type SimScenario } from './scenario'
import type {
  SimBill,
  SimLogin,
  SimPayment,
  SimRow,
  SimState,
  SimTable,
  SimTicketRow,
} from './state'
import { amountOf, parseQuantity, quantityText, splitAmount } from './units'

export interface Credentials {
  readonly user: string
  readonly password: string
}

/** The engine's answer to a call. Amounts are minor units; the wire renders them. */
export type SimAnswer =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | {
      readonly ok: false
      readonly status: number
      readonly code: string
      readonly detail: string
      readonly line: number | null
    }

/** How the transport delivers the answer: at once, after a delay, or never. */
export interface SimPlan {
  readonly answer: SimAnswer
  readonly delayMs: number
  readonly hang: boolean
  /** The login whose slot a delayed answer holds; the transport calls `release` after it. */
  readonly login: string | null
}

/** One call as the POS saw it, for tests and the control page (design §2.2's call log). */
export interface SimCallRecord {
  readonly seq: number
  readonly at: string
  readonly login: string | null
  readonly method: SimMethod
  readonly write: boolean
  status: number | 'hung'
  faults: FaultKind[]
}

export interface SimEngineOptions {
  readonly switches?: ProfileName | SimSwitches
  readonly scenario?: SimScenario
  readonly clock?: Clock
  readonly seed?: number
  /** Items per page of every list. Small by default, so a reading takes several calls. */
  readonly pageSize?: number
}

interface PlannedRow {
  readonly article: string
  readonly name: string
  readonly quantity: number
  readonly unitPriceMinor: number
  readonly amountMinor: number
  readonly note: string | null
  readonly options: readonly string[]
  readonly ref: string | null
}

interface CallMods {
  readonly partlyRows: number | null
  readonly noReceipt: boolean
  readonly dropItem: boolean
}

const NO_MODS: CallMods = { partlyRows: null, noReceipt: false, dropItem: false }

/** The POS's electronic receipt as a file: bytes of its own, named by the receipt number. */
function receiptFileOf(number: string): {
  readonly filename: string
  readonly contentType: 'application/pdf'
  readonly contentBase64: string
} {
  return {
    filename: `receipt-${number}.pdf`,
    contentType: 'application/pdf',
    contentBase64: Buffer.from(`%PDF-1.4
sim-pos electronic receipt ${number}
%%EOF
`).toString('base64'),
  }
}

export class SimEngine {
  readonly switches: SimSwitches
  readonly clock: Clock
  readonly faults = new FaultPlan()
  readonly waiter: SimWaiter
  readonly pageSize: number
  state: SimState
  readonly #seed: number
  #random: Random
  #initial: SimState
  #calls: SimCallRecord[] = []
  #rate = new Map<string, number[]>()
  #inFlight = new Map<string, number>()
  #late: { due: number; login: string; call: SimCall }[] = []

  constructor(options: SimEngineOptions = {}) {
    this.switches = switchesOf(options.switches ?? 'cautious')
    this.clock = options.clock ?? new ManualClock()
    this.pageSize = options.pageSize ?? 2
    this.#seed = options.seed ?? 1
    this.#random = seededRandom(this.#seed)
    this.state = this.#build(options.scenario ?? DEFAULT_SCENARIO)
    this.#initial = structuredClone(this.state)
    this.waiter = new SimWaiter(this)
  }

  /**
   * Back to the starting state: faults off, calls, rate counters and late writes forgotten. Ids
   * keep counting, as a real POS never reuses one: an id an outside app still holds from before
   * the reset can't name a new bill.
   */
  reset(): void {
    const seq = this.state.seq
    this.state = structuredClone(this.#initial)
    this.state.seq = Math.max(seq, this.state.seq)
    this.faults.clear()
    this.#calls = []
    this.#rate.clear()
    this.#inFlight.clear()
    this.#late = []
  }

  /** The current state as JSON-safe data. */
  snapshot(): SimState {
    return structuredClone(this.state)
  }

  /** Loads a saved state; it becomes the state `reset` returns to. */
  load(state: SimState): void {
    this.#initial = structuredClone(state)
    this.reset()
    this.#random = seededRandom(this.#seed)
  }

  /** A digest of the whole POS state (not the call log or rate counters). */
  digest(): string {
    return JSON.stringify({ state: this.state, late: this.#late })
  }

  calls(): readonly SimCallRecord[] {
    return this.#calls
  }

  /** Writes waiting to land late (the `landsLate` fault). */
  pendingLateWrites(): number {
    return this.#late.length
  }

  /** The logins Restro's connector may use: one per bar, or one for every bar (Q19). */
  apiLogins(): readonly SimLogin[] {
    return this.state.logins.filter((login) => login.kind === 'api')
  }

  /** Releases the slot a delayed answer held (`SimPlan.login`). */
  release(login: string): void {
    this.#inFlight.set(login, Math.max(0, (this.#inFlight.get(login) ?? 0) - 1))
  }

  /** Lands every late write whose time has come. Every call and waiter action does it first. */
  settle(): void {
    const now = this.clock.now().getTime()
    const due = this.#late.filter((late) => late.due <= now)
    this.#late = this.#late.filter((late) => late.due > now)
    for (const late of due) {
      const login = this.state.logins.find((l) => l.id === late.login)
      if (login !== undefined) this.#execute(login, late.call, NO_MODS)
    }
  }

  /** Answers one call of an outside app. Pure apart from the engine's own state. */
  call(credentials: Credentials | null, call: SimCall): SimPlan {
    this.settle()
    const now = this.clock.now()
    const read = isReadMethod(call.method)
    const record: SimCallRecord = {
      seq: this.#calls.length + 1,
      at: now.toISOString(),
      login: credentials?.user ?? null,
      method: call.method,
      write: !read,
      status: 0,
      faults: [],
    }
    this.#calls.push(record)
    const answer = (value: SimAnswer, delayMs = 0, login: string | null = null): SimPlan => {
      record.status = value.ok ? 200 : value.status
      return { answer: value, delayMs, hang: false, login }
    }
    const hang = (): SimPlan => {
      record.status = 'hung'
      return {
        answer: refusalAnswer(new PosRefusal('failed', 'no answer')),
        delayMs: 0,
        hang: true,
        login: null,
      }
    }

    const login = this.state.logins.find((l) => l.id === credentials?.user)
    if (login === undefined || credentials === null || login.password !== credentials.password) {
      return answer(refusalAnswer(new PosRefusal('credentials', 'the login is refused')))
    }
    if (this.state.offline.includes(login.id)) {
      return answer(refusalAnswer(new PosRefusal('login_offline', 'the login is offline')))
    }
    const limit = this.switches.rateLimit
    if ((this.#inFlight.get(login.id) ?? 0) >= limit.concurrent) {
      return answer(
        refusalAnswer(new PosRefusal('busy', 'another call of this login is in flight')),
      )
    }
    const at = now.getTime()
    const recent = (this.#rate.get(login.id) ?? []).filter((t) => t > at - 1000)
    if (recent.length >= limit.perSecond) {
      this.#rate.set(login.id, recent)
      return answer(refusalAnswer(new PosRefusal('busy', 'too many calls in the last second')))
    }
    this.#rate.set(login.id, [...recent, at])

    const faults = this.faults.next({ method: call.method, read, login: login.id })
    record.faults = faults.map((fault) => fault.kind)
    let delayMs = 0
    let after: 'answer' | 'hang' | 'late' = 'answer'
    let mods: CallMods = NO_MODS
    for (const fault of faults) {
      switch (fault.kind) {
        case 'hang':
          return hang()
        case 'landsThenHangs':
          after = 'hang'
          break
        case 'landsPartly':
          if (call.method !== 'addRows') {
            throw new SimSetupError('landsPartly applies to adding rows only')
          }
          if (this.switches.addIsAllOrNothing) {
            throw new SimSetupError('landsPartly contradicts addIsAllOrNothing (Q15)')
          }
          mods = {
            ...mods,
            partlyRows: fault.rows ?? Math.max(1, Math.floor(call.rows.length / 2)),
          }
          after = 'hang'
          break
        case 'landsLate':
          if (read) throw new SimSetupError('landsLate applies to writes only')
          after = 'late'
          break
        case 'fail':
          return answer(refusalAnswer(new PosRefusal('failed', 'the POS failed this call')))
        case 'dropItem':
          mods = { ...mods, dropItem: true }
          break
        case 'refuse':
          return answer(
            refusalAnswer(
              new PosRefusal(fault.code, `refused (${fault.code})`, fault.line ?? null),
            ),
          )
        case 'slow':
          delayMs += this.faults.delayOf(fault, this.#random)
          break
        case 'loginOffline':
          this.state.offline.push(login.id)
          return answer(refusalAnswer(new PosRefusal('login_offline', 'the login went offline')))
        case 'waiterRoundSlipsIn':
        case 'waiterVoidsLine':
        case 'waiterClosesBill':
          this.#waiterFault(fault, call)
          break
        case 'noReceipt':
          mods = { ...mods, noReceipt: true }
          break
      }
    }

    if (after === 'late') {
      this.#late.push({ due: at + this.switches.lateLandingMs, login: login.id, call })
      return hang()
    }
    const result = this.#execute(login, call, mods)
    if (after === 'hang') return hang()
    if (delayMs > 0) {
      this.#inFlight.set(login.id, (this.#inFlight.get(login.id) ?? 0) + 1)
      return answer(result, delayMs, login.id)
    }
    return answer(result)
  }

  // -------------------------------------------------------------------------------------------
  // Building the state

  #build(scenario: SimScenario): SimState {
    const perBar = this.switches.oneLoginPerBar
    const state: SimState = {
      seq: 0,
      day: 1,
      training: this.switches.startsInTrainingMode,
      printerDown: false,
      offline: [],
      logins: scenario.logins
        .filter((login) => login.kind === 'waiter' || login.bars.length > 0 === perBar)
        .map((login) => ({ ...login, bars: [...login.bars] })),
      bars: scenario.bars.map((bar) => ({ ...bar })),
      tables: scenario.tables.map((table) => ({ ...table })),
      articles: scenario.articles.map((article) => ({ ...article, soldOut: false })),
      paymentTypes: scenario.paymentTypes.map((type) => ({ ...type })),
      bills: [],
      tickets: [],
      receiptSeq: 0,
      repeats: {},
    }
    this.state = state
    const now = this.clock.now().getTime()
    for (const bill of scenario.bills) {
      const by = this.#login(bill.by)
      const at = new Date(now - bill.minutesAgo * 60_000).toISOString()
      const opened = this.#openBill(this.#tableOf(bill.table), by, at)
      const rows = bill.rows.map((row) =>
        this.#planRow(
          {
            article: row.article,
            quantity: row.quantity,
            note: null,
            options: [],
            ref: null,
            amountMinor: null,
          },
          0,
          false,
        ),
      )
      this.#pushRows(opened, rows, by, at, false)
    }
    return state
  }

  // -------------------------------------------------------------------------------------------
  // Executing a call

  #execute(login: SimLogin, call: SimCall, mods: CallMods): SimAnswer {
    const read = isReadMethod(call.method)
    const before = read ? null : structuredClone(this.state)
    try {
      return { ok: true, value: this.#dispatch(login, call, mods) }
    } catch (error) {
      if (before !== null) this.state = before
      if (error instanceof PosRefusal) return refusalAnswer(error)
      if (error instanceof UndefinedBehaviour) {
        return { ok: false, status: 501, code: error.code, detail: error.message, line: null }
      }
      throw error
    }
  }

  #dispatch(login: SimLogin, call: SimCall, mods: CallMods): Record<string, unknown> {
    switch (call.method) {
      case 'ping':
        return this.switches.trainingMode
          ? { ok: true, mode: this.state.training ? 'training' : 'live' }
          : { ok: true }
      case 'listTables':
        return this.#page(
          this.state.tables
            .filter((table) => this.#sees(login, table))
            .map((table) => ({
              id: table.id,
              number: table.number,
              hall: table.hall,
              ...(this.switches.readsTableBar ? { bar: table.bar } : {}),
            })),
          call.page,
          mods,
        )
      case 'listBars':
        if (!this.switches.readsTableBar) {
          throw new UndefinedBehaviour('reading the bars', 'Q16')
        }
        return this.#page(
          this.state.bars
            .filter((bar) => login.bars.length === 0 || login.bars.includes(bar.id))
            .map((bar) => ({ id: bar.id, name: bar.name })),
          call.page,
          mods,
        )
      case 'listBills': {
        const table = this.#table(login, call.table)
        if (call.state === 'closed' && !this.switches.readClosedBills) {
          throw new UndefinedBehaviour("reading a table's closed bills", 'Q24')
        }
        const bills =
          call.state === 'open'
            ? this.#openBills(table.id)
            : this.state.bills.filter(
                (bill) =>
                  bill.table === table.id && bill.state === 'closed' && bill.day === this.state.day,
              )
        return this.#page(
          bills.map((bill) => this.#billHead(bill)),
          call.page,
          mods,
        )
      }
      case 'listOpenBills': {
        if (!this.switches.readAllOpenBillsInOneCall) {
          throw new UndefinedBehaviour('reading every open bill in one call', 'Q28')
        }
        const tables = new Set(
          this.state.tables.filter((t) => this.#sees(login, t)).map((t) => t.id),
        )
        const bills = this.state.bills.filter(
          (bill) => bill.state === 'open' && tables.has(bill.table),
        )
        return this.#page(
          bills.map((bill) => ({ ...this.#billHead(bill), table: bill.table })),
          call.page,
          mods,
        )
      }
      case 'listRows': {
        const bill = this.#bill(login, call.bill)
        if (bill.state === 'closed' && !this.switches.readClosedBills) {
          // Defined, and cautious: a bill that closed while a reading ran is refused, not read (Q24).
          throw new PosRefusal('bill_closed', 'the bill is closed')
        }
        const rows = bill.rows.filter((row) => !row.pending).map((row) => this.#rowOut(row))
        return {
          ...this.#page(rows, call.page, mods),
          bill: { ...this.#billHead(bill), state: bill.state },
        }
      }
      case 'addRows':
        return this.#addRows(login, call, mods.partlyRows)
      case 'moveRows':
        return this.#moveRows(login, call.bill, call.rows, call.to, true)
      case 'voidRow':
        return this.#voidRow(login, call.bill, call.row, call.quantity, true)
      case 'closeBill':
        return this.#closeBill(login, call, mods.noReceipt)
      case 'sale':
        return this.#sale(login, call, mods.noReceipt)
    }
  }

  #page<T>(items: readonly T[], page: number, mods: CallMods): Page<T> {
    const count = items.length
    const pages = Math.max(1, Math.ceil(count / this.pageSize))
    if (!Number.isSafeInteger(page) || page < 1 || page > pages) {
      throw new PosRefusal('bad_request', `no page ${page} of ${pages}`)
    }
    const slice = items.slice((page - 1) * this.pageSize, page * this.pageSize)
    return { page, pages, count, items: mods.dropItem ? slice.slice(0, -1) : slice }
  }

  #billHead(bill: SimBill): Record<string, unknown> {
    return { id: bill.id, total: billTotal(bill), paid: paidOf(bill) }
  }

  #rowOut(row: SimRow): Record<string, unknown> {
    const s = this.switches
    return {
      id: row.id,
      article: row.article,
      name: row.name,
      quantity: quantityText(row.quantity),
      price: row.unitPriceMinor,
      amount: row.amountMinor,
      ...(s.notesReachTicket ? { note: row.note, options: [...row.options] } : {}),
      ...(s.lineShowsWhoAndWhen ? { by: row.by, at: row.at } : {}),
      ...(s.lineCarriesCallerRef ? { ref: row.ref } : {}),
    }
  }

  #addRows(
    login: SimLogin,
    call: Extract<SimCall, { method: 'addRows' }>,
    partlyRows: number | null,
  ): Record<string, unknown> {
    const s = this.switches
    const table = this.#table(login, call.table)
    this.#writable()
    if (call.ref !== null && !s.repeatSafeAdd) {
      throw new UndefinedBehaviour('a call reference on an add', 'Q15')
    }
    const repeatKey = call.ref === null ? null : `${login.id}|${call.ref}`
    if (repeatKey !== null) {
      const earlier = this.state.repeats[repeatKey]
      if (earlier !== undefined) return earlier as Record<string, unknown>
    }
    if (call.rows.length === 0) throw new PosRefusal('bad_request', 'an add needs rows')
    const planned = call.rows.map((row, index) => this.#planRow(row, index, true))
    let bill: SimBill
    let opened = false
    if (call.bill === 'new') {
      if (!s.firstItemsOpenBill) {
        throw new PosRefusal('needs_first_item', 'an outside app may not open a bill')
      }
      if (s.billsPerTable === 'one' && this.#openBills(table.id).length > 0) {
        throw new UndefinedBehaviour('opening a second bill on a one-bill table', 'Q10')
      }
      bill = this.#openBill(table, login, this.clock.now().toISOString())
      opened = true
    } else {
      bill = this.#bill(login, call.bill)
      if (bill.table !== table.id) throw new UndefinedBehaviour('adding to a bill of another table')
      this.#open(bill, login)
      if (!s.addToStaffOpenedBill && this.#login(bill.openedBy).kind === 'waiter') {
        throw new PosRefusal('staff_bill', "an outside app may not add to a waiter's bill")
      }
    }
    const landing = partlyRows === null ? planned : planned.slice(0, partlyRows)
    const at = this.clock.now().toISOString()
    const rows = this.#pushRows(bill, landing, login, at, s.approvalAtBar)
    const value = { bill: bill.id, opened, rows: rows.map((row) => row.id) }
    if (repeatKey !== null) this.state.repeats[repeatKey] = value
    return value
  }

  /** Validates one row and prices it from the catalogue; changes nothing. */
  #planRow(row: RowIn, index: number, outside: boolean): PlannedRow {
    const s = this.switches
    const article = this.state.articles.find((a) => a.id === row.article)
    if (article === undefined) throw new PosRefusal('article_unknown', 'no such article', index)
    if (article.tip && !s.tipAsLine) throw new UndefinedBehaviour('a tip as a row', 'Q41')
    if (article.tip !== (row.amountMinor !== null)) {
      // Only a tip row names its amount; every other price comes from the POS (rule 5).
      throw new UndefinedBehaviour('a row with an amount of its own that is not a tip')
    }
    if (article.soldOut) throw new PosRefusal('sold_out', 'the article is sold out', index)
    if (outside && (row.note !== null || row.options.length > 0) && !s.notesReachTicket) {
      throw new UndefinedBehaviour('a note or options on a row', 'Q31')
    }
    if (row.ref !== null && !s.lineCarriesCallerRef) {
      throw new UndefinedBehaviour("the caller's reference on a row", 'Q15')
    }
    const quantity = parseQuantity(row.quantity)
    const amountMinor = row.amountMinor ?? amountOf(article.priceMinor, quantity)
    return {
      article: article.id,
      name: article.name,
      quantity,
      unitPriceMinor: article.priceMinor,
      amountMinor,
      note: row.note,
      options: row.options,
      ref: row.ref,
    }
  }

  #pushRows(
    bill: SimBill,
    planned: readonly PlannedRow[],
    by: SimLogin,
    at: string,
    pending: boolean,
  ): SimRow[] {
    const rows = planned.map(
      (row): SimRow => ({ ...row, id: this.#id('row'), by: by.id, at, pending }),
    )
    bill.rows.push(...rows)
    if (!pending) this.#print(bill, 'order', by, rows)
    return rows
  }

  #moveRows(
    login: SimLogin,
    billId: string,
    picks: readonly { readonly row: string; readonly quantity: string | null }[],
    to: { readonly table: string; readonly bill: string | null },
    outside: boolean,
  ): Record<string, unknown> {
    const s = this.switches
    const several = s.billsPerTable === 'several'
    const source = this.#bill(login, billId)
    if (outside) this.#writable()
    this.#open(source, login)
    const target = this.#table(login, to.table)
    if (outside && !s.moveLines && !(several && target.id === source.table)) {
      throw new UndefinedBehaviour('moving rows to another table', 'Q11')
    }
    if (source.chargeMinor > 0) {
      throw new UndefinedBehaviour('moving rows off a bill with a charge of its own', 'Q37')
    }
    if (picks.length === 0) throw new PosRefusal('bad_request', 'a move needs rows')
    const seen = new Set<string>()
    const moves = picks.map((pick) => {
      const row = source.rows.find((r) => r.id === pick.row && !r.pending)
      if (row === undefined || seen.has(pick.row)) {
        throw new UndefinedBehaviour('moving a row the bill does not hold, or one row twice')
      }
      seen.add(pick.row)
      const taken = pick.quantity === null ? row.quantity : parseQuantity(pick.quantity)
      if (taken > row.quantity) throw new PosRefusal('bad_request', 'more than the row holds')
      if (taken < row.quantity && !s.movePartialQuantity) {
        throw new UndefinedBehaviour("moving part of a row's quantity", 'Q11')
      }
      return { row, taken }
    })

    let into: SimBill
    let opened = false
    if (to.bill === 'new') {
      if (!several) throw new UndefinedBehaviour('a new bill by a move on a one-bill POS', 'Q10')
      into = this.#openBill(target, login, this.clock.now().toISOString())
      opened = true
    } else if (to.bill !== null) {
      into = this.#bill(login, to.bill)
      if (into.table !== target.id) throw new UndefinedBehaviour('a bill named on another table')
      this.#open(into, login)
    } else {
      const open = this.#openBills(target.id)
      if (open.length > 1)
        throw new UndefinedBehaviour('which of several bills a move goes to', 'Q10')
      const only = open[0]
      if (only === undefined) {
        into = this.#openBill(target, login, this.clock.now().toISOString())
        opened = true
      } else {
        into = only
        this.#open(into, login)
      }
    }
    if (into.id === source.id) throw new UndefinedBehaviour('moving rows onto their own bill')

    const moved: SimRow[] = []
    for (const { row, taken } of moves) {
      if (taken === row.quantity) {
        source.rows = source.rows.filter((r) => r !== row)
        into.rows.push(row)
        moved.push(row)
      } else {
        const split = splitAmount(row.amountMinor, taken, row.quantity)
        const part: SimRow = {
          ...row,
          id: this.#id('row'),
          quantity: taken,
          amountMinor: split.taken,
        }
        row.quantity = subtractMinor(row.quantity, taken)
        row.amountMinor = split.rest
        into.rows.push(part)
        moved.push(part)
      }
    }
    if (source.rows.length === 0 && s.emptiedBill === 'closes') {
      source.state = 'closed'
      source.closedAt = this.clock.now().toISOString()
    }
    if (s.moveReprintsTicket) this.#print(into, 'move', login, moved)
    return { bill: into.id, opened, rows: moved.map((row) => row.id) }
  }

  #voidRow(
    login: SimLogin,
    billId: string,
    rowId: string,
    quantity: string | null,
    outside: boolean,
  ): Record<string, unknown> {
    const bill = this.#bill(login, billId)
    if (outside) this.#writable()
    this.#open(bill, login)
    const row = bill.rows.find((r) => r.id === rowId && !r.pending)
    if (row === undefined) throw new UndefinedBehaviour('voiding a row the bill does not hold')
    const taken = quantity === null ? row.quantity : parseQuantity(quantity)
    if (taken > row.quantity) throw new PosRefusal('bad_request', 'more than the row holds')
    if (taken === row.quantity && bill.rows.length === 1) {
      // Q30 asks what an emptied bill becomes after a move; after a void nobody has said.
      throw new UndefinedBehaviour("voiding a bill's last row", 'Q30')
    }
    const split = splitAmount(row.amountMinor, taken, row.quantity)
    if (taken === row.quantity) {
      bill.rows = bill.rows.filter((r) => r !== row)
    } else {
      row.quantity = subtractMinor(row.quantity, taken)
      row.amountMinor = split.rest
    }
    return { row: row.id, amount: split.taken }
  }

  #closeBill(
    login: SimLogin,
    call: Extract<SimCall, { method: 'closeBill' }>,
    noReceipt: boolean,
  ): Record<string, unknown> {
    const s = this.switches
    if (!s.closeWithPaymentType) {
      throw new UndefinedBehaviour('an outside app closing a bill with a payment', 'Q4')
    }
    const bill = this.#bill(login, call.bill)
    this.#writable()
    this.#open(bill, login)
    if (call.note !== null && !s.closeCarriesNote) {
      throw new UndefinedBehaviour('a note on a close', 'Q35')
    }
    if (call.receiptEmail !== null && !s.electronicReceipt) {
      throw new UndefinedBehaviour('an electronic receipt', 'Q38')
    }
    const receipt = this.#takePayments(bill, call.payments, login, noReceipt, call.receiptEmail)
    return {
      bill: bill.id,
      ...(receipt !== null && s.receiptNumberOnClose ? { receipt } : {}),
      // The POS's own file, where it returns it rather than sending: with a receipt printed.
      ...(receipt !== null && call.receiptEmail !== null && s.electronicReceiptFile
        ? { receiptFile: receiptFileOf(receipt) }
        : {}),
    }
  }

  #sale(
    login: SimLogin,
    call: Extract<SimCall, { method: 'sale' }>,
    noReceipt: boolean,
  ): Record<string, unknown> {
    const s = this.switches
    if (!s.oneCallSale)
      throw new UndefinedBehaviour('opening, paying and closing in one call', 'Q4')
    const table = this.#table(login, call.table)
    this.#writable()
    if (this.#openBills(table.id).length > 0) {
      throw new UndefinedBehaviour('a one-call sale on a table with an open bill', 'Q12')
    }
    if (call.rows.length === 0) throw new PosRefusal('bad_request', 'a sale needs rows')
    const planned = call.rows.map((row, index) => this.#planRow(row, index, true))
    const at = this.clock.now().toISOString()
    const bill = this.#openBill(table, login, at)
    const rows = planned.map(
      (row): SimRow => ({ ...row, id: this.#id('row'), by: login.id, at, pending: false }),
    )
    bill.rows.push(...rows)
    if (s.ticketOnOneCallSale) this.#print(bill, 'sale', login, rows)
    const receipt = this.#takePayments(bill, call.payments, login, noReceipt, null)
    return { bill: bill.id, ...(receipt !== null && s.receiptNumberOnClose ? { receipt } : {}) }
  }

  /** Checks and takes the payments, closes the bill, and answers its receipt number or null. */
  #takePayments(
    bill: SimBill,
    payments: readonly PaymentIn[],
    by: SimLogin,
    noReceipt: boolean,
    email: string | null,
  ): string | null {
    const s = this.switches
    if (bill.rows.some((row) => row.pending)) {
      throw new UndefinedBehaviour('closing a bill with rows waiting for approval', 'Q14')
    }
    if (payments.length === 0) throw new PosRefusal('bad_request', 'a close needs a payment')
    if (payments.length > 1 && !s.severalPaymentsPerClose) {
      throw new UndefinedBehaviour('several payments in one close', 'Q20')
    }
    const at = this.clock.now().toISOString()
    const taken: SimPayment[] = payments.map((payment) => {
      const type =
        payment.type === null
          ? this.state.paymentTypes.find((t) => t.kind === 'card')
          : this.state.paymentTypes.find((t) => t.id === payment.type)
      if (type === undefined)
        throw new UndefinedBehaviour('a payment type the POS does not have', 'Q26')
      return { type: type.id, amountMinor: payment.amountMinor, by: by.id, at }
    })
    const paying = taken.reduce((sum, payment) => addMinor(sum, payment.amountMinor), 0)
    const balance = subtractMinor(billTotal(bill), paidOf(bill))
    if (paying !== balance) {
      throw new PosRefusal('amount_mismatch', `the payment is ${paying}, the balance ${balance}`)
    }
    const printerFails = noReceipt || this.state.printerDown
    if (printerFails && !s.closeSucceedsWithoutPrinter) {
      throw new PosRefusal('fiscal_device', 'the fiscal printer fails')
    }
    let number: string | null = null
    if (!printerFails) {
      this.state.receiptSeq += 1
      number = String(this.state.receiptSeq).padStart(7, '0')
    }
    bill.payments.push(...taken)
    bill.state = 'closed'
    bill.closedAt = at
    const delivery =
      email === null || number === null ? null : s.electronicReceiptFile ? 'returned' : 'sent'
    bill.receipt = { number, email: delivery === null ? null : email, delivery }
    return number
  }

  // -------------------------------------------------------------------------------------------
  // Faults that act as a waiter

  #waiterFault(fault: SimFault, call: SimCall): void {
    const bill = this.#billOfCall(call, fault.kind === 'waiterClosesBill' ? fault.bill : undefined)
    if (bill === undefined || bill.state !== 'open') return
    const table = this.#tableOf(bill.table)
    const waiter = this.#waiterFor(table)
    if (fault.kind === 'waiterRoundSlipsIn') {
      const rows: RowIn[] =
        fault.identical && call.method === 'addRows'
          ? call.rows.map((row) => ({ ...row, note: null, options: [], ref: null }))
          : fault.identical && bill.rows[0] !== undefined
            ? [
                {
                  article: bill.rows[0].article,
                  quantity: quantityText(bill.rows[0].quantity),
                  note: null,
                  options: [],
                  ref: null,
                  amountMinor: null,
                },
              ]
            : [
                {
                  article: this.#firstArticle(),
                  quantity: '1',
                  note: null,
                  options: [],
                  ref: null,
                  amountMinor: null,
                },
              ]
      const planned = rows.map((row, index) => this.#planRow(row, index, false))
      this.#pushRows(bill, planned, waiter, this.clock.now().toISOString(), false)
    } else if (fault.kind === 'waiterVoidsLine') {
      const last = bill.rows.at(-1)
      if (last === undefined) return
      if (bill.rows.length > 1) this.#voidRow(waiter, bill.id, last.id, null, false)
      else if (last.quantity > 1000) this.#voidRow(waiter, bill.id, last.id, '1', false)
    } else if (fault.kind === 'waiterClosesBill') {
      this.waiter.closeBill(bill.id, 'cash')
    }
  }

  #billOfCall(call: SimCall, named: string | undefined): SimBill | undefined {
    if (named !== undefined) return this.state.bills.find((bill) => bill.id === named)
    switch (call.method) {
      case 'addRows':
        return call.bill === 'new'
          ? this.#openBills(call.table)[0]
          : this.state.bills.find((bill) => bill.id === call.bill)
      case 'listBills':
        return this.#openBills(call.table)[0]
      case 'listRows':
      case 'moveRows':
      case 'voidRow':
      case 'closeBill':
        return this.state.bills.find((bill) => bill.id === call.bill)
      default:
        return undefined
    }
  }

  // -------------------------------------------------------------------------------------------
  // Shared by the calls and the waiter

  /** @internal The waiter's side reaches the same rules through these. */
  get internals() {
    return {
      table: (id: string) => this.#tableOf(id),
      login: (id: string) => this.#login(id),
      waiterFor: (table: SimTable) => this.#waiterFor(table),
      openBills: (table: string) => this.#openBills(table),
      openBill: (table: SimTable, by: SimLogin, at: string) => this.#openBill(table, by, at),
      planRow: (row: RowIn, index: number) => this.#planRow(row, index, false),
      pushRows: (bill: SimBill, rows: readonly PlannedRow[], by: SimLogin, at: string) =>
        this.#pushRows(bill, rows, by, at, false),
      bill: (id: string) => this.#billById(id),
      move: (
        by: SimLogin,
        bill: string,
        picks: readonly { readonly row: string; readonly quantity: string | null }[],
        to: { readonly table: string; readonly bill: string | null },
      ) => this.#atomic(() => this.#moveRows(by, bill, picks, to, false)),
      void: (by: SimLogin, bill: string, row: string, quantity: string | null) =>
        this.#atomic(() => this.#voidRow(by, bill, row, quantity, false)),
      takePayments: (bill: SimBill, payments: readonly PaymentIn[], by: SimLogin) =>
        this.#atomic(() => this.#takePayments(bill, payments, by, false, null)),
      print: (bill: SimBill, by: SimLogin, rows: readonly SimRow[]) =>
        this.#print(bill, 'order', by, rows),
    }
  }

  /** Runs a waiter's action all or nothing: a throw leaves the state as it was. */
  #atomic<T>(run: () => T): T {
    const before = structuredClone(this.state)
    try {
      return run()
    } catch (error) {
      this.state = before
      throw error
    }
  }

  #login(id: string): SimLogin {
    const login = this.state.logins.find((l) => l.id === id)
    if (login === undefined) throw new SimSetupError(`no login ${id}`)
    return login
  }

  #waiterFor(table: SimTable): SimLogin {
    const waiter = this.state.logins.find(
      (l) => l.kind === 'waiter' && (l.bars.length === 0 || l.bars.includes(table.bar)),
    )
    if (waiter === undefined)
      throw new SimSetupError(`no waiter serves the bar of table ${table.id}`)
    return waiter
  }

  #firstArticle(): string {
    const article = this.state.articles.find((a) => !a.tip && !a.soldOut)
    if (article === undefined) throw new SimSetupError('no article is on sale')
    return article.id
  }

  #tableOf(id: string): SimTable {
    const table = this.state.tables.find((t) => t.id === id)
    if (table === undefined) throw new SimSetupError(`no table ${id}`)
    return table
  }

  #billById(id: string): SimBill {
    const bill = this.state.bills.find((b) => b.id === id)
    if (bill === undefined) throw new SimSetupError(`no bill ${id}`)
    return bill
  }

  #sees(login: SimLogin, table: SimTable): boolean {
    return login.bars.length === 0 || login.bars.includes(table.bar)
  }

  /** A table named in a call: unknown is undefined; another bar's table is refused (Q19). */
  #table(login: SimLogin, id: string): SimTable {
    const table = this.state.tables.find((t) => t.id === id)
    if (table === undefined)
      throw new UndefinedBehaviour('a call names a table the POS does not have')
    if (!this.#sees(login, table)) {
      throw new PosRefusal('no_rights', "the login does not serve this table's bar")
    }
    return table
  }

  #bill(login: SimLogin, id: string): SimBill {
    const bill = this.state.bills.find((b) => b.id === id)
    if (bill === undefined) throw new UndefinedBehaviour('a call names a bill the POS never had')
    this.#table(login, bill.table)
    return bill
  }

  /** The bill takes changes from this login: open, and not held on another terminal. */
  #open(bill: SimBill, login: SimLogin): void {
    if (bill.state !== 'open') throw new PosRefusal('bill_closed', 'the bill is closed')
    if (bill.lockedBy !== null && bill.lockedBy !== login.id) {
      throw new PosRefusal('bill_locked', 'the bill is open on another terminal')
    }
  }

  /** An outside write is defined only while the POS runs live (Q27, D124 §5). */
  #writable(): void {
    if (this.state.training) {
      throw new UndefinedBehaviour('an outside write while the POS is in training mode', 'Q27')
    }
  }

  /** The table's open bills, oldest first. */
  #openBills(table: string): SimBill[] {
    return this.state.bills
      .filter((bill) => bill.table === table && bill.state === 'open')
      .sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt))
  }

  #openBill(table: SimTable, by: SimLogin, at: string): SimBill {
    const bill: SimBill = {
      id: this.#id('bill'),
      table: table.id,
      state: 'open',
      openedAt: at,
      openedBy: by.id,
      rows: [],
      chargeMinor: 0,
      lockedBy: null,
      payments: [],
      receipt: null,
      closedAt: null,
      day: this.state.day,
    }
    this.state.bills.push(bill)
    return bill
  }

  #print(
    bill: SimBill,
    kind: 'order' | 'move' | 'sale',
    by: SimLogin,
    rows: readonly SimRow[],
  ): void {
    const table = this.#tableOf(bill.table)
    this.state.tickets.push({
      at: this.clock.now().toISOString(),
      bar: table.bar,
      table: table.id,
      bill: bill.id,
      kind,
      by: by.id,
      rows: rows.map(
        (row): SimTicketRow => ({
          name: row.name,
          quantity: quantityText(row.quantity),
          note: this.switches.notesReachTicket ? row.note : null,
          options: this.switches.notesReachTicket ? [...row.options] : [],
        }),
      ),
    })
  }

  #id(kind: 'bill' | 'row'): string {
    this.state.seq += 1
    return makeId(kind, this.state.seq, this.#random)
  }
}

/** A bill's total: its rows (approved ones) and its own charge. */
export function billTotal(bill: SimBill): number {
  return bill.rows
    .filter((row) => !row.pending)
    .reduce((sum, row) => addMinor(sum, row.amountMinor), bill.chargeMinor)
}

function paidOf(bill: SimBill): number {
  return bill.payments.reduce((sum, payment) => addMinor(sum, payment.amountMinor), 0)
}

function refusalAnswer(refusal: PosRefusal): SimAnswer {
  return {
    ok: false,
    status: refusal.status,
    code: refusal.code,
    detail: refusal.message,
    line: refusal.line,
  }
}

/**
 * The waiter's side of the POS (#51 design §2.5): staff at the front end, in tests. Each action
 * is all or nothing, acts as the waiter of the table's bar unless `by` names a login, and is not
 * a wire call (no rate limit, no faults, no call log).
 */
export class SimWaiter {
  readonly #engine: SimEngine

  constructor(engine: SimEngine) {
    this.#engine = engine
  }

  #by(table: SimTable, by: string | undefined): SimLogin {
    const i = this.#engine.internals
    return by === undefined ? i.waiterFor(table) : i.login(by)
  }

  /**
   * Adds a round to the table's bill, or puts the first item on (which opens it). With several
   * bills, onto `bill`, a `new` one, or the oldest. `at` backdates it (a bill opened earlier).
   */
  addRound(
    table: string,
    rows: readonly { readonly article: string; readonly quantity?: string }[],
    options: { readonly by?: string; readonly at?: Date; readonly bill?: string } = {},
  ): { readonly bill: string; readonly rows: readonly string[] } {
    const engine = this.#engine
    engine.settle()
    const i = engine.internals
    const where = i.table(table)
    const by = this.#by(where, options.by)
    const at = (options.at ?? engine.clock.now()).toISOString()
    const planned = rows.map((row, index) =>
      i.planRow(
        {
          article: row.article,
          quantity: row.quantity ?? '1',
          note: null,
          options: [],
          ref: null,
          amountMinor: null,
        },
        index,
      ),
    )
    if (options.bill === 'new' && engine.switches.billsPerTable === 'one') {
      if (i.openBills(where.id).length > 0) {
        throw new UndefinedBehaviour('a second bill on a one-bill table', 'Q10')
      }
    }
    let bill =
      options.bill === 'new'
        ? undefined
        : options.bill === undefined
          ? i.openBills(where.id)[0]
          : i.bill(options.bill)
    if (bill === undefined) bill = i.openBill(where, by, at)
    if (bill.state !== 'open') throw new SimSetupError(`bill ${bill.id} is closed`)
    const added = i.pushRows(bill, planned, by, at)
    return { bill: bill.id, rows: added.map((row) => row.id) }
  }

  /** Voids a row, or part of its quantity; answers the amount voided. */
  voidLine(bill: string, row: string, quantity?: string, by?: string): number {
    this.#engine.settle()
    const i = this.#engine.internals
    const answer = i.void(this.#by(i.table(i.bill(bill).table), by), bill, row, quantity ?? null)
    return Number(answer.amount)
  }

  /** Moves rows to another table's bill (opening one there if it has none), as staff do. */
  moveLines(
    bill: string,
    rows: readonly { readonly row: string; readonly quantity?: string }[],
    toTable: string,
    by?: string,
  ): { readonly bill: string } {
    this.#engine.settle()
    const i = this.#engine.internals
    const answer = i.move(
      this.#by(i.table(i.bill(bill).table), by),
      bill,
      rows.map((row) => ({ row: row.row, quantity: row.quantity ?? null })),
      { table: toTable, bill: null },
    )
    return { bill: String(answer.bill) }
  }

  /** Splits rows off onto a new bill of the same table (several bills only, Q10). */
  splitBill(bill: string, rows: readonly string[], by?: string): { readonly bill: string } {
    this.#several()
    const i = this.#engine.internals
    const source = i.bill(bill)
    const answer = i.move(
      this.#by(i.table(source.table), by),
      bill,
      rows.map((row) => ({ row, quantity: null })),
      { table: source.table, bill: 'new' },
    )
    return { bill: String(answer.bill) }
  }

  /** Moves every row of `from` onto `into`, a bill of the same table (several bills only, Q10). */
  mergeBills(from: string, into: string, by?: string): void {
    this.#several()
    const i = this.#engine.internals
    const source = i.bill(from)
    i.move(
      this.#by(i.table(source.table), by),
      from,
      source.rows.filter((row) => !row.pending).map((row) => ({ row: row.id, quantity: null })),
      { table: i.bill(into).table, bill: into },
    )
  }

  /** Closes a bill in cash or by card at its balance. */
  closeBill(bill: string, kind: 'cash' | 'card' = 'cash', by?: string): void {
    const engine = this.#engine
    engine.settle()
    const i = engine.internals
    const target = i.bill(bill)
    if (target.state !== 'open') throw new SimSetupError(`bill ${bill} is already closed`)
    const type = engine.state.paymentTypes.find((t) => t.kind === kind)
    if (type === undefined) throw new SimSetupError(`no ${kind} payment type`)
    const balance = subtractMinor(
      billTotal(target),
      target.payments.reduce((sum, payment) => addMinor(sum, payment.amountMinor), 0),
    )
    i.takePayments(
      target,
      [{ type: type.id, amountMinor: balance }],
      this.#by(i.table(target.table), by),
    )
  }

  /** Holds a bill as if open on a terminal: other logins' changes are refused `bill_locked`. */
  lockBill(bill: string, by?: string): void {
    const i = this.#engine.internals
    const target = i.bill(bill)
    target.lockedBy = this.#by(i.table(target.table), by).id
  }

  unlockBill(bill: string): void {
    this.#engine.internals.bill(bill).lockedBy = null
  }

  markSoldOut(article: string, soldOut = true): void {
    const found = this.#engine.state.articles.find((a) => a.id === article)
    if (found === undefined) throw new SimSetupError(`no article ${article}`)
    found.soldOut = soldOut
  }

  /** Every call of the login fails until it is back (connection pauses, D122 §6). */
  takeOffline(login: string): void {
    this.#engine.internals.login(login)
    if (!this.#engine.state.offline.includes(login)) this.#engine.state.offline.push(login)
  }

  bringOnline(login: string): void {
    this.#engine.state.offline = this.#engine.state.offline.filter((id) => id !== login)
  }

  /** Approves the rows waiting at the bar on a bill; the ticket prints now (Q3, Q14). */
  approveRound(bill: string): void {
    if (!this.#engine.switches.approvalAtBar) throw new SimSetupError('approvalAtBar is off')
    const i = this.#engine.internals
    const target = i.bill(bill)
    const pending = target.rows.filter((row) => row.pending)
    for (const row of pending) row.pending = false
    if (pending.length > 0) i.print(target, this.#by(i.table(target.table), undefined), pending)
  }

  /** Puts a charge of the bill's own on it, such as an entrance fee (Q37). */
  chargeBill(bill: string, amountMinor: number): void {
    if (!this.#engine.switches.billTotalDiffersFromLines) {
      throw new SimSetupError('billTotalDiffersFromLines is off: a bill is the sum of its rows')
    }
    const target = this.#engine.internals.bill(bill)
    target.chargeMinor = addMinor(target.chargeMinor, amountMinor)
  }

  setTrainingMode(on: boolean): void {
    if (!this.#engine.switches.trainingMode)
      throw new SimSetupError('the POS has no training mode (Q27)')
    this.#engine.state.training = on
  }

  /** The fiscal printer fails (or works again): a close then prints no receipt (Q25). */
  setPrinterDown(down: boolean): void {
    this.#engine.state.printerDown = down
  }

  /** Closes the service day. Defined only with no bill open (Q29 asks about payment tables). */
  closeDay(): void {
    const state = this.#engine.state
    const open = state.bills.filter((bill) => bill.state === 'open')
    const onPayment = open.some((bill) => state.tables.find((t) => t.id === bill.table)?.payment)
    if (onPayment)
      throw new UndefinedBehaviour('closing the day while a payment table is open', 'Q29')
    if (open.length > 0) throw new UndefinedBehaviour('closing the day while bills are open')
    state.day += 1
  }

  #several(): void {
    if (this.#engine.switches.billsPerTable !== 'several') {
      throw new UndefinedBehaviour('splitting or merging bills on a one-bill POS', 'Q10')
    }
  }
}
