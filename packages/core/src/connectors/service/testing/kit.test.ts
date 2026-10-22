import { describe, expect, it } from 'vitest'

import { NO_SERVICE_CAPABILITIES, type ServiceCapabilities } from '../capabilities'
import type { ServiceConnector } from '../connector'
import { posRef } from '../pos-ref'
import {
  capabilitiesCheck,
  floorCheck,
  floorFailedPartCheck,
  probeAnswersWithoutWritingCheck,
  probeTimeoutCheck,
  tableFailedPartCheck,
} from './checks-read'
import { paymentRouteCheck, staffBillCheck, writeTimeoutCheck } from './checks-write'
import { posIdLeaks, waiterActionProblems } from './guard'
import { serviceConnectorSuite } from './suite'
import { TOY_CAPABILITIES, ToyPos, toyConnector, toyHarness } from './toy-pos'

/** One bill per table: lines are isolated by moving them to a payment table, whole lines only. */
const ONE_BILL: ServiceCapabilities = {
  ...NO_SERVICE_CAPABILITIES,
  whoEnteredLine: true,
  billOpeningTime: true,
  moveLinesToTable: true,
}

// The kit on a connector that is right (the whole suite passes) and on connectors that are wrong
// on purpose (each check finds its fault). The toy POS is the kit's own test double, not #68.

serviceConnectorSuite(toyHarness())
serviceConnectorSuite(
  toyHarness(
    (pos) => toyConnector(pos, ONE_BILL),
    'toy with one bill per table and a payment table, no first items, no staff bills',
  ),
)

function variant(
  override: (pos: ToyPos, base: ServiceConnector) => Partial<ServiceConnector>,
  capabilities = TOY_CAPABILITIES,
) {
  return toyHarness((pos) => {
    const base = toyConnector(pos, capabilities)
    return { ...base, ...override(pos, base) }
  })
}

describe('the kit on a POS that can isolate lines neither way', () => {
  it('passes when isolating is refused as not supported', async () => {
    const harness = toyHarness((pos) => toyConnector(pos, { ...ONE_BILL, moveLinesToTable: false }))
    expect(await paymentRouteCheck(harness)).toStrictEqual([])
  })
})

