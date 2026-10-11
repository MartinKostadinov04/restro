import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { stubServices } from '../testing'
import { SERVICE_KINDS } from './features'
import {
  EMPTY_SERVICE_STATE,
  type GuestCommand,
  GuestCommandSchema,
  PAY_METHODS,
  PAY_SCOPES,
  RECEIPT_ACTIONS,
  SERVICE_LIMITS,
} from './services'
import { stringsFor } from './strings'

// Compile-time check: what the schema parses is a `GuestCommand`, so the hand-written type and the
// schema cannot drift apart without `pnpm typecheck` failing.
const _parsedIsACommand = (parsed: z.output<typeof GuestCommandSchema>): GuestCommand => parsed
void _parsedIsACommand

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const nd = (n: number): `nd_${string}` => `nd_${String(n).padStart(22, '0')}`

const line = { itemId: nd(1), optionIds: [nd(2), nd(3)], qty: 2, note: 'no onion' }

/** One valid command of every kind. */
const VALID: readonly GuestCommand[] = [
  { kind: 'order.send', actionId: uuid(1), lines: [line] },
  { kind: 'service.request', actionId: uuid(2), request: 'waiter', note: '' },
  { kind: 'service.cancel', actionId: uuid(3), requestId: 'rq-1' },
  {
    kind: 'pay.quote',
    actionId: uuid(4),
    scope: 'full',
    people: null,
    tipPercent: 10,
    tipMinor: null,
    promo: null,
  },
  {
    kind: 'pay.quote',
    actionId: uuid(5),
    scope: 'split',
    people: 3,
    tipPercent: null,
    tipMinor: 250,
    promo: 'SUMMER',
  },
  { kind: 'pay.start', actionId: uuid(6), quoteId: 'q-1', method: 'card' },
  { kind: 'receipt.action', actionId: uuid(7), receiptId: 'rc-1', action: 'pdf' },
]

const ok = (value: unknown) => GuestCommandSchema.safeParse(value).success

const order = (changes: Record<string, unknown>) => ({ ...VALID[0], ...changes })
const quote = (changes: Record<string, unknown>) => ({ ...VALID[3], ...changes })

