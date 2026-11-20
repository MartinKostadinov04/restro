// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAllCodesAction,
  createAreaAction,
  createTableAction,
  deleteAreaAction,
  deleteTableAction,
  issueCodeAction,
  moveAreaAction,
  moveTableAction,
  renameAreaAction,
  renameTableAction,
  revealCodesAction,
  setAreaHiddenAction,
  setMenuRouteAction,
  setTableHiddenAction,
  setTableNumberAction,
  turnOffCodeAction,
} from '@/server/tables/actions'
import type { TablesView } from '@/server/tables/view'
import { renderWithIntl } from '@/test-utils'

import { missingCodes, TablesPanel } from './tables-panel'
import { SVG, TOKEN_A, VENUE_ID, view } from './test-view'

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
  revealCodesAction: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))

const ACTIONS = [
  createAllCodesAction,
  issueCodeAction,
  renameTableAction,
  turnOffCodeAction,
  createAreaAction,
  renameAreaAction,
  setAreaHiddenAction,
  moveAreaAction,
  deleteAreaAction,
  createTableAction,
  setTableNumberAction,
  setTableHiddenAction,
  moveTableAction,
  deleteTableAction,
  setMenuRouteAction,
]
const OK = { ok: true, queued: true } as const
const cards = () => screen.getAllByTestId('table-card')
const cardOf = (id: string) => {
  const found = cards().find((element) => element.getAttribute('data-table-id') === id)
  if (!found) throw new Error(`no card ${id}`)
  return found
}
const areaOf = (id: string) => {
  const found = screen
    .getAllByTestId('hall')
    .find((element) => element.getAttribute('data-area-id') === id)
  if (!found) throw new Error(`no area ${id}`)
  return found
}
const AREA_MAIN = 'ar_0000000000000000000001'
const AREA_TERRACE = 'ar_0000000000000000000002'
const AREA_TABLES = 'ar_0000000000000000000003'
const CODED = 'tb_0000000000000000000002'
const PLAIN = 'tb_0000000000000000000010'
const NAMELESS = 'tb_0000000000000000000009'
const HIDDEN = 'tb_0000000000000000000004'
const SOLE = 'tb_0000000000000000000001'

/** Opens a "more" menu by its trigger. */
async function open(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, testId: string) {
  await user.click(within(scope).getByTestId(testId))
}
const hallNames = () =>
  screen.getAllByTestId('hall-name').map((element) => (element as HTMLInputElement).value)

beforeEach(() => {
  for (const action of ACTIONS) {
    vi.mocked(action).mockReset()
    vi.mocked(action).mockResolvedValue(OK)
  }
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.mocked(toast.warning).mockReset()
  vi.mocked(toast.message).mockReset()
  vi.mocked(revealCodesAction).mockReset()
  vi.mocked(revealCodesAction).mockResolvedValue({ ok: true, codes: [] })
})

