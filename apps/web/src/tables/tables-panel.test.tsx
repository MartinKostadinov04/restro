// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAllCodesAction,
  issueCodeAction,
  renameTableAction,
  turnOffCodeAction,
} from '@/server/tables/actions'
import { renderWithIntl } from '@/test-utils'

import { TablesPanel } from './tables-panel'
import { SVG, TOKEN_A, VENUE_ID, view } from './test-view'

vi.mock('@/server/tables/actions', () => ({
  createAllCodesAction: vi.fn(),
  issueCodeAction: vi.fn(),
  renameTableAction: vi.fn(),
  turnOffCodeAction: vi.fn(),
  saveQrSettingsAction: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const OK = { ok: true, queued: true } as const
const rows = () => screen.getAllByTestId('table-row')
const rowOf = (id: string) => {
  const found = rows().find((element) => element.getAttribute('data-table-id') === id)
  if (!found) throw new Error(`no row ${id}`)
  return found
}
const CODED = 'tb_0000000000000000000002'
const PLAIN = 'tb_0000000000000000000010'
const NAMELESS = 'tb_0000000000000000000009'

beforeEach(() => {
  for (const action of [
    createAllCodesAction,
    issueCodeAction,
    renameTableAction,
    turnOffCodeAction,
  ]) {
    vi.mocked(action).mockReset()
    vi.mocked(action).mockResolvedValue(OK)
  }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.warning).mockReset()
  vi.mocked(toast.message).mockReset()
})

describe('the Tables & QR tab', () => {
  it('lists the tables by area, in the areas’ order, with the counts', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    expect(screen.getAllByTestId('hall-name').map((element) => element.textContent)).toEqual([
      'Main hall',
      'Terrace',
      'Tables',
    ])
    expect(screen.getByTestId('tables-summary').textContent).toBe('5 tables, 1 with a code')
    const terrace = screen.getAllByTestId('hall')[1] as HTMLElement
    expect(
      within(terrace)
        .getAllByTestId('table-number')
        .map((e) => e.textContent),
    ).toEqual(['barsy number: 2', 'barsy number: 10'])
  })

  it('shows for each table its number, public or hidden, and whether it has a code', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const coded = rowOf(CODED)
    expect(within(coded).getByTestId('code-status').textContent).toBe('Code active')
    expect(within(coded).getByText('Public')).toBeTruthy()
    expect(within(coded).getByTestId('qr-thumb')).toBeTruthy()
    const plain = rowOf(PLAIN)
    expect(within(plain).getByTestId('code-status').textContent).toBe('No code')
    expect(within(plain).queryByTestId('qr-thumb')).toBeNull()
    const hidden = rows().find((element) => element.textContent?.includes('barsy number: VIP'))
    expect(within(hidden as HTMLElement).getByText('Hidden')).toBeTruthy()
    // A table with neither a number nor a name says so, and its name box has no number to show.
    expect(within(rowOf(NAMELESS)).getByText('barsy number: no number')).toBeTruthy()
  })

  it('draws the code as a black-on-white picture, never as markup of its own', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const picture = within(rowOf(CODED)).getByTestId('qr-picture') as HTMLImageElement
    expect(picture.tagName).toBe('IMG')
    expect(decodeURIComponent(picture.src.replace('data:image/svg+xml;utf8,', ''))).toBe(SVG)
    expect(picture.alt).toBe('QR code of table 2')
    // No SVG was injected into the page itself.
    expect(document.querySelector('svg path[d="M0 0h1v1H0z"]')).toBeNull()
  })

  it('opens the code large with its address, and offers PNG and SVG downloads', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const coded = rowOf(CODED)
    const png = within(coded).getByTestId('download-png') as HTMLAnchorElement
    const svg = within(coded).getByTestId('download-svg') as HTMLAnchorElement
    expect(png.getAttribute('href')).toBe(`/api/tables/${CODED}/qr?format=png`)
    expect(svg.getAttribute('href')).toBe(`/api/tables/${CODED}/qr?format=svg`)
    expect(png.hasAttribute('download')).toBe(true)

    await user.click(within(coded).getByRole('button', { name: 'Enlarge the QR code of table 2' }))
    const dialog = await screen.findByTestId('qr-dialog')
    expect(within(dialog).getByTestId('qr-dialog-address').textContent).toBe(
      `http://localhost:3000/t/${TOKEN_A}`,
    )
    expect(within(dialog).getByTestId('download-png')).toBeTruthy()
  })

  it('creates codes for all tables and says how many, and what was left out', async () => {
    vi.mocked(createAllCodesAction).mockResolvedValue({
      ok: true,
      queued: true,
      issued: 4,
      skippedNoLabel: 1,
    })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(screen.getByTestId('create-all'))
    await waitFor(() => expect(createAllCodesAction).toHaveBeenCalledWith({ venueId: VENUE_ID }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('4 codes created.'))
    expect(toast.warning).toHaveBeenCalledWith(
      '1 table was left out: it has no number from barsy and no name.',
    )
  })

  it('says so when every table already had a code, and warns when the files are late', async () => {
    vi.mocked(createAllCodesAction).mockResolvedValue({
      ok: true,
      queued: false,
      issued: 0,
      skippedNoLabel: 0,
    })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(screen.getByTestId('create-all'))
    await waitFor(() =>
      expect(toast.message).toHaveBeenCalledWith('Every table already has a code.'),
    )
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('could not be refreshed yet'),
    )
  })

  it('creates one code', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(within(rowOf(PLAIN)).getByTestId('create-code'))
    await waitFor(() => expect(issueCodeAction).toHaveBeenCalledWith({ tableId: PLAIN }))
    expect(toast.success).toHaveBeenCalledWith('Code created.')
  })

  it('asks before a new code: the printed sticker stops working; Cancel changes nothing', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(within(rowOf(CODED)).getByTestId('new-code'))
    const dialog = await screen.findByTestId('confirm-new-code')
    expect(within(dialog).getByText('Make a new code for table 2?')).toBeTruthy()
    expect(
      within(dialog).getByText(/Stickers already printed with the old code stop working/),
    ).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(issueCodeAction).not.toHaveBeenCalled()

    await user.click(within(rowOf(CODED)).getByTestId('new-code'))
    await user.click(
      within(await screen.findByTestId('confirm-new-code')).getByRole('button', {
        name: 'Make new code',
      }),
    )
    await waitFor(() => expect(issueCodeAction).toHaveBeenCalledWith({ tableId: CODED }))
    expect(toast.success).toHaveBeenCalledWith('New code made. The old one stopped working.')
  })

  it('asks before turning a code off', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(within(rowOf(CODED)).getByTestId('turn-off-code'))
    await user.click(
      within(await screen.findByTestId('confirm-turn-off-code')).getByRole('button', {
        name: 'Turn off',
      }),
    )
    await waitFor(() => expect(turnOffCodeAction).toHaveBeenCalledWith({ tableId: CODED }))
    expect(toast.success).toHaveBeenCalledWith('Code turned off.')
  })

  it('renames a table when the name box is left, and clears the name with an empty box', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const box = within(rowOf(PLAIN)).getByTestId('table-name') as HTMLInputElement
    expect(box.placeholder).toBe('10')
    await user.type(box, 'VIP corner')
    await user.tab()
    await waitFor(() =>
      expect(renameTableAction).toHaveBeenCalledWith({ tableId: PLAIN, label: 'VIP corner' }),
    )
    expect(toast.success).toHaveBeenCalledWith('Name saved.')

    // Leaving a box that was not changed saves nothing.
    vi.mocked(renameTableAction).mockClear()
    await user.click(within(rowOf(CODED)).getByTestId('table-name'))
    await user.tab()
    expect(renameTableAction).not.toHaveBeenCalled()
  })

  it('shows why an action failed, and puts the old name back', async () => {
    vi.mocked(renameTableAction).mockResolvedValue({ ok: false, error: 'no_label' })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const box = within(rowOf(NAMELESS)).getByTestId('table-name') as HTMLInputElement
    await user.type(box, 'x')
    await user.tab()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This table has no number from barsy. Give it a name first.',
      ),
    )
    expect(box.value).toBe('')
  })

  it('links to the print sheet in a new tab once there is a code, and not before', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={view()} />)
    const link = screen.getByTestId('print-sheet-link') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/venues/${VENUE_ID}/tables/print`)
    expect(link.target).toBe('_blank')
    unmount()
    renderWithIntl(<TablesPanel view={view({ coded: 0 })} />)
    const none = screen.getByTestId('print-sheet-link') as HTMLButtonElement
    expect(none.tagName).toBe('BUTTON')
    expect(none.disabled).toBe(true)
  })

  it('has an empty state that sends the manager to the venue’s Menu source', () => {
    renderWithIntl(<TablesPanel view={view({ halls: [], total: 0, coded: 0, sample: null })} />)
    expect(screen.getByText('No tables yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the Menu source' }).getAttribute('href')).toBe(
      `/venues/${VENUE_ID}?tab=settings#menu-source`,
    )
    expect(screen.queryByTestId('create-all')).toBeNull()
  })
})

describe('a member who may not manage codes', () => {
  it('can read and print, with no button that changes anything', () => {
    renderWithIntl(<TablesPanel view={view({ canManage: false })} />)
    expect(screen.getByTestId('tables-read-only')).toBeTruthy()
    for (const id of ['create-all', 'create-code', 'new-code', 'turn-off-code', 'table-name']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(screen.getByTestId('print-sheet-link')).toBeTruthy()
    expect(within(rowOf(CODED)).getByTestId('download-png')).toBeTruthy()
    expect(within(rowOf(CODED)).getByTestId('table-name-text').textContent).toBe('2')
  })
})

describe('in Bulgarian', () => {
  it('reads in Bulgarian', () => {
    renderWithIntl(<TablesPanel view={view()} />, { locale: 'bg' })
    expect(screen.getByText('Маси и QR кодове')).toBeTruthy()
    expect(screen.getByTestId('tables-summary').textContent).toBe('5 маси, 1 с код')
    expect(screen.getByTestId('create-all').textContent).toBe('Създай кодове за всички маси')
    expect(
      screen
        .getAllByTestId('hall-name')
        .map((e) => e.textContent)
        .at(-1),
    ).toBe('Tables')
  })
})