describe('GuestCommandSchema', () => {
  it('accepts a valid command of every kind', () => {
    for (const command of VALID) {
      const result = GuestCommandSchema.safeParse(command)
      expect(result.success, JSON.stringify(command)).toBe(true)
      expect(result.data).toEqual(command)
    }
  })

  it('accepts every service kind, pay scope, pay method and receipt action', () => {
    for (const request of SERVICE_KINDS) {
      expect(ok({ kind: 'service.request', actionId: uuid(1), request, note: '' }), request).toBe(
        true,
      )
    }
    for (const method of PAY_METHODS) {
      expect(ok({ kind: 'pay.start', actionId: uuid(1), quoteId: 'q', method }), method).toBe(true)
    }
    for (const action of RECEIPT_ACTIONS) {
      expect(
        ok({ kind: 'receipt.action', actionId: uuid(1), receiptId: 'r', action }),
        action,
      ).toBe(true)
    }
    for (const scope of PAY_SCOPES) {
      const people = scope === 'split' ? 2 : null
      expect(ok(quote({ scope, people })), scope).toBe(true)
    }
  })

  it('refuses a command it does not know, and unknown keys on every kind (strict)', () => {
    expect(ok({ kind: 'order.cancel', actionId: uuid(1) })).toBe(false)
    expect(ok({ actionId: uuid(1) })).toBe(false)
    expect(ok(null)).toBe(false)
    for (const command of VALID) expect(ok({ ...command, extra: 1 }), command.kind).toBe(false)
    // A face never sends a price, a table token or a barsy id.
    expect(ok(order({ price: 100 }))).toBe(false)
    expect(ok(order({ lines: [{ ...line, price: 100 }] }))).toBe(false)
    expect(ok(order({ lines: [{ ...line, unitMinor: 100 }] }))).toBe(false)
  })

  it('needs an actionId that is a uuid, on every kind', () => {
    for (const command of VALID) {
      expect(ok({ ...command, actionId: 'not-a-uuid' }), command.kind).toBe(false)
      expect(ok({ ...command, actionId: '' }), command.kind).toBe(false)
      const { actionId: _omitted, ...without } = command
      expect(ok(without), command.kind).toBe(false)
    }
  })

  it('limits an order: 1 to 50 lines, quantity 1 to 50, up to 32 options, a note up to 200 characters', () => {
    expect(ok(order({ lines: [] }))).toBe(false)
    expect(ok(order({ lines: Array.from({ length: SERVICE_LIMITS.lines }, () => line) }))).toBe(
      true,
    )
    expect(ok(order({ lines: Array.from({ length: SERVICE_LIMITS.lines + 1 }, () => line) }))).toBe(
      false,
    )

    for (const qty of [0, -1, 51, 1.5, Number.NaN, '2']) {
      expect(ok(order({ lines: [{ ...line, qty }] })), `qty ${qty}`).toBe(false)
    }
    for (const qty of [1, 50])
      expect(ok(order({ lines: [{ ...line, qty }] })), `qty ${qty}`).toBe(true)

    const options = (n: number) => Array.from({ length: n }, (_, i) => nd(i + 1))
    expect(ok(order({ lines: [{ ...line, optionIds: options(32) }] }))).toBe(true)
    expect(ok(order({ lines: [{ ...line, optionIds: options(33) }] }))).toBe(false)

    expect(ok(order({ lines: [{ ...line, note: 'x'.repeat(200) }] }))).toBe(true)
    expect(ok(order({ lines: [{ ...line, note: 'x'.repeat(201) }] }))).toBe(false)
  })

  it('takes only our own node ids for items and options', () => {
    for (const bad of ['', 'nd_short', `tb_${'0'.repeat(22)}`, `as_${'0'.repeat(22)}`, 42, null]) {
      expect(ok(order({ lines: [{ ...line, itemId: bad }] })), `item ${bad}`).toBe(false)
      expect(ok(order({ lines: [{ ...line, optionIds: [bad] }] })), `option ${bad}`).toBe(false)
    }
  })

  it('limits a request: a known kind and a note up to 200 characters', () => {
    const request = (changes: Record<string, unknown>) => ({ ...VALID[1], ...changes })
    expect(ok(request({ request: 'champagne' }))).toBe(false)
    expect(ok(request({ note: 'x'.repeat(200) }))).toBe(true)
    expect(ok(request({ note: 'x'.repeat(201) }))).toBe(false)
  })

  it('limits a cancel and the later steps of a payment: a host id of 1 to 64 characters', () => {
    expect(ok({ ...VALID[2], requestId: '' })).toBe(false)
    expect(ok({ ...VALID[2], requestId: 'r'.repeat(65) })).toBe(false)
    expect(ok({ ...VALID[5], quoteId: '' })).toBe(false)
    expect(ok({ ...VALID[5], method: 'cash' })).toBe(false)
    expect(ok({ ...VALID[6], receiptId: '' })).toBe(false)
    expect(ok({ ...VALID[6], action: 'fax' })).toBe(false)
  })

  it('limits a quote: people 2 to 20, tip 0 to 30 percent, promo up to 32 characters', () => {
    const split = { scope: 'split' }
    for (const people of [1, 0, 21, 2.5, '3', Number.NaN]) {
      expect(ok(quote({ ...split, people })), `people ${people}`).toBe(false)
    }
    for (const people of [2, 20])
      expect(ok(quote({ ...split, people })), `people ${people}`).toBe(true)

    for (const tipPercent of [-1, 31, 10.5, '10']) {
      expect(ok(quote({ tipPercent })), `tip ${tipPercent}`).toBe(false)
    }
    for (const tipPercent of [0, 30])
      expect(ok(quote({ tipPercent })), `tip ${tipPercent}`).toBe(true)

    for (const tipMinor of [-1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ok(quote({ tipPercent: null, tipMinor })), `tipMinor ${tipMinor}`).toBe(false)
    }
    expect(ok(quote({ tipPercent: null, tipMinor: 0 }))).toBe(true)

    expect(ok(quote({ promo: 'P'.repeat(32) }))).toBe(true)
    expect(ok(quote({ promo: 'P'.repeat(33) }))).toBe(false)
    expect(ok(quote({ promo: '' }))).toBe(false)
  })

  it('keeps a quote unambiguous: people exactly for a split, one kind of tip at most', () => {
    expect(ok(quote({ scope: 'split', people: null }))).toBe(false)
    expect(ok(quote({ scope: 'full', people: 3 }))).toBe(false)
    expect(ok(quote({ scope: 'mine', people: 3 }))).toBe(false)
    expect(ok(quote({ tipPercent: 10, tipMinor: 100 }))).toBe(false)
    expect(ok(quote({ tipPercent: null, tipMinor: null }))).toBe(true)
  })

  it('accepts every order built from valid parts and refuses one part out of range (property)', () => {
    const validLine = fc.record({
      itemId: fc.integer({ min: 1, max: 1000 }).map(nd),
      optionIds: fc.array(fc.integer({ min: 1, max: 1000 }).map(nd), { maxLength: 32 }),
      qty: fc.integer({ min: 1, max: 50 }),
      note: fc.string({ maxLength: 200 }),
    })
    fc.assert(
      fc.property(
        fc.uuid({ version: 4 }),
        fc.array(validLine, { minLength: 1, maxLength: 50 }),
        (actionId, lines) => {
          expect(ok({ kind: 'order.send', actionId, lines })).toBe(true)
        },
      ),
    )
    fc.assert(
      fc.property(
        fc.uuid({ version: 4 }),
        fc.array(validLine, { minLength: 1, maxLength: 49 }),
        fc.oneof(fc.integer({ min: -1000, max: 0 }), fc.integer({ min: 51, max: 1000 })),
        (actionId, lines, qty) => {
          expect(
            ok({ kind: 'order.send', actionId, lines: [...lines, { ...lines[0], qty }] }),
          ).toBe(false)
        },
      ),
    )
  })
})

