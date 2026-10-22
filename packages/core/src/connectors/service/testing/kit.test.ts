import { describe, expect, it } from 'vitest'

import { NO_SERVICE_CAPABILITIES } from '../capabilities'
import type { ServiceConnector } from '../connector'
import { posRef } from '../pos-ref'
import {
  capabilitiesCheck,
  floorCheck,
  floorFailedPartCheck,
  probeAnswersWithoutWritingCheck,
  probeTimeoutCheck,
} from './checks-read'
import { staffBillCheck, writeTimeoutCheck } from './checks-write'
import { posIdLeaks, waiterActionProblems } from './guard'
import { serviceConnectorSuite } from './suite'
import { TOY_CAPABILITIES, ToyPos, toyConnector, toyHarness } from './toy-pos'

// The kit on a connector that is right (the whole suite passes) and on connectors that are wrong
// on purpose (each check finds its fault). The toy POS is the kit's own test double, not #68.

serviceConnectorSuite(toyHarness())
serviceConnectorSuite(
  toyHarness(
    (pos) =>
      toyConnector(pos, {
        ...NO_SERVICE_CAPABILITIES,
        whoEnteredLine: true,
        billOpeningTime: true,
      }),
    'toy with one bill per table, no first items, no staff bills',
  ),
)

function variant(override: (pos: ToyPos, base: ServiceConnector) => Partial<ServiceConnector>) {
  return toyHarness((pos) => {
    const base = toyConnector(pos)
    return { ...base, ...override(pos, base) }
  })
}

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
          : { kind: 'answered', mode: null, degraded: false, fiscalDevice: null }
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
      'a floor read with a failed part came back complete',
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
