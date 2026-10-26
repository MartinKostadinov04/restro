import { describe, expect, it } from 'vitest'

import {
  GUEST_API_MAX_BYTES,
  GuestActionAnswerSchema,
  GuestActionRequestSchema,
  GuestStateAnswerSchema,
  GuestStateQuerySchema,
  isGuestRefusalCode,
} from './guest-api'
import { GUEST_REFUSAL_CODES } from './service-vocabulary'

const nd = (n: number) => `nd_${String(n).padStart(22, '0')}`
const ol = (n: number) => `ol_${String(n).padStart(22, '0')}`
const uuid = '00000000-0000-4000-8000-000000000001'

const STATE = {
  unchanged: false,
  version: 3,
  next: 2_000,
  table: { label: '12' },
  ordering: { state: 'on' },
  order: {
    lines: [
      {
        id: ol(1),
        itemId: nd(1),
        optionIds: [],
        qty: 2,
        note: '',
        rev: 1,
        mode: 'on_bill',
        held: null,
      },
    ],
    removed: [],
    earlier: null,
  },
  sentOrders: [],
  bill: null,
}

describe('the guest API wire shapes (#75)', () => {
  it('reads a full state and an unchanged answer, and nothing in between', () => {
    expect(GuestStateAnswerSchema.parse(STATE)).toEqual(STATE)
    const unchanged = { unchanged: true, version: 3, next: 10_000 }
    expect(GuestStateAnswerSchema.parse(unchanged)).toEqual(unchanged)
    expect(GuestStateAnswerSchema.safeParse({ ...unchanged, order: STATE.order }).success).toBe(
      false,
    )
  })

  it('refuses a state carrying anything beyond its shape (a POS id, a price, a code)', () => {
    const line = STATE.order.lines[0]
    for (const extra of [{ posId: '123' }, { priceMinor: 900 }]) {
      const lines = [{ ...line, ...extra }]
      const state = { ...STATE, order: { ...STATE.order, lines } }
      expect(GuestStateAnswerSchema.safeParse(state).success).toBe(false)
    }
    expect(GuestStateAnswerSchema.safeParse({ ...STATE, code: 'abc' }).success).toBe(false)
    expect(
      GuestStateAnswerSchema.safeParse({ ...STATE, table: { label: '12', id: 'tb_1' } }).success,
    ).toBe(false)
  })

  it('takes a command with its tap’s age, the order view by default, and nothing more', () => {
    const command = { kind: 'order.remove', actionId: uuid, lineId: ol(1) }
    expect(GuestActionRequestSchema.parse({ command, ageMs: 40 })).toEqual({
      command,
      ageMs: 40,
      view: 'order',
    })
    expect(GuestActionRequestSchema.safeParse({ command, ageMs: -1 }).success).toBe(false)
    expect(GuestActionRequestSchema.safeParse({ command }).success).toBe(false)
    expect(GuestActionRequestSchema.safeParse({ command, ageMs: 1, code: 'x' }).success).toBe(false)
  })

  it('reads the query with menu as the default view', () => {
    expect(GuestStateQuerySchema.parse({})).toEqual({ view: 'menu' })
    expect(GuestStateQuerySchema.parse({ since: '7', view: 'bill' })).toEqual({
      since: 7,
      view: 'bill',
    })
    expect(GuestStateQuerySchema.safeParse({ view: 'kitchen' }).success).toBe(false)
  })

  it('answers a command with its result and the state, or no state', () => {
    const result = {
      actionId: uuid,
      status: 'rejected',
      code: 'line_held',
      subjectId: null,
      ref: null,
    }
    expect(GuestActionAnswerSchema.parse({ result, state: null })).toEqual({ result, state: null })
    expect(GuestActionAnswerSchema.parse({ result, state: STATE }).state).toEqual(STATE)
  })

  it('knows every refusal code the shell words, and an 8 KB cap', () => {
    for (const code of GUEST_REFUSAL_CODES) expect(isGuestRefusalCode(code)).toBe(true)
    expect(isGuestRefusalCode('teapot')).toBe(false)
    expect(GUEST_API_MAX_BYTES).toBe(8192)
  })
})