describe('the empty state and the stub', () => {
  it('has no bill, no request, no quote, no receipt, and is not a preview', () => {
    expect(EMPTY_SERVICE_STATE).toEqual({
      revision: 0,
      preview: false,
      bill: null,
      requests: [],
      quote: null,
      receipt: null,
    })
  })

  it('answers every command with pending and the same actionId, and never changes its state', async () => {
    const stub = stubServices()
    expect(stub.state).toBe(EMPTY_SERVICE_STATE)
    for (const command of VALID) {
      await expect(stub.dispatch(command)).resolves.toEqual({
        actionId: command.actionId,
        status: 'pending',
        message: null,
        ref: null,
      })
    }
    expect(stub.state).toBe(EMPTY_SERVICE_STATE)
  })
})

describe('the service strings', () => {
  const walk = (value: unknown, path: string, out: [string, unknown][] = []) => {
    if (typeof value === 'object' && value !== null) {
      for (const [key, inner] of Object.entries(value)) walk(inner, `${path}.${key}`, out)
    } else out.push([path, value])
    return out
  }

  it('has the same keys in Bulgarian and English, none of them empty', () => {
    const bg = walk(stringsFor('bg_BG').services, 'services')
    const en = walk(stringsFor('en_US').services, 'services')
    expect(bg.map(([path]) => path).sort()).toEqual(en.map(([path]) => path).sort())
    for (const [path, value] of [...bg, ...en]) {
      const text = typeof value === 'function' ? value('12') : value
      expect(typeof text, path).toBe('string')
      expect(String(text).trim(), path).not.toBe('')
    }
  })

  it('names every service kind, pay scope, pay method, line status and request status', () => {
    for (const locale of ['bg_BG', 'en_US'] as const) {
      const words = stringsFor(locale).services
      expect(Object.keys(words.kinds).sort()).toEqual([...SERVICE_KINDS].sort())
      expect(Object.keys(words.scopes).sort()).toEqual([...PAY_SCOPES].sort())
      expect(Object.keys(words.methods).sort()).toEqual([...PAY_METHODS].sort())
      expect(Object.keys(words.lineStatus).sort()).toEqual([
        'cancelled',
        'preparing',
        'received',
        'served',
      ])
      expect(Object.keys(words.requestStates).sort()).toEqual([
        'accepted',
        'cancelled',
        'done',
        'on_the_way',
        'rejected',
        'sent',
      ])
    }
  })

  it('says "Preview" and "approx." in both languages', () => {
    expect(stringsFor('en_US').services).toMatchObject({ preview: 'Preview', approx: 'approx.' })
    expect(stringsFor('bg_BG').services).toMatchObject({ preview: 'Преглед', approx: 'прибл.' })
  })

  it('reads English for every language but Bulgarian', () => {
    expect(stringsFor('de_DE').services.preview).toBe('Preview')
  })
})
