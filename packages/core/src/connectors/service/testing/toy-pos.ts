// A toy POS and its connector, for the kit's own tests only (kit.test.ts): small enough to read
// in one go, so the kit's write checks run in this package and a connector that is wrong on
// purpose can be built by overriding one step. It is not the simulated POS (#68) and claims
// nothing about any real POS. Ids take varied shapes on purpose (#51's overfitting guard). Its
// lists answer one entry per page, so a reading takes several calls and a failed page can bite.

import {
  addMinor,
  decimalToMinor,
  minorToDecimal,
  ratioOfMinor,
  subtractMinor,
} from '../../../money'
import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from '../capabilities'
import type { ServiceConnector, ServiceContext } from '../connector'
import { type PosRef, posRef } from '../pos-ref'
import type { BillLine, PosBill, Reading, TableBills, WriteOutcome } from '../schemas'
import { chooseTargetBill } from '../target-bill'
import type { PosCall, WaiterDriver, WriteHarness } from './harness'

/** Quantities are held in thousandths, from and to decimal text (rule 8: never a float). */
const QUANTITY_SCALE = 3
const thousandths = (quantity: string) => decimalToMinor(quantity, QUANTITY_SCALE)
const quantityText = (value: number) => minorToDecimal(value, QUANTITY_SCALE).replace(/\.?0+$/, '')

interface ToyLine {
  id: string
  item: string
  /** In thousandths. */
  quantity: number
  amountMinor: number
  enteredBy: 'restro' | 'staff'
}

interface ToyBill {
  id: string
  table: string
  openedAt: Date
  byRestro: boolean
  closed: boolean
  lines: ToyLine[]
  /** For a split-off or moved bill: the bill its lines came from. */
  from: string | null
}

/** One page of a list: one entry, and whether more follow. */
export interface ToyPage<T> {
  readonly items: readonly T[]
  readonly more: boolean
}

const PRICES: Record<string, number> = { 'art#1': 450, 'art#2': 1200 }
export const TOY_PAYMENT_TABLE = 'tbl/pay'
/** The toy's tip item: a tip is one line of it, of the tip's amount (D127's tip line). */
export const TOY_TIP_ITEM = 'art#tip'

export class ToyPos {
  tables = new Map<string, { name: string; area: string }>()
  bills: ToyBill[] = []
  log: PosCall[] = []
  stalled = false
  stalledWrites = false
  /** The next write lands, then hangs. */
  stallNextWrite = false
  readsSeen = 0
  /** Reads fail from this read count on; null when they answer. */
  failFrom: number | null = null
  closeBeforeWrite: string | null = null
  seq = 0

  reset(): void {
    this.tables = new Map([
      ['tbl/7', { name: '7', area: 'Hall' }],
      ['tbl/8', { name: '8', area: 'Hall' }],
      [TOY_PAYMENT_TABLE, { name: 'Pay', area: 'Bar' }],
    ])
    this.bills = []
    this.log = []
    this.stalled = false
    this.stalledWrites = false
    this.stallNextWrite = false
    this.readsSeen = 0
    this.failFrom = null
    this.closeBeforeWrite = null
    this.seq = 0
  }

  nextId(prefix: string): string {
    this.seq += 1
    return `${prefix}${this.seq}`
  }

  /** One wire call: logged, then stalled, failed or run. */
  call<T>(name: string, write: boolean, run: () => T): Promise<T> {
    this.log.push({ name, write })
    if (this.stalled || (write && this.stalledWrites)) return new Promise<T>(() => {})
    if (write && this.stallNextWrite) {
      this.stallNextWrite = false
      run()
      return new Promise<T>(() => {})
    }
    if (!write) {
      this.readsSeen += 1
      if (this.failFrom !== null && this.readsSeen >= this.failFrom) {
        return Promise.reject(new Error(`${name} failed`))
      }
    }
    if (write && this.closeBeforeWrite !== null) {
      const bill = this.bills.find((b) => b.id === this.closeBeforeWrite)
      if (bill) bill.closed = true
      this.closeBeforeWrite = null
    }
    return Promise.resolve().then(run)
  }

  open(table: string, openedAt: Date, byRestro: boolean): ToyBill {
    const bill: ToyBill = {
      id: this.nextId('acc-'),
      table,
      openedAt,
      byRestro,
      closed: false,
      lines: [],
      from: null,
    }
    this.bills.push(bill)
    return bill
  }

