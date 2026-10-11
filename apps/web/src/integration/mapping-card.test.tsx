// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { MappingCard } from './mapping-card'
import { emptyView, integrationView } from './test-view'

const actions = vi.hoisted(() => ({ saveMappingSettingsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.saveMappingSettingsAction.mockReset()
})

describe('how the till’s data is read (the whole installation)', () => {
  it('has no price: the price is each venue’s own (D73)', () => {
    renderWithIntl(<MappingCard view={integrationView()} />)
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText(/Base price/)).toBeNull()
  })

  it('shows what automatic detection finds for the allergen characteristic', () => {
    renderWithIntl(<MappingCard view={integrationView()} />)
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Detect automatically (Алергени)',
    )
  })

  it('says when detection finds nothing yet, and when the list is still unread', () => {
    renderWithIntl(
      <MappingCard
        view={emptyView({
          integration: integrationView().integration,
          mapping: {
            ...integrationView().mapping,
            allergenDetected: null,
            allergenOptions: [],
          },
        })}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Detect automatically (none found yet)',
    )
    expect(
      screen.getByText(/list of characteristics is read when the connection is checked/),
    ).toBeTruthy()
  })

  it('shows the default language by name', () => {
    renderWithIntl(<MappingCard view={integrationView()} />)
    expect(screen.getByRole('combobox', { name: 'Default language' }).textContent).toMatch(
      /Bulgarian/,
    )
  })

  it('saves only when something changed, and sends both settings', async () => {
    const user = userEvent.setup()
    actions.saveMappingSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<MappingCard view={integrationView()} />)
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    await user.click(screen.getByRole('combobox', { name: 'Default language' }))
    await user.click(await screen.findByRole('option', { name: /English/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)

    expect(actions.saveMappingSettingsAction).toHaveBeenCalledWith({
      allergenKey: null,
      defaultLocale: 'en_US',
    })
    expect(await screen.findByText(/Settings saved/)).toBeTruthy()
  })

  it('sends the characteristic the manager picks', async () => {
    const user = userEvent.setup()
    actions.saveMappingSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<MappingCard view={integrationView()} />)
    await user.click(screen.getByRole('combobox', { name: 'Allergen characteristic' }))
    await user.click(await screen.findByRole('option', { name: 'Годност в дни' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(actions.saveMappingSettingsAction).toHaveBeenCalledWith(
        expect.objectContaining({ allergenKey: 'k101' }),
      ),
    )
  })

  it('shows a refusal from the server', async () => {
    const user = userEvent.setup()
    actions.saveMappingSettingsAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    renderWithIntl(<MappingCard view={integrationView()} />)
    await user.click(screen.getByRole('combobox', { name: 'Allergen characteristic' }))
    await user.click(await screen.findByRole('option', { name: 'Годност в дни' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only owners and admins can do this.',
    )
  })

  it('is read-only for someone who cannot manage', () => {
    renderWithIntl(<MappingCard view={integrationView({ canManage: false })} />)
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    const form = screen.getByTestId('mapping-form')
    expect(
      within(form).getByRole('combobox', { name: 'Default language' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      within(form)
        .getByRole('combobox', { name: 'Allergen characteristic' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('shows what is stored: a chosen characteristic and language', () => {
    renderWithIntl(
      <MappingCard
        view={integrationView({
          mapping: { ...integrationView().mapping, allergenKey: 'k101', defaultLocale: 'en_US' },
        })}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Годност в дни',
    )
    expect(screen.getByRole('combobox', { name: 'Default language' }).textContent).toMatch(
      /English/,
    )
  })
})
