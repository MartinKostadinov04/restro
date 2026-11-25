import { describe, expect, it } from 'vitest'

import { LandingBasisSchema, matchLanded } from '../../landing-match'
import { checkLanded, closeProof, landingBasisOf, type SentLineShape } from './landed'
import { posRef } from './pos-ref'
import type { BillLine, PosBill, TableBills } from './schemas'

const REF = 'so_round'

function line(id: string, item: string, quantity: string, extra: Partial<BillLine> = {}): BillLine {
  return {
    ref: posRef(id),
    item: posRef(item),
    name: null,
    quantity,
    amountMinor: 500,
    enteredBy: null,
    enteredAt: null,
    restroRef: null,
    ...extra,
  }
}

function bill(id: string, lines: BillLine[]): PosBill {
  return {
    ref: posRef(id),
    totalMinor: 0,
    paidMinor: 0,
    openedAt: null,
    openedByRestro: null,
    paymentInFlight: false,
    lines,
  }
}

function table(...bills: PosBill[]): TableBills {
  return { table: posRef('t7'), currency: 'EUR', bills }
}

const sent: SentLineShape[] = [
  { item: posRef('gin'), quantity: '2' },
  { item: posRef('cola'), quantity: '1' },
]

const NONE = { ownLineReference: false, whoEnteredLine: false }
const before = table(bill('b1', [line('l1', 'beer', '1')]))

describe('checkLanded (D115, #77)', () => {
  describe('without any way to tell our lines', () => {
    it('is absent while the bill is as it was', () => {
      expect(checkLanded({ before, after: before, sent, ref: REF, capabilities: NONE })).toEqual({
        kind: 'absent',
      })
    })

    it('lands when exactly our round appeared, quantities compared as decimal text', () => {
      const after = table(
        bill('b1', [
          line('l1', 'beer', '1'),
          line('l2', 'gin', '2.000'),
          line('l3', 'cola', '1.0'),
        ]),
      )
      const verdict = checkLanded({ before, after, sent, ref: REF, capabilities: NONE })
      expect(verdict).toEqual({
        kind: 'landed',
        bill: posRef('b1'),
        lines: [posRef('l2'), posRef('l3')],
      })
    })

    it('is ambiguous when a waiter slipped an identical round in as well', () => {
      const after = table(
        bill('b1', [
          line('l1', 'beer', '1'),
          line('l2', 'gin', '2'),
          line('l3', 'cola', '1'),
          line('l4', 'gin', '2'),
          line('l5', 'cola', '1'),
        ]),
      )
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: NONE }).kind).toBe(
        'ambiguous',
      )
    })

    it('is ambiguous, never absent or landed, when a line went or changed', () => {
      const gone = table(bill('b1', [line('l2', 'gin', '2'), line('l3', 'cola', '1')]))
      expect(checkLanded({ before, after: gone, sent, ref: REF, capabilities: NONE }).kind).toBe(
        'ambiguous',
      )
      const changed = table(bill('b1', [line('l1', 'beer', '3')]))
      expect(checkLanded({ before, after: changed, sent, ref: REF, capabilities: NONE }).kind).toBe(
        'ambiguous',
      )
    })

    it('is ambiguous when only other new lines appeared', () => {
      const after = table(bill('b1', [line('l1', 'beer', '1'), line('l9', 'wine', '1')]))
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: NONE }).kind).toBe(
        'ambiguous',
      )
    })
  })

  describe('with the POS saying who entered a line', () => {
    const who = { ownLineReference: false, whoEnteredLine: true }
    it("counts Restro's new lines only: a waiter's identical round doesn't make it doubtful", () => {
      const after = table(
        bill('b1', [
          line('l1', 'beer', '1'),
          line('l2', 'gin', '2', { enteredBy: 'staff' }),
          line('l3', 'cola', '1', { enteredBy: 'staff' }),
          line('l4', 'gin', '2', { enteredBy: 'restro' }),
          line('l5', 'cola', '1', { enteredBy: 'restro' }),
        ]),
      )
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: who })).toEqual({
        kind: 'landed',
        bill: posRef('b1'),
        lines: [posRef('l4'), posRef('l5')],
      })
    })

    it('is absent with no new line of ours', () => {
      const after = table(bill('b1', [line('l1', 'beer', '1'), line('l2', 'gin', '2')]))
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: who })).toEqual({
        kind: 'absent',
      })
    })
  })

  describe("with Restro's reference read back", () => {
    const own = { ownLineReference: true, whoEnteredLine: false }
    it('finds the round by its reference, on a second bill too', () => {
      const after = table(
        bill('b1', [line('l1', 'beer', '1'), line('l2', 'gin', '2')]),
        bill('b2', [
          line('l4', 'gin', '2', { restroRef: REF }),
          line('l5', 'cola', '1', { restroRef: REF }),
        ]),
      )
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: own })).toEqual({
        kind: 'landed',
        bill: posRef('b2'),
        lines: [posRef('l4'), posRef('l5')],
      })
    })

    it('is ambiguous when the lines with our reference are not our round', () => {
      const after = table(bill('b1', [line('l4', 'gin', '1', { restroRef: REF })]))
      expect(checkLanded({ before, after, sent, ref: REF, capabilities: own }).kind).toBe(
        'ambiguous',
      )
    })
  })
})

