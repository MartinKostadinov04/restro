// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { MappingCard } from './mapping-card'
import { emptyView, integrationView, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ saveMappingSettingsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.saveMappingSettingsAction.mockReset()
})

describe('the mapping settings', () => {
  it('offers both prices with a line each, and keeps the default', () => {
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
    const base = screen.getByRole('radio', { name: /Base price/ }) as HTMLInputElement
    const current = screen.getByRole('radio', { name: /Current price/ }) as HTMLInputElement
    expect(base.checked).toBe(true)
    expect(current.checked).toBe(false)
    expect(screen.getByText("barsy's regular price of the article.")).toBeTruthy()
    expect(screen.getByText(/The price barsy charges right now/)).toBeTruthy()
    expect(screen.getByText('(default)')).toBeTruthy()
  })

  it('shows what automatic detection finds for the allergen characteristic', () => {
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Detect automatically (Алергени)',
    )
  })

  it('says when detection finds nothing yet, and when the list is still unread', () => {
    renderWithIntl(
      <MappingCard
        venueId={VENUE_ID}
        view={emptyView({
          integration: integrationView().integration,
          settings: {
            ...integrationView().settings,
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
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
    expect(screen.getByRole('combobox', { name: 'Default language' }).textContent).toMatch(
      /Bulgarian/,
    )
  })

  it('saves only when something changed, and sends all three settings', async () => {
    const user = userEvent.setup()
    actions.saveMappingSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)

    expect(actions.saveMappingSettingsAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      priceSource: 'current_price',
      allergenKey: null,
      defaultLocale: 'bg_BG',
    })
    expect(await screen.findByText(/Settings saved/)).toBeTruthy()
  })

  it('sends the characteristic the manager picks', async () => {
    const user = userEvent.setup()
    actions.saveMappingSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
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
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only owners and admins can do this.',
    )
  })

  it('is read-only for someone who cannot manage', () => {
    renderWithIntl(<MappingCard venueId={VENUE_ID} view={integrationView({ canManage: false })} />)
    // The radios sit in a disabled fieldset: `:disabled` matches, the property does not.
    expect(screen.getByRole('radio', { name: /Base price/ }).matches(':disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    const form = screen.getByTestId('mapping-form')
    expect(
      within(form).getByRole('combobox', { name: 'Default language' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('shows what is stored: current price and a chosen characteristic', () => {
    renderWithIntl(
      <MappingCard
        venueId={VENUE_ID}
        view={integrationView({
          settings: {
            ...integrationView().settings,
            priceSource: 'current_price',
            allergenKey: 'k101',
            defaultLocale: 'en_US',
          },
        })}
      />,
    )
    expect((screen.getByRole('radio', { name: /Current price/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Годност в дни',
    )
    expect(screen.getByRole('combobox', { name: 'Default language' }).textContent).toMatch(
      /English/,
    )
  })
})
