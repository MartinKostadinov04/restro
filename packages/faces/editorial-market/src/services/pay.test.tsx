// @vitest-environment jsdom

// Paying (brief SH-06 test 6): the amounts and the methods are the host's quote; a failure never
// shows "Paid"; "Paid" needs an accepted pay.start and a receipt; the processing screen always clears.

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SERVICE_TIMEOUT_MS } from './command'
import {
  billLine,
  billOf,
  billRound,
  drawFace,
  eur,
  type FakeHost,
  fakeHost,
  orderingView,
  quoteOf,
  receiptOf,
  resetPage,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

const bill = billOf(
  [billRound('s1', 'staff', [billLine('w1', 'House wine', 2, 2000, 'served')])],
  2000,
)
const PAID = 'Payment complete'

/** Opens the pay sheet and gives it the host's first quote. */
async function openPay(host: FakeHost, quote = quoteOf()) {
  const page = drawFace(host)
  fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
  const sheet = screen.getByRole('dialog', { name: 'Pay' })
  await waitFor(() => expect(host.of('pay.quote')).toHaveLength(1))
  await act(async () => host.of('pay.quote')[0]?.answer())
  page.update({ quote })
  return { page, sheet }
}
const method = (sheet: HTMLElement, name: string) => within(sheet).getByRole('button', { name })
const quotes = (host: FakeHost) => host.of('pay.quote').map((call) => call.command)

describe('the quote', () => {
  it('is asked for on arrival, for the whole table with no choices made', async () => {
    const host = fakeHost({ bill })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(1))
    expect(quotes(host)[0]).toMatchObject({
      kind: 'pay.quote',
      scope: 'full',
      people: null,
      tipPercent: null,
      tipMinor: null,
      promo: null,
    })
    // Until the host's state has a quote there is nothing to pay with.
    const sheet = screen.getByRole('dialog', { name: 'Pay' })
    expect(within(sheet).getByText('Updating the amount')).toBeTruthy()
    expect(within(sheet).queryByRole('button', { name: 'Card' })).toBeNull()
  })

  it("shows the host's amounts as they are: subtotal, tip, VAT and total", async () => {
    const quote = quoteOf({
      subtotal: eur(1234),
      tip: eur(123),
      vat: [{ rate: '20%', amount: eur(206) }],
      total: eur(1357),
    })
    const { sheet } = await openPay(fakeHost({ bill }), quote)
    const rows = [...sheet.querySelectorAll('.ro-sum')].map((row) => row.textContent)
    expect(rows).toEqual([
      'Subtotal€12.34',
      'Tip for the team€1.23',
      'incl. VAT 20%€2.06',
      'Total€13.57',
    ])
  })

  it('offers only the methods of the quote, in its order', async () => {
    const { sheet } = await openPay(fakeHost({ bill }), quoteOf({ methods: ['card', 'waiter'] }))
    const names = within(sheet)
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((label) =>
        ['Apple Pay', 'Google Pay', 'Card', 'Pay the waiter at the table'].includes(label ?? ''),
      )
    expect(names).toEqual(['Card', 'Pay the waiter at the table'])
    expect(within(sheet).queryByRole('button', { name: 'Apple Pay' })).toBeNull()
  })

  it('has no method at all when the quote has none', async () => {
    const { sheet } = await openPay(fakeHost({ bill }), quoteOf({ methods: [] }))
    for (const name of ['Apple Pay', 'Google Pay', 'Card', 'Pay the waiter at the table']) {
      expect(within(sheet).queryByRole('button', { name })).toBeNull()
    }
  })

  it('asks for a new quote when the guest changes the share, the people, the tip or the code', async () => {
    const host = fakeHost({ bill })
    const { page, sheet } = await openPay(host)

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Split equally' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(2))
    expect(quotes(host)[1]).toMatchObject({ scope: 'split', people: 2 })

    fireEvent.click(within(sheet).getByRole('button', { name: 'One more: People' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(3))
    expect(quotes(host)[2]).toMatchObject({ scope: 'split', people: 3 })

    fireEvent.click(within(sheet).getByRole('radio', { name: '15%' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(4))
    expect(quotes(host)[3]).toMatchObject({
      scope: 'split',
      people: 3,
      tipPercent: 15,
      tipMinor: null,
    })

    fireEvent.click(within(sheet).getByRole('radio', { name: 'No tip' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(5))
    expect(quotes(host)[4]).toMatchObject({ tipPercent: 0, tipMinor: null })

    fireEvent.click(within(sheet).getByRole('radio', { name: 'My items' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(6))
    expect(quotes(host)[5]).toMatchObject({ scope: 'mine', people: null, tipPercent: 0 })
    expect(page).toBeDefined()
  })

  it('waits for a pause before it asks for a custom tip, and sends it as an exact amount', async () => {
    const host = fakeHost({ bill })
    const { sheet } = await openPay(host)
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Custom' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(2)) // custom, still the host's own tip
    expect(quotes(host)[1]).toMatchObject({ tipPercent: null, tipMinor: null })

    vi.useFakeTimers()
    const input = within(sheet).getByRole('textbox', { name: 'Custom tip amount' })
    fireEvent.change(input, { target: { value: '2,5' } })
    fireEvent.change(input, { target: { value: '2,50' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(host.of('pay.quote')).toHaveLength(2) // still typing
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(host.of('pay.quote')).toHaveLength(3)
    expect(quotes(host)[2]).toMatchObject({ tipPercent: null, tipMinor: 250 })
    // Something that is not an amount asks for the host's own tip, not for a wrong one.
    fireEvent.change(input, { target: { value: '2,5x' } })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(quotes(host)[3]).toMatchObject({ tipMinor: null })
  })

  it('does not let the guest pay a quote that is for something else than they chose', async () => {
    const host = fakeHost({ bill })
    const { page, sheet } = await openPay(host)
    expect(method(sheet, 'Card').hasAttribute('disabled')).toBe(false)
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Split equally' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(2))
    // The old quote (the whole table) is still in the state; the new one is on its way.
    expect(method(sheet, 'Card').hasAttribute('disabled')).toBe(true)
    await act(async () => host.of('pay.quote')[1]?.answer())
    expect(method(sheet, 'Card').hasAttribute('disabled')).toBe(true) // answered, but the state still shows the old one
    expect(within(sheet).getByRole('button', { name: 'Try again' })).toBeTruthy()
    page.update({ quote: quoteOf({ id: 'q-2', scope: 'split', people: 2, total: eur(1100) }) })
    expect(method(sheet, 'Card').hasAttribute('disabled')).toBe(false)
    expect(sheet.textContent).toContain('Total (per person)€11.00')
    // A split of 3 needs a quote for 3.
    fireEvent.click(within(sheet).getByRole('button', { name: 'One more: People' }))
    expect(method(sheet, 'Card').hasAttribute('disabled')).toBe(true)
  })

  it('says so when the quote could not be had, and asks again on request', async () => {
    const host = fakeHost({ bill })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(1))
    await act(async () => host.of('pay.quote')[0]?.fail())
    const sheet = screen.getByRole('dialog', { name: 'Pay' })
    expect(within(sheet).getByRole('alert').textContent).toContain('could not get the amount')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(2))
    // The same question keeps its actionId.
    expect(host.of('pay.quote')[1]?.command.actionId).toBe(
      host.of('pay.quote')[0]?.command.actionId,
    )
  })

  it('has nothing to pay, and asks for nothing, when the table owes nothing', () => {
    const host = fakeHost({ bill: billOf([], 0) })
    drawFace(host)
    fireEvent.click(screen.getByRole('button', { name: 'Pay' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Pay' })).getByText('There is nothing to pay yet.'),
    ).toBeTruthy()
    expect(host.calls).toHaveLength(0)
  })

  it('shows no tip section when the host offers no tip', async () => {
    const { sheet } = await openPay(fakeHost({ bill }), quoteOf({ tipOptions: [], tip: eur(0) }))
    expect(within(sheet).queryByRole('radiogroup', { name: 'Tip for the team' })).toBeNull()
    expect(sheet.textContent).not.toContain('Tip for the team')
  })

  it("shows the tip button that is the host's own default as on", async () => {
    const { sheet } = await openPay(fakeHost({ bill }))
    expect(within(sheet).getByRole('radio', { name: '10%' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(within(sheet).getByRole('radio', { name: '5%' }).getAttribute('aria-checked')).toBe(
      'false',
    )
  })
})

describe('the promo code', () => {
  it('is shown only when the quote has a promo slot, whether or not a code was tried', async () => {
    const { page, sheet } = await openPay(fakeHost({ bill }))
    expect(within(sheet).queryByLabelText('Promo code')).toBeNull()
    page.update({ quote: quoteOf({ promo: { code: '', accepted: false, message: null } }) })
    expect(within(sheet).getByLabelText('Promo code')).toBeTruthy()
    page.update({
      quote: quoteOf({
        promo: { code: 'NOPE', accepted: false, message: text('Not valid today.') },
      }),
    })
    expect(sheet.textContent).toContain('This code did not work Not valid today.')
    page.update({ quote: quoteOf({ promo: { code: 'GOOD', accepted: true, message: null } }) })
    expect(sheet.textContent).toContain('Code applied')
  })

  it('sends the code with the next quote', async () => {
    const host = fakeHost({ bill })
    const { sheet } = await openPay(
      host,
      quoteOf({ promo: { code: '', accepted: false, message: null } }),
    )
    fireEvent.change(within(sheet).getByLabelText('Promo code'), { target: { value: '  DEMO10 ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(host.of('pay.quote')).toHaveLength(2))
    expect(quotes(host)[1]).toMatchObject({ promo: 'DEMO10' })
  })
})

describe('paying', () => {
  async function paying(extra: Partial<Parameters<typeof quoteOf>[0]> = {}, hostState = { bill }) {
    const host = fakeHost(hostState)
    const { page, sheet } = await openPay(host, quoteOf(extra))
    fireEvent.click(method(sheet, 'Card'))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    return { host, page, sheet, call: host.of('pay.start')[0] }
  }

  it("sends pay.start with the quote's id and the method, and shows processing until the host answers", async () => {
    const { sheet, call } = await paying()
    expect(call?.command).toMatchObject({ kind: 'pay.start', quoteId: 'q-1', method: 'card' })
    expect(call?.command.actionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(within(sheet).getByText('Processing your payment')).toBeTruthy()
    expect(within(sheet).getByText('€22.00')).toBeTruthy()
    expect(sheet.textContent).not.toContain(PAID)
  })

  it('says "Payment complete" only after the host accepted AND its state holds a new receipt', async () => {
    const { page, sheet, call } = await paying()
    await act(async () => call?.answer())
    // Accepted, no receipt yet: not paid.
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByText('We are waiting for your payment to be confirmed.')).toBeTruthy()
    page.update({ receipt: receiptOf() })
    expect(within(sheet).getByText(PAID)).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'View receipt' })).toBeTruthy()
    expect(within(sheet).getByRole('button', { name: 'Back to menu' })).toBeTruthy()
  })

  it('does not take a receipt that was there before for this payment', async () => {
    const old = receiptOf({ id: 'rc-old' })
    const { page, sheet, call } = await paying({}, { bill, receipt: old } as never)
    await act(async () => call?.answer())
    expect(sheet.textContent).not.toContain(PAID)
    page.update({ receipt: receiptOf({ id: 'rc-new' }) })
    expect(within(sheet).getByText(PAID)).toBeTruthy()
  })

  it("does not say paid when the receipt comes without the host's acceptance", async () => {
    const { page, sheet, call } = await paying()
    page.update({ receipt: receiptOf() })
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByText('Processing your payment')).toBeTruthy()
    await act(async () => call?.answer({ status: 'rejected' }))
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByText('Payment did not go through')).toBeTruthy()
  })

  it('shows a failure, not "Paid", when the host rejects, with its reason; a retry is a new payment', async () => {
    const { host, sheet, call } = await paying()
    await act(async () =>
      call?.answer({ status: 'rejected', message: text('The card was declined.') }),
    )
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByRole('alert').textContent).toContain('Payment did not go through')
    expect(sheet.textContent).toContain('The card was declined.')
    expect(within(sheet).queryByText('Processing your payment')).toBeNull()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    expect(host.of('pay.start')[1]?.command.actionId).not.toBe(call?.command.actionId)
  })

  it('clears the processing screen after a throw, never says "Paid", and retries with the same actionId', async () => {
    const { host, sheet, call } = await paying()
    expect(within(sheet).getByText('Processing your payment')).toBeTruthy()
    await act(async () => call?.fail())
    expect(within(sheet).queryByText('Processing your payment')).toBeNull()
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'We could not confirm your payment',
    )

    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    expect(host.of('pay.start')[1]?.command).toEqual(call?.command)

    // Back to the methods: nothing was lost, and a different method is a different payment.
    await act(async () => host.of('pay.start')[1]?.fail())
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pay with' }))
    expect(method(sheet, 'Card')).toBeTruthy()
  })

  it('treats no answer in time as an unknown outcome, not as paid and not as nothing charged', async () => {
    const host = fakeHost({ bill })
    const { sheet } = await openPay(host)
    vi.useFakeTimers()
    fireEvent.click(method(sheet, 'Card'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUT_MS + 10)
    })
    expect(within(sheet).queryByText('Processing your payment')).toBeNull()
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByRole('alert').textContent).toContain(
      'We could not confirm your payment',
    )
    expect(sheet.textContent).not.toMatch(/nothing was charged/i)
  })

  it('waits when the host has the payment but has not decided, and can ask again with the same actionId', async () => {
    const { host, page, sheet, call } = await paying()
    await act(async () => call?.answer({ status: 'pending' }))
    expect(sheet.textContent).not.toContain(PAID)
    expect(within(sheet).getByText('We are waiting for your payment to be confirmed.')).toBeTruthy()
    // A receipt does not make it paid: the host has not accepted.
    page.update({ receipt: receiptOf() })
    expect(sheet.textContent).not.toContain(PAID)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(2))
    expect(host.of('pay.start')[1]?.command.actionId).toBe(call?.command.actionId)
    await act(async () => host.of('pay.start')[1]?.answer())
    expect(within(sheet).getByText(PAID)).toBeTruthy()
  })

  it('sends one payment for two quick taps', async () => {
    const host = fakeHost({ bill })
    const { sheet } = await openPay(host)
    const card = method(sheet, 'Card')
    fireEvent.click(card)
    fireEvent.click(card)
    await waitFor(() => expect(host.of('pay.start')).toHaveLength(1))
    await act(async () => {})
    expect(host.of('pay.start')).toHaveLength(1)
  })

  it('goes on to the receipt from "Payment complete"', async () => {
    const { page, sheet, call } = await paying()
    await act(async () => call?.answer())
    page.update({ receipt: receiptOf() })
    fireEvent.click(within(sheet).getByRole('button', { name: 'View receipt' }))
    const receipt = await screen.findByRole('dialog', { name: 'Receipt' })
    expect(receipt.textContent).toContain('Test venue')
    expect(screen.queryByRole('dialog', { name: 'Pay' })).toBeNull()
  })
})