describe('the Tables & QR tab', () => {
  it('counts the tables guests sit at, not the payment tables (walk P1)', () => {
    renderWithIntl(<TablesPanel view={view({ guestTotal: 3 })} />)
    expect(screen.getByTestId('tables-summary').textContent).toBe('3 tables, 1 with a code')
  })

  it('lists the tables by area, in the areas’ order, with the counts', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    expect(hallNames()).toEqual(['Main hall', 'Terrace', 'Tables'])
    expect(screen.getByTestId('tables-summary').textContent).toBe('5 tables, 1 with a code')
    expect(
      within(areaOf(AREA_TERRACE))
        .getAllByTestId('table-card')
        .map((e) => e.getAttribute('data-number')),
    ).toEqual(['2', '10'])
    expect(within(areaOf(AREA_TERRACE)).getByTestId('hall-count').textContent).toBe('2 tables')
  })

  it('opens with an index of the areas, each a link to its section with its table count (S14)', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const index = screen.getByRole('navigation', { name: 'Areas' })
    const jumps = within(index).getAllByTestId('area-jump')
    // Read out as a name and a count, not "Main hall2".
    expect(jumps.map((jump) => jump.getAttribute('aria-label'))).toEqual([
      'Main hall, 2 tables',
      'Terrace, 2 tables',
      'Tables, 1 table',
    ])
    expect(screen.getByRole('link', { name: 'Terrace, 2 tables' })).toBe(jumps[1])
    for (const jump of jumps) {
      const target = jump.getAttribute('href')?.slice(1) ?? ''
      expect(document.getElementById(target)?.getAttribute('data-testid')).toBe('hall')
    }
    expect(jumps[1]?.getAttribute('href')).toBe(`#area-${AREA_TERRACE}`)
  })

  it('counts in the index what the summary counts: no payment table', () => {
    const base = view()
    const withPayment = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) =>
          row.id === PLAIN ? { ...row, isPaymentTable: true } : row,
        ),
      })),
      guestTotal: 4,
    })
    renderWithIntl(<TablesPanel view={withPayment} />)
    expect(screen.getByRole('link', { name: 'Terrace, 1 table' })).toBeTruthy()
    expect(screen.getByTestId('tables-summary').textContent).toBe('4 tables, 1 with a code')
  })

  it('leaves out of the index an area with no table guests sit at; its section stays', () => {
    const base = view()
    const tillOnly = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) =>
          row.id === SOLE ? { ...row, isPaymentTable: true } : row,
        ),
      })),
      guestTotal: 4,
    })
    renderWithIntl(<TablesPanel view={tillOnly} />)
    expect(
      screen.getAllByTestId('area-jump').map((jump) => jump.getAttribute('aria-label')),
    ).toEqual(['Main hall, 2 tables', 'Terrace, 2 tables'])
    expect(areaOf(AREA_TABLES)).toBeTruthy()
  })

  it('has no index when only one area has tables guests sit at', () => {
    const base = view()
    const oneArea = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.id === AREA_TERRACE ? hall.tables : [],
      })),
    })
    renderWithIntl(<TablesPanel view={oneArea} />)
    expect(screen.queryByTestId('area-index')).toBeNull()
    expect(screen.getAllByTestId('hall')).toHaveLength(3)
  })

  it('has no index when the venue has a single area', () => {
    const base = view()
    renderWithIntl(<TablesPanel view={view({ halls: base.halls.slice(0, 1) })} />)
    expect(screen.queryByTestId('area-index')).toBeNull()
  })

  it('keeps the header to one sentence, and names the venue’s menu only when there is none (S14)', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={view()} />)
    expect(
      screen.getByText('Each table can have a QR code: a guest scans it and sees the menu.'),
    ).toBeTruthy()
    expect(screen.queryByTestId('venue-menu')).toBeNull()
    expect(screen.queryByTestId('tables-source-note')).toBeNull()
    unmount()
    renderWithIntl(
      <TablesPanel
        view={view({ menus: [{ id: 'nd_0000000000000000000002', name: 'Draft', live: false }] })}
      />,
    )
    expect(screen.getByTestId('venue-menu').textContent).toContain('no menu yet')
  })

  it('shows for each table its number, hidden or not, and the state of its code', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const coded = cardOf(CODED)
    expect(within(coded).getByTestId('code-status').textContent).toBe('Code active')
    expect(within(coded).getByTestId('qr-thumb')).toBeTruthy()
    expect(within(coded).queryByTestId('table-hidden')).toBeNull()
    const plain = cardOf(PLAIN)
    expect(within(plain).getByTestId('code-status').textContent).toBe('No code')
    expect(within(plain).queryByTestId('qr-thumb')).toBeNull()
    expect(within(cardOf(HIDDEN)).getByTestId('table-hidden').textContent).toBe('Hidden')
    // A table with neither a number nor a name says so.
    expect(within(cardOf(NAMELESS)).getByText('from barsy: no number')).toBeTruthy()
  })

  it('labels the name field as the name guests see, naming the till’s number only once (S14)', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const card = cardOf(CODED)
    const box = within(card).getByLabelText('Name guests see') as HTMLInputElement
    expect(box).toBe(within(card).getByTestId('table-name'))
    // Not renamed: the empty box says what guests see, and no line repeats the number.
    expect(box.placeholder).toBe('Same as in barsy (2)')
    expect(within(card).queryByTestId('table-number')).toBeNull()
    // A till’s number cannot be typed over.
    expect(within(card).queryByTestId('table-number-input')).toBeNull()
  })

  it('names the till’s number under a table that guests see by another name', () => {
    const base = view()
    const renamed = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) =>
          row.id === CODED ? { ...row, label: 'Window', shownAs: 'Window' } : row,
        ),
      })),
    })
    renderWithIntl(<TablesPanel view={renamed} />)
    expect(within(cardOf(CODED)).getByTestId('table-number').textContent).toBe('from barsy: 2')
  })

  it('a code of a hidden table or of a table in a hidden area is paused: no picture, no address', () => {
    const base = view()
    const paused = view({
      halls: base.halls.map((hall) =>
        hall.id === AREA_TERRACE
          ? {
              ...hall,
              isPublic: false,
              tables: hall.tables.map((row) => ({ ...row, qrSvg: null, address: null })),
            }
          : hall,
      ),
      coded: 0,
    })
    renderWithIntl(<TablesPanel view={paused} />)
    expect(within(cardOf(CODED)).getByTestId('code-status').textContent).toBe('Code paused')
    expect(within(cardOf(CODED)).queryByTestId('qr-thumb')).toBeNull()
    expect(within(areaOf(AREA_TERRACE)).getByTestId('hall-hidden').textContent).toBe('Hidden')
  })

  it('draws the code as a black-on-white picture, never as markup of its own', () => {
    renderWithIntl(<TablesPanel view={view()} />)
    const picture = within(cardOf(CODED)).getByTestId('qr-picture') as HTMLImageElement
    expect(picture.tagName).toBe('IMG')
    expect(decodeURIComponent(picture.src.replace('data:image/svg+xml;utf8,', ''))).toBe(SVG)
    expect(picture.alt).toBe('QR code of table 2')
    // No SVG was injected into the page itself.
    expect(document.querySelector('svg path[d="M0 0h1v1H0z"]')).toBeNull()
  })

  it('opens the code large with its address, and offers PNG and SVG downloads there', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await user.click(
      within(cardOf(CODED)).getByRole('button', { name: 'Enlarge the QR code of table 2' }),
    )
    const dialog = await screen.findByTestId('qr-dialog')
    expect(within(dialog).getByTestId('qr-dialog-address').textContent).toBe(
      `http://localhost:3000/t/${TOKEN_A}`,
    )
    const png = within(dialog).getByTestId('download-png') as HTMLAnchorElement
    const svg = within(dialog).getByTestId('download-svg') as HTMLAnchorElement
    expect(png.getAttribute('href')).toBe(`/api/tables/${CODED}/qr?format=png`)
    expect(svg.getAttribute('href')).toBe(`/api/tables/${CODED}/qr?format=svg`)
    expect(png.hasAttribute('download')).toBe(true)
  })

  it('asks the worker for its codes once the page is up, and not again when an action refreshes it', async () => {
    const base = view()
    /** The tab as the server draws it (#70): table 2's code named by `key`, not yet revealed. */
    const drawnBy = (key: string): TablesView => ({
      ...base,
      sample: null,
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) =>
          row.id === CODED ? { ...row, codeKey: key, address: null, qrSvg: null } : row,
        ),
      })),
    })
    const address = `http://localhost:3000/t/${TOKEN_A}`
    vi.mocked(revealCodesAction).mockResolvedValue({
      ok: true,
      codes: [{ id: CODED, codeKey: 'key-a', token: TOKEN_A, address, qrSvg: SVG }],
    })
    const { rerender } = renderWithIntl(<TablesPanel view={drawnBy('key-a')} />)
    expect(within(cardOf(CODED)).queryByTestId('qr-thumb')).toBeNull()
    await waitFor(() => expect(within(cardOf(CODED)).getByTestId('qr-thumb')).toBeTruthy())
    expect(revealCodesAction).toHaveBeenCalledTimes(1)
    expect(revealCodesAction).toHaveBeenCalledWith({ venueId: VENUE_ID, tableIds: [CODED] })
    expect(screen.getByTestId('open-test-link').getAttribute('href')).toBe(address)

    // An action's refresh brings the same codes: nothing is asked again, the picture stays.
    rerender(<TablesPanel view={drawnBy('key-a')} />)
    expect(within(cardOf(CODED)).getByTestId('qr-thumb')).toBeTruthy()
    expect(revealCodesAction).toHaveBeenCalledTimes(1)

    // A new code is asked for on its own; one the worker does not give draws none, once.
    vi.mocked(revealCodesAction).mockResolvedValue({ ok: false, error: 'failed' })
    rerender(<TablesPanel view={drawnBy('key-b')} />)
    await waitFor(() => expect(revealCodesAction).toHaveBeenCalledTimes(2))
    expect(revealCodesAction).toHaveBeenLastCalledWith({ venueId: VENUE_ID, tableIds: [CODED] })
    expect(within(cardOf(CODED)).queryByTestId('qr-thumb')).toBeNull()
    rerender(<TablesPanel view={drawnBy('key-b')} />)
    expect(revealCodesAction).toHaveBeenCalledTimes(2)
  })

  describe('when the worker cannot show the codes (#441)', () => {
    /** The tab as the server draws it: table 2 has a code the page has not been given yet. */
    const unrevealed = (): TablesView => {
      const base = view()
      return {
        ...base,
        sample: null,
        halls: base.halls.map((hall) => ({
          ...hall,
          tables: hall.tables.map((row) =>
            row.id === CODED ? { ...row, codeKey: 'key-a', address: null, qrSvg: null } : row,
          ),
        })),
      }
    }
    const LINE = "The codes can't be shown right now."
    const failureLine = () => screen.queryByText(LINE)

    it.each([
      ['fails', { ok: false, error: 'failed' } as const],
      ['gives no code', { ok: true, codes: [] } as const],
    ])('says so, with a way to try again, when the reveal %s', async (_name, answer) => {
      vi.mocked(revealCodesAction).mockResolvedValue(answer)
      renderWithIntl(<TablesPanel view={unrevealed()} />)
      // While the answer is awaited the tab says it is loading, never the failure.
      expect(screen.getByText('Loading the codes…')).toBeTruthy()
      expect(failureLine()).toBeNull()
      await waitFor(() => expect(failureLine()).toBeTruthy())
      expect(screen.queryByText('Loading the codes…')).toBeNull()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
      expect((screen.getByTestId('open-test-link') as HTMLButtonElement).disabled).toBe(true)
    })

    it('says so when the call itself throws', async () => {
      vi.mocked(revealCodesAction).mockRejectedValue(new Error('network'))
      renderWithIntl(<TablesPanel view={unrevealed()} />)
      await waitFor(() => expect(failureLine()).toBeTruthy())
      expect(screen.queryByText('Loading the codes…')).toBeNull()
    })

    it('asks once more on Try again, and shows the codes when they come', async () => {
      vi.mocked(revealCodesAction).mockResolvedValue({ ok: false, error: 'failed' })
      const user = userEvent.setup({ delay: null })
      renderWithIntl(<TablesPanel view={unrevealed()} />)
      await waitFor(() => expect(failureLine()).toBeTruthy())
      expect(revealCodesAction).toHaveBeenCalledTimes(1)

      const address = `http://localhost:3000/t/${TOKEN_A}`
      vi.mocked(revealCodesAction).mockResolvedValue({
        ok: true,
        codes: [{ id: CODED, codeKey: 'key-a', token: TOKEN_A, address, qrSvg: SVG }],
      })
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() =>
        expect(screen.getByTestId('open-test-link').getAttribute('href')).toBe(address),
      )
      expect(revealCodesAction).toHaveBeenCalledTimes(2)
      expect(revealCodesAction).toHaveBeenLastCalledWith({ venueId: VENUE_ID, tableIds: [CODED] })
      expect(failureLine()).toBeNull()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    })

    it('asks exactly once per click, and shows the line again when the retry fails too', async () => {
      vi.mocked(revealCodesAction).mockResolvedValue({ ok: true, codes: [] })
      const user = userEvent.setup({ delay: null })
      renderWithIntl(<TablesPanel view={unrevealed()} />)
      await waitFor(() => expect(failureLine()).toBeTruthy())
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      await waitFor(() => expect(revealCodesAction).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(failureLine()).toBeTruthy())
      expect(revealCodesAction).toHaveBeenCalledTimes(2)
    })

    it('says nothing of the kind when no table has a code', async () => {
      renderWithIntl(<TablesPanel view={view({ coded: 0, sample: null })} />)
      expect(failureLine()).toBeNull()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      expect(screen.getByText('Create a code for a table first, then test the link.')).toBeTruthy()
    })

    it('reads in Bulgarian', async () => {
      vi.mocked(revealCodesAction).mockResolvedValue({ ok: false, error: 'failed' })
      renderWithIntl(<TablesPanel view={unrevealed()} />, { locale: 'bg' })
      await waitFor(() =>
        expect(screen.getByText('Кодовете не се показват в момента.')).toBeTruthy(),
      )
      expect(screen.getByRole('button', { name: 'Опитай пак' })).toBeTruthy()
    })
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
      '1 table was left out: it has no number and no name.',
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

  it('creates one code from the card’s menu', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, cardOf(PLAIN), 'table-menu')
    await user.click(await screen.findByTestId('create-code'))
    await waitFor(() => expect(issueCodeAction).toHaveBeenCalledWith({ tableId: PLAIN }))
    expect(toast.success).toHaveBeenCalledWith('Code created.')
  })

  it('asks before a new code: the printed sticker stops working; Cancel changes nothing', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, cardOf(CODED), 'table-menu')
    await user.click(await screen.findByTestId('new-code'))
    const dialog = await screen.findByTestId('confirm-new-code')
    expect(within(dialog).getByText('Make a new code for table 2?')).toBeTruthy()
    expect(
      within(dialog).getByText(/Stickers already printed with the old code stop working/),
    ).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(issueCodeAction).not.toHaveBeenCalled()

    await open(user, cardOf(CODED), 'table-menu')
    await user.click(await screen.findByTestId('new-code'))
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
    await open(user, cardOf(CODED), 'table-menu')
    await user.click(await screen.findByTestId('turn-off-code'))
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
    const box = within(cardOf(PLAIN)).getByTestId('table-name') as HTMLInputElement
    expect(box.placeholder).toBe('Same as in barsy (10)')
    await user.type(box, 'VIP corner')
    await user.tab()
    await waitFor(() =>
      expect(renameTableAction).toHaveBeenCalledWith({ tableId: PLAIN, label: 'VIP corner' }),
    )
    expect(toast.success).toHaveBeenCalledWith('Name saved.')

    // Leaving a box that was not changed saves nothing.
    vi.mocked(renameTableAction).mockClear()
    await user.click(within(cardOf(CODED)).getByTestId('table-name'))
    await user.tab()
    expect(renameTableAction).not.toHaveBeenCalled()
  })

  it('shows why an action failed, and puts the old name back', async () => {
    vi.mocked(renameTableAction).mockResolvedValue({ ok: false, error: 'no_label' })
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const box = within(cardOf(NAMELESS)).getByTestId('table-name') as HTMLInputElement
    await user.type(box, 'x')
    await user.tab()
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('A table needs a name or a number.'),
    )
    expect(box.value).toBe('')
  })

  it('links to the print sheet in a new tab once there is a code, and shows nothing before (R2)', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={view()} />)
    const link = screen.getByTestId('print-sheet-link') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`/venues/${VENUE_ID}/tables/print`)
    expect(link.target).toBe('_blank')
    unmount()
    renderWithIntl(<TablesPanel view={view({ coded: 0 })} />)
    expect(screen.queryByTestId('print-sheet-link')).toBeNull()
  })

  it('counts the missing codes as core picks them: shown tables in shown areas, no payment table', () => {
    const base = view()
    // VIP is hidden and 2 has a code: the nameless table, 10 and 1 are missing.
    expect(missingCodes(base)).toBe(3)
    const withPayment = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        isPublic: hall.id !== AREA_MAIN,
        tables: hall.tables.map((row) =>
          row.id === SOLE ? { ...row, isPaymentTable: true } : row,
        ),
      })),
    })
    expect(missingCodes(withPayment)).toBe(1)
  })

  it('makes creating the missing codes the one main action, then the print sheet (R1)', () => {
    const { unmount } = renderWithIntl(<TablesPanel view={view()} />)
    expect(screen.getByTestId('create-all').textContent).toBe('Create the 3 missing codes')
    expect(screen.getByTestId('print-sheet-link').getAttribute('data-primary')).toBe('false')
    unmount()

    const base = view()
    const allCoded = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) => (row.isPublic ? { ...row, hasCode: true } : row)),
      })),
      coded: 4,
    })
    renderWithIntl(<TablesPanel view={allCoded} />)
    expect(screen.queryByTestId('create-all')).toBeNull()
    expect(screen.getByTestId('print-sheet-link').getAttribute('data-primary')).toBe('true')
  })

  it('names a single missing code in the singular', () => {
    const base = view()
    const one = view({
      halls: base.halls.map((hall) => ({
        ...hall,
        tables: hall.tables.map((row) =>
          row.isPublic && row.id !== PLAIN ? { ...row, hasCode: true } : row,
        ),
      })),
      coded: 3,
    })
    renderWithIntl(<TablesPanel view={one} />)
    expect(screen.getByTestId('create-all').textContent).toBe('Create the missing code')
  })

  it('has an empty state that sends the manager to the venue’s Menu source, naming the till', () => {
    renderWithIntl(<TablesPanel view={view({ halls: [], total: 0, coded: 0, sample: null })} />)
    expect(screen.getByText('No tables yet')).toBeTruthy()
    expect(screen.getByText(/Areas and tables come from barsy\./)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to the Menu source' }).getAttribute('href')).toBe(
      `/venues/${VENUE_ID}?tab=settings#menu-source`,
    )
    expect(screen.queryByTestId('create-all')).toBeNull()
  })
})

