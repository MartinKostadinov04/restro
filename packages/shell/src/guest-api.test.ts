import { describe, expect, it } from 'vitest'

import {
  GUEST_API_MAX_BYTES,
  GUEST_PHONE_PATTERN,
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
  location: { state: 'off', passSeconds: null, dayEndsInSeconds: 3_600, venueName: 'Club' },
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
    const unchanged = { unchanged: true, version: 3, next: 10_000, location: 'off' }
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
    const answer = { result, state: null, pass: null }
    expect(GuestActionAnswerSchema.parse(answer)).toEqual(answer)
    expect(GuestActionAnswerSchema.parse({ ...answer, state: STATE }).state).toEqual(STATE)
    expect(GuestActionAnswerSchema.safeParse({ result, state: null }).success).toBe(false)
  })

  it('hides the order and the bill while the phone has no pass (#76)', () => {
    const needed = {
      ...STATE,
      location: { state: 'needed', passSeconds: null, dayEndsInSeconds: 3_600, venueName: 'Club' },
      order: null,
    }
    expect(GuestStateAnswerSchema.parse(needed)).toEqual(needed)
  })

  it('takes a check with a position, a consent version and a token, and nothing more (#76)', () => {
    const command = { kind: 'order.remove', actionId: uuid, lineId: ol(1) }
    const check = {
      location: { lat: 42.6977, lng: 23.3219, accuracyM: 12 },
      consentVersion: 'v1',
      humanToken: 'token',
    }
    expect(GuestActionRequestSchema.parse({ command, ageMs: 1, check }).check).toEqual(check)
    const extra = { ...check, ip: '1.2.3.4' }
    expect(GuestActionRequestSchema.safeParse({ command, ageMs: 1, check: extra }).success).toBe(
      false,
    )
    const far = { ...check, location: { lat: 91, lng: 0, accuracyM: 1 } }
    expect(GuestActionRequestSchema.safeParse({ command, ageMs: 1, check: far }).success).toBe(
      false,
    )
  })

  it('knows the phone value’s shape (#76)', () => {
    expect(GUEST_PHONE_PATTERN.test('A'.repeat(22))).toBe(true)
    expect(GUEST_PHONE_PATTERN.test('A'.repeat(21))).toBe(false)
    expect(GUEST_PHONE_PATTERN.test(`${'A'.repeat(21)}!`)).toBe(false)
  })

  it('knows every refusal code the shell words, and an 8 KB cap', () => {
    for (const code of GUEST_REFUSAL_CODES) expect(isGuestRefusalCode(code)).toBe(true)
    expect(isGuestRefusalCode('teapot')).toBe(false)
    expect(GUEST_API_MAX_BYTES).toBe(8192)
  })
})
