// @vitest-environment jsdom
// The whole Structure screen for a member (RR-70): the Composer itself, not its parts under a
// hand-made state, so the read-only line, the left column and the pane are wired from `canEdit`.
// The server actions and the navigation are the only fakes.
import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { Composer } from './composer'
import { makeTestView } from './test-view'

vi.mock('./actions', () => ({}))
vi.mock('./payment-mode-actions', () => ({}))
vi.mock('./sold-out-actions', () => ({}))
vi.mock('./tag-actions', () => ({}))
vi.mock('@/server/item-sheet/actions', () => ({}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/venues/vn_0123456789ABCDEFGHIJKL',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ venueId: 'vn_0123456789ABCDEFGHIJKL' }),
}))

describe('the Composer for a member (RR-70)', () => {
  it('shows the menu to read, says why once, and draws no edit control', () => {
    const { view, ids } = makeTestView()
    const { container } = renderWithIntl(
      <Composer
        venueId="vn_0123456789ABCDEFGHIJKL"
        menuId={ids.menu}
        view={view}
        defaultLocale="bg_BG"
        enabledLocales={['bg_BG', 'en_US']}
        currency="EUR"
        canEdit={false}
        canMarkSoldOut={false}
        canCreateItem={false}
        hasTill={false}
        canDelete={false}
        payFirstDefault={null}
      />,
      { locale: 'en' },
    )
    expect(screen.getByTestId('composer-read-only').textContent).toBe(
      'You can look at the menu here. Only an owner or admin can change it.',
    )
    // Everything is there to read: the sections and the open section's items.
    expect(screen.getAllByTestId('section-node').length).toBeGreaterThan(0)
    const pane = screen.getByTestId('item-pane')
    expect(within(pane).getAllByTestId('item-open').length).toBeGreaterThan(0)
    // No control that can only fail (operational-screens.md): nothing to create, tick, switch or drag.
    for (const testId of [
      'new-section',
      'open-tags',
      'new-item',
      'section-menu',
      'section-visible',
      'item-visible',
      'item-select',
      'select-all',
    ]) {
      expect(screen.queryAllByTestId(testId), testId).toHaveLength(0)
    }
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(container.querySelectorAll('[data-rfd-drag-handle-draggable-id]')).toHaveLength(0)
  })
})
