// @vitest-environment jsdom

// The walk's findings on the guest's phone at a table (#420): P15 (a round the guests sent that is
// not on the bill yet is not shown as a fresh total), P22 (staff moved the party: the bill stayed
// at this table, no amount), P23 ("Add" is greyed at a table closed for phones) and S10 (the closed
// sentence is printed once). No local success (D72): nothing here adds a round to a total.

import { stringsFor } from '@restro/shell'
import { cleanup, fireEvent, screen } from '@testing-library/react'
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

describe('P23 and S10: a table closed for phones', () => {
  const closed = () => orderHost({ ordering: { state: 'closed', notesAndOptions: true } })

  it('greys "Add" on the item card, keeping its name', () => {
    drawFace(closed())
    const add = screen.getByRole('button', { name: 'Add Hummus' })
    expect(add.hasAttribute('disabled')).toBe(true)
    expect(add.getAttribute('aria-disabled')).toBe('true')
  })

  it('prints the closed sentence once', () => {
    drawFace(closed())
    expect(screen.getAllByText(W.orderingClosed)).toHaveLength(1)
  })

  it('leaves "Add" live where the table takes orders', () => {
    drawFace(orderHost())
    expect(screen.getByRole('button', { name: 'Add Hummus' }).hasAttribute('disabled')).toBe(false)
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
