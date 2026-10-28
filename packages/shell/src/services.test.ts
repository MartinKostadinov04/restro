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
const ol = (n: number): `ol_${string}` => `ol_${String(n).padStart(22, '0')}`

const bn = (n: number): `bn_${string}` => `bn_${String(n).padStart(22, '0')}`

const line = { itemId: nd(1), optionIds: [nd(2), nd(3)], qty: 2, note: 'no onion' }

/** One valid command of every kind. */
const VALID: readonly GuestCommand[] = [
  { kind: 'order.send', actionId: uuid(1), lines: [line] },
  { kind: 'service.request', actionId: uuid(2), request: 'waiter', note: '' },
  { kind: 'service.cancel', actionId: uuid(3), requestId: 'rq-1' },
  {
    kind: 'pay.start',
    actionId: uuid(4),
    pick: { kind: 'lines', lines: [{ lineId: bn(1), quantity: '2' }] },
    seen: [{ lineId: bn(1), quantity: '2', amountMinor: 1200 }],
    tipMinor: null,
    tipPercent: 10,
  },
  {
    kind: 'pay.start',
    actionId: uuid(5),
    pick: { kind: 'whole' },
    seen: [{ lineId: bn(1), quantity: '1', amountMinor: -50 }],
    tipMinor: 250,
    tipPercent: null,
  },
  { kind: 'pay.returned', actionId: uuid(6) },
  { kind: 'pay.cancel', actionId: uuid(13) },
  { kind: 'receipt.action', actionId: uuid(7), receiptId: 'rc-1', action: 'pdf' },
  // The shared order's edits (#75).
  { kind: 'order.add', actionId: uuid(8), ...line },
  { kind: 'order.change', actionId: uuid(9), lineId: ol(1), delta: -1 },
  { kind: 'order.remove', actionId: uuid(10), lineId: ol(1) },
  { kind: 'order.undo', actionId: uuid(11), lineId: ol(1) },
  { kind: 'order.restore', actionId: uuid(12), setAsideAt: 1_760_000_000_000 },
]

const ok = (value: unknown) => GuestCommandSchema.safeParse(value).success

const order = (changes: Record<string, unknown>) => ({ ...VALID[0], ...changes })
const start = (changes: Record<string, unknown>) => ({ ...VALID[3], ...changes })

describe('GuestCommandSchema', () => {
  it('refuses an order edit out of its bounds (#75)', () => {
    const change = { kind: 'order.change', actionId: uuid(1), lineId: ol(1) }
    expect(ok({ ...change, delta: 0 })).toBe(false)
    expect(ok({ ...change, delta: 51 })).toBe(false)
    expect(ok({ ...change, delta: 1.5 })).toBe(false)
    expect(ok({ ...change, delta: 50, lineId: nd(1) })).toBe(false)
    expect(ok({ kind: 'order.add', actionId: uuid(1), ...line, qty: 0 })).toBe(false)
    expect(ok({ kind: 'order.add', actionId: uuid(1), ...line, price: 100 })).toBe(false)
    expect(ok({ kind: 'order.restore', actionId: uuid(1), setAsideAt: -1 })).toBe(false)
  })

  it('takes a Send again only naming a sent order (#78: "Send another")', () => {
    expect(ok(order({ confirmDuplicateOf: `so_${'0'.repeat(21)}1` }))).toBe(true)
    expect(ok(order({ confirmDuplicateOf: nd(1) }))).toBe(false)
    expect(ok(order({ confirmDuplicateOf: '' }))).toBe(false)
  })

  it('accepts a valid command of every kind', () => {
    for (const command of VALID) {
      const result = GuestCommandSchema.safeParse(command)
      expect(result.success, JSON.stringify(command)).toBe(true)
      expect(result.data).toEqual(command)
    }
  })

  it('accepts every service kind, receipt action and a pay command of each kind', () => {
    for (const request of SERVICE_KINDS) {
      expect(ok({ kind: 'service.request', actionId: uuid(1), request, note: '' }), request).toBe(
        true,
      )
    }
    for (const action of RECEIPT_ACTIONS) {
      expect(
        ok({ kind: 'receipt.action', actionId: uuid(1), receiptId: 'r', action }),
        action,
      ).toBe(true)
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
    expect(ok({ ...VALID[6], receiptId: '' })).toBe(false)
    expect(ok({ ...VALID[6], action: 'fax' })).toBe(false)
  })

  it('limits a pay.start: a tip of 1 to 30 percent or an amount, never both (D127: it starts at zero)', () => {
    for (const tipPercent of [0, -1, 31, 10.5, '10']) {
      expect(ok(start({ tipPercent })), `tip ${tipPercent}`).toBe(false)
    }
    for (const tipPercent of [1, 30])
      expect(ok(start({ tipPercent })), `tip ${tipPercent}`).toBe(true)
    for (const tipMinor of [-1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(ok(start({ tipPercent: null, tipMinor })), `tipMinor ${tipMinor}`).toBe(false)
    }
    expect(ok(start({ tipPercent: null, tipMinor: 0 }))).toBe(true)
    expect(ok(start({ tipPercent: 10, tipMinor: 100 }))).toBe(false)
    expect(ok(start({ tipPercent: null, tipMinor: null }))).toBe(true)
  })

  it('names the lines of a pay.start by our bill ids and as the phone saw them', () => {
    const seen = [{ lineId: bn(1), quantity: '1', amountMinor: 500 }]
    expect(ok(start({ seen: [] }))).toBe(false)
    expect(ok(start({ pick: { kind: 'lines', lines: [] } }))).toBe(false)
    expect(
      ok(start({ pick: { kind: 'lines', lines: [{ lineId: 'x', quantity: '1' }] }, seen })),
    ).toBe(false)
    expect(ok(start({ seen: [{ ...seen[0], amountMinor: 1.5 }] }))).toBe(false)
    expect(ok(start({ seen: [{ ...seen[0], quantity: '1.5.2' }] }))).toBe(false)
    expect(
      ok(start({ pick: { kind: 'lines', lines: [{ lineId: bn(1), quantity: '0.5' }] } })),
    ).toBe(true)
    expect(ok(start({ pick: { kind: 'everything' } }))).toBe(false)
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
  it('has no bill, no request, no payment, no receipt, and is not a preview', () => {
    expect(EMPTY_SERVICE_STATE).toEqual({
      revision: 0,
      preview: false,
      bill: null,
      requests: [],
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

  it('names every service kind, pay method, line status and request status', () => {
    for (const locale of ['bg_BG', 'en_US'] as const) {
      const words = stringsFor(locale).services
      expect(Object.keys(words.kinds).sort()).toEqual([...SERVICE_KINDS].sort())
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