describe('an area on a venue with a till', () => {
  it('can be renamed, hidden and moved, never created, deleted or given tables', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const terrace = areaOf(AREA_TERRACE)
    expect(within(terrace).queryByTestId('add-table')).toBeNull()
    expect(screen.queryByTestId('add-area-form')).toBeNull()

    await open(user, terrace, 'hall-menu')
    expect(await screen.findByTestId('toggle-hall-hidden')).toBeTruthy()
    expect(screen.getByTestId('move-hall-up')).toBeTruthy()
    expect(screen.getByTestId('move-hall-down')).toBeTruthy()
    expect(screen.queryByTestId('delete-hall')).toBeNull()
  })

  it('is renamed in place; an unchanged name saves nothing', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    const box = within(areaOf(AREA_TERRACE)).getByTestId('hall-name') as HTMLInputElement
    await user.click(box)
    await user.tab()
    expect(renameAreaAction).not.toHaveBeenCalled()
    await user.clear(box)
    await user.type(box, 'Roof')
    await user.tab()
    await waitFor(() =>
      expect(renameAreaAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        areaId: AREA_TERRACE,
        name: 'Roof',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Area name saved.')
  })

  it('is hidden or shown, and moved up or down by its place in the list', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, areaOf(AREA_TERRACE), 'hall-menu')
    await user.click(await screen.findByTestId('toggle-hall-hidden'))
    await waitFor(() =>
      expect(setAreaHiddenAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        areaId: AREA_TERRACE,
        hidden: true,
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Area hidden. Its codes are paused.')

    await open(user, areaOf(AREA_TERRACE), 'hall-menu')
    await user.click(await screen.findByTestId('move-hall-up'))
    await waitFor(() =>
      expect(moveAreaAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        areaId: AREA_TERRACE,
        position: 0,
      }),
    )
    await open(user, areaOf(AREA_TERRACE), 'hall-menu')
    await user.click(await screen.findByTestId('move-hall-down'))
    await waitFor(() =>
      expect(moveAreaAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        areaId: AREA_TERRACE,
        position: 2,
      }),
    )
  })

  it('cannot go above the first place or below the last', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, areaOf(AREA_MAIN), 'hall-menu')
    expect((await screen.findByTestId('move-hall-up')).getAttribute('data-disabled')).not.toBeNull()
    await user.keyboard('{Escape}')
    await open(user, areaOf(AREA_TABLES), 'hall-menu')
    expect(
      (await screen.findByTestId('move-hall-down')).getAttribute('data-disabled'),
    ).not.toBeNull()
  })
})

