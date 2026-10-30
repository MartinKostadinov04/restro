// @vitest-environment jsdom
// The sent-order sheet says which POS bill the order joined, as staff know it there (RR-56), and
// nothing until it has joined one.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Frame, SentDetailView } from '@/server/tonight/night-view'
import { renderWithIntl } from '@/test-utils'

import { RunProvider } from './run'
import { SentOrderSheet } from './sent-sheet'

const sentOrderDetailAction = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/tonight/night-actions', () => ({ sentOrderDetailAction }))
vi.mock('@/server/tonight/actions', () => ({}))

const frame = {
  venueId: 'vn_0123456789ABCDEFGHIJKL',
  source: 'Mistral',
  currency: 'EUR',
  device: false,
} as unknown as Frame

const detail = (billRef: string | null): SentDetailView => ({
  row: {
    id: 'so_1',
    reference: 'K7Q',
    tableId: 'tb_1',
    table: '7',
    numbered: true,
    itemCount: 2,
    totalMinor: 1200,
    state: 'added',
    reason: null,
    time: '22:10',
    landedAt: null,
    answer: null,
  },
  lines: [],
  billRef,
  steps: [],
})

async function open(billRef: string | null) {
  sentOrderDetailAction.mockResolvedValue({ ok: true, detail: detail(billRef) })
  renderWithIntl(
    <RunProvider>
      <SentOrderSheet frame={frame} sentOrderId="so_1" onClose={vi.fn()} onChanged={vi.fn()} />
    </RunProvider>,
  )
  await screen.findByTestId('sent-sheet-body')
}

describe('the bill on the sent-order sheet', () => {
  it('names the bill in the POS', async () => {
    await open('1042')
    expect(screen.getByTestId('sent-bill').textContent).toBe('Bill 1042 in Mistral')
  })

  it('says nothing before the order has joined a bill', async () => {
    await open(null)
    expect(screen.queryByTestId('sent-bill')).toBeNull()
  })
})
