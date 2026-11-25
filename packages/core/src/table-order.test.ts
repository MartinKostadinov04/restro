import { describe, expect, it } from 'vitest'

import { isId, newId } from './ids'
import {
  applyOrderEdit,
  dropHeldLines,
  EMPTY_TABLE_ORDER,
  holdPayFirstLines,
  nextOrderChangeAt,
  ORDER_IDLE_MS,
  type OrderEdit,
  orderFromRow,
  orderLineIdFor,
  orderToRow,
  releaseHeldLines,
  returnSentLines,
  type TableOrderDraft,
  takeSentLines,
  tidyOrder,
  UNDO_WINDOW_MS,
} from './table-order'

const NOW = Date.parse('2026-10-26T21:00:00.000Z')
const gin = newId('nd')
const lime = newId('nd')
const ice = newId('nd')

const add = (qty = 1, note = '', optionIds: string[] = []): OrderEdit => ({
  type: 'order.add',
  itemId: gin,
  optionIds,
  qty,
  note,
})

function run(order: TableOrderDraft, edit: OrderEdit, now = NOW, newLineId = newId('ol')) {
  const outcome = applyOrderEdit(order, edit, { now, newLineId })
  if (!outcome.ok) throw new Error(`refused ${outcome.code}`)
  return outcome
}

