// @vitest-environment jsdom
// The sent-order sheet says which POS bill the order joined, as staff know it there (RR-56), and
// nothing until it has joined one; and it offers the sold-out tap on each of its lines (D147,
// #437), which only somebody who may mark sees.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Frame, SentDetailView } from '@/server/tonight/night-view'
import { renderWithIntl } from '@/test-utils'

import { RunProvider } from './run'
import { SentOrderSheet } from './sent-sheet'

const sentOrderDetailAction = vi.hoisted(() => vi.fn())
const markSoldOutAction = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/night-actions', () => ({ sentOrderDetailAction }))
vi.mock('@/server/tonight/actions', () => ({ markSoldOutAction }))

const frame = {
  venueId: 'vn_0123456789ABCDEFGHIJKL',
  source: 'Mistral',
  currency: 'EUR',
  device: false,
  can: { soldOut: true },
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

describe('a sheet whose read never got an answer (RR-O32)', () => {
  it('says so and reads again on the button, instead of loading for ever', async () => {
    sentOrderDetailAction.mockRejectedValueOnce(new Error('no connection'))
    sentOrderDetailAction.mockResolvedValueOnce({ ok: true, detail: detail('1042') })
    renderWithIntl(
      <RunProvider>
        <SentOrderSheet frame={frame} sentOrderId="so_1" onClose={vi.fn()} onChanged={vi.fn()} />
      </RunProvider>,
    )
    const line = await screen.findByTestId('read-failed')
    expect(line.textContent).toContain('Check the connection')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByTestId('sent-bill')).toBeTruthy())
  })
})

const ITEM = 'nd_0123456789ABCDEFGHIJKL'

/** The same sheet with one line on it, for a frame that may or may not mark. */
async function openWithLine(soldOut: boolean, can = { soldOut: true }) {
  sentOrderDetailAction.mockResolvedValue({
    ok: true,
    detail: {
      ...detail('1042'),
      lines: [{ itemId: ITEM, qty: 2, name: 'Mojito', options: [], note: null, soldOut }],
    },
  })
  renderWithIntl(
    <RunProvider>
      <SentOrderSheet
        frame={{ ...frame, can } as unknown as Frame}
        sentOrderId="so_1"
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    </RunProvider>,
  )
  await screen.findByTestId('sent-sheet-body')
}

describe('the sold-out tap on a line of the sheet', () => {
  it('marks the item for the night, naming it in the toast', async () => {
    markSoldOutAction.mockResolvedValue({ ok: true, details: {} })
    await openWithLine(false)
    await userEvent.click(screen.getByTestId('sold-out-mark'))
    await waitFor(() =>
      expect(markSoldOutAction).toHaveBeenCalledWith({
        venueId: frame.venueId,
        itemId: ITEM,
        soldOut: true,
      }),
    )
  })

  it('offers to put a marked item back on sale, and says it is marked', async () => {
    markSoldOutAction.mockResolvedValue({ ok: true, details: {} })
    await openWithLine(true)
    expect(screen.getByTestId('sold-out-state').textContent).toBe('Sold out tonight')
    // #437: the money is not handled, and the screen says so instead of implying it is.
    expect(screen.getByTestId('sold-out-paid').textContent).toBe(
      'A line already paid for is still refunded by hand.',
    )
    await userEvent.click(screen.getByTestId('sold-out-back'))
    await waitFor(() =>
      expect(markSoldOutAction).toHaveBeenCalledWith({
        venueId: frame.venueId,
        itemId: ITEM,
        soldOut: false,
      }),
    )
  })

  it('shows no tap at all to somebody whose role may not mark', async () => {
    await openWithLine(false, { soldOut: false })
    expect(screen.queryByTestId('sold-out-mark')).toBeNull()
    expect(screen.getByText('2 × Mojito')).toBeTruthy()
  })

  it("asks the person's own PIN on a shared device, and writes nothing before it", async () => {
    // RR-83: the mark writes the menu, so the tablet gets nowhere without a PIN — and the PIN is
    // what makes the night's Log name the bartender rather than the device.
    markSoldOutAction.mockResolvedValue({ ok: true, details: {} })
    sentOrderDetailAction.mockResolvedValue({
      ok: true,
      detail: {
        ...detail('1042'),
        lines: [{ itemId: ITEM, qty: 2, name: 'Mojito', options: [], note: null, soldOut: false }],
      },
    })
    renderWithIntl(
      <RunProvider>
        <SentOrderSheet
          frame={{ ...frame, device: true, can: { soldOut: true } } as unknown as Frame}
          sentOrderId="so_1"
          onClose={vi.fn()}
          onChanged={vi.fn()}
        />
      </RunProvider>,
    )
    await screen.findByTestId('sent-sheet-body')
    await userEvent.click(screen.getByTestId('sold-out-mark'))
    expect(await screen.findByTestId('pin-sheet')).toBeTruthy()
    expect(markSoldOutAction).not.toHaveBeenCalled()
    await userEvent.keyboard('1234')
    await waitFor(() =>
      expect(markSoldOutAction).toHaveBeenCalledWith({
        venueId: frame.venueId,
        itemId: ITEM,
        soldOut: true,
        pin: '1234',
      }),
    )
  })
})
