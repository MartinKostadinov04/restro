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
})