  addLine(bill: ToyBill, item: string, quantity: string, enteredBy: 'restro' | 'staff'): void {
    const q = thousandths(quantity)
    bill.lines.push({
      id: this.nextId('row:'),
      item,
      quantity: q,
      amountMinor: ratioOfMinor(PRICES[item] ?? 0, q, 1000),
      enteredBy,
    })
  }

  tablePage(index: number): ToyPage<[string, { name: string; area: string }]> {
    return page([...this.tables], index)
  }

  billPage(table: string, index: number): ToyPage<ToyBill> {
    return page(
      this.bills.filter((bill) => bill.table === table && !bill.closed),
      index,
    )
  }

  digest(): string {
    return JSON.stringify([...this.tables], null, 0) + JSON.stringify(this.bills)
  }
}

function page<T>(list: readonly T[], index: number): ToyPage<T> {
  return { items: list.slice(index, index + 1), more: index + 1 < list.length }
}

function withDeadline<T>(ms: number, run: Promise<T>, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late()), ms)
  })
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer))
}

/** Reads every page of a list; any failed page makes the whole reading incomplete (rule 6). */
function readPages<T>(
  pos: ToyPos,
  ctx: ServiceContext,
  name: string,
  pageAt: (index: number) => ToyPage<T>,
): Promise<Reading<T[]>> {
  const run = (async (): Promise<Reading<T[]>> => {
    const items: T[] = []
    for (let index = 0; ; index += 1) {
      const answer = await pos.call(name, false, () => pageAt(index))
      items.push(...answer.items)
      if (!answer.more) return { complete: true, value: items }
    }
  })().catch((error: unknown) => ({ complete: false as const, reason: String(error) }))
  return withDeadline<Reading<T[]>>(ctx.timings.readTimeoutMs, run, () => ({
    complete: false,
    reason: 'timed out',
  }))
}

export const TOY_CAPABILITIES: ServiceCapabilities = {
  ...NO_SERVICE_CAPABILITIES,
  whoEnteredLine: true,
  movePartOfLineQuantity: true,
  severalBillsPerTable: true,
  firstItemsOpenBill: true,
  billOpeningTime: true,
}

function billOut(bill: ToyBill, capabilities: ServiceCapabilities): PosBill {
  return {
    ref: posRef(bill.id),
    totalMinor: bill.lines.reduce((sum, line) => addMinor(sum, line.amountMinor), 0),
    paidMinor: 0,
    openedAt: capabilities.billOpeningTime ? bill.openedAt.toISOString() : null,
    openedByRestro: bill.byRestro,
    paymentInFlight: bill.from !== null,
    lines: bill.lines.map(
      (line): BillLine => ({
        ref: posRef(line.id),
        item: posRef(line.item),
        name: null,
        quantity: quantityText(line.quantity),
        amountMinor: line.amountMinor,
        enteredBy: capabilities.whoEnteredLine ? line.enteredBy : null,
        enteredAt: null,
        restroRef: null,
      }),
    ),
  }
}

type RefusalCode =
  | 'bill_closed'
  | 'already_done'
  | 'amount_mismatch'
  | 'needs_first_item'
  | 'not_supported'

