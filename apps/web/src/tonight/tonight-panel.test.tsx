// @vitest-environment jsdom
// Tonight's "Needs you" block when nothing waits (RR-O33): a venue with tables nobody has opened is
// told to open them, with the button; a venue with no tables at all is told where to add them, in
// its own line, with no button to a thing that cannot be done.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TableTile, TonightView } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { TonightPanel } from './tonight-panel'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const openAll = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('@/server/tonight/actions', () => ({ openAllTablesAction: openAll }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/tables', () => ({}))
vi.mock('@/server/tonight/payment-actions', () => ({}))
vi.mock('@/server/tonight/night-actions', () => ({}))

const draw = (over: Partial<TonightView>) =>
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
          banners: [],
          paying: null,
          rows: [],
          outOfStock: [],
          groups: [],
          paymentTables: [],
          openCount: 0,
          tableCount: 0,
          pausableBars: [],
          canPauseAll: false,
          now: '2026-11-06T20:00:00.000Z',
          timezone: 'Europe/Sofia',
          ...over,
        } as unknown as TonightView
      }
    />,
  )

describe('Tonight with nothing waiting', () => {
  it('tells a venue with no tables where to add them, and offers no Open all', () => {
    draw({})
    expect(screen.getByText('There are no tables yet')).toBeTruthy()
    expect(screen.queryByText("Tables aren't open yet")).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull()
  })
})

const tile = (id: string, label: string, over: Partial<TableTile> = {}): TableTile => ({
  id,
  label,
  numbered: false,
  state: 'closed',
  hidden: false,
  since: null,
  sentOrders: 0,
  sittingId: null,
  payRule: null,
  parties: [],
  ...over,
})

describe('the payment tables', () => {
  it('draws a venue that has only payment tables: its own group, and a line that is not "no tables"', () => {
    draw({ paymentTables: [tile('tb_1', 'Bar till')] })
    const group = screen.getByRole('region', { name: 'Payment tables' })
    expect(within(group).getAllByTestId('table-tile')).toHaveLength(1)
    expect(screen.getByTestId('no-guest-tables').textContent).toMatch(/No tables for guests/)
    expect(screen.queryByText(/This venue has no tables yet/)).toBeNull()
    // Nothing for guests to open: no Open all.
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull()
  })

  it('draws the group under the guest grid, tiles still tappable to open', () => {
    draw({
      groups: [{ barId: null, name: null, paused: false, tables: [tile('tb_2', 'Table 2')] }],
      paymentTables: [tile('tb_1', 'Bar till')],
      tableCount: 1,
    })
    expect(screen.queryByTestId('no-guest-tables')).toBeNull()
    const group = screen.getByRole('region', { name: 'Payment tables' })
    expect(
      within(group).getByRole('button', { name: 'Bar till is closed for phones' }),
    ).toBeTruthy()
    expect(screen.getAllByTestId('table-tile')).toHaveLength(2)
  })

  it('says nothing about payment tables when there are none', () => {
    draw({
      groups: [{ barId: null, name: null, paused: false, tables: [tile('tb_2', 'Table 2')] }],
      paymentTables: [],
      tableCount: 1,
    })
    expect(screen.queryByRole('region', { name: 'Payment tables' })).toBeNull()
  })
})

describe('who is seated at a table (walk P20, #419)', () => {
  const open = (parties: TableTile['parties']) =>
    draw({
      groups: [
        {
          barId: null,
          name: null,
          paused: false,
          tables: [tile('tb_1', 'Table 1', { state: 'open', since: '21:53', parties })],
        },
      ],
      tableCount: 1,
      openCount: 1,
    })

  it('puts the name alone on the tile, and a plain +1 for a second party', () => {
    open([
      { id: 'rv_1', name: 'Елена Димитрова', size: 6 },
      { id: 'rv_2', name: 'Иванова', size: 2 },
    ])
    const party = screen.getByTestId('tile-party')
    expect(party.textContent).toBe('Елена Димитрова+1')
    // No guests on the tile: the sheet has them.
    expect(party.textContent).not.toMatch(/6/)
    // The name is cut short by the tile, never wrapped over its other lines.
    expect(within(party).getByText('Елена Димитрова').className).toContain('truncate')
  })

  it('says nothing on the tile for a table with nobody seated, or a walk-in nobody named', () => {
    open([])
    expect(screen.queryByTestId('tile-party')).toBeNull()
  })

  it('says nothing on the tile for a walk-in nobody named', () => {
    open([{ id: 'rv_3', name: null, size: 4 }])
    expect(screen.queryByTestId('tile-party')).toBeNull()
  })

  it("puts the name and the guests on the table's sheet, one line a party", async () => {
    open([
      { id: 'rv_1', name: 'Елена Димитрова', size: 6 },
      { id: 'rv_4', name: null, size: 1 },
      { id: 'rv_5', name: 'Петров', size: null },
    ])
    await userEvent.click(screen.getByTestId('table-tile'))
    const lines = (await screen.findAllByTestId('sh-party')).map((line) => line.textContent)
    expect(lines).toEqual([
      'Елена Димитрова · 6 guests',
      'A party with no name · 1 guest',
      'Петров',
    ])
  })
})

describe('Open all', () => {
  beforeEach(() => {
    toast.mockClear()
    openAll.mockReset()
  })

  const closedVenue = () =>
    draw({
      groups: [{ barId: null, name: null, paused: false, tables: [tile('tb_2', 'Table 2')] }],
      paymentTables: [tile('tb_1', 'Bar till')],
      tableCount: 1,
    })

  it('reports what it opened and, only for payment tables, why some stayed closed', async () => {
    openAll.mockResolvedValue({
      ok: true,
      details: { opened: 1, alreadyOpen: 0, skipped: 3, skippedPayment: 2 },
    })
    closedVenue()
    await userEvent.click(screen.getAllByRole('button', { name: 'Open all' })[0] as HTMLElement)
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0]).toEqual([
      '1 table opened for phones',
      expect.objectContaining({ description: '2 payment tables do not open for phones' }),
    ])
  })

  it('names no reason for tables skipped that were not payment tables', async () => {
    openAll.mockResolvedValue({
      ok: true,
      details: { opened: 2, alreadyOpen: 0, skipped: 1, skippedPayment: 0 },
    })
    closedVenue()
    await userEvent.click(screen.getAllByRole('button', { name: 'Open all' })[0] as HTMLElement)
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    const [text, options] = toast.mock.calls[0] as [string, { description?: string }]
    expect(text).toBe('2 tables opened for phones')
    expect(options.description).toBeUndefined()
  })

  it('leaves a hidden table out of the Open all count and button', () => {
    draw({
      groups: [
        {
          barId: null,
          name: null,
          paused: false,
          tables: [tile('tb_3', 'Table 3', { hidden: true })],
        },
      ],
      tableCount: 0,
    })
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull()
  })
})