describe('the kit catches a connector that is wrong', () => {
  it('a probe that writes', async () => {
    const harness = variant((pos, base) => ({
      async probe(ctx) {
        await pos.call('bills.touch', true, () => 1)
        return base.probe(ctx)
      },
    }))
    expect(await probeAnswersWithoutWritingCheck(harness)).toContain(
      'the probe wrote to the POS: bills.touch',
    )
  })

  it('a timeout reported as a refusal', async () => {
    const harness = variant((_pos, base) => ({
      async probe(ctx) {
        const result = await base.probe(ctx)
        return result.kind === 'unknown'
          ? {
              kind: 'refused',
              refusal: { code: 'credentials', scope: 'login', line: null, detail: null },
            }
          : result
      },
    }))
    expect(await probeTimeoutCheck(harness)).toContain(
      'a stalled probe answered refused, not unknown',
    )
  })

  it('a probe that ignores the budget it is given', async () => {
    const harness = variant((pos) => ({
      async probe() {
        await new Promise((resolve) => setTimeout(resolve, 2_000))
        return pos.stalled
          ? { kind: 'unknown', reason: 'late' }
          : { kind: 'answered', mode: null, degraded: null, fiscalDevice: null }
      },
    }))
    const problems = await probeTimeoutCheck(harness)
    expect(problems.some((p) => p.includes('ignores the probe budget'))).toBe(true)
  })

  it('a partial floor returned as a shorter list', async () => {
    const harness = variant(() => ({
      async readFloor() {
        return { complete: true, value: { tables: [], bars: [] } }
      },
    }))
    expect(await floorFailedPartCheck(harness)).toContain(
      'reading the floor made no POS call the harness saw',
    )
  })

  it('a paged read that keeps the pages that answered and calls them complete', async () => {
    const harness = variant((pos) => ({
      async readFloor() {
        const tables = []
        try {
          for (let index = 0; ; index += 1) {
            const page = await pos.call('tables.page', false, () => pos.tablePage(index))
            tables.push(...page.items)
            if (!page.more) break
          }
        } catch {
          // Drops the failed page: rule 6 says such a reading concludes nothing.
        }
        return {
          complete: true,
          value: {
            bars: [],
            tables: tables.map(([id, t]) => ({
              ref: posRef(id),
              name: t.name,
              area: t.area,
              bar: null,
              paymentTable: null,
            })),
          },
        }
      },
      async readTable(_ctx, table) {
        try {
          for (let index = 0; ; index += 1) {
            const page = await pos.call('bills.page', false, () => pos.billPage(table.pos, index))
            if (!page.more) break
          }
        } catch {
          // Same fault on a table: fewer bills, called complete.
        }
        return { complete: true, value: { table, currency: 'EUR', bills: [] } }
      },
    }))
    const floor = await floorFailedPartCheck(harness)
    expect(floor).toContain('a floor read whose call 2 of 3 failed came back complete')
    expect(floor).toContain('a floor read whose call 3 of 3 failed came back complete')
    expect(floor).toContain('a floor read whose call 1 of 3 failed came back complete')
    expect(await tableFailedPartCheck(harness)).toContain(
      'a table read whose call 2 of 2 failed came back complete',
    )
  })

  it('a made-up bar', async () => {
    const harness = variant(() => ({
      async readFloor() {
        return {
          complete: true,
          value: {
            bars: [{ ref: posRef('bar-x'), name: 'Main' }],
            tables: [
              {
                ref: posRef('tbl/7'),
                name: '7',
                area: null,
                bar: posRef('bar-x'),
                paymentTable: null,
              },
            ],
          },
        }
      },
    }))
    const problems = await floorCheck(harness)
    expect(problems).toContain('bars are listed, but tableBar is not declared')
  })

  it('a POS id copied into a name', () => {
    expect(posIdLeaks({ ref: posRef('tbl/7'), name: 'tbl/7' })).toStrictEqual([
      '$.name carries the POS id "tbl/7" outside a PosRef',
    ])
  })

  it('availability offered without being declared', async () => {
    const harness = variant(() => ({
      async readAvailability() {
        return { complete: true, value: { items: [] } }
      },
    }))
    expect(await capabilitiesCheck(harness)).toContain(
      'readAvailability is offered but itemAvailability is not declared',
    )
  })

  it('a round on a staff bill where the capability is not declared', async () => {
    const harness = toyHarness((pos) => {
      const base = toyConnector(pos, { ...TOY_CAPABILITIES, addToStaffOpenedBill: false })
      return {
        ...base,
        // Joins the oldest open bill whoever opened it: D124 §3 says only Restro's own.
        addLines(ctx, request) {
          return toyConnector(pos, { ...TOY_CAPABILITIES, addToStaffOpenedBill: true }).addLines(
            ctx,
            request,
          )
        },
      }
    })
    const problems = await staffBillCheck(harness)
    expect(problems).toContain('no new POS bill appeared')
  })

  it('a round sent again after a timeout', async () => {
    const harness = variant((pos) => ({
      async addLines(ctx) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const answered = await Promise.race([
            pos.call('bills.add', true, () => true),
            new Promise<false>((resolve) =>
              setTimeout(() => resolve(false), ctx.timings.writeTimeoutMs / 2),
            ),
          ])
          if (answered) return { kind: 'done', result: { bill: null, opened: false } }
        }
        return { kind: 'unknown', reason: 'timed out twice' }
      },
    }))
    const problems = await writeTimeoutCheck(harness)
    expect(problems).toContain('a stalled round was written 2 times: bills.add, bills.add')
  })

  it('a round that gives up before it reaches the POS', async () => {
    const harness = variant(() => ({
      async addLines() {
        return { kind: 'unknown', reason: 'never sent' }
      },
    }))
    expect(await writeTimeoutCheck(harness)).toContain(
      'the stalled round never reached the POS: no write was attempted',
    )
  })

  it('isolating that copies the picked lines instead of moving them', async () => {
    const harness = variant((pos, base) => ({
      async isolateLines(ctx, request) {
        const outcome = await base.isolateLines(ctx, request)
        if (outcome.kind === 'done') {
          const split = pos.bills.find((b) => b.id === outcome.result.isolated.ref.pos)
          const source = pos.bills.find((b) => b.id === split?.from)
          for (const line of split?.lines ?? []) {
            source?.lines.push({ ...line, id: pos.nextId('row:') })
          }
        }
        return outcome
      },
    }))
    const problems = await paymentRouteCheck(harness)
    expect(problems.some((p) => p.includes('the lines were copied, not moved'))).toBe(true)
    expect(problems.some((p) => p.startsWith('after isolating, the original bill holds'))).toBe(
      true,
    )
  })

  it('a one-bill POS that splits onto the real table instead of the payment table', async () => {
    const harness = variant(
      (pos) => ({
        isolateLines(ctx, request) {
          const splitter = { ...TOY_CAPABILITIES, movePartOfLineQuantity: false }
          return toyConnector(pos, splitter).isolateLines(ctx, request)
        },
      }),
      ONE_BILL,
    )
    expect(await paymentRouteCheck(harness)).toContain('the isolated bill is on tbl/7, not tbl/pay')
  })

  it('part of a line isolated where movePartOfLineQuantity is not declared', async () => {
    const harness = variant(
      (pos) => ({
        isolateLines(ctx, request) {
          return toyConnector(pos, TOY_CAPABILITIES).isolateLines(ctx, request)
        },
      }),
      { ...TOY_CAPABILITIES, movePartOfLineQuantity: false },
    )
    const problems = await paymentRouteCheck(harness)
    expect(
      problems.some((p) =>
        p.startsWith('movePartOfLineQuantity is not declared, but isolating came back done'),
      ),
    ).toBe(true)
  })

  it('a write that is not a waiter action, and an operation past the seam', () => {
    const connector = { ...toyConnector(new ToyPos()), updatePrice() {} }
    const problems = waiterActionProblems(
      connector as unknown as ServiceConnector,
      { addRound: () => {}, setPrice: () => {} },
      { addRound: ['add_round'], ghost: ['open_bill'], setPrice: ['change_price' as never] },
    )
    expect(problems).toStrictEqual([
      'ghost is declared as a waiter action but the write module has no such export',
      "setPrice is declared as change_price, which is not one of D110's waiter actions",
      'the connector offers updatePrice, which is not a step of the service interface',
    ])
  })
})
