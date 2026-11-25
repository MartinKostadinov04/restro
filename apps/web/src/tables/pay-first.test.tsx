// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { savePayFirstAction } from '@/server/settings/paying-actions'
import type { PayFirstShown, TablesView } from '@/server/tables/view'
import { renderWithIntl } from '@/test-utils'

import { TablesPanel } from './tables-panel'
import { VENUE_ID, view } from './test-view'

// Pay first on Tables & QR (#217; plan: #201 comment, part B): one row under the menu picker of
// each area header and table card, a Select that saves at once with Undo and returns to the saved
// value when the save fails; text for a person without `settings.payment_tables`; no row at a
// payment table or where pay first can't take effect.
vi.mock('@/server/settings/paying-actions', () => ({ savePayFirstAction: vi.fn() }))
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
vi.mock('@/server/tonight/actions', () => ({ markPaymentTableAction: vi.fn() }))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const TERRACE = 'ar_0000000000000000000002'
const HALL = 'ar_0000000000000000000001'
const TABLE = 'tb_0000000000000000000002'
const PLAIN = 'tb_0000000000000000000010'
const OK = { ok: true, details: {} } as const

const shown = (overrides: Partial<PayFirstShown> = {}): PayFirstShown => ({
  own: null,
  applies: true,
  level: 'venue',
  inherited: { applies: true, level: 'venue' },
  ...overrides,
})

/** The terrace and its two tables can take pay first; the main hall and the rest cannot. */
function payFirstView(
  options: {
    canSet?: boolean
    area?: PayFirstShown
    table?: PayFirstShown
    paymentTable?: boolean
  } = {},
): TablesView {
  const base = view()
  return {
    ...base,
    payFirst: { canSet: options.canSet ?? true, email: 'owner@club.test' },
    halls: base.halls.map((hall) =>
      hall.id !== TERRACE
        ? hall
        : {
            ...hall,
            payFirst: options.area ?? shown(),
            tables: hall.tables.map((table) =>
              table.id === TABLE
                ? { ...table, payFirst: options.table ?? shown() }
                : table.id === PLAIN
                  ? {
                      ...table,
                      isPaymentTable: options.paymentTable === true,
                      payFirst: options.paymentTable === true ? null : shown(),
                    }
                  : table,
            ),
          },
    ),
  }
}

