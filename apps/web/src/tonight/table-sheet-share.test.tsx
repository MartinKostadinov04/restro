// @vitest-environment jsdom
// A table sharing its bill (#545; D160 §3, decision log 2.16): the sheet reads what is held of how
// much and the time left, never who; one button, "Cancel sharing", behind a dialog that names the
// consequence; a role that may not open and close tables reads the line and has no button.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TableTile, TonightView } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { TonightPanel } from './tonight-panel'

const cancel = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('@/server/tonight/actions', () => ({
  openAllTablesAction: vi.fn(),
  openTableAction: vi.fn(),
  closeTableAction: vi.fn(),
  newGuestsAction: vi.fn(),
  tableBookedLaterAction: vi.fn(),
  tableBillAction: vi.fn().mockResolvedValue({ ok: true, bill: null }),
  cancelShareAction: cancel,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/tables', () => ({}))
vi.mock('@/server/tonight/payment-actions', () => ({}))
vi.mock('@/server/tonight/night-actions', () => ({}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const PAYMENT = 'py_0123456789ABCDEFGHIJKL'

const tile = (id: string, label: string, share?: TableTile['share']): TableTile => ({
  id,
  label,
  numbered: true,
  state: share === undefined ? 'open' : 'payment',
  hidden: false,
  since: '21:53',
  sentOrders: 0,
  sittingId: 'st_1',
  payRule: null,
  parties: [],
  ...(share === undefined ? {} : { share }),
})

function open(share: TableTile['share'], openClose = true) {
  renderWithIntl(
    <TonightPanel
      view={
        {
          venueId: VENUE,
          source: 'Mistral',
          currency: 'EUR',
          provider: null,
          device: false,
          asks: false,
          operator: false,
          can: { openClose, resume: true, pause: true, lift: true, answer: true },
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
              tables: [tile('tb_1', '1', share), tile('tb_2', '2')],
            },
          ],
          paymentTables: [],
          openCount: 2,
          tableCount: 2,
          pausableBars: [],
          canPauseAll: false,
          now: '2026-11-26T20:00:00.000Z',
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

const gathering = { paymentId: PAYMENT, sharedMinor: 10000, heldMinor: 6000, minutesLeft: 6 }

describe('a table sharing its bill (#545)', () => {
  beforeEach(() => cancel.mockReset())

  it('reads what is held of how much and the time left, and nothing of who', async () => {
    open(gathering)
    await sheetOf()
    expect(screen.getByTestId('sh-share').textContent).toMatch(
      /^Being shared · .*60[.,]00.* of .*100[.,]00.* · 6 min left$/,
    )
  })

  it('drops the time while no card is held yet, as the time starts with the first hold', async () => {
    open({ ...gathering, heldMinor: 0, minutesLeft: null })
    await sheetOf()
    expect(screen.getByTestId('sh-share').textContent).toMatch(
      /^Being shared · .*0[.,]00.* of .*100[.,]00.*$/,
    )
    expect(screen.getByTestId('sh-share').textContent).not.toMatch(/min left/)
  })

  it('says nothing of sharing for a table that is not', async () => {
    open(undefined)
    await sheetOf()
    expect(screen.queryByTestId('sh-share')).toBeNull()
    expect(screen.queryByTestId('sh-cancel-share')).toBeNull()
  })

  it('asks once, naming the consequence, and cancels the share at that table', async () => {
    cancel.mockResolvedValue({ ok: true, details: {} })
    open(gathering)
    await sheetOf()
    await userEvent.click(screen.getByTestId('sh-cancel-share'))
    expect(await screen.findByText('Cancel sharing?')).toBeTruthy()
    expect(screen.getByText('Every held amount is let go. Nothing is charged.')).toBeTruthy()
    // Nothing is written until the second tap.
    expect(cancel).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('sh-cancel-share-ok'))
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    expect(cancel).toHaveBeenCalledWith({ venueId: VENUE, tableId: 'tb_1', paymentId: PAYMENT })
  })

  it('lets "Keep it" leave the share as it is', async () => {
    open(gathering)
    await sheetOf()
    await userEvent.click(screen.getByTestId('sh-cancel-share'))
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }))
    expect(cancel).not.toHaveBeenCalled()
  })

  it('shows the line but no button to a role that may not open and close tables', async () => {
    open(gathering, false)
    await sheetOf()
    expect(screen.getByTestId('sh-share')).toBeTruthy()
    expect(screen.queryByTestId('sh-cancel-share')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel sharing' })).toBeNull()
  })
})