describe('a table on a venue with a till', () => {
  it('can be hidden, shown and moved within its area; not deleted, renumbered or moved elsewhere', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, cardOf(CODED), 'table-menu')
    expect(await screen.findByTestId('toggle-hidden')).toBeTruthy()
    expect(screen.getByTestId('move-up')).toBeTruthy()
    expect(screen.getByTestId('move-down')).toBeTruthy()
    expect(screen.queryByTestId('delete-table')).toBeNull()
    expect(screen.queryByTestId('move-to-area')).toBeNull()
  })

  it('hides a shown table and shows a hidden one', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, cardOf(CODED), 'table-menu')
    await user.click(await screen.findByTestId('toggle-hidden'))
    await waitFor(() =>
      expect(setTableHiddenAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: CODED,
        hidden: true,
      }),
    )
    await open(user, cardOf(HIDDEN), 'table-menu')
    await user.click(await screen.findByTestId('toggle-hidden'))
    await waitFor(() =>
      expect(setTableHiddenAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        tableId: HIDDEN,
        hidden: false,
      }),
    )
    expect(toast.success).toHaveBeenLastCalledWith('Table shown.')
  })

  it('moves up and down by its place in the area, the first and last having one way only', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    // The code table is first in the terrace, 10 is last.
    await open(user, cardOf(CODED), 'table-menu')
    expect((await screen.findByTestId('move-up')).getAttribute('data-disabled')).not.toBeNull()
    await user.click(screen.getByTestId('move-down'))
    await waitFor(() =>
      expect(moveTableAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: CODED,
        areaId: undefined,
        position: 1,
      }),
    )
    await open(user, cardOf(PLAIN), 'table-menu')
    expect((await screen.findByTestId('move-down')).getAttribute('data-disabled')).not.toBeNull()
    await user.click(screen.getByTestId('move-up'))
    await waitFor(() =>
      expect(moveTableAction).toHaveBeenLastCalledWith({
        venueId: VENUE_ID,
        tableId: PLAIN,
        areaId: undefined,
        position: 0,
      }),
    )
  })

  it('a hidden table’s card cannot create a code', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={view()} />)
    await open(user, cardOf(HIDDEN), 'table-menu')
    expect((await screen.findByTestId('create-code')).getAttribute('data-disabled')).not.toBeNull()
  })
})

