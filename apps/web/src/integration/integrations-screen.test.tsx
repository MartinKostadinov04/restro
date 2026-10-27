// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyView, instanceView, integrationsView, newInstanceView } from '@/connectors/test-view'
import type { IntegrationsView } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { IntegrationsScreen } from './integrations-screen'

const actions = vi.hoisted(() => ({
  saveSystemsAction: vi.fn(),
  addInstanceAction: vi.fn(),
  saveConnectionAction: vi.fn(),
  renameInstanceAction: vi.fn(),
  removeInstanceAction: vi.fn(),
  checkConnectionAction: vi.fn(),
  saveInstanceSettingsAction: vi.fn(),
  syncAllAction: vi.fn(),
}))
vi.mock('@/server/integration/actions', () => actions)
const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => navigation.params,
}))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  navigation.params = new URLSearchParams()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const screenOf = (view: IntegrationsView, locale: 'en' | 'bg' = 'en') =>
  renderWithIntl(<IntegrationsScreen view={view} />, { locale })

describe('Settings -> Integrations, source-agnostic', () => {
  it('starts with the picker and an empty state when no system is chosen', () => {
    screenOf(emptyView())
    expect(screen.getByTestId('systems-picker')).toBeTruthy()
    expect(screen.getByTestId('systems-empty').textContent).toContain('No system chosen yet')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByTestId('instance')).toBeNull()
    expect(screen.queryByTestId('read-only')).toBeNull()
  })

  it('gives each chosen system a tab, with its instances inside', () => {
    screenOf(integrationsView())
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['barsy'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    const instances = screen.getAllByTestId('instance')
    expect(instances).toHaveLength(1)
    expect(
      within(instances[0] as HTMLElement).getByRole('heading', { name: 'barsy – Sofia' }),
    ).toBeTruthy()
  })

  it('lists several named instances of one system, each with its own cards', () => {
    screenOf(
      integrationsView({
        systems: [{ kind: 'barsy', label: 'barsy', instances: 2 }],
        instances: [
          instanceView(),
          instanceView({
            id: 'in_secondInstance000000001',
            name: 'barsy – Plovdiv',
            host: 'plovdiv.barsyonline.com',
            venues: [],
          }),
        ],
      }),
    )
    const instances = screen.getAllByTestId('instance')
    expect(instances.map((instance) => instance.querySelector('h3')?.textContent)).toEqual([
      'barsy – Sofia',
      'barsy – Plovdiv',
    ])
    // Each has its own connection and settings card.
    expect(screen.getAllByTestId('settings-form')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Sync everything now' })).toHaveLength(2)
  })

  it('offers "Add barsy" and opens the form for another connection', async () => {
    const user = userEvent.setup()
    screenOf(integrationsView())
    expect(screen.queryByTestId('add-instance-form')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add barsy' }))
    const form = screen.getByTestId('add-instance-form')
    expect(within(form).getByLabelText('Name')).toBeTruthy()
    expect(within(form).getByLabelText('barsy address')).toBeTruthy()
    // Cancel closes it again.
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByTestId('add-instance-form')).toBeNull()
  })

  it('shows the form at once for a chosen system with no instance yet', () => {
    screenOf(
      integrationsView({
        systems: [{ kind: 'barsy', label: 'barsy', instances: 0 }],
        instances: [],
      }),
    )
    expect(screen.getByTestId('add-instance-form')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add barsy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('keeps a system with instances as a tab even if it is not in the chosen list', () => {
    screenOf(integrationsView({ chosen: [] }))
    expect(screen.getAllByRole('tab')).toHaveLength(1)
    expect(screen.getByTestId('instance')).toBeTruthy()
  })

  it('draws the tab strip with no vertical scrollbar of its own (trial finding 2.2: a 36 px strip of 37 px)', () => {
    screenOf(integrationsView({ chosen: [] }))
    const strip = screen.getByRole('tablist')
    expect(strip.className).toContain('overflow-y-hidden')
  })

  it('opens the tab the address asks for and writes the open tab to the address', async () => {
    const user = userEvent.setup()
    const replace = vi.spyOn(window.history, 'replaceState')
    navigation.params = new URLSearchParams('system=other_pos')
    screenOf(
      integrationsView({
        systems: [
          { kind: 'barsy', label: 'barsy', instances: 1 },
          { kind: 'other_pos', label: 'Other POS', instances: 0 },
        ],
        chosen: ['barsy', 'other_pos'],
      }),
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true'])

    await user.click(tabs[0] as HTMLElement)
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(replace).toHaveBeenCalled()
    expect(String(replace.mock.calls.at(-1)?.[2])).toContain('system=barsy')
  })

  it('falls back to the first tab for a system the address names but is not shown', () => {
    navigation.params = new URLSearchParams('system=nope')
    screenOf(integrationsView())
    expect(screen.getAllByRole('tab')[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('is read-only for someone who cannot manage: it shows everything and offers no change', () => {
    screenOf(integrationsView({ canManage: false }))
    expect(screen.getByTestId('read-only').textContent).toContain('Only owners and admins')
    expect(screen.queryByRole('button', { name: 'Save systems' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add barsy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change credentials' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    expect(screen.getByTestId('status-badge').textContent).toBe('Connected')
  })

  it('says to ask an owner when a read-only person looks at a system with no instance', () => {
    screenOf(
      integrationsView({
        canManage: false,
        systems: [{ kind: 'barsy', label: 'barsy', instances: 0 }],
        instances: [],
      }),
    )
    expect(screen.getByTestId('system-empty').textContent).toContain('No barsy connection yet')
    expect(screen.queryByTestId('add-instance-form')).toBeNull()
  })

  it('names no system outside the instance and connector parts: the labels come from the data', () => {
    screenOf(
      integrationsView({
        systems: [{ kind: 'barsy', label: 'Label from the server', instances: 1 }],
        instances: [instanceView({ source: 'Label from the server' })],
      }),
    )
    // The system's words in the status card are the data's, not a hard-coded name.
    expect(
      screen.getByText(
        'Whether Restro can reach Label from the server with the saved credentials.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add Label from the server' })).toBeTruthy()
  })

  it('shows an instance without credentials as new, with its form open', () => {
    screenOf(
      integrationsView({
        instances: [newInstanceView()],
      }),
    )
    expect(screen.getByTestId('connect-form')).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    screenOf(integrationsView(), 'bg')
    expect(screen.getByRole('heading', { name: 'Системи' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Добави barsy' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'barsy' })).toBeTruthy()
  })
})