describe('the table order', () => {
  it('merges identical lines: same item, same options in any order, same trimmed note', () => {
    const first = run(EMPTY_TABLE_ORDER, add(1, 'no ice', [lime, ice]))
    const second = run(first.order, add(2, ' no ice ', [ice, lime]))
    expect(second.order.lines).toHaveLength(1)
    expect(second.order.lines[0]).toMatchObject({ qty: 3, rev: 1, note: 'no ice' })
    expect(second.lineId).toBe(first.lineId)
    const other = run(second.order, add(1, 'with ice'))
    expect(other.order.lines).toHaveLength(2)
  })

  it("names a new line after the add's action id, the same on both sides", () => {
    const actionId = '2f0c6b3e-8a43-4c6e-9a1c-4e2b7d0f9a11'
    expect(orderLineIdFor(actionId)).toBe(orderLineIdFor(actionId))
    expect(isId('ol', orderLineIdFor(actionId))).toBe(true)
    expect(orderLineIdFor(actionId)).not.toBe(orderLineIdFor(crypto.randomUUID()))
  })

  it('refuses a line past 50 and a 51st line', () => {
    const full = run(EMPTY_TABLE_ORDER, add(50))
    expect(applyOrderEdit(full.order, add(1), { now: NOW, newLineId: newId('ol') })).toEqual({
      ok: false,
      code: 'quantity_limit',
    })
    let order = EMPTY_TABLE_ORDER
    for (let i = 0; i < 50; i++) {
      order = run(order, { ...add(1), itemId: newId('nd') } as OrderEdit).order
    }
    expect(applyOrderEdit(order, add(1), { now: NOW, newLineId: newId('ol') })).toEqual({
      ok: false,
      code: 'order_full',
    })
  })

  it('changes by a delta, and removes at zero with Undo for a few seconds', () => {
    const added = run(EMPTY_TABLE_ORDER, add(2))
    const lineId = added.lineId as string
    const up = run(added.order, { type: 'order.change', lineId, delta: 3 })
    expect(up.order.lines[0]).toMatchObject({ qty: 5, rev: 1 })
    const gone = run(up.order, { type: 'order.change', lineId, delta: -5 }, NOW + 1000)
    expect(gone.order.lines[0]?.removedAt).toBe(NOW + 1000)
    expect(gone.order.idleExpiresAt).toBeNull()
    expect(
      applyOrderEdit(
        gone.order,
        { type: 'order.change', lineId, delta: 1 },
        {
          now: NOW + 2000,
          newLineId: newId('ol'),
        },
      ),
    ).toEqual({ ok: false, code: 'order_changed' })

    const back = run(gone.order, { type: 'order.undo', lineId }, NOW + 1000 + UNDO_WINDOW_MS)
    expect(back.order.lines[0]).toMatchObject({ qty: 5, removedAt: null })
    expect(
      applyOrderEdit(
        gone.order,
        { type: 'order.undo', lineId },
        {
          now: NOW + 1001 + UNDO_WINDOW_MS,
          newLineId: newId('ol'),
        },
      ),
    ).toEqual({ ok: false, code: 'undo_expired' })
  })

  it('merges an undone line into one added meanwhile', () => {
    const added = run(EMPTY_TABLE_ORDER, add(2))
    const lineId = added.lineId as string
    const removed = run(added.order, { type: 'order.remove', lineId })
    const again = run(removed.order, add(1))
    expect(again.order.lines.filter((line) => line.removedAt === null)).toHaveLength(1)
    const undone = run(again.order, { type: 'order.undo', lineId })
    expect(undone.order.lines).toHaveLength(1)
    expect(undone.order.lines[0]?.qty).toBe(3)
  })

  it('never touches a line a payment holds', () => {
    const added = run(EMPTY_TABLE_ORDER, add(1))
    const held: TableOrderDraft = {
      ...added.order,
      lines: added.order.lines.map((line) => ({ ...line, heldBy: newId('py') })),
    }
    const lineId = added.lineId as string
    for (const edit of [
      { type: 'order.change', lineId, delta: 1 },
      { type: 'order.remove', lineId },
    ] as const) {
      expect(applyOrderEdit(held, edit, { now: NOW, newLineId: newId('ol') })).toEqual({
        ok: false,
        code: 'line_held',
      })
    }
    // An identical add makes a line of its own instead of merging into the held one.
    expect(run(held, add(1)).order.lines).toHaveLength(2)
  })

  it('sets an idle order aside as the earlier order, and restores it merged', () => {
    const added = run(EMPTY_TABLE_ORDER, add(2))
    expect(added.order.idleExpiresAt).toBe(NOW + ORDER_IDLE_MS)
    expect(nextOrderChangeAt(added.order)).toBe(NOW + ORDER_IDLE_MS)
    expect(tidyOrder(added.order, NOW + ORDER_IDLE_MS - 1).changed).toBe(false)

    const at = NOW + ORDER_IDLE_MS
    const idle = tidyOrder(added.order, at)
    expect(idle.changed).toBe(true)
    expect(idle.order.lines).toEqual([])
    expect(idle.order.earlier?.at).toBe(at)
    expect(idle.order.idleExpiresAt).toBeNull()

    const fresh = run(idle.order, add(1), at + 5)
    expect(
      applyOrderEdit(
        fresh.order,
        { type: 'order.restore', setAsideAt: at - 1 },
        {
          now: at + 6,
          newLineId: newId('ol'),
        },
      ),
    ).toEqual({ ok: false, code: 'order_changed' })
    const restored = run(fresh.order, { type: 'order.restore', setAsideAt: at }, at + 6)
    expect(restored.order.earlier).toBeNull()
    expect(restored.order.lines).toHaveLength(1)
    expect(restored.order.lines[0]?.qty).toBe(3)
  })

  it('lets removed lines go after their Undo, and keeps held lines when the order goes idle', () => {
    const one = run(EMPTY_TABLE_ORDER, add(1))
    const two = run(one.order, { ...add(1), itemId: newId('nd') } as OrderEdit)
    const removed = run(two.order, { type: 'order.remove', lineId: one.lineId as string })
    expect(nextOrderChangeAt(removed.order)).toBe(NOW + UNDO_WINDOW_MS + 1)
    const pruned = tidyOrder(removed.order, NOW + UNDO_WINDOW_MS + 1)
    expect(pruned.order.lines).toHaveLength(1)

    const held: TableOrderDraft = {
      ...pruned.order,
      lines: pruned.order.lines.map((line) => ({ ...line, heldBy: newId('py') })),
    }
    const idle = tidyOrder(held, NOW + ORDER_IDLE_MS)
    expect(idle.order.lines).toHaveLength(1)
    expect(idle.order.earlier).toBeNull()
  })

  it('round-trips through the stored columns, dropping a line that fails its schema', () => {
    const added = run(EMPTY_TABLE_ORDER, add(2, 'note', [lime]))
    const removed = run(added.order, add(1, '', [ice]))
    const row = orderToRow(tidyOrder(removed.order, NOW + ORDER_IDLE_MS).order)
    const back = orderFromRow({ ...row, earlier: [...(row.earlier ?? []), { id: 'x' }] })
    expect(back).toEqual(tidyOrder(removed.order, NOW + ORDER_IDLE_MS).order)
  })
})