describe('a venue made by hand', () => {
  const hand = (overrides = {}) => view({ fromTill: false, sourceLabel: '', ...overrides })

  it('adds and removes areas and tables, and says that the owner makes them', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    expect(screen.getByTestId('add-area-form')).toBeTruthy()
    expect(within(areaOf(AREA_TERRACE)).getByTestId('add-table')).toBeTruthy()

    await open(user, areaOf(AREA_TERRACE), 'hall-menu')
    expect(await screen.findByTestId('delete-hall')).toBeTruthy()
    await user.keyboard('{Escape}')
    await open(user, cardOf(CODED), 'table-menu')
    expect(await screen.findByTestId('delete-table')).toBeTruthy()
    // It can move to each of the other areas.
    expect(screen.getAllByTestId('move-to-area').map((item) => item.textContent)).toEqual([
      'Move to Main hall',
      'Move to Tables',
    ])
  })

  it('shows a number box on each table instead of the till’s number, and saves it', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    const card = cardOf(PLAIN)
    expect(within(card).queryByTestId('table-number')).toBeNull()
    const box = within(card).getByTestId('table-number-input') as HTMLInputElement
    expect(box.value).toBe('10')
    await user.clear(box)
    await user.type(box, '11')
    await user.tab()
    await waitFor(() =>
      expect(setTableNumberAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: PLAIN,
        number: '11',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Number saved.')
  })

  it('adds an area by its name, and clears the box', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    const form = screen.getByTestId('add-area-form')
    const button = within(form).getByTestId('add-area') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const box = within(form).getByTestId('new-area-name') as HTMLInputElement
    await user.type(box, 'Garden')
    await user.click(button)
    await waitFor(() =>
      expect(createAreaAction).toHaveBeenCalledWith({ venueId: VENUE_ID, name: 'Garden' }),
    )
    expect(toast.success).toHaveBeenCalledWith('Area added.')
    await waitFor(() => expect(box.value).toBe(''))
  })

  it('adds a table with a number and a name to an area', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    await user.click(within(areaOf(AREA_TERRACE)).getByTestId('add-table'))
    const form = await screen.findByTestId('add-table-form')
    const submit = within(form).getByTestId('new-table-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await user.type(within(form).getByTestId('new-table-number'), '12')
    await user.type(within(form).getByTestId('new-table-name'), 'Sofa')
    await user.click(submit)
    await waitFor(() =>
      expect(createTableAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        areaId: AREA_TERRACE,
        number: '12',
        name: 'Sofa',
      }),
    )
    expect(toast.success).toHaveBeenCalledWith('Table added.')
  })

  it('asks before deleting a table, and before deleting an area', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    await open(user, cardOf(CODED), 'table-menu')
    await user.click(await screen.findByTestId('delete-table'))
    const dialog = await screen.findByTestId('confirm-delete-table')
    expect(within(dialog).getByText('Delete table 2?')).toBeTruthy()
    expect(deleteTableAction).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete table' }))
    await waitFor(() =>
      expect(deleteTableAction).toHaveBeenCalledWith({ venueId: VENUE_ID, tableId: CODED }),
    )
    expect(toast.success).toHaveBeenCalledWith('Table deleted.')

    await open(user, areaOf(AREA_TABLES), 'hall-menu')
    await user.click(await screen.findByTestId('delete-hall'))
    const areaDialog = await screen.findByTestId('confirm-delete-area')
    expect(within(areaDialog).getByText('Delete the area Tables?')).toBeTruthy()
    await user.click(within(areaDialog).getByRole('button', { name: 'Delete area' }))
    await waitFor(() =>
      expect(deleteAreaAction).toHaveBeenCalledWith({ venueId: VENUE_ID, areaId: AREA_TABLES }),
    )
  })

  it('moves a table to the end of another area', async () => {
    const user = userEvent.setup({ delay: null })
    renderWithIntl(<TablesPanel view={hand()} />)
    await open(user, cardOf(SOLE), 'table-menu')
    const items = await screen.findAllByTestId('move-to-area')
    await user.click(items.find((item) => item.textContent === 'Move to Terrace') as HTMLElement)
    await waitFor(() =>
      expect(moveTableAction).toHaveBeenCalledWith({
        venueId: VENUE_ID,
        tableId: SOLE,
        areaId: AREA_TERRACE,
        position: 2,
      }),
    )
  })

  it('has an empty state with only the add-area form while there is no area', () => {
    renderWithIntl(<TablesPanel view={hand({ halls: [], total: 0, coded: 0, sample: null })} />)
    expect(screen.getByTestId('areas-empty').textContent).toContain('No areas yet')
    expect(screen.getByTestId('add-area-form')).toBeTruthy()
    expect(screen.queryByTestId('tables-empty')).toBeNull()
    expect(screen.queryByTestId('create-all')).toBeNull()
  })

  it('shows an area with no table as such', () => {
    const base = hand()
    renderWithIntl(
      <TablesPanel
        view={hand({
          halls: base.halls.map((h) => (h.id === AREA_TABLES ? { ...h, tables: [] } : h)),
          total: 4,
          guestTotal: 4,
        })}
      />,
    )
    expect(within(areaOf(AREA_TABLES)).getByTestId('hall-empty').textContent).toBe(
      'No tables in this area yet.',
    )
  })
})

