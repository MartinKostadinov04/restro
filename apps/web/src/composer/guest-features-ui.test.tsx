// @vitest-environment jsdom
// The composer's "Guest features" card (brief SH-05b, D71; on the Design subtab since S6): the menu
// switches, the service at the table with its request kinds, the allergen line that has no switch
// (R6), the one Save button, and the read-only view for a person who may not change the venue.

import type { GuestFeatures } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  saveFeatureOptionsAction,
  saveGuestFeaturesAction,
} from '@/server/composer/guest-features-actions'
import { renderWithIntl } from '@/test-utils'

import { GuestFeaturesCard, type TemplateFeatureOptions } from './guest-features-panel'

vi.mock('@/server/composer/guest-features-actions', () => ({
  saveGuestFeaturesAction: vi.fn(),
  saveFeatureOptionsAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'

/** Filters on, every service off: what a venue has until it chooses. */
const FEATURES: GuestFeatures = {
  filters: true,
  call_waiter: { enabled: false, kinds: [] },
  bill: false,
  ordering: false,
  pay: false,
}

/**
 * A template's own feature switch, as a template may declare one (Editorial Market's layout switch
 * was one until D92 made it a menu setting).
 */
const OPTIONS: TemplateFeatureOptions = {
  declared: [
    {
      key: 'layoutSwitch',
      type: 'boolean',
      default: true,
      label: { bg: 'Гостите могат да сменят подредбата', en: 'Guests can change the layout' },
    },
  ],
  values: { layoutSwitch: true },
}

function setup({
  features = FEATURES,
  options = OPTIONS,
  canEdit = true,
}: {
  features?: GuestFeatures
  options?: TemplateFeatureOptions
  canEdit?: boolean
} = {}) {
  renderWithIntl(
    <GuestFeaturesCard venueId={VENUE} features={features} options={options} canEdit={canEdit} />,
    { locale: 'en' },
  )
}

const save = () => screen.getByRole('button', { name: 'Save' })
const switchNamed = (name: string) => screen.getByRole('switch', { name })
const checkboxNamed = (name: string) => screen.getByRole('checkbox', { name })

beforeEach(() => {
  vi.mocked(saveGuestFeaturesAction).mockReset()
  vi.mocked(saveGuestFeaturesAction).mockResolvedValue({ ok: true })
  vi.mocked(saveFeatureOptionsAction).mockReset()
  vi.mocked(saveFeatureOptionsAction).mockResolvedValue({ ok: true })
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
})

describe('the guest features panel', () => {
  it('shows the saved menu switches, and the allergen line without a switch', () => {
    setup({ features: { ...FEATURES, filters: false } })
    expect(switchNamed('Filters (diet and tags)').getAttribute('aria-checked')).toBe('false')
    expect(switchNamed('Guests can change the layout').getAttribute('aria-checked')).toBe('true')

    const allergens = screen.getByTestId('allergens-always')
    expect(allergens.textContent).toBe('Allergen information is always shown')
    expect(within(allergens).queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('switch', { name: /allergen/i })).toBeNull()
  })

  it('has nothing to save at first, something once a switch moves, and nothing again when it moves back', async () => {
    setup()
    expect(save().hasAttribute('disabled')).toBe(true)

    await userEvent.click(switchNamed('Filters (diet and tags)'))
    expect(switchNamed('Filters (diet and tags)').getAttribute('aria-checked')).toBe('false')
    expect(save().hasAttribute('disabled')).toBe(false)

    await userEvent.click(switchNamed('Filters (diet and tags)'))
    expect(save().hasAttribute('disabled')).toBe(true)
  })

  it('ticks every kind but the card terminal when "Call a waiter" goes on, "Waiter" fixed on, and saves them', async () => {
    setup()
    await userEvent.click(switchNamed('Call a waiter'))
    expect(checkboxNamed('Waiter').getAttribute('aria-checked')).toBe('true')
    expect(checkboxNamed('Waiter').hasAttribute('disabled')).toBe(true)
    for (const name of ['The bill', 'Ice', 'Water', 'Glasses', 'Clean the table']) {
      expect(checkboxNamed(name).getAttribute('aria-checked')).toBe('true')
    }
    expect(checkboxNamed('Card terminal').getAttribute('aria-checked')).toBe('false')

    await userEvent.click(save())
    await waitFor(() => expect(saveGuestFeaturesAction).toHaveBeenCalledTimes(1))
    expect(saveGuestFeaturesAction).toHaveBeenCalledWith({
      venueId: VENUE,
      features: {
        filters: true,
        call_waiter: {
          enabled: true,
          kinds: ['waiter', 'bill', 'ice', 'water', 'glasses', 'clean_table'],
        },
        bill: false,
        ordering: false,
        pay: false,
      },
    })
    expect(saveFeatureOptionsAction).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith('Saved. Guests see it after the next publish')
  })

  it('keeps the request kinds in the order of the vocabulary', async () => {
    setup()
    await userEvent.click(switchNamed('Call a waiter'))
    for (const name of ['The bill', 'Ice', 'Water', 'Glasses', 'Clean the table']) {
      await userEvent.click(checkboxNamed(name))
    }
    await userEvent.click(checkboxNamed('Card terminal'))
    await userEvent.click(checkboxNamed('Ice'))
    await userEvent.click(save())
    await waitFor(() => expect(saveGuestFeaturesAction).toHaveBeenCalledTimes(1))
    expect(saveGuestFeaturesAction).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({
          call_waiter: { enabled: true, kinds: ['waiter', 'ice', 'terminal'] },
        }),
      }),
    )
  })

  it('shows the Stage 4 note under waiter, bill and ordering, and the Stage 5 note under pay', () => {
    setup()
    expect(
      screen.getAllByText('Guests see this once ordering is connected (Stage 4)'),
    ).toHaveLength(3)
    expect(screen.getByText('Guests see this once payment is connected (Stage 5)')).toBeTruthy()
  })

  it('saves a template feature switch through its own action, not the guest features one', async () => {
    setup()
    await userEvent.click(switchNamed('Guests can change the layout'))
    await userEvent.click(save())
    await waitFor(() => expect(saveFeatureOptionsAction).toHaveBeenCalledTimes(1))
    expect(saveFeatureOptionsAction).toHaveBeenCalledWith({
      venueId: VENUE,
      options: { layoutSwitch: false },
    })
    expect(saveGuestFeaturesAction).not.toHaveBeenCalled()
  })

  it('says why a save was refused and keeps the change to try again', async () => {
    vi.mocked(saveGuestFeaturesAction).mockResolvedValue({ ok: false, error: 'forbidden' } as const)
    setup()
    await userEvent.click(switchNamed('Order from the phone'))
    await userEvent.click(save())
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Only owners and admins can change guest features.'),
    )
    expect(toast.success).not.toHaveBeenCalled()
    expect(switchNamed('Order from the phone').getAttribute('aria-checked')).toBe('true')
    // The save is over once the button is pressable again (the transition ends after the toast).
    await waitFor(() => expect(save().hasAttribute('disabled')).toBe(false))
  })

  it('is read-only for a person who may not change the venue', () => {
    setup({ canEdit: false })
    expect(screen.getByText('Only owners and admins can change these.')).toBeTruthy()
    const names = [
      'Filters (diet and tags)',
      'Guests can change the layout',
      'Call a waiter',
      "Show the table's bill",
      'Order from the phone',
      'Pay from the phone',
    ]
    for (const name of names) {
      expect(switchNamed(name).hasAttribute('disabled')).toBe(true)
    }
    expect(checkboxNamed('Waiter').hasAttribute('disabled')).toBe(true)
    expect(save().hasAttribute('disabled')).toBe(true)
  })
})