describe('the lines a Send takes and gives back (#77)', () => {
  const two = run(run(EMPTY_TABLE_ORDER, add(2, 'no ice')).order, {
    type: 'order.add',
    itemId: lime,
    optionIds: [],
    qty: 1,
    note: '',
  }).order
  const asSeen = two.lines.map((line) => ({
    itemId: line.itemId,
    optionIds: line.optionIds,
    qty: line.qty,
    note: line.note,
  }))

  it('takes every live line as the guest saw it, in any order, and leaves none behind', () => {
    const taken = takeSentLines(two, [...asSeen].reverse(), NOW)
    if (!taken.ok) throw new Error(taken.code)
    expect(taken.lines.map((line) => line.id)).toEqual(two.lines.map((line) => line.id))
    expect(taken.order.lines).toEqual([])
  })

  it('takes only the named lines: a change to a line it does not send leaves the Send alone', () => {
    const [first, second] = two.lines
    if (first === undefined || second === undefined) throw new Error('two lines expected')
    // The guest saw one line; a friend added another in the second before.
    const taken = takeSentLines(two, asSeen.slice(0, 1), NOW)
    if (!taken.ok) throw new Error(taken.code)
    expect(taken.lines).toEqual([first])
    expect(taken.order.lines).toEqual([second])
    expect(taken.order.idleExpiresAt).toBe(NOW + ORDER_IDLE_MS)
  })

  it('refuses a Send when a line it sends changed or went', () => {
    const [first, second] = two.lines
    if (first === undefined || second === undefined) throw new Error('two lines expected')
    const gone: TableOrderDraft = { ...two, lines: [second] }
    expect(takeSentLines(gone, asSeen.slice(0, 1), NOW)).toEqual({
      ok: false,
      code: 'order_changed',
    })
    // The same line named twice takes one line once: the second naming is a change.
    const twice = [asSeen[0], asSeen[0]] as typeof asSeen
    expect(takeSentLines(two, twice, NOW)).toEqual({ ok: false, code: 'order_changed' })
    // Nothing named sends nothing.
    expect(takeSentLines(two, [], NOW)).toEqual({ ok: false, code: 'order_changed' })
    expect(takeSentLines({ ...two, lines: [first] }, [], NOW)).toEqual({
      ok: false,
      code: 'order_changed',
    })
  })

  it('refuses a Send that differs from the order in any quantity', () => {
    const more = asSeen.map((line, index) => (index === 0 ? { ...line, qty: 3 } : line))
    expect(takeSentLines(two, more, NOW)).toEqual({ ok: false, code: 'order_changed' })
    expect(takeSentLines(EMPTY_TABLE_ORDER, asSeen, NOW)).toEqual({
      ok: false,
      code: 'order_empty',
    })
  })

  it('leaves a held line and a removed line alone', () => {
    const [first, second] = two.lines
    if (first === undefined || second === undefined) throw new Error('two lines expected')
    const held: TableOrderDraft = {
      ...two,
      lines: [
        { ...first, heldBy: 'py_x' },
        { ...second, removedAt: NOW - 1_000 },
      ],
    }
    expect(takeSentLines(held, asSeen, NOW)).toEqual({ ok: false, code: 'order_empty' })
    const oneHeld: TableOrderDraft = { ...two, lines: [{ ...first, heldBy: 'py_x' }, second] }
    const taken = takeSentLines(oneHeld, asSeen.slice(1), NOW)
    if (!taken.ok) throw new Error(taken.code)
    expect(taken.order.lines).toEqual([{ ...first, heldBy: 'py_x' }])
  })

  it('sends the other lines and keeps back the ones the menu cannot take (Send the other N)', () => {
    const [first, second] = two.lines
    if (first === undefined || second === undefined) throw new Error('two lines expected')
    const soldOut = (line: { readonly id: string }) => line.id === first.id
    const taken = takeSentLines(two, asSeen.slice(1), NOW, soldOut)
    if (!taken.ok) throw new Error(taken.code)
    expect(taken.lines.map((line) => line.id)).toEqual([second.id])
    expect(taken.order.lines).toEqual([first])
    // Naming the kept-back line is a Send that differs from what may go.
    expect(takeSentLines(two, asSeen, NOW, soldOut)).toEqual({ ok: false, code: 'order_changed' })
    expect(takeSentLines(two, asSeen.slice(1), NOW, () => true)).toEqual({
      ok: false,
      code: 'order_empty',
    })
  })

  it('gives lines back merged into identical ones, under a fresh id where theirs is taken', () => {
    const taken = takeSentLines(two, asSeen, NOW)
    if (!taken.ok) throw new Error(taken.code)
    const meanwhile = run(taken.order, add(1, 'no ice')).order
    const fresh = newId('ol')
    const back = returnSentLines(meanwhile, taken.lines, NOW, () => fresh)
    expect(back.lines).toHaveLength(2)
    expect(back.lines.find((line) => line.itemId === gin)).toMatchObject({ qty: 3 })
    expect(back.lines.find((line) => line.itemId === lime)).toMatchObject({ qty: 1 })
  })
})

