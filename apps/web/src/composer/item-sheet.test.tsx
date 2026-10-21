// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as actions from '@/server/item-sheet/actions'
import { renderWithIntl } from '@/test-utils'

import { ItemSheet } from './item-sheet'
import { sheetData } from './item-sheet-test-data'

// The sheet talks to the server through these actions; the tests answer for them.
vi.mock('@/server/item-sheet/actions', () => ({
  loadItemSheetAction: vi.fn(),
  loadItemHistoryAction: vi.fn(),
  saveItemFieldAction: vi.fn(),
  revertItemFieldAction: vi.fn(),
  keepItemOverrideAction: vi.fn(),
  saveItemTranslationAction: vi.fn(),
  setItemImageAction: vi.fn(),
  removeItemImageAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({ useParams: () => ({ venueId: 'vn_fromroute' }) }))

const A = vi.mocked(actions)

const ITEM = 'nd_0123456789ABCDEFGHIJKL'

beforeEach(() => {
  vi.clearAllMocks()
  A.loadItemHistoryAction.mockResolvedValue({ entries: [], nextBefore: null })
})

describe('ItemSheet', () => {
  it('loads the item named by its props and shows its name, source and tabs', async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData({ title: 'Негрони' }))
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    expect(screen.getByTestId('item-sheet-loading')).toBeTruthy()
    expect((await screen.findByTestId('item-sheet-title')).textContent).toBe('Негрони')
    expect(A.loadItemSheetAction).toHaveBeenCalledWith('vn_x', ITEM)
    expect(screen.getByText('From barsy')).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Details',
      'Translations',
      'Media',
      'History',
    ])
  })

  it('reads and saves in the menu the composer has open (S6), when it names one', async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData())
    A.saveItemFieldAction.mockResolvedValue({ ok: true, data: sheetData() })
    const MENU = 'nd_menu000000000000000000'
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" menuId={MENU} />)
    await screen.findByTestId('item-sheet-title')
    expect(A.loadItemSheetAction).toHaveBeenCalledWith({ venueId: 'vn_x', menuId: MENU }, ITEM)
  })

  it("takes the venue from the page's route when no venue is given", async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData())
    renderWithIntl(<ItemSheet itemId={ITEM} />)
    await screen.findByTestId('item-sheet-title')
    expect(A.loadItemSheetAction).toHaveBeenCalledWith('vn_fromroute', ITEM)
  })

  it('says so when the item is not there, and when loading fails', async () => {
    A.loadItemSheetAction.mockResolvedValueOnce(null)
    const first = renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    expect((await screen.findByTestId('item-sheet-problem')).textContent).toBe(
      'This item could not be found in this venue.',
    )
    first.unmount()
    A.loadItemSheetAction.mockRejectedValueOnce(new Error('boom'))
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    expect((await screen.findByTestId('item-sheet-problem')).textContent).toMatch(
      /could not be loaded/,
    )
  })

  it('notes the overrides to review (V12): what the till changed since ours was written', async () => {
    A.loadItemSheetAction.mockResolvedValue(
      sheetData({
        issues: [
          { code: 'stale_override', severity: 'warning', fieldKey: 'name' },
          { code: 'V4', severity: 'warning', fieldKey: 'allergens' },
        ],
      }),
    )
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />, { locale: 'en' })
    const notice = await screen.findByTestId('review-notice')
    expect(notice.textContent).toContain('Overrides to review')
    expect(notice.textContent).toContain('barsy changed Name after you replaced it here.')
  })

  it('has no such note when nothing waits for review', async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData())
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    await screen.findByTestId('item-sheet-title')
    expect(screen.queryByTestId('review-notice')).toBeNull()
  })

  it('does not load anything while closed', () => {
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" open={false} />)
    expect(A.loadItemSheetAction).not.toHaveBeenCalled()
  })

  it('saves an edit through the action and shows the refreshed value and badge', async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData())
    A.saveItemFieldAction.mockResolvedValue({
      ok: true,
      data: sheetData({
        revision: 4,
        fields: { abv: { value: 30, provenance: 'owned', layer: 'manual' } },
      }),
    })
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    await screen.findByTestId('item-sheet-title')
    const row = document.querySelector('[data-field-key="abv"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /set abv/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'ABV' }), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(A.saveItemFieldAction).toHaveBeenCalledWith('vn_x', ITEM, 'abv', 30))
    await waitFor(() => expect(within(row).getByText('Owned here')).toBeTruthy())
    expect(toast.success).toHaveBeenCalledWith('Saved')
  })

  it('says why a save did not happen and keeps what it showed', async () => {
    A.loadItemSheetAction.mockResolvedValue(sheetData())
    A.saveItemFieldAction.mockResolvedValue({ ok: false, error: 'locked' })
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    await screen.findByTestId('item-sheet-title')
    const row = document.querySelector('[data-field-key="abv"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /set abv/i }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'ABV' }), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('barsy owns this value. Change it in barsy.'),
    )
    // The editor stays open for another try.
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('reverts through the action', async () => {
    A.loadItemSheetAction.mockResolvedValue(
      sheetData({
        fields: {
          allergens: {
            value: ['gluten', 'milk'],
            provenance: 'overridden',
            canRevert: true,
            tillValue: ['gluten'],
          },
        },
      }),
    )
    A.revertItemFieldAction.mockResolvedValue({
      ok: true,
      data: sheetData({ fields: { allergens: { value: ['gluten'], provenance: 'till' } } }),
    })
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    await screen.findByTestId('item-sheet-title')
    await userEvent.click(screen.getByRole('button', { name: /revert allergens/i }))
    await waitFor(() =>
      expect(A.revertItemFieldAction).toHaveBeenCalledWith('vn_x', ITEM, 'allergens'),
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /revert allergens/i })).toBeNull(),
    )
  })

  it('opens the Media tab from the image row, keeps a half-written translation across tabs and loads History on demand', async () => {
    A.loadItemSheetAction.mockResolvedValue(
      sheetData({
        fields: { image: { access: { kind: 'media' } } },
        translations: [
          {
            fieldKey: 'description',
            definition: sheetData().fields.find((f) => f.key === 'description')
              ?.definition as never,
            cells: {
              bg_BG: {
                text: null,
                provenance: 'none',
                ourText: null,
                editable: true,
                missing: true,
                review: false,
              },
              en_US: {
                text: null,
                provenance: 'none',
                ourText: null,
                editable: true,
                missing: true,
                review: false,
              },
            },
          },
        ],
      }),
    )
    renderWithIntl(<ItemSheet itemId={ITEM} venueId="vn_x" />)
    await screen.findByTestId('item-sheet-title')

    // Image row -> Media tab.
    const imageRow = document.querySelector('[data-field-key="image"]') as HTMLElement
    await userEvent.click(within(imageRow).getByRole('button', { name: /^(edit|set) image/i }))
    expect(screen.getByRole('tab', { name: 'Media' }).getAttribute('aria-selected')).toBe('true')
    // Only the selected tab's panel shows; the others stay mounted but hidden.
    const hidden = (testId: string) =>
      document.querySelector(`[data-testid="${testId}"]`)?.closest('[hidden]') != null
    expect(hidden('item-sheet-media')).toBe(false)
    expect(hidden('item-sheet-details')).toBe(true)
    expect(hidden('item-sheet-translations')).toBe(true)

    // A draft survives a visit to another tab.
    await userEvent.click(screen.getByRole('tab', { name: 'Translations' }))
    const cell = document.querySelector(
      '[data-testid="translation-cell"][data-locale="en_US"]',
    ) as HTMLElement
    await userEvent.type(within(cell).getByRole('textbox'), 'Half written')
    await userEvent.click(screen.getByRole('tab', { name: 'Details' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Translations' }))
    expect((within(cell).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Half written')

    // History is not loaded until it is opened.
    expect(A.loadItemHistoryAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('tab', { name: 'History' }))
    await waitFor(() => expect(A.loadItemHistoryAction).toHaveBeenCalledWith('vn_x', ITEM))
  })
})