const cardOf = (id: string) => {
  const found = screen
    .getAllByTestId('table-card')
    .find((element) => element.getAttribute('data-table-id') === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const hallOf = (id: string) => {
  const found = screen.getAllByTestId('hall').find((e) => e.getAttribute('data-area-id') === id)
  if (!found) throw new Error(`no area ${id}`)
  return found
}
/** The row in the area's header (the first inside the area section). */
const areaRow = (id: string) => {
  const found = within(hallOf(id)).getAllByTestId('pay-first-row')[0]
  if (!found) throw new Error(`no row in ${id}`)
  return found
}
/** Opens the row's Select and picks the option with this name. */
async function choose(user: ReturnType<typeof userEvent.setup>, row: HTMLElement, option: string) {
  await user.click(within(row).getByTestId('pay-first-select'))
  await user.click(await screen.findByRole('option', { name: option }))
}

beforeEach(() => {
  vi.mocked(savePayFirstAction).mockReset()
  vi.mocked(savePayFirstAction).mockResolvedValue(OK)
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('pay first on Tables & QR', () => {
  it('has a row on the area and its tables that can take pay first, none at a payment table', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={payFirstView()} />)
    expect(within(hallOf(TERRACE)).getAllByTestId('pay-first-row')).toHaveLength(3)
    expect(within(hallOf(HALL)).queryByTestId('pay-first-row')).toBeNull()
    unmount()
    renderWithIntl(<TablesPanel view={payFirstView({ paymentTable: true })} />)
    expect(within(cardOf(PLAIN)).queryByTestId('pay-first-row')).toBeNull()
  })

  it('has no row where pay first can’t take effect', () => {
    renderWithIntl(<TablesPanel view={{ ...payFirstView(), payFirst: null }} />)
    expect(screen.queryByTestId('pay-first-row')).toBeNull()
  })

  it('words what each row follows: the area, the venue, or its own choice', () => {
    renderWithIntl(
      <TablesPanel
        view={payFirstView({
          area: shown({ own: false, applies: false, level: 'area' }),
          table: shown({
            applies: false,
            level: 'area',
            inherited: { applies: false, level: 'area' },
          }),
        })}
      />,
    )
    expect(within(areaRow(TERRACE)).getByTestId('pay-first-select').textContent).toBe(
      'Pay first: Off: everything on the bill',
    )
    expect(within(cardOf(TABLE)).getByTestId('pay-first-select').textContent).toBe(
      'Pay first: Same as the area (Off: everything on the bill)',
    )
    expect(within(cardOf(PLAIN)).getByTestId('pay-first-select').textContent).toBe(
      'Pay first: Same as the venue (On)',
    )
  })

  it('marks an area or table with its own choice with the Overrides badge', () => {
    renderWithIntl(
      <TablesPanel view={payFirstView({ table: shown({ own: true, level: 'table' }) })} />,
    )
    expect(within(cardOf(TABLE)).getByTestId('pay-first-overrides').textContent).toBe('Overrides')
    expect(within(cardOf(PLAIN)).queryByTestId('pay-first-overrides')).toBeNull()
    expect(within(areaRow(TERRACE)).queryByTestId('pay-first-overrides')).toBeNull()
  })

  it('offers follow, On and Off, and saves a table’s choice at once with an Undo', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={payFirstView()} />)
    await user.click(within(cardOf(TABLE)).getByTestId('pay-first-select'))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual([
      'Same as the venue (On)',
      'On',
      'Off: everything on the bill',
    ])
    await user.click(screen.getByRole('option', { name: 'Off: everything on the bill' }))
    await waitFor(() =>
      expect(savePayFirstAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        change: { table: TABLE, value: false },
      }),
    )
    // The Select shows the choice before the server answers.
    expect(within(cardOf(TABLE)).getByTestId('pay-first-select').textContent).toBe(
      'Pay first: Off: everything on the bill',
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [message, options] = vi.mocked(toast.success).mock.calls[0] ?? []
    expect(message).toBe('Pay first for table 2: Off: everything on the bill')
    const undo = (options as { action: { label: string; onClick: () => void } }).action
    expect(undo.label).toBe('Undo')
    undo.onClick()
    await waitFor(() =>
      expect(savePayFirstAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        change: { table: TABLE, value: null },
      }),
    )
  })

  it('saves an area’s choice as a group, and Undo puts the previous choice back', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(
      <TablesPanel view={payFirstView({ area: shown({ own: false, level: 'area' }) })} />,
    )
    await choose(user, areaRow(TERRACE), 'On')
    await waitFor(() =>
      expect(savePayFirstAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        change: { group: TERRACE, value: true },
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [, options] = vi.mocked(toast.success).mock.calls[0] ?? []
    ;(options as unknown as { action: { onClick: () => void } }).action.onClick()
    await waitFor(() =>
      expect(savePayFirstAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        change: { group: TERRACE, value: false },
      }),
    )
  })

  it('returns to the saved value and names the problem when a save is refused', async () => {
    vi.mocked(savePayFirstAction).mockResolvedValue({ ok: false, error: 'failed' })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={payFirstView()} />)
    await choose(user, cardOf(TABLE), 'On')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      "Couldn't save. Check the connection and try again.",
    )
    await waitFor(() =>
      expect(within(cardOf(TABLE)).getByTestId('pay-first-select').textContent).toBe(
        'Pay first: Same as the venue (On)',
      ),
    )
    expect(within(cardOf(TABLE)).queryByTestId('pay-first-overrides')).toBeNull()
  })

  it('says a table deleted meanwhile is gone', async () => {
    vi.mocked(savePayFirstAction).mockResolvedValue({ ok: false, error: 'table_missing' })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={payFirstView()} />)
    await choose(user, cardOf(TABLE), 'On')
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(
      'This table, area or venue is not there any more. Reload the page.',
    )
  })

  it('does nothing when the choice is the one already saved', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(
      <TablesPanel view={payFirstView({ table: shown({ own: true, level: 'table' }) })} />,
    )
    await choose(user, cardOf(TABLE), 'On')
    expect(savePayFirstAction).not.toHaveBeenCalled()
  })

  it('shows a person without the right the line as text, with no Select', () => {
    renderWithIntl(<TablesPanel view={payFirstView({ canSet: false })} />)
    expect(screen.queryByTestId('pay-first-select')).toBeNull()
    expect(within(cardOf(TABLE)).getByTestId('pay-first-text').textContent).toBe(
      'Pay first: Same as the venue (On)',
    )
    expect(within(hallOf(TERRACE)).getAllByTestId('pay-first-text')).toHaveLength(3)
  })
})