describe('the pay-first lines a Send holds for its payment (#113)', () => {
  const order = run(run(EMPTY_TABLE_ORDER, add(2)).order, {
    type: 'order.add',
    itemId: lime,
    optionIds: [],
    qty: 1,
    note: '',
  }).order
  const isGin = (line: { readonly itemId: string }) => line.itemId === gin
  const ginLine = { itemId: gin, optionIds: [], qty: 2, note: '' }

  it('holds exactly the live pay-first lines, and leaves the others alone', () => {
    const held = holdPayFirstLines(order, [ginLine], isGin, 'py_1')
    if (!held.ok) throw new Error(held.code)
    expect(held.lines.map((line) => line.itemId)).toEqual([gin])
    expect(held.order.lines.find((line) => line.itemId === gin)?.heldBy).toBe('py_1')
    expect(held.order.lines.find((line) => line.itemId === lime)?.heldBy).toBeNull()
  })

  it('holds the pay-first lines the Send names, leaving the others for a later Pay', () => {
    // The gin and the lime both paid first.
    const both = () => true
    const held = holdPayFirstLines(
      order,
      [{ itemId: lime, optionIds: [], qty: 1, note: '' }],
      both,
      'py_1',
    )
    if (!held.ok) throw new Error(held.code)
    expect(held.lines.map((line) => line.itemId)).toEqual([lime])
    expect(held.order.lines.find((line) => line.itemId === gin)?.heldBy).toBeNull()
    // The same line twice is one line too many.
    expect(
      holdPayFirstLines(
        held.order,
        [{ itemId: lime, optionIds: [], qty: 1, note: '' }],
        both,
        'py_2',
      ),
    ).toEqual({
      ok: false,
      code: 'order_changed',
    })
  })

  it('a "Send and pay" (`whole`) names every live pay-first line, or is refused', () => {
    const both = () => true
    const lime1 = { itemId: lime, optionIds: [], qty: 1, note: '' }
    expect(holdPayFirstLines(order, [lime1], both, 'py_1', true)).toEqual({
      ok: false,
      code: 'order_changed',
    })
    const held = holdPayFirstLines(order, [lime1, ginLine], both, 'py_1', true)
    if (!held.ok) throw new Error(held.code)
    expect(held.lines.map((line) => line.itemId)).toEqual([gin, lime])
  })

  it('refuses a part that differs from the order, and one with nothing to pay first', () => {
    expect(holdPayFirstLines(order, [{ ...ginLine, qty: 3 }], isGin, 'py_1')).toEqual({
      ok: false,
      code: 'order_changed',
    })
    expect(holdPayFirstLines(order, [], isGin, 'py_1')).toEqual({
      ok: false,
      code: 'order_changed',
    })
    expect(holdPayFirstLines(order, [ginLine], () => false, 'py_1')).toEqual({
      ok: false,
      code: 'order_empty',
    })
  })

  it('drops the held lines once on the POS, and frees them when the payment ends before it', () => {
    const held = holdPayFirstLines(order, [ginLine], isGin, 'py_1')
    if (!held.ok) throw new Error(held.code)
    expect(dropHeldLines(held.order, 'py_1', NOW).lines.map((line) => line.itemId)).toEqual([lime])
    const freed = releaseHeldLines(held.order, 'py_1')
    const line = freed.lines.find((other) => other.itemId === gin)
    expect(line?.heldBy).toBeNull()
    // A new revision: the phone sees the line changed and names it afresh.
    const before = held.order.lines.find((other) => other.itemId === gin)?.rev ?? 0
    expect(line?.rev).toBe(before + 1)
    expect(releaseHeldLines(held.order, 'py_2')).toEqual(held.order)
  })
})
