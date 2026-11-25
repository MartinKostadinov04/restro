// @vitest-environment jsdom
// A member table's sheet names the party, its tables and the group's total (D160 §1, decision log
// 1.7 and 1.8; #540); a member that cannot be read is named and the total is not final. Reading
// only: nothing here writes.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TableTile, TonightView } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { TonightPanel } from './tonight-panel'

const bill = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('@/server/tonight/actions', () => ({
  openAllTablesAction: vi.fn(),
  openTableAction: vi.fn(),
  tableBookedLaterAction: vi.fn(),
  tableBillAction: bill,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/tables', () => ({}))
vi.mock('@/server/tonight/payment-actions', () => ({}))
vi.mock('@/server/tonight/night-actions', () => ({}))

const tile = (id: string, label: string, numbered: boolean): TableTile => ({
  id,
  label,
  numbered,
  state: 'open',
  hidden: false,
  since: '21:53',
  sentOrders: 0,
  sittingId: 'st_1',
  payRule: null,
  parties: [],
})

function open() {
  renderWithIntl(
    <TonightPanel
      view={
        {
          venueId: 'vn_0123456789ABCDEFGHIJKL',
          source: 'Mistral',
          currency: 'EUR',
          provider: null,
          device: false,
          operator: false,
          can: { openClose: true, resume: true, pause: true, lift: true },
          nightEnd: null,
          phoneOrders: null,
          banners: [],
          paying: null,
          rows: [],
          outOfStock: [],
          groups: [
            {
              barId: null,
              name: null,
              paused: false,
              tables: [
                tile('tb_1', '1', true),
                tile('tb_3', 'Сепаре 1', false),
                tile('tb_4', '4', true),
              ],
            },
          ],
          paymentTables: [],
          openCount: 3,
          tableCount: 3,
          pausableBars: [],
          canPauseAll: false,
          now: '2026-11-25T20:00:00.000Z',
          timezone: 'Europe/Sofia',
        } as unknown as TonightView
      }
    />,
  )
}

const sheetOf = async () => {
  await userEvent.click(screen.getAllByTestId('table-tile')[0] as HTMLElement)
  return screen.findByTestId('table-sheet')
}

describe("a member table's sheet (#540)", () => {
  beforeEach(() => bill.mockReset())

  it('says the party, its tables by name and the group total, with nothing else new', async () => {
    bill.mockResolvedValue({
      ok: true,
      bill: { totalMinor: 1500, currency: 'EUR', complete: true },
      group: {
        tables: [
          { id: 'tb_1', label: '1', updating: false },
          { id: 'tb_3', label: 'Сепаре 1', updating: false },
          { id: 'tb_4', label: '4', updating: false },
        ],
        totalMinor: 2200,
        currency: 'EUR',
        final: true,
      },
    })
    open()
    await sheetOf()
    expect((await screen.findByTestId('sh-group')).textContent).toBe('Party · 3 tables')
    expect(screen.getByTestId('sh-group-tables').textContent).toBe('Table 1, Сепаре 1, Table 4')
    expect(screen.getByTestId('sh-group-total').textContent).toMatch(/Party total.*22[.,]00/)
    expect(screen.queryByTestId('sh-group-updating')).toBeNull()
    expect(screen.queryByTestId('sh-group-not-final')).toBeNull()
  })

  it('names a table that cannot be read and says the total is not final', async () => {
    bill.mockResolvedValue({
      ok: true,
      bill: { totalMinor: 1500, currency: 'EUR', complete: true },
      group: {
        tables: [
          { id: 'tb_1', label: '1', updating: false },
          { id: 'tb_4', label: '4', updating: true },
        ],
        totalMinor: 1500,
        currency: 'EUR',
        final: false,
      },
    })
    open()
    await sheetOf()
    expect((await screen.findByTestId('sh-group-updating')).textContent).toBe('Table 4 is updating')
    expect(screen.getByTestId('sh-group-not-final').textContent).toBe('The total is not final yet')
  })

  it('shows no party line for a table in no group', async () => {
    bill.mockResolvedValue({ ok: true, bill: { totalMinor: 900, currency: 'EUR', complete: true } })
    open()
    await sheetOf()
    await screen.findByText(/Bill:/)
    expect(screen.queryByTestId('sh-group')).toBeNull()
    expect(screen.queryByTestId('sh-group-total')).toBeNull()
  })
})
