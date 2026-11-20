// @vitest-environment jsdom

// The walk's findings on the guest's phone at a table (#420): P15 (a round the guests sent that is
// not on the bill yet is not shown as a fresh total), P22 (staff moved the party: the bill stayed
// at this table, no amount), and a table closed for phones: the menu read-only, with no Add and no
// waiter button, and the closed sentence printed once (S10, lane 3 S17, S19). No local success
// (D72): nothing here adds a round to a total.

import { stringsFor } from '@restro/shell'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  drawFace,
  fakeHost,
  itemNamed,
  orderHost,
  orderingView,
  payingOf,
  resetPage,
  sentOrderOf,
  tableBillOf,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

const W = stringsFor('en_US').services
const BG = stringsFor('bg_BG').services

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const view = orderingView()
const hummus = itemNamed(view, 'Hummus')
const openBill = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Your table’s bill' }))
  return screen.getByRole('dialog', { name: 'Your table’s bill' })
}

describe('P15: a round on its way to the bill', () => {
  const NOW = Date.now()
  const bill = (readAt: number) => ({ ...tableBillOf(), readAt })
  const own = (readAt: number, sentAt: number) =>
    fakeHost({
      tableBill: bill(readAt),
      paying: payingOf(),
      sentOrders: [sentOrderOf('so_1', 'added', [{ item: hummus, qty: 1 }], { sentAt })],
    })

  it('says the latest order is still reaching the bill, in place of the freshness line', () => {
    drawFace(own(NOW - 6000, NOW - 2000))
    const sheet = openBill()
    expect(sheet.querySelector('[data-slot="bill.pending"]')?.textContent).toBe(
      W.paying.roundPending,
    )
    expect(sheet.querySelector('[data-slot="bill.updated"]')).toBeNull()
    // The total is the host's; the round is not added to it here.
    expect(sheet.querySelector('[data-slot="bill.owed"]')?.textContent).toBe(
      `${W.paying.leftToPay}€22.50`,
    )
  })

  it('compares the reading with when the round settled, not when Send was tapped', () => {
    // Sent 5 minutes ago, waited for approval, taken by the POS 1 minute ago; read 3 minutes ago.
    drawFace(
      fakeHost({
        tableBill: bill(NOW - 180_000),
        paying: payingOf(),
        sentOrders: [
          sentOrderOf('so_1', 'added', [{ item: hummus, qty: 1 }], {
            sentAt: NOW - 300_000,
            settledAt: NOW - 60_000,
          }),
        ],
      }),
    )
    expect(openBill().querySelector('[data-slot="bill.pending"]')).not.toBeNull()
  })

  it('shows while a round is still in flight, and keeps the not-up-to-date warning beside it', () => {
    drawFace(
      fakeHost({
        tableBill: { ...bill(NOW - 5000), complete: false },
        paying: payingOf(),
        sentOrders: [
          sentOrderOf('so_1', 'awaiting_approval', [{ item: hummus, qty: 1 }], {
            sentAt: NOW - 300_000,
          }),
        ],
      }),
    )
    const sheet = openBill()
    expect(sheet.querySelector('[data-slot="bill.pending"]')).not.toBeNull()
    expect(sheet.querySelector('[data-slot="bill.updated"]')).not.toBeNull()
  })

  it('goes once a reading after the round holds it', () => {
    drawFace(own(NOW - 1000, NOW - 8000))
    const sheet = openBill()
    expect(sheet.querySelector('[data-slot="bill.pending"]')).toBeNull()
    expect(sheet.querySelector('[data-slot="bill.updated"]')).not.toBeNull()
  })

  it('has the Bulgarian words', () => {
    expect(BG.paying.roundPending).toBe('Последната поръчка още влиза в сметката')
  })
})

describe('S10, S17 and S19: a table closed for phones shows the menu read-only', () => {
  const closed = () => orderHost({ ordering: { state: 'closed', notesAndOptions: true } })

  it('draws no Add and no waiter button, and says why once', () => {
    drawFace(closed())
    expect(document.querySelectorAll('[data-slot="item.add"]')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add Hummus' })).toBeNull()
    // A call is refused at a closed table too (S19): no bell to tap.
    expect(document.querySelector('[data-slot="menu.call_waiter"]')).toBeNull()
    expect(screen.getAllByText(W.orderingClosed)).toHaveLength(1)
    expect(W.orderingClosed).toBe('This table isn’t open for phone orders. Ask a waiter.')
  })

  it('draws no order on the dish page either', () => {
    drawFace(closed())
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    const page = screen.getByRole('dialog', { name: 'Hummus' })
    expect(within(page).queryByRole('button', { name: /Add to bag/ })).toBeNull()
  })

  it('says why the waiter button went where the venue takes calls but no orders', () => {
    const callsOnly = { ...view, features: { ...view.features, ordering: false } }
    drawFace(fakeHost({ ordering: { state: 'closed', notesAndOptions: true } }), callsOnly)
    expect(document.querySelector('[data-slot="menu.call_waiter"]')).toBeNull()
    expect(document.querySelector('[data-slot="ordering.closed"]')?.textContent).toBe(
      W.callTableNotOpen,
    )
    expect(document.body.textContent).not.toContain(W.orderingClosed)
  })

  it('leaves "Add" and the waiter button where the table takes orders', () => {
    drawFace(orderHost())
    expect(screen.getByRole('button', { name: 'Add Hummus' }).hasAttribute('disabled')).toBe(false)
    expect(document.querySelector('[data-slot="menu.call_waiter"]')).not.toBeNull()
  })
})

describe('P22: staff moved the party to another table', () => {
  it('says the bill stayed at this table and shows no amount', () => {
    drawFace(
      orderHost({
        ordering: { state: 'closed', movedAway: true, notesAndOptions: true },
        tableBill: null,
      }),
      view,
      { tableLabel: 'Table 1' },
    )
    expect(document.querySelector('[data-slot="ordering.closed"]')?.textContent).toBe(
      W.billStayed('Table 1'),
    )
    expect(document.body.textContent).not.toContain(W.orderingClosed)
    // No amount of the bill: the host has none for a closed table, and the note names none.
    expect(document.querySelector('[data-slot="ordering.closed"]')?.textContent).not.toMatch(
      /€|EUR/,
    )
  })

  it('says it in Bulgarian', () => {
    expect(BG.billStayed('Маса 1')).toBe(
      'Сметката ви остана на Маса 1. Попитайте сервитьора или сканирайте кода на новата маса.',
    )
  })
})