export function toyConnector(pos: ToyPos, capabilities = TOY_CAPABILITIES): ServiceConnector {
  async function read(ctx: ServiceContext, table: PosRef): Promise<Reading<TableBills>> {
    const bills = await readPages(pos, ctx, 'bills.page', (index) => pos.billPage(table.pos, index))
    if (!bills.complete) return bills
    return {
      complete: true,
      value: {
        table,
        currency: 'EUR',
        bills: bills.value.map((bill) => billOut(bill, capabilities)),
      },
    }
  }

  function write<R>(
    ctx: ServiceContext,
    name: string,
    run: () => WriteOutcome<R>,
  ): Promise<WriteOutcome<R>> {
    return withDeadline(ctx.timings.writeTimeoutMs, pos.call(name, true, run), () => ({
      kind: 'unknown',
      reason: `${name} timed out`,
    }))
  }

  const refused = (code: RefusalCode) =>
    ({ kind: 'refused', refusal: { code, scope: 'bill', line: null, detail: null } }) as const

  return {
    kind: 'toy',
    capabilities,
    probe(ctx) {
      const run = pos
        .call('ping', false, () => 1)
        .then(
          () => ({ kind: 'answered', mode: null, degraded: null, fiscalDevice: null }) as const,
          (error: unknown) => ({ kind: 'unknown', reason: String(error) }) as const,
        )
      return withDeadline(ctx.timings.probeBudgetMs, run, () => ({
        kind: 'unknown',
        reason: 'the probe timed out',
      }))
    },
    async readFloor(ctx) {
      const tables = await readPages(pos, ctx, 'tables.page', (index) => pos.tablePage(index))
      if (!tables.complete) return tables
      return {
        complete: true,
        value: {
          bars: [],
          tables: tables.value.map(([id, table]) => ({
            ref: posRef(id),
            name: table.name,
            area: table.area,
            bar: null,
            paymentTable: null,
          })),
        },
      }
    },
    readTable: read,
    async addLines(ctx, request) {
      const reading = await read(ctx, request.table)
      if (!reading.complete) return { kind: 'unknown', reason: reading.reason }
      const target = chooseTargetBill({
        bills: reading.value.bills,
        capabilities,
        serviceDayStartsAt: new Date(request.serviceDayStartsAt),
        excludeBills: request.excludeBills,
      })
      if (target.kind === 'refuse') return refused('needs_first_item')
      return write(ctx, 'bills.add', () => {
        const bill =
          target.kind === 'join'
            ? pos.bills.find((b) => b.id === target.bill.pos)
            : pos.open(request.table.pos, ctx.now(), true)
        if (bill === undefined || bill.closed) return refused('bill_closed')
        for (const line of request.lines) pos.addLine(bill, line.item.pos, line.quantity, 'restro')
        return {
          kind: 'done',
          result: { bill: posRef(bill.id), opened: target.kind === 'open' },
        }
      })
    },
    isolateLines(ctx, request) {
      const onto = capabilities.severalBillsPerTable
        ? request.table
        : capabilities.moveLinesToTable
          ? request.paymentTable
          : null
      if (onto === null) return Promise.resolve(refused('not_supported'))
      return write(ctx, 'bills.split', () => {
        const pick = request.picks[0]
        const source = pos.bills.find((b) => b.id === pick?.bill.pos && !b.closed)
        const line = source?.lines.find((l) => l.id === pick?.line.pos)
        if (source === undefined || line === undefined || pick === undefined) {
          return refused('bill_closed')
        }
        const taken = thousandths(pick.quantity)
        if (taken > line.quantity) return refused('amount_mismatch')
        if (taken !== line.quantity && !capabilities.movePartOfLineQuantity) {
          return refused('not_supported')
        }
        const split = pos.open(onto.pos, ctx.now(), true)
        split.from = source.id
        if (taken === line.quantity) {
          source.lines = source.lines.filter((l) => l !== line)
          split.lines.push(line)
        } else {
          const amount = ratioOfMinor(line.amountMinor, taken, line.quantity)
          split.lines.push({
            ...line,
            id: pos.nextId('row:'),
            quantity: taken,
            amountMinor: amount,
          })
          line.quantity = subtractMinor(line.quantity, taken)
          line.amountMinor = subtractMinor(line.amountMinor, amount)
        }
        return {
          kind: 'done',
          result: { isolated: { ref: posRef(split.id), table: onto } },
        }
      })
    },
    async readIsolated(ctx, isolated) {
      const reading = await read(ctx, isolated.table)
      if (!reading.complete) return reading
      const bill = reading.value.bills.find((b) => b.ref.pos === isolated.ref.pos) ?? null
      return { complete: true, value: { currency: 'EUR', bill } }
    },
    payAndClose(ctx, request) {
      if (request.tipMinor > 0 && !capabilities.recordTipOnClose) {
        return Promise.resolve(refused('not_supported'))
      }
      return write(ctx, 'bills.close', () => {
        const bill = pos.bills.find((b) => b.id === request.isolated.ref.pos)
        if (bill === undefined || bill.closed) return refused('already_done')
        const total = bill.lines.reduce((sum, line) => addMinor(sum, line.amountMinor), 0)
        if (addMinor(total, request.tipMinor) !== request.amountMinor) {
          return refused('amount_mismatch')
        }
        if (request.tipMinor > 0) {
          bill.lines.push({
            id: pos.nextId('row:'),
            item: TOY_TIP_ITEM,
            quantity: 1000,
            amountMinor: request.tipMinor,
            enteredBy: 'restro',
          })
        }
        bill.closed = true
        return { kind: 'done', result: { receiptNumber: null } }
      })
    },
    undoIsolate(ctx, request) {
      return write(ctx, 'bills.merge', () => {
        const split = pos.bills.find((b) => b.id === request.isolated.ref.pos && !b.closed)
        const origin = pos.bills.find((b) => b.id === split?.from && !b.closed)
        if (split === undefined || origin === undefined) return refused('bill_closed')
        origin.lines.push(...split.lines)
        split.lines = []
        split.closed = true
        return { kind: 'done', result: {} }
      })
    },
  }
}

