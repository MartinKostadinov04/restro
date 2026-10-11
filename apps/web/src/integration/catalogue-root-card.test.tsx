// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { CatalogueRootCard } from './catalogue-root-card'
import { emptyView, integrationView, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ chooseCatalogueRootAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.chooseCatalogueRootAction.mockReset()
})

describe('the catalogue-root picker', () => {
  it('shows the cached tree with each category’s child count, the chosen one marked', () => {
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />)
    const rows = screen.getAllByTestId('category-node')
    // Top level and the children of the chosen category's branch are open.
    expect(screen.getByRole('radio', { name: /Публично меню/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Каса Kiosk/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Коктейли/ })).toBeTruthy()
    expect(rows.length).toBeGreaterThanOrEqual(4)
    expect(
      within(
        screen.getByRole('radio', { name: /Публично меню/ }).closest('label') as HTMLElement,
      ).getByText('2 sub-categories'),
    ).toBeTruthy()
    expect(
      within(
        screen.getByRole('radio', { name: /Каса Kiosk/ }).closest('label') as HTMLElement,
      ).getByText('no sub-categories'),
    ).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Публично меню/ }) as HTMLInputElement).checked).toBe(
      true,
    )
  })

  it('opens and closes a branch', async () => {
    const user = userEvent.setup()
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />)
    expect(screen.queryByRole('radio', { name: /Наливна/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Show the sub-categories of Бира' }))
    expect(screen.getByRole('radio', { name: /Наливна/ })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Hide the sub-categories of Бира' }))
    expect(screen.queryByRole('radio', { name: /Наливна/ })).toBeNull()
  })

  it('opens down to the chosen category when it is deep in the tree', () => {
    renderWithIntl(
      <CatalogueRootCard venueId={VENUE_ID} view={integrationView({ rootCatId: 1174 })} />,
    )
    expect((screen.getByRole('radio', { name: /Наливна/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('stores the category the manager picks', async () => {
    const user = userEvent.setup()
    actions.chooseCatalogueRootAction.mockResolvedValue({ ok: true })
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: /Каса Kiosk/ }))
    expect(actions.chooseCatalogueRootAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      catId: 1091,
    })
  })

  it('shows an error the server reports', async () => {
    const user = userEvent.setup()
    actions.chooseCatalogueRootAction.mockResolvedValue({ ok: false, error: 'invalid' })
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: /Каса Kiosk/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('That input is not valid.')
  })

  it('never shows a category id', () => {
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />)
    expect(screen.getByTestId('catalogue-tree').textContent).not.toMatch(/1171|1091|1172/)
  })

  it('explains why it matters, and waits for the barsy venue first', () => {
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={emptyView()} />)
    expect(screen.getByText(/can hold several menus/)).toBeTruthy()
    expect(screen.getByTestId('catalogue-need-venue').textContent).toBe(
      'Choose the barsy venue first.',
    )
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('has an empty state until a connection check has read the tree', () => {
    renderWithIntl(<CatalogueRootCard venueId={VENUE_ID} view={integrationView({ tree: null })} />)
    expect(screen.getByTestId('catalogue-empty').textContent).toContain('No categories yet')
  })

  it('is read-only for someone who cannot manage', () => {
    renderWithIntl(
      <CatalogueRootCard venueId={VENUE_ID} view={integrationView({ canManage: false })} />,
    )
    expect((screen.getByRole('radio', { name: /Каса Kiosk/ }) as HTMLInputElement).disabled).toBe(
      true,
    )
  })

  it('warns when the chosen category is no longer in the tree', () => {
    renderWithIntl(
      <CatalogueRootCard venueId={VENUE_ID} view={integrationView({ rootCatId: 9999 })} />,
    )
    expect(screen.getByRole('alert').textContent).toContain('no longer in the tree')
  })

  it('marks the category the venue names as its public menu, and chooses nothing by it', () => {
    const tree = [
      { id: 1171, name: 'Публично меню', children: [] },
      {
        id: 1091,
        name: 'Каса Kiosk',
        children: [{ id: 1092, name: 'Горещи напитки', suggested: true as const, children: [] }],
      },
    ]
    renderWithIntl(
      <CatalogueRootCard venueId={VENUE_ID} view={integrationView({ tree, rootCatId: 1171 })} />,
    )
    // The suggested one is nested: its branch is open so the mark can be seen.
    const mark = screen.getByTestId('category-suggested')
    expect(mark.textContent).toBe("Suggested (the venue's public menu in the till)")
    expect(
      (mark.closest('label') as HTMLElement).contains(
        screen.getByRole('radio', { name: /Горещи напитки/ }),
      ),
    ).toBe(true)
    expect(screen.getAllByTestId('category-suggested')).toHaveLength(1)
    // The chosen root is still the one that was chosen.
    expect((screen.getByRole('radio', { name: /Публично меню/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(
      (screen.getByRole('radio', { name: /Горещи напитки/ }) as HTMLInputElement).checked,
    ).toBe(false)
    expect(actions.chooseCatalogueRootAction).not.toHaveBeenCalled()
  })

  it('shows no mark when no category is suggested, and says it in Bulgarian when one is', () => {
    const { unmount } = renderWithIntl(
      <CatalogueRootCard venueId={VENUE_ID} view={integrationView()} />,
    )
    expect(screen.queryByTestId('category-suggested')).toBeNull()
    unmount()
    renderWithIntl(
      <CatalogueRootCard
        venueId={VENUE_ID}
        view={integrationView({
          tree: [{ id: 1171, name: 'Публично меню', suggested: true, children: [] }],
        })}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('category-suggested').textContent).toBe(
      'Препоръчана (публичното меню на заведението в касата)',
    )
  })
})
