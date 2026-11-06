// @vitest-environment jsdom
// An earlier night's open payment question on today's end of night (#220): the view carries the
// night it was asked on (`earlier`), a question of tonight carries none, and the row draws the
// words "From the night of {date}" (`m_earlier`) for the one and not the other.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { paymentsView } from '@/server/tonight/payment-view'
import { renderWithIntl } from '@/test-utils'

import { ActionRowItem } from './action-rows'
import { NightPaymentsList } from './night-payments'
import { RunProvider } from './run'

type NightPayments = Parameters<typeof paymentsView>[0]
type NightPayFix = NightPayments['fix'][number]
type NightPaymentRow = NightPayFix['payment']

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
const nightPaymentsAction = vi.hoisted(() => vi.fn())
vi.mock('@/server/tonight/payment-actions', () => ({
  nightPaymentsAction,
  paymentDetailAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))

const paymentRow = (id: string): NightPaymentRow => ({
  id,
  tableId: 'tb_1',
  table: '7',
  numbered: true,
  bar: null,
  payTable: null,
  kind: 'on_bill',
  state: 'unconfirmed',
  reason: 'close_unknown',
  reference: null,
  amountMinor: 3600,
  tipMinor: null,
  capturedMinor: null,
  refundedMinor: 0,
  dispute: null,
  receiptNumber: null,
  currency: 'EUR',
  at: new Date('2026-10-29T21:00:00Z'),
  captureBefore: new Date('2026-11-02T20:00:00Z'),
})

const fix = (
  id: string,
  earlier: string | null,
  chargeMinor: number | null = null,
): NightPayFix => ({
  payment: paymentRow(id),
  problem: 'unconfirmed',
  question: 'close',
  earlier,
  chargeMinor,
  alert: {
    id: `al_${id}`,
    kind: 'payment_unconfirmed',
    raisedAt: new Date('2026-10-29T21:00:00Z'),
  },
})

const read = (fixes: readonly NightPayFix[]): NightPayments => ({
  day: '2026-10-29',
  full: false,
  counts: { all: 0, captured: 0, released: 0, unconfirmed: 0 },
  fix: fixes,
  notBrought: [],
  stornoFix: [],
  rows: [],
  hasMore: false,
  paying: null,
  providerKind: null,
  money: null,
})

describe("an earlier night's question on today's end of night", () => {
  const view = paymentsView(
    read([fix('py_old', '2026-10-25'), fix('py_new', null)]),
    'Europe/Sofia',
  )

  it('carries the night it was asked on, and none for tonight', () => {
    const byPayment = (id: string) => view.fix.find((row) => row.money?.paymentId === id)
    expect(byPayment('py_old')?.money?.earlier).toBe('2026-10-25')
    expect(byPayment('py_new')?.money?.earlier).toBeNull()
  })

  it('keeps the amount without the tip and carries the true charge for the confirmation alone', () => {
    const shown = paymentsView(read([fix('py_dev', null, 3800)]), 'Europe/Sofia')
    expect(shown.fix[0]?.money).toMatchObject({ amountMinor: 3600, chargeMinor: 3800 })
    expect(view.fix.every((row) => row.money?.chargeMinor === null)).toBe(true)
  })

  it('draws the words for the earlier night only', () => {
    const frame = {
      venueId: 'vn_1',
      source: 'Till',
      currency: 'EUR',
      device: false,
      can: {
        openClose: false,
        resume: false,
        pause: false,
        lift: false,
        answer: true,
        followUp: true,
      },
    }
    renderWithIntl(
      <RunProvider>
        <ul>
          {view.fix.map((row) => (
            <ActionRowItem
              key={row.money?.paymentId}
              row={row}
              view={frame}
              primary={false}
              ago=""
            />
          ))}
        </ul>
      </RunProvider>,
    )
    expect(screen.getAllByText(/From the night of 25 October/)).toHaveLength(1)
  })
})

describe('the one-shot "show all" read of the end of the night', () => {
  it('says what is true when it fails and reads again on the button, not by itself (D72)', async () => {
    const initial = {
      ...paymentsView(read([]), 'Europe/Sofia'),
      counts: { all: 5, captured: 0, released: 0, unconfirmed: 0 },
    }
    nightPaymentsAction.mockRejectedValueOnce(new Error('no connection'))
    nightPaymentsAction.mockResolvedValueOnce({ ok: true, payments: initial })
    renderWithIntl(
      <RunProvider>
        <NightPaymentsList
          initial={initial}
          frame={{ venueId: 'vn_1', source: 'Till', currency: 'EUR', device: false } as never}
        />
      </RunProvider>,
    )
    await userEvent.click(screen.getByTestId('night-pay-show-all'))
    const line = await screen.findByTestId('load-failed')
    expect(line.textContent).not.toContain('by itself')
    expect(nightPaymentsAction).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(nightPaymentsAction).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId('load-failed')).toBeNull())
  })
})