describe('a member who may not manage codes', () => {
  it('reads the areas and tables, is told the codes are for owners and admins, and gets none (S25)', () => {
    renderWithIntl(<TablesPanel view={view({ canManage: false })} />)
    expect(screen.getByTestId('tables-codes-hidden').textContent).toBe(
      'Only owners and admins can see the codes.',
    )
    expect(screen.getByTestId('tables-read-only').textContent).toBe(
      'Only owners and admins can see the codes. They also change the areas, tables and menus.',
    )
    for (const id of [
      'create-all',
      'print-sheet-link',
      'qr-address-card',
      'qr-thumb',
      'table-menu',
      'hall-menu',
      'table-name',
      'route-select',
      'add-table',
      'add-area-form',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(within(cardOf(CODED)).getByTestId('table-name-text').textContent).toBe('2')
    // The name of an area is text, and the menu each shows is read out.
    expect(screen.getAllByTestId('hall-name').map((e) => e.textContent)).toEqual([
      'Main hall',
      'Terrace',
      'Tables',
    ])
    // Who cannot open the picker reads the menu's name.
    expect(within(cardOf(CODED)).getByTestId('route-text').textContent).toBe(
      "The venue's menu (Main menu)",
    )
  })

  it('keeps the area index, which changes nothing', () => {
    renderWithIntl(<TablesPanel view={view({ canManage: false })} />)
    expect(screen.getAllByTestId('area-jump')).toHaveLength(3)
  })
})

describe('in Bulgarian', () => {
  it('reads in Bulgarian, naming the till', () => {
    renderWithIntl(<TablesPanel view={view()} />, { locale: 'bg' })
    expect(screen.getByText('Маси и QR кодове')).toBeTruthy()
    expect(screen.getByTestId('tables-summary').textContent).toBe('5 маси, 1 с код')
    expect(screen.getByTestId('create-all').textContent).toBe('Създай липсващите 3 кода')
    const box = within(cardOf(CODED)).getByTestId('table-name') as HTMLInputElement
    expect(box.placeholder).toBe('Като в barsy (2)')
    expect(within(cardOf(CODED)).getByTestId('route-select').textContent).toBe(
      'Менюто на заведението',
    )
    expect(screen.getByRole('navigation', { name: 'Зони' })).toBeTruthy()
    expect(hallNames().at(-1)).toBe('Tables')
  })

  it('tells a member in Bulgarian that the codes are for owners and admins', () => {
    renderWithIntl(<TablesPanel view={view({ canManage: false })} />, { locale: 'bg' })
    expect(screen.getByTestId('tables-codes-hidden').textContent).toBe(
      'Само собственици и администратори виждат кодовете.',
    )
    expect(screen.getByRole('link', { name: 'Terrace, 2 маси' })).toBeTruthy()
  })
})
