// @vitest-environment jsdom
// "Not served" on a paid line of a payment's sheet (the 11-18 refund decision, 148): offered only to
// a person who may answer, on a captured payment whose line the POS closed, while Restro's refunds
// are on; a tap on a personal phone asks once more in the sheet; the line then tells what is true:
// "being sent" until the provider's list shows the refund (D72), then "refunded"; "did not go
// through" says to see the bar and offers the tap again.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaymentDetailView } from '@/server/tonight/payment-view'
import { renderWithIntl } from '@/test-utils'

import { PaymentSheet } from './payment-sheet'
import { RunProvider } from './run'

const paymentDetailAction = vi.hoisted(() => vi.fn())
const notServedAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('@/server/tonight/payment-actions', () => ({ paymentDetailAction }))
vi.mock('@/server/tonight/actions', () => ({ notServedAction }))
vi.mock('sonner', () => ({ toast }))

type Line = PaymentDetailView['lines'][number]

const line = (over: Partial<Line> = {}): Line => ({
  name: 'Jägermeister',
  quantity: '2',
  amountMinor: 1200,
  position: 1,
  closedMinor: 1200,
  refund: null,
  ...over,
})

const detail = (over: Partial<PaymentDetailView> = {}): PaymentDetailView => ({
  row: {
    id: 'py_1',
    table: '7',
    numbered: true,
    bar: null,
    payTable: null,
    state: 'captured',
    reason: null,
    amountMinor: 1200,
    tipMinor: 0,
    receiptNumber: 'R-000123',
    currency: 'EUR',
    time: '01:00',
  },
  number: '4821',
  lines: [line()],
  refundRouteOff: false,
  steps: [],
  provider: 'Stripe',
  refunds: [],
  dispute: null,
  evidence: null,
  ...over,
})

const can = { answer: true } as never
const frame = { venueId: 'vn_0123456789ABCDEFGHIJKL', currency: 'EUR', can, device: false }

async function open(view: PaymentDetailView, withFrame: object = frame) {
  paymentDetailAction.mockResolvedValue({ ok: true, detail: view })
  renderWithIntl(
    <RunProvider>
      <PaymentSheet frame={withFrame as never} paymentId="py_1" onClose={vi.fn()} />
    </RunProvider>,
  )
  await screen.findByTestId('payment-sheet-body')
}

beforeEach(() => {
  toast.mockClear()
  paymentDetailAction.mockReset()
  notServedAction.mockReset()
})

describe('the Not served control', () => {
  it('is not drawn without the right to answer, and not on a payment that was not captured', async () => {
    await open(detail(), { venueId: frame.venueId, currency: 'EUR' })
    expect(screen.queryByTestId('not-served')).toBeNull()
  })

  it('is not drawn on a line the POS did not close, or while Restro’s refunds are switched off', async () => {
    await open(detail({ lines: [line({ closedMinor: null })] }))
    expect(screen.queryByTestId('not-served')).toBeNull()
  })

  it('is not drawn while Restro’s refunds are switched off', async () => {
    await open(detail({ refundRouteOff: true }))
    expect(screen.queryByTestId('not-served')).toBeNull()
  })

  it('asks once more in the sheet on a personal phone, then asks for the refund of that line', async () => {
    notServedAction.mockResolvedValue({ ok: true, details: { refundId: 'rf_1' } })
    await open(detail())
    await userEvent.click(screen.getByTestId('not-served'))
    // Nothing is asked of the server by the first tap.
    expect(notServedAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('not-served-yes'))
    await waitFor(() => expect(notServedAction).toHaveBeenCalledTimes(1))
    expect(notServedAction.mock.calls[0]?.[0]).toMatchObject({
      venueId: frame.venueId,
      paymentId: 'py_1',
      position: 1,
    })
    // The sheet reads the payment again to show what became of it.
    await waitFor(() => expect(paymentDetailAction).toHaveBeenCalledTimes(2))
  })

  it('says "Refund being sent" until the provider’s list shows it, then "Refunded"', async () => {
    const by = { who: { kind: 'person', name: 'Ivan' }, telegram: false } as never
    await open(detail({ lines: [line({ refund: { state: 'sending', amountMinor: 1200, by } })] }))
    expect(screen.getByTestId('payment-line-refund').textContent).toBe('Refund being sent')
    expect(screen.queryByTestId('not-served')).toBeNull()
  })

  it('says Refunded with the amount once confirmed', async () => {
    const by = { who: { kind: 'person', name: 'Ivan' }, telegram: false } as never
    await open(detail({ lines: [line({ refund: { state: 'refunded', amountMinor: 1200, by } })] }))
    expect(screen.getByTestId('payment-line-refund').textContent).toBe('Refunded €12.00')
  })

  it('says to see the bar when the refund did not go through, and offers the tap again', async () => {
    const by = { who: { kind: 'person', name: 'Ivan' }, telegram: false } as never
    await open(detail({ lines: [line({ refund: { state: 'failed', amountMinor: 1200, by } })] }))
    expect(screen.getByTestId('payment-line-refund').textContent).toContain(
      "Refund didn't go through. Please see the bar.",
    )
    expect(screen.getByTestId('not-served')).toBeTruthy()
  })
})
