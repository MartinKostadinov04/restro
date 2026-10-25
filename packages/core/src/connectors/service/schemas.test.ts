import { describe, expect, it } from 'vitest'

import {
  NO_SERVICE_CAPABILITIES,
  SERVICE_CAPABILITIES,
  ServiceCapabilitiesSchema,
} from './capabilities'
import { posRef } from './pos-ref'
import {
  BillLineSchema,
  DecimalQuantitySchema,
  FloorSchema,
  OrderQuantitySchema,
  PayAndCloseRequestSchema,
  RefusalSchema,
  readingSchema,
  writeOutcomeSchema,
} from './schemas'
import { SERVICE_TIMING_SOURCES, SERVICE_TIMINGS, ServiceTimingsSchema } from './timings'
import { SERVICE_WRITE_STEPS, WAITER_ACTIONS } from './waiter-actions'

describe('the seam schemas', () => {
  it('quantities are decimal text, never a float (rule 8)', () => {
    expect(DecimalQuantitySchema.safeParse('2').success).toBe(true)
    expect(DecimalQuantitySchema.safeParse('0.5').success).toBe(true)
    expect(DecimalQuantitySchema.safeParse('-1').success).toBe(true)
    expect(DecimalQuantitySchema.safeParse(2).success).toBe(false)
    expect(DecimalQuantitySchema.safeParse('1e3').success).toBe(false)
    expect(DecimalQuantitySchema.safeParse('02').success).toBe(false)
    expect(OrderQuantitySchema.safeParse('0').success).toBe(false)
    expect(OrderQuantitySchema.safeParse('-1').success).toBe(false)
    expect(OrderQuantitySchema.safeParse('0.25').success).toBe(true)
  })

  it('a line carries a signed integer amount (fix 30), never a fractional one', () => {
    const line = {
      ref: posRef('r1'),
      item: null,
      name: 'Discount',
      quantity: '1',
      amountMinor: -250,
      enteredBy: null,
      enteredAt: null,
      restroRef: null,
    }
    expect(BillLineSchema.safeParse(line).success).toBe(true)
    expect(BillLineSchema.safeParse({ ...line, amountMinor: -2.5 }).success).toBe(false)
    expect(BillLineSchema.safeParse({ ...line, article_id: 7 }).success).toBe(false)
  })

  it('a refusal names its line exactly when it is scoped to a line', () => {
    const refusal = { code: 'item_unavailable', scope: 'line', line: 1, detail: null }
    expect(RefusalSchema.safeParse(refusal).success).toBe(true)
    expect(RefusalSchema.safeParse({ ...refusal, line: null }).success).toBe(false)
    expect(RefusalSchema.safeParse({ ...refusal, scope: 'bill' }).success).toBe(false)
  })

  it('a timeout has no "refused" form of its own: an outcome is done, refused or unknown', () => {
    const schema = writeOutcomeSchema(FloorSchema)
    expect(schema.safeParse({ kind: 'timeout' }).success).toBe(false)
    expect(schema.safeParse({ kind: 'unknown', reason: 'timed out' }).success).toBe(true)
  })

  it('an incomplete reading carries no value (rule 6)', () => {
    const schema = readingSchema(FloorSchema)
    expect(
      schema.safeParse({
        complete: false,
        reason: 'page 2 failed',
        value: { tables: [], bars: [] },
      }).success,
    ).toBe(false)
  })

  it('a floor never names a bar it does not list (D124 §1)', () => {
    const table = {
      ref: posRef('t1'),
      name: '1',
      area: null,
      bar: posRef('b1'),
      paymentTable: null,
    }
    expect(FloorSchema.safeParse({ tables: [table], bars: [] }).success).toBe(false)
    expect(
      FloorSchema.safeParse({ tables: [table], bars: [{ ref: posRef('b1'), name: 'Main' }] })
        .success,
    ).toBe(true)
    expect(FloorSchema.safeParse({ tables: [table, table], bars: [] }).success).toBe(false)
  })

  it('a capability declaration names every capability and nothing else', () => {
    expect(ServiceCapabilitiesSchema.safeParse(NO_SERVICE_CAPABILITIES).success).toBe(true)
    const { trainingMode: _, ...missing } = NO_SERVICE_CAPABILITIES
    expect(ServiceCapabilitiesSchema.safeParse(missing).success).toBe(false)
    expect(
      ServiceCapabilitiesSchema.safeParse({ ...NO_SERVICE_CAPABILITIES, webhooks: true }).success,
    ).toBe(false)
    expect(SERVICE_CAPABILITIES).toContain('addToStaffOpenedBill')
  })

  it('a close carries its tip inside the amount, in whole minor units (D127, rule 8)', () => {
    const close = {
      isolated: { ref: posRef('acc 1'), table: posRef('pay 1') },
      amountMinor: 1250,
      tipMinor: 250,
      paymentType: null,
      ref: 'py_1-close',
    }
    expect(PayAndCloseRequestSchema.safeParse(close).success).toBe(true)
    expect(PayAndCloseRequestSchema.safeParse({ ...close, tipMinor: 0 }).success).toBe(true)
    expect(PayAndCloseRequestSchema.safeParse({ ...close, tipMinor: 1251 }).success).toBe(false)
    expect(PayAndCloseRequestSchema.safeParse({ ...close, tipMinor: 2.5 }).success).toBe(false)
    expect(PayAndCloseRequestSchema.safeParse({ ...close, tipMinor: -1 }).success).toBe(false)
    const { tipMinor: _, ...noTip } = close
    expect(PayAndCloseRequestSchema.safeParse(noTip).success).toBe(false)
  })

  it('every timing has its source named, and the defaults pass their schema', () => {
    expect(ServiceTimingsSchema.parse(SERVICE_TIMINGS)).toStrictEqual(SERVICE_TIMINGS)
    for (const key of Object.keys(SERVICE_TIMINGS)) {
      expect(SERVICE_TIMING_SOURCES[key as keyof typeof SERVICE_TIMINGS]).toMatch(/\S/)
    }
  })

  it("every write step of the interface is one of D110's waiter actions", () => {
    for (const actions of Object.values(SERVICE_WRITE_STEPS)) {
      for (const action of actions) expect(WAITER_ACTIONS).toContain(action)
    }
  })
})