export function toyWaiter(pos: ToyPos, capabilities = TOY_CAPABILITIES): WaiterDriver {
  return {
    async emptyTable() {
      return posRef('tbl/7')
    },
    async sellableItem() {
      return posRef('art#2')
    },
    async openBill(table, options) {
      const bill = pos.open(table.pos, options.openedAt, options.byRestro)
      pos.addLine(bill, 'art#1', '1', options.byRestro ? 'restro' : 'staff')
      return posRef(bill.id)
    },
    async paymentTable() {
      return capabilities.moveLinesToTable ? posRef(TOY_PAYMENT_TABLE) : null
    },
    closeBillBeforeNextWrite(bill) {
      pos.closeBeforeWrite = bill.pos
    },
    async closedBill(ref) {
      const bill = pos.bills.find((b) => b.id === ref.pos && b.closed)
      return bill === undefined ? null : billOut(bill, capabilities)
    },
  }
}

/**
 * A whole harness over a fresh toy POS; `connector` swaps in a variant. Table 8 starts with two
 * bills, a staff one and a later one of Restro's, so reading it takes two pages.
 */
export function toyHarness(
  connector?: (pos: ToyPos) => ServiceConnector,
  name = 'toy',
): WriteHarness {
  const pos = new ToyPos()
  pos.reset()
  const hour = 3_600_000
  const staff = pos.open('tbl/8', new Date(Date.now() - hour), false)
  pos.addLine(staff, 'art#1', '2', 'staff')
  const ours = pos.open('tbl/8', new Date(Date.now() - hour / 2), true)
  pos.addLine(ours, 'art#2', '0.5', 'restro')
  const built = (connector ?? toyConnector)(pos)
  const caps = built.capabilities
  const billOf = (
    bill: ToyBill,
    line: { item: string; quantity: string; amountMinor: number },
  ): PosBill => ({
    ref: posRef(bill.id),
    totalMinor: line.amountMinor,
    paidMinor: 0,
    openedAt: caps.billOpeningTime ? bill.openedAt.toISOString() : null,
    openedByRestro: bill.byRestro,
    paymentInFlight: false,
    lines: [
      {
        ref: posRef(bill.lines[0]?.id ?? ''),
        item: posRef(line.item),
        name: null,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
        enteredBy: caps.whoEnteredLine ? (bill.byRestro ? 'restro' : 'staff') : null,
        enteredAt: null,
        restroRef: null,
      },
    ],
  })
  const expected: TableBills = {
    table: posRef('tbl/8'),
    currency: 'EUR',
    bills: [
      billOf(staff, { item: 'art#1', quantity: '2', amountMinor: 900 }),
      billOf(ours, { item: 'art#2', quantity: '0.5', amountMinor: 600 }),
    ],
  }
  const snapshot = structuredClone(pos.bills)
  return {
    name,
    connector: built,
    pos: {
      reset() {
        pos.reset()
        pos.bills = structuredClone(snapshot)
        pos.seq = 100
      },
      calls: () => pos.log,
      digest: () => pos.digest(),
    },
    faults: {
      stall() {
        pos.stalled = true
      },
      stallWrites() {
        pos.stalledWrites = true
      },
      stallNextWrite() {
        pos.stallNextWrite = true
      },
      failReadsFrom(n) {
        pos.failFrom = pos.readsSeen + n
      },
    },
    table: { ref: posRef('tbl/8'), expected },
    writeModule: {},
    waiterActions: {},
    waiter: toyWaiter(pos, caps),
  }
}
