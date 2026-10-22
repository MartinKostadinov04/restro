// A toy POS and its connector, for the kit's own tests only (kit.test.ts): small enough to read
// in one go, so the kit's write checks run in this package and a connector that is wrong on
// purpose can be built by overriding one step. It is not the simulated POS (#68) and claims
// nothing about any real POS. Ids take varied shapes on purpose (#51's overfitting guard).

import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from '../capabilities'
import type { ServiceConnector, ServiceContext } from '../connector'
import { type PosRef, posRef } from '../pos-ref'
import type { BillLine, PosBill, Reading, TableBills, WriteOutcome } from '../schemas'
import { chooseTargetBill } from '../target-bill'
import type { PosCall, WaiterDriver, WriteHarness } from './harness'

interface ToyLine {
  id: string
  item: string
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
  /** For a split-off bill: the bill its lines came from. */
  from: string | null
}

const PRICES: Record<string, number> = { 'art#1': 450, 'art#2': 1200 }

export class ToyPos {
  tables = new Map<string, { name: string; area: string }>()
  bills: ToyBill[] = []
  log: PosCall[] = []
  stalled = false
  failingReads = false
  closeBeforeWrite: string | null = null
  seq = 0

  reset(): void {
    this.tables = new Map([
      ['tbl/7', { name: '7', area: 'Hall' }],
      ['tbl/8', { name: '8', area: 'Hall' }],
    ])
    this.bills = []
    this.log = []
    this.stalled = false
    this.failingReads = false
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
    if (this.stalled) return new Promise<T>(() => {})
    if (!write && this.failingReads) return Promise.reject(new Error(`${name} failed`))
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

  addLine(bill: ToyBill, item: string, quantity: number, enteredBy: 'restro' | 'staff'): void {
    const price = PRICES[item] ?? 0
    bill.lines.push({
      id: this.nextId('row:'),
      item,
      quantity,
      amountMinor: price * quantity,
      enteredBy,
    })
  }

  digest(): string {
    return JSON.stringify([...this.tables], null, 0) + JSON.stringify(this.bills)
  }
}

function withDeadline<T>(ms: number, run: Promise<T>, late: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(late()), ms)
  })
  return Promise.race([run, deadline]).finally(() => clearTimeout(timer))
}

export const TOY_CAPABILITIES: ServiceCapabilities = {
  ...NO_SERVICE_CAPABILITIES,
  whoEnteredLine: true,
  severalBillsPerTable: true,
  firstItemsOpenBill: true,
  billOpeningTime: true,
  movePartOfLineQuantity: false,
}

