// @vitest-environment jsdom
// An earlier night's open payment question on today's end of night (#220): the view carries the
// night it was asked on (`earlier`), a question of tonight carries none, and the row draws the
// words "From the night of {date}" (`m_earlier`) for the one and not the other.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { paymentsView } from '@/server/tonight/payment-view'
import { renderWithIntl } from '@/test-utils'

import { ActionRowItem } from './action-rows'
import { RunProvider } from './run'

type NightPayments = Parameters<typeof paymentsView>[0]
type NightPayFix = NightPayments['fix'][number]
type NightPaymentRow = NightPayFix['payment']

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
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

const fix = (id: string, earlier: string | null): NightPayFix => ({
  payment: paymentRow(id),
  problem: 'unconfirmed',
  question: 'close',
  earlier,
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
  rows: [],
  hasMore: false,
  paying: null,
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
