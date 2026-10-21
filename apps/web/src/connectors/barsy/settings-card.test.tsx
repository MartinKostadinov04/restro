// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { barsySettings, INSTANCE_ID } from '@/connectors/test-view'
import { renderWithIntl } from '@/test-utils'

import { BarsySettingsCard } from './settings-card'

const actions = vi.hoisted(() => ({ saveInstanceSettingsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.saveInstanceSettingsAction.mockReset()
})

function card(data = barsySettings(), canManage = true) {
  return renderWithIntl(
    <BarsySettingsCard integrationId={INSTANCE_ID} canManage={canManage} data={data} />,
  )
}

describe('the barsy system settings card (an instance, the whole installation)', () => {
  it('holds the allergen characteristic and the language of untagged text, nothing else', () => {
    card()
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Language of untagged text' })).toBeTruthy()
    // No price (each venue's own, D73), no schedule (each venue's, D82), no category.
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText(/Base price/)).toBeNull()
    expect(screen.queryByText(/schedule/i)).toBeNull()
    expect(screen.queryByText(/category/i)).toBeNull()
  })

  it('shows what automatic detection finds for the allergen characteristic', () => {
    card()
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Detect automatically (Алергени)',
    )
  })

  it('says when detection finds nothing yet, and when the list is still unread', () => {
    card(barsySettings({ allergenDetected: null, allergenOptions: [] }))
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Detect automatically (none found yet)',
    )
    expect(
      screen.getByText(/list of characteristics is read when the connection is checked/),
    ).toBeTruthy()
  })

  it('shows the language by name', () => {
    card()
    expect(screen.getByRole('combobox', { name: 'Language of untagged text' }).textContent).toMatch(
      /Bulgarian/,
    )
  })

  it('saves only when something changed, and sends both settings with the instance', async () => {
    const user = userEvent.setup()
    actions.saveInstanceSettingsAction.mockResolvedValue({ ok: true })
    card()
    const save = screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    await user.click(screen.getByRole('combobox', { name: 'Language of untagged text' }))
    await user.click(await screen.findByRole('option', { name: /English/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)

    expect(actions.saveInstanceSettingsAction).toHaveBeenCalledWith({
      integrationId: INSTANCE_ID,
      settings: { allergenKey: null, defaultLocale: 'en_US' },
    })
    expect(await screen.findByText(/Settings saved/)).toBeTruthy()
  })

  it('sends the characteristic the manager picks', async () => {
    const user = userEvent.setup()
    actions.saveInstanceSettingsAction.mockResolvedValue({ ok: true })
    card()
    await user.click(screen.getByRole('combobox', { name: 'Allergen characteristic' }))
    await user.click(await screen.findByRole('option', { name: 'Годност в дни' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() =>
      expect(actions.saveInstanceSettingsAction).toHaveBeenCalledWith({
        integrationId: INSTANCE_ID,
        settings: expect.objectContaining({ allergenKey: 'k101' }),
      }),
    )
  })

  it('shows a refusal from the server', async () => {
    const user = userEvent.setup()
    actions.saveInstanceSettingsAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    card()
    await user.click(screen.getByRole('combobox', { name: 'Allergen characteristic' }))
    await user.click(await screen.findByRole('option', { name: 'Годност в дни' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only owners and admins can do this.',
    )
  })

  it('is read-only for someone who cannot manage', () => {
    card(barsySettings(), false)
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
    const form = screen.getByTestId('settings-form')
    expect(
      within(form)
        .getByRole('combobox', { name: 'Language of untagged text' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      within(form)
        .getByRole('combobox', { name: 'Allergen characteristic' })
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  it('shows what is stored: a chosen characteristic and language', () => {
    card(barsySettings({ allergenKey: 'k101', defaultLocale: 'en_US' }))
    expect(screen.getByRole('combobox', { name: 'Allergen characteristic' }).textContent).toBe(
      'Годност в дни',
    )
    expect(screen.getByRole('combobox', { name: 'Language of untagged text' }).textContent).toMatch(
      /English/,
    )
  })
})
