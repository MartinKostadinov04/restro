// @vitest-environment jsdom
// What a payment's sheet adds for refunds and disputes (#222; decision log 5.2, 5.12, 5.13): the
// refund lines with "Refunded" / "Partly refunded", the storno answered, the dispute's state, and
// the "Dispute evidence" section with Copy as text, Copy in English and Print, all from the one
// text the server made. A sheet read without the right (no `evidence`) has no such section.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaymentDetailView } from '@/server/tonight/payment-view'
import { renderWithIntl } from '@/test-utils'

import { EVIDENCE_PRINT_CSS } from './dispute-evidence'
import { PaymentSheet } from './payment-sheet'

const paymentDetailAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('@/server/tonight/payment-actions', () => ({ paymentDetailAction }))
vi.mock('sonner', () => ({ toast }))

const EN_TEXT = 'Evidence for a card payment dispute\nPayment: 4821'
const BG_TEXT = 'Доказателства по спор за плащане с карта\nПлащане: 4821'

const detail = (over: Partial<PaymentDetailView> = {}): PaymentDetailView => ({
  row: {
    id: 'py_1',
    table: '7',
    numbered: true,
    bar: null,
    payTable: null,
    state: 'captured',
    reason: null,
    amountMinor: 4600,
    tipMinor: 400,
    receiptNumber: 'R-000123',
    currency: 'EUR',
    time: '22:50',
  },
  number: '4821',
  lines: [],
  steps: [],
  provider: 'Stripe',
  refunds: [],
  dispute: null,
  evidence: null,
  ...over,
})

const frame = { venueId: 'vn_0123456789ABCDEFGHIJKL', currency: 'EUR' }

async function open(view: PaymentDetailView) {
  paymentDetailAction.mockResolvedValue({ ok: true, detail: view })
  renderWithIntl(<PaymentSheet frame={frame} paymentId="py_1" onClose={vi.fn()} />)
  await screen.findByTestId('payment-sheet-body')
}

beforeEach(() => {
  toast.mockClear()
  paymentDetailAction.mockReset()
})

describe('the refunds on the sheet', () => {
  it('says Partly refunded with the amounts, each refund with its storno or the lack of one', async () => {
    await open(
      detail({
        refunds: [
          {
            amountMinor: 500,
            time: '10:00',
            failed: false,
            storno: {
              by: { who: { kind: 'person', name: 'Ivan' }, telegram: false },
              time: '12:30',
            },
          },
          { amountMinor: 300, time: '11:00', failed: false, storno: null },
          { amountMinor: 700, time: '11:30', failed: true, storno: null },
        ],
      }),
    )
    const refunds = screen.getByTestId('payment-refunds')
    expect(refunds.textContent).toContain('Partly refunded: €8.00 of €46.00')
    expect(refunds.textContent).toContain('Storno done · Ivan, 12:30')
    expect(refunds.textContent).toContain('storno not done')
    expect(refunds.textContent).toContain("The refund didn't go through at Stripe")
  })

  it('says Refunded when everything was', async () => {
    await open(
      detail({ refunds: [{ amountMinor: 4600, time: '10:00', failed: false, storno: null }] }),
    )
    expect(screen.getByTestId('payment-refunds').textContent).toContain('Refunded €46.00')
  })
})

describe('the dispute on the sheet', () => {
  it('words open, won and lost', async () => {
    await open(detail({ dispute: { state: 'open', due: { date: '2026-11-04', time: '11:00' } } }))
    expect(screen.getByTestId('payment-dispute').textContent).toContain('Disputed')
    expect(screen.getByTestId('payment-dispute').textContent).toContain(
      'Answer in Stripe by 4 November',
    )
  })

  it('says a dispute that was lost asks the accountant', async () => {
    await open(detail({ dispute: { state: 'lost', due: null } }))
    expect(screen.getByTestId('payment-dispute').textContent).toMatch(
      /Dispute lost: the money went back to the guest's bank\. Ask your accountant/,
    )
  })

  it('says a dispute that was won leaves the money with the venue', async () => {
    await open(detail({ dispute: { state: 'won', due: null } }))
    expect(screen.getByTestId('payment-dispute').textContent).toContain(
      'Dispute won: the venue keeps the money.',
    )
  })
})

describe('the dispute evidence', () => {
  it('is not drawn without the right to see it', async () => {
    await open(detail())
    expect(screen.queryByTestId('dispute-evidence')).toBeNull()
  })

  it('shows the text and where to paste it, and copies it as text and in English', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await open(detail({ evidence: { bg: BG_TEXT, en: EN_TEXT } }))
    expect(screen.getByText('Dispute evidence')).toBeTruthy()
    expect(
      screen.getByText("Paste this into the dispute in Stripe. Restro doesn't answer disputes."),
    ).toBeTruthy()
    expect(screen.getByTestId('dispute-evidence-text').textContent).toBe(EN_TEXT)
    await userEvent.click(screen.getByRole('button', { name: 'Copy as text' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EN_TEXT))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Copied', expect.anything()))
    writeText.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Copy in English' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(EN_TEXT))
  })

  it('prints the text alone on a page of its own and takes the page away afterwards', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      // While the dialog is open the page holds the text and the rule that hides the rest.
      expect(document.getElementById('evidence-print-root')?.textContent).toBe(EN_TEXT)
      expect(document.getElementById('evidence-print-style')?.textContent).toBe(EVIDENCE_PRINT_CSS)
    })
    await open(detail({ evidence: { bg: BG_TEXT, en: EN_TEXT } }))
    await userEvent.click(screen.getByRole('button', { name: 'Print' }))
    expect(print).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('afterprint'))
    expect(document.getElementById('evidence-print-root')).toBeNull()
    expect(document.getElementById('evidence-print-style')).toBeNull()
    print.mockRestore()
  })
})
