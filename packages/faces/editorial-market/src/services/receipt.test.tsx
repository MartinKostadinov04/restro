// @vitest-environment jsdom

// The receipt page: it draws the host's `state.receipt` and nothing else, and its buttons are the
// actions the receipt allows, each sending `receipt.action`.

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  billLine,
  drawFace,
  eur,
  type FakeHost,
  fakeHost,
  orderingView,
  receiptOf,
  resetPage,
  text,
} from './test-kit'

vi.setConfig({ testTimeout: 15_000 })

beforeEach(resetPage)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

/** The face at a shared link to the receipt (the address names the sheet), and the sheet. */
async function showReceipt(host: FakeHost, view = orderingView(), name = 'Receipt') {
  window.history.replaceState(null, '', '/#receipt')
  drawFace(host, view)
  return screen.findByRole('dialog', { name })
}

describe('the receipt page', () => {
  it("draws the host's receipt: venue, table, date, lines, VAT, tip, total, method and references", async () => {
    const receipt = receiptOf({
      lines: [
        billLine('l1', 'Hummus', 2, 1400, 'served'),
        billLine('l2', 'Mojito', 1, 1000, 'served'),
      ],
      vat: [
        { rate: '9%', amount: eur(111) },
        { rate: '20%', amount: eur(222) },
      ],
      tip: eur(240),
      total: eur(2640),
      method: 'google',
    })
    const page = await showReceipt(fakeHost({ receipt }))
    const article = within(page).getByRole('article', { name: 'Receipt' })
    expect(article.textContent).toContain('Test venue')
    expect(article.textContent).toContain('Table 12')
    expect(article.textContent).toContain('Date: 07.10.2026 21:00')
    expect(article.textContent).toContain('2× Hummus')
    expect(article.textContent).toContain('1× Mojito')
    // Every amount is the host's: the total is not the lines plus the tip.
    expect(article.textContent).toContain('incl. VAT 9%€1.11')
    expect(article.textContent).toContain('incl. VAT 20%€2.22')
    expect(article.textContent).toContain('Tip for the team€2.40')
    expect(article.textContent).toContain('Total€26.40')
    expect(article.textContent).toContain('Paid withGoogle Pay')
    expect(article.textContent).toContain('Fiscal ref.FR-123')
    expect(article.textContent).toContain('Reference R-0001')
  })

  it('leaves out what the receipt does not have: no table, no fiscal reference', async () => {
    const page = await showReceipt(
      fakeHost({ receipt: receiptOf({ tableLabel: null, fiscalReference: null }) }),
    )
    const article = within(page).getByRole('article')
    expect(article.textContent).not.toContain('Table')
    expect(article.textContent).not.toContain('Fiscal ref.')
  })

  it('says there is no receipt, and draws nothing of its own, when the host has none', async () => {
    const page = await showReceipt(fakeHost())
    expect(within(page).getByText('There is no receipt yet.')).toBeTruthy()
    expect(within(page).queryByRole('article')).toBeNull()
  })

  it('shows only the buttons the receipt allows', async () => {
    const page = await showReceipt(
      fakeHost({ receipt: receiptOf({ actions: { pdf: true, email: false, print: true } }) }),
    )
    expect(within(page).getByRole('button', { name: 'Download PDF' })).toBeTruthy()
    expect(within(page).getByRole('button', { name: 'Ask waiter to print' })).toBeTruthy()
    expect(within(page).queryByRole('button', { name: 'Email receipt' })).toBeNull()
  })

  it('shows no button at all when the receipt allows none', async () => {
    const page = await showReceipt(
      fakeHost({ receipt: receiptOf({ actions: { pdf: false, email: false, print: false } }) }),
    )
    expect(
      within(page)
        .queryAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Back to menu'])
  })

  it("sends receipt.action with the receipt's id, and says what the host answers", async () => {
    const host = fakeHost({ receipt: receiptOf() })
    const page = await showReceipt(host)
    fireEvent.click(within(page).getByRole('button', { name: 'Email receipt' }))
    await waitFor(() => expect(host.of('receipt.action')).toHaveLength(1))
    const call = host.of('receipt.action')[0]
    expect(call?.command).toMatchObject({
      kind: 'receipt.action',
      receiptId: 'rc-1',
      action: 'email',
    })
    // Nothing is claimed before the host answers.
    expect(within(page).queryByRole('status')).toBeNull()
    expect(
      within(page).getByRole('button', { name: 'Email receipt' }).hasAttribute('disabled'),
    ).toBe(true)
    await act(async () => call?.answer({ message: text('Sent to a***@example.test.') }))
    expect(within(page).getByRole('status').textContent).toBe('Sent to a***@example.test.')
    expect(
      within(page).getByRole('button', { name: 'Email receipt' }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it('says "Done" when the host accepts without a message, and a new tap is a new action', async () => {
    const host = fakeHost({ receipt: receiptOf() })
    const page = await showReceipt(host)
    fireEvent.click(within(page).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(host.of('receipt.action')).toHaveLength(1))
    await act(async () => host.of('receipt.action')[0]?.answer())
    expect(within(page).getByRole('status').textContent).toBe('Done: request sent')
    fireEvent.click(within(page).getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(host.of('receipt.action')).toHaveLength(2))
    expect(host.of('receipt.action')[1]?.command.actionId).not.toBe(
      host.of('receipt.action')[0]?.command.actionId,
    )
  })

  it('says it did not go through on a refusal or an error, and retries a failed one with the same actionId', async () => {
    const host = fakeHost({ receipt: receiptOf() })
    const page = await showReceipt(host)
    fireEvent.click(within(page).getByRole('button', { name: 'Ask waiter to print' }))
    await waitFor(() => expect(host.of('receipt.action')).toHaveLength(1))
    await act(async () => host.of('receipt.action')[0]?.fail())
    expect(within(page).getByRole('alert').textContent).toBe('That did not go through. Try again.')

    fireEvent.click(within(page).getByRole('button', { name: 'Ask waiter to print' }))
    await waitFor(() => expect(host.of('receipt.action')).toHaveLength(2))
    expect(host.of('receipt.action')[1]?.command.actionId).toBe(
      host.of('receipt.action')[0]?.command.actionId,
    )
    await act(async () =>
      host
        .of('receipt.action')[1]
        ?.answer({ status: 'rejected', message: text('No printer here.') }),
    )
    expect(within(page).getByRole('alert').textContent).toBe('No printer here.')
  })

  it('is in Bulgarian for a Bulgarian menu', async () => {
    const page = await showReceipt(
      fakeHost({ receipt: receiptOf({ method: 'waiter' }) }),
      orderingView('bg_BG'),
      'Касова бележка',
    )
    expect(page.textContent).toContain('Платено сПлащане при сервитьора')
    expect(page.textContent).toContain('Фискален №FR-123')
    expect(page.textContent).toContain('Изтегли PDF')
  })
})
