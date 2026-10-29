// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PaymentTablesView, TablesView } from '@/server/tables/view'
import { markPaymentTableAction } from '@/server/tonight/actions'
import { renderWithIntl } from '@/test-utils'

import { TablesPanel } from './tables-panel'
import { row, VENUE_ID, view } from './test-view'

// Marking payment tables on Tables & QR (#215): the card's menu, the question before marking, the
// one-tap stop with Undo, the badges, the banner, and what a person without the right sees.
vi.mock('@/server/tonight/actions', () => ({ markPaymentTableAction: vi.fn() }))
vi.mock('@/server/tables/actions', () => ({
  createAllCodesAction: vi.fn(),
  issueCodeAction: vi.fn(),
  renameTableAction: vi.fn(),
  turnOffCodeAction: vi.fn(),
  createAreaAction: vi.fn(),
  renameAreaAction: vi.fn(),
  setAreaHiddenAction: vi.fn(),
  moveAreaAction: vi.fn(),
  deleteAreaAction: vi.fn(),
  createTableAction: vi.fn(),
  setTableNumberAction: vi.fn(),
  setTableHiddenAction: vi.fn(),
  moveTableAction: vi.fn(),
  deleteTableAction: vi.fn(),
  setMenuRouteAction: vi.fn(),
  revealCodesAction: vi.fn().mockResolvedValue({ ok: true, codes: [] }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const CODED = 'tb_0000000000000000000002'
const PAYMENT = 'tb_0000000000000000000010'
const NO_BAR = 'tb_0000000000000000000001'
const OK = { ok: true, details: {} } as const
const BAR = { id: 'br_0000000000000000000001', name: 'Roof bar' }

const paying = (overrides: Partial<PaymentTablesView> = {}): PaymentTablesView => ({
  canMark: true,
  email: 'owner@club.test',
  missing: [{ name: 'Roof bar' }],
  ...overrides,
})

/** The default view with the coded table in the roof bar, one payment table, and paying on. */
function payingView(overrides: Partial<TablesView> = {}): TablesView {
  const base = view()
  return {
    ...base,
    paying: paying(),
    halls: base.halls.map((hall) => ({
      ...hall,
      tables: hall.tables.map((table) => {
        if (table.id === CODED) return { ...table, bar: BAR }
        if (table.id === PAYMENT) {
          return {
            ...table,
            isPublic: false,
            hasCode: false,
            isPaymentTable: true,
            bar: BAR,
            menu: null,
          }
        }
        return table
      }),
    })),
    ...overrides,
  }
}

const cardOf = (id: string) => {
  const found = screen
    .getAllByTestId('table-card')
    .find((element) => element.getAttribute('data-table-id') === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const menuOf = async (user: ReturnType<typeof userEvent.setup>, id: string) =>
  user.click(within(cardOf(id)).getByTestId('table-menu'))

beforeEach(() => {
  vi.mocked(markPaymentTableAction).mockReset()
  vi.mocked(markPaymentTableAction).mockResolvedValue(OK)
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('payment tables on Tables & QR', () => {
  it('shows a payment table’s badge and its bar instead of a code, and the bar of the others', () => {
    renderWithIntl(<TablesPanel view={payingView()} />)
    const payment = cardOf(PAYMENT)
    expect(within(payment).getByTestId('payment-table-badge').textContent).toBe('Payment table')
    expect(within(payment).getByTestId('table-bar').textContent).toBe('Bar: Roof bar')
    expect(within(payment).queryByTestId('code-status')).toBeNull()
    expect(within(payment).queryByTestId('table-hidden')).toBeNull()
    // The coded table keeps its code badge and shows its bar; a table the POS gives no bar says so.
    expect(within(cardOf(CODED)).getByTestId('code-status').textContent).toBe('Code active')
    expect(within(cardOf(CODED)).getByTestId('table-bar').textContent).toBe('Bar: Roof bar')
    expect(within(cardOf(NO_BAR)).getByTestId('table-bar').textContent).toBe(
      'Bar: not known in barsy',
    )
  })

  it('says a payment table’s bar is not known when the POS gives none', () => {
    const base = payingView()
    renderWithIntl(
      <TablesPanel
        view={{
          ...base,
          halls: base.halls.map((hall) => ({
            ...hall,
            tables: hall.tables.map((t) => (t.id === PAYMENT ? { ...t, bar: null } : t)),
          })),
        }}
      />,
    )
    expect(within(cardOf(PAYMENT)).getByTestId('table-bar').textContent).toBe(
      'Bar: not known in barsy',
    )
  })

  it('names the bars without a payment table, at most three and then “and N more”', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={payingView()} />)
    expect(screen.getByTestId('payment-tables-banner').textContent).toBe(
      'Mark a payment table for each bar so guests can pay by card. Still missing for: Roof bar.',
    )
    unmount()

    renderWithIntl(
      <TablesPanel
        view={payingView({
          paying: paying({
            missing: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: null }],
          }),
        })}
      />,
    )
    expect(screen.getByTestId('payment-tables-banner').textContent).toContain(
      'Still missing for: A, B, C and 2 more.',
    )
  })

  it('names the tables with no bar as a group, and has no banner once every bar has one', () => {
    const { unmount } = renderWithIntl(
      <TablesPanel view={payingView({ paying: paying({ missing: [{ name: null }] }) })} />,
    )
    expect(screen.getByTestId('payment-tables-banner').textContent).toContain(
      'Still missing for: the tables with no bar.',
    )
    unmount()
    renderWithIntl(<TablesPanel view={payingView({ paying: paying({ missing: [] }) })} />)
    expect(screen.queryByTestId('payment-tables-banner')).toBeNull()
  })

  it('asks first, naming the consequence, and marks only on the confirm', async () => {
    const user = userEvent.setup()
    renderWithIntl(<TablesPanel view={payingView()} />)
    await menuOf(user, CODED)
    await user.click(screen.getByTestId('mark-payment-table'))
    const dialog = screen.getByTestId('confirm-payment-table')
    expect(within(dialog).getByText('Use table 2 as a payment table?')).toBeTruthy()
    expect(dialog.textContent).toContain('to take card payments for Roof bar')
    expect(dialog.textContent).toContain('its code stops for good')
    expect(markPaymentTableAction).not.toHaveBeenCalled()

    // "Keep for guests" changes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Keep for guests' }))
    expect(markPaymentTableAction).not.toHaveBeenCalled()

    await menuOf(user, CODED)
    await user.click(screen.getByTestId('mark-payment-table'))
    await user.click(
      within(screen.getByTestId('confirm-payment-table')).getByRole('button', {
        name: 'Use as payment table',
      }),
    )
    await waitFor(() =>
      expect(markPaymentTableAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: CODED,
        isPaymentTable: true,
      }),
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Table 2 is a payment table', expect.anything()),
    )
  })

  it('drops the code sentence for a table with no code', async () => {
    const user = userEvent.setup()
    renderWithIntl(<TablesPanel view={payingView()} />)
    await menuOf(user, NO_BAR)
    await user.click(screen.getByTestId('mark-payment-table'))
    const dialog = screen.getByTestId('confirm-payment-table')
    expect(dialog.textContent).toContain('Only Restro will use it')
    expect(dialog.textContent).toContain('for the tables with no bar')
    expect(dialog.textContent).not.toContain('stops for good')
  })

  it('stops with one tap and an Undo that marks again with no question', async () => {
    const user = userEvent.setup()
    renderWithIntl(<TablesPanel view={payingView()} />)
    await menuOf(user, PAYMENT)
    await user.click(screen.getByTestId('unmark-payment-table'))
    expect(screen.queryByTestId('confirm-payment-table')).toBeNull()
    await waitFor(() =>
      expect(markPaymentTableAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: PAYMENT,
        isPaymentTable: false,
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [message, options] = vi.mocked(toast.success).mock.calls[0] ?? []
    expect(message).toBe('Table 10 is no longer a payment table. It stays hidden, with no code.')
    const undo = (options as { action: { label: string; onClick: () => void } }).action
    expect(undo.label).toBe('Undo')
    undo.onClick()
    await waitFor(() =>
      expect(markPaymentTableAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        tableId: PAYMENT,
        isPaymentTable: true,
      }),
    )
  })

  it('offers a payment table neither a code, nor Show, nor a menu picker', async () => {
    const user = userEvent.setup()
    renderWithIntl(<TablesPanel view={payingView()} />)
    await menuOf(user, PAYMENT)
    expect(screen.queryByTestId('create-code')).toBeNull()
    expect(screen.queryByTestId('new-code')).toBeNull()
    expect(screen.queryByTestId('turn-off-code')).toBeNull()
    expect(screen.queryByTestId('toggle-hidden')).toBeNull()
    expect(screen.getByTestId('move-down')).toBeTruthy()
    expect(within(cardOf(PAYMENT)).queryByTestId('route-picker')).toBeNull()
    expect(within(cardOf(CODED)).getByTestId('route-picker')).toBeTruthy()
  })

  it('says why a table open for phones, or one a payment holds, was not changed', async () => {
    const user = userEvent.setup()
    vi.mocked(markPaymentTableAction).mockResolvedValue({ ok: false, error: 'table_open' })
    renderWithIntl(<TablesPanel view={payingView()} />)
    await menuOf(user, CODED)
    await user.click(screen.getByTestId('mark-payment-table'))
    await user.click(
      within(screen.getByTestId('confirm-payment-table')).getByRole('button', {
        name: 'Use as payment table',
      }),
    )
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Table 2 is open for phones. Close it in Tonight, then try again.',
        expect.anything(),
      ),
    )

    vi.mocked(markPaymentTableAction).mockResolvedValue({
      ok: false,
      error: 'payment_table_busy',
    })
    await menuOf(user, PAYMENT)
    await user.click(screen.getByTestId('unmark-payment-table'))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A payment is going through table 10 right now. Try again in a few minutes.',
        expect.anything(),
      ),
    )
  })

  it('shows a person without the right the badges and the banner, never the menu items', async () => {
    const user = userEvent.setup()
    renderWithIntl(<TablesPanel view={payingView({ paying: paying({ canMark: false }) })} />)
    expect(screen.getByTestId('payment-tables-banner')).toBeTruthy()
    expect(within(cardOf(PAYMENT)).getByTestId('payment-table-badge')).toBeTruthy()
    await menuOf(user, CODED)
    expect(screen.queryByTestId('mark-payment-table')).toBeNull()
    await user.keyboard('{Escape}')
    await menuOf(user, PAYMENT)
    expect(screen.queryByTestId('unmark-payment-table')).toBeNull()
  })

  it('shows none of it where no connector takes payments', async () => {
    const user = userEvent.setup()
    // The same rows, but the view says paying is not offered here.
    renderWithIntl(<TablesPanel view={payingView({ paying: null })} />)
    expect(screen.queryByTestId('payment-tables-banner')).toBeNull()
    expect(screen.queryByTestId('payment-table-badge')).toBeNull()
    expect(screen.queryByTestId('table-bar')).toBeNull()
    await menuOf(user, CODED)
    expect(screen.queryByTestId('mark-payment-table')).toBeNull()
    // And a plain row has no mark at all.
    expect(row({ id: 'tb_x' }).isPaymentTable).toBe(false)
  })
})