describe('the reading kept for a late landing (#135)', () => {
  const modes = {
    'nothing tells our lines': NONE,
    'who entered the line': { ownLineReference: false, whoEnteredLine: true },
    'our reference read back': { ownLineReference: true, whoEnteredLine: false },
  } as const

  const readings: Record<string, TableBills> = {
    'the bill as it was': before,
    'our round on it': table(
      bill('b1', [
        line('l1', 'beer', '1'),
        line('l2', 'gin', '2', { enteredBy: 'restro', restroRef: REF }),
        line('l3', 'cola', '1.0', { enteredBy: 'restro', restroRef: REF }),
      ]),
    ),
    "a waiter's identical round as well": table(
      bill('b1', [
        line('l1', 'beer', '1'),
        line('l2', 'gin', '2', { enteredBy: 'restro', restroRef: REF }),
        line('l3', 'cola', '1', { enteredBy: 'restro', restroRef: REF }),
        line('l4', 'gin', '2', { enteredBy: 'staff' }),
        line('l5', 'cola', '1', { enteredBy: 'staff' }),
      ]),
    ),
    'a line gone': table(bill('b1', [line('l2', 'gin', '2'), line('l3', 'cola', '1')])),
    'only other lines': table(bill('b1', [line('l1', 'beer', '1'), line('l9', 'wine', '1')])),
  }

  for (const [mode, capabilities] of Object.entries(modes)) {
    for (const [name, after] of Object.entries(readings)) {
      it(`matches as the read-back does when ${mode}, with ${name}`, () => {
        const basis = LandingBasisSchema.parse(landingBasisOf({ before, sent, capabilities }))
        const direct = checkLanded({ before, after, sent, ref: REF, capabilities })
        const later = matchLanded({
          before: basis.before,
          after: after.bills.flatMap((one) =>
            one.lines.map((each) => ({
              bill: one.ref.pos,
              line: each.ref.pos,
              item: each.item?.pos ?? null,
              quantity: each.quantity,
              amountMinor: each.amountMinor,
              enteredBy: each.enteredBy,
              restroRef: each.restroRef,
            })),
          ),
          sent: basis.sent,
          ref: REF,
          capabilities: basis.capabilities,
        })
        if (direct.kind === 'landed') {
          expect(later).toEqual({
            kind: 'landed',
            bill: direct.bill?.pos ?? null,
            lines: direct.lines.map((one) => one.pos),
          })
        } else {
          expect(later).toEqual(direct)
        }
      })
    }
  }

  it('keeps only what the match compares: no name, no time, no reference', () => {
    const rich = table(
      bill('b1', [
        line('l1', 'beer', '1', {
          name: 'Бира',
          enteredAt: '2026-10-26T20:00:00Z',
          restroRef: 'x',
        }),
      ]),
    )
    const basis = landingBasisOf({ before: rich, sent, capabilities: NONE })
    expect(basis.before).toEqual([{ bill: 'b1', line: 'l1', quantity: '1', amountMinor: 500 }])
    expect(JSON.stringify(basis)).not.toMatch(/Бира|2026|"x"/)
  })
})

describe("a close's third proof (D127)", () => {
  const close = { refs: new Set(['so_round', 'py_1-close']), amountMinor: 2200 }
  const closed = (extra: {
    receiptNumber?: string
    restroRefs?: string[]
    totalMinor?: number
  }) => ({
    ref: posRef('b1'),
    totalMinor: extra.totalMinor ?? 2200,
    receiptNumber: extra.receiptNumber ?? null,
    restroRefs: extra.restroRefs ?? [],
  })

  it("takes a receipt number or one of Restro's references", () => {
    expect(closeProof(closed({ receiptNumber: 'R-1' }), close)).toEqual({ receiptNumber: 'R-1' })
    expect(closeProof(closed({ restroRefs: ['py_1-close'] }), close)).toEqual({
      receiptNumber: null,
    })
    expect(closeProof(closed({ restroRefs: ['other', 'so_round'] }), close)).toEqual({
      receiptNumber: null,
    })
  })

  it('takes nothing else: no closed bill, neither mark, another total, a reference not ours', () => {
    expect(closeProof(null, close)).toBeNull()
    expect(closeProof(closed({}), close)).toBeNull()
    expect(closeProof(closed({ receiptNumber: 'R-1', totalMinor: 2100 }), close)).toBeNull()
    expect(closeProof(closed({ restroRefs: ['py_1-close'], totalMinor: 2100 }), close)).toBeNull()
    expect(closeProof(closed({ restroRefs: ['another-app'] }), close)).toBeNull()
  })
})