export function toyConnector(pos: ToyPos, capabilities = TOY_CAPABILITIES): ServiceConnector {
  function billOut(bill: ToyBill): PosBill {
    return {
      ref: posRef(bill.id),
      totalMinor: bill.lines.reduce((sum, line) => sum + line.amountMinor, 0),
      paidMinor: 0,
      openedAt: capabilities.billOpeningTime ? bill.openedAt.toISOString() : null,
      openedByRestro: bill.byRestro,
      paymentInFlight: false,
      lines: bill.lines.map(
        (line): BillLine => ({
          ref: posRef(line.id),
          item: posRef(line.item),
          name: null,
          quantity: String(line.quantity),
          amountMinor: line.amountMinor,
          enteredBy: capabilities.whoEnteredLine ? line.enteredBy : null,
          enteredAt: null,
          restroRef: null,
        }),
      ),
    }
  }

  async function read(ctx: ServiceContext, table: PosRef): Promise<Reading<TableBills>> {
    const run: Promise<Reading<TableBills>> = pos
      .call('bills.list', false, () =>
        pos.bills.filter((bill) => bill.table === table.pos && !bill.closed),
      )
      .then(
        (bills) => ({
          complete: true as const,
          value: { table, currency: 'EUR' as const, bills: bills.map(billOut) },
        }),
        (error: unknown) => ({ complete: false as const, reason: String(error) }),
      )
    return withDeadline<Reading<TableBills>>(ctx.timings.readTimeoutMs, run, () => ({
      complete: false,
      reason: 'timed out',
    }))
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

  const refused = (code: 'bill_closed' | 'already_done' | 'amount_mismatch' | 'needs_first_item') =>
    ({ kind: 'refused', refusal: { code, scope: 'bill', line: null, detail: null } }) as const

  return {
    kind: 'toy',
    capabilities,
    probe(ctx) {
      const run = pos
        .call('ping', false, () => 1)
        .then(
          () => ({ kind: 'answered', mode: null, degraded: false, fiscalDevice: null }) as const,
          (error: unknown) => ({ kind: 'unknown', reason: String(error) }) as const,
        )
      return withDeadline(ctx.timings.probeBudgetMs, run, () => ({
        kind: 'unknown',
        reason: 'the probe timed out',
      }))
    },
    readFloor(ctx) {
      const run = pos
        .call('tables.list', false, () => [...pos.tables])
        .then(
          (tables) => ({
            complete: true as const,
            value: {
              bars: [],
              tables: tables.map(([id, table]) => ({
                ref: posRef(id),
                name: table.name,
                area: table.area,
                bar: null,
                paymentTable: null,
              })),
            },
          }),
          (error: unknown) => ({ complete: false as const, reason: String(error) }),
        )
      return withDeadline(ctx.timings.readTimeoutMs, run, () => ({
        complete: false,
        reason: 'timed out',
      }))
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
        for (const line of request.lines) {
          pos.addLine(bill, line.item.pos, Number(line.quantity), 'restro')
        }
        return {
          kind: 'done',
          result: { bill: posRef(bill.id), opened: target.kind === 'open' },
        }
      })
    },
    isolateLines(ctx, request) {
      return write(ctx, 'bills.split', () => {
        const pick = request.picks[0]
        const source = pos.bills.find((b) => b.id === pick?.bill.pos && !b.closed)
        const line = source?.lines.find((l) => l.id === pick?.line.pos)
        if (source === undefined || line === undefined || pick === undefined) {
          return refused('bill_closed')
        }
        const split = pos.open(request.table.pos, ctx.now(), true)
        split.from = source.id
        source.lines = source.lines.filter((l) => l !== line)
        split.lines.push(line)
        return {
          kind: 'done',
          result: { isolated: { ref: posRef(split.id), table: request.table } },
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
      return write(ctx, 'bills.close', () => {
        const bill = pos.bills.find((b) => b.id === request.isolated.ref.pos)
        if (bill === undefined || bill.closed) return refused('already_done')
        const total = bill.lines.reduce((sum, line) => sum + line.amountMinor, 0)
        if (total !== request.amountMinor) return refused('amount_mismatch')
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

export function toyWaiter(pos: ToyPos): WaiterDriver {
  return {
    async emptyTable() {
      return posRef('tbl/7')
    },
    async sellableItem() {
      return posRef('art#2')
    },
    async openBill(table, options) {
      const bill = pos.open(table.pos, options.openedAt, options.byRestro)
      pos.addLine(bill, 'art#1', 1, options.byRestro ? 'restro' : 'staff')
      return posRef(bill.id)
    },
    async paymentTable() {
      return null
    },
    closeBillBeforeNextWrite(bill) {
      pos.closeBeforeWrite = bill.pos
    },
  }
}

/** A whole harness over a fresh toy POS; `connector` swaps in a variant. */
export function toyHarness(
  connector?: (pos: ToyPos) => ServiceConnector,
  name = 'toy',
): WriteHarness {
  const pos = new ToyPos()
  pos.reset()
  const opened = pos.open('tbl/8', new Date(Date.now() - 3_600_000), false)
  pos.addLine(opened, 'art#1', 2, 'staff')
  const expected: TableBills = { table: posRef('tbl/8'), currency: 'EUR', bills: [billOf(opened)] }
  function billOf(bill: ToyBill): PosBill {
    return {
      ref: posRef(bill.id),
      totalMinor: 900,
      paidMinor: 0,
      openedAt: bill.openedAt.toISOString(),
      openedByRestro: false,
      paymentInFlight: false,
      lines: [
        {
          ref: posRef(bill.lines[0]?.id ?? ''),
          item: posRef('art#1'),
          name: null,
          quantity: '2',
          amountMinor: 900,
          enteredBy: 'staff',
          enteredAt: null,
          restroRef: null,
        },
      ],
    }
  }
  const snapshot = structuredClone(pos.bills)
  return {
    name,
    connector: (connector ?? toyConnector)(pos),
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
      failReads() {
        pos.failingReads = true
      },
    },
    table: { ref: posRef('tbl/8'), expected },
    writeModule: {},
    waiterActions: {},
    waiter: toyWaiter(pos),
  }
}
