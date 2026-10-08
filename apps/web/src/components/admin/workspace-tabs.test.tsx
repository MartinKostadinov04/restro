// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { WORKSPACE_TAB_DEFS, type WorkspaceTabValue } from './workspace-tab-defs'
import { WorkspaceTabs } from './workspace-tabs'

// The tabs read and write the URL through next/navigation: replace it with a small fake.
const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: '/venues/vn_demo',
  search: '',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navigation.replace }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

const contents = Object.fromEntries(
  WORKSPACE_TAB_DEFS.map(({ value }) => [value, <p key={value}>content of {value}</p>]),
) as Record<WorkspaceTabValue, React.ReactNode>

function renderTabs() {
  return renderWithIntl(<WorkspaceTabs contents={contents} />)
}

beforeEach(() => {
  navigation.replace.mockReset()
  navigation.search = ''
})

describe('WorkspaceTabs: tabs and the URL', () => {
  it('draws the tab bar and the small-screen select from the one declared list', () => {
    renderTabs()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Composer',
      'Tables & QR',
      'Publishing',
      'Integration',
      'Settings',
    ])
    // The select has one entry per declared tab, labelled from the same keys.
    expect(screen.getByRole('combobox', { name: 'Switch tab' })).toBeTruthy()
    expect(tabs).toHaveLength(WORKSPACE_TAB_DEFS.length)
  })

  it('opens the first tab when the URL has no ?tab=', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Composer' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('content of composer')).toBeTruthy()
    expect(screen.queryByText('content of settings')).toBeNull()
  })

  it('opens the tab named in ?tab= (a reload keeps the tab)', () => {
    navigation.search = 'tab=publishing'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Publishing' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByText('content of publishing')).toBeTruthy()
  })

  it('falls back to the first tab for an unknown ?tab=', () => {
    navigation.search = 'tab=nonsense'
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Composer' }).getAttribute('aria-selected')).toBe('true')
  })

  it('writes the chosen tab to the URL with router.replace, keeping the other parameters', async () => {
    navigation.search = 'tab=composer&foo=bar'
    renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1))
    expect(navigation.replace).toHaveBeenCalledWith('/venues/vn_demo?tab=settings&foo=bar', {
      scroll: false,
    })
  })

  it('does not touch the URL when the current tab is clicked again', async () => {
    navigation.search = 'tab=settings'
    renderTabs()
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(navigation.replace).not.toHaveBeenCalled()
  })
})
