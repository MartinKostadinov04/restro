// @vitest-environment jsdom

// The parts of the service sheets carry their design markers (D128, D130). The never-list harness
// draws the menu with no sheet open, so what a sheet owns is checked here: each sheet, opened, holds
// its parts, and no marker in the page is outside the contract.

import { DESIGN_MARKER_PAGES } from '@restro/shell'
import { PAYING_LEGAL } from '@restro/shell/testing'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  billLine,
  billOf,
  billRound,
  drawFace,
  type FakeHost,
  fakeHost,
  itemNamed,
  orderHost,
  orderingView,
  orderLine,
  orderOf,
  payingOf,
  paymentOf,
  resetPage,
  tableBillOf,
} from './test-kit'

// The first sheet of a run renders slowly on a busy machine.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const view = orderingView()
const paying = () => ({
  tableBill: tableBillOf(),
  paying: payingOf({ legal: PAYING_LEGAL }),
  ordering: { state: 'on' as const, tips: true },
})

const partsOnPage = () =>
  [...document.querySelectorAll('[data-design-part]')].map((element) =>
    element.getAttribute('data-design-part'),
  )

const openWith = (host: FakeHost, button: string | RegExp) => {
  drawFace(host)
  fireEvent.click(screen.getByRole('button', { name: button }))
}

describe('the design parts of a sheet', () => {
  it.each([
    [
      'the order',
      () => orderHost({ order: orderOf([orderLine(itemNamed(view, 'Hummus'))]) }),
      /View bag/,
      ['order', 'order.bar', 'item.add', 'button'],
    ],
    [
      'the bill',
      () =>
        fakeHost({
          ...paying(),
          bill: billOf([billRound('g1', 'guest', [billLine('g1-1', 'Hummus', 1, 700)])], 700),
        }),
      'Table order',
      ['bill', 'bill.lines', 'bill.total', 'button'],
    ],
    ['the call', () => fakeHost(), 'Call a server', ['call', 'call.kinds', 'button']],
    ['the pay sheet', () => fakeHost(paying()), 'Pay', ['pay', 'pay.scope', 'pay.tip', 'button']],
  ] as const)('%s holds its parts, all of the contract', (_name, host, button, parts) => {
    openWith(host(), button)
    const drawn = partsOnPage()
    for (const part of parts) expect(drawn, part).toContain(part)
    for (const part of drawn) expect(DESIGN_MARKER_PAGES.has(part ?? ''), part ?? '').toBe(true)
  })

  it('the card form holds the methods part, and a waiting screen the status part', () => {
    openWith(fakeHost({ ...paying(), payment: paymentOf() }), 'Pay')
    expect(partsOnPage()).toContain('pay.methods')
    cleanup()
    openWith(fakeHost({ ...paying(), payment: paymentOf({ state: 'closed', form: null }) }), 'Pay')
    expect(partsOnPage()).toContain('status')
  })

  it('the Payment confirmation holds the receipt and its venue', () => {
    openWith(
      fakeHost({
        ...paying(),
        payment: paymentOf({ state: 'captured', form: null, tipMinor: 250, amountMinor: 2500 }),
      }),
      'Pay',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Payment confirmation' }))
    const drawn = partsOnPage()
    expect(drawn).toContain('receipt')
    expect(drawn).toContain('receipt.venue')
  })

  it('the dish page holds its parts', () => {
    drawFace(fakeHost())
    fireEvent.click(screen.getByRole('button', { name: /^Hummus/ }))
    const drawn = partsOnPage()
    expect(drawn).toContain('dish')
    for (const part of drawn) expect(DESIGN_MARKER_PAGES.has(part ?? ''), part ?? '').toBe(true)
  })
})
