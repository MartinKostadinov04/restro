// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenuSourceView, SyncBlock } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'

import { MenuSourceCard } from './menu-source-card'
import { linkedMenuSource, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({
  chooseTillVenueAction: vi.fn(),
  chooseCatalogueRootAction: vi.fn(),
  saveVenuePriceAction: vi.fn(),
  syncNowAction: vi.fn(),
}))
vi.mock('@/server/integration/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
})

const card = (view: MenuSourceView, locale: 'en' | 'bg' = 'en') =>
  renderWithIntl(<MenuSourceCard venueId={VENUE_ID} view={view} />, { locale })

describe('the Menu source card, linked', () => {
  it('shows its venue in barsy read-only, its menu category and the price it shows', () => {
    card(linkedMenuSource())
    expect(screen.getByTestId('menu-source-venue').textContent).toBe('Main bar')
    // The venue is not a form field: it can only be changed through "Change…".
    expect(within(screen.getByTestId('menu-source')).queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Публично меню/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('radio', { name: /Base price/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(
      screen.getByText("Current price follows barsy's price rules for this venue."),
    ).toBeTruthy()
  })

  it('shows the venue’s own current price when that is what it saved', () => {
    card(linkedMenuSource({ priceSource: 'current_price' }))
    expect((screen.getByRole('radio', { name: /Current price/ }) as HTMLInputElement).checked).toBe(
      true,
    )
  })

  describe('"Change…" is deliberate (T62, CF-02)', () => {
    it('warns, offers the other venues of the till, and moves only after a confirmation', async () => {
      const user = userEvent.setup()
      actions.chooseTillVenueAction.mockResolvedValue({ ok: true })
      card(linkedMenuSource())
      await user.click(screen.getByRole('button', { name: 'Change…' }))

      const dialog = await screen.findByTestId('change-dialog')
      expect(within(dialog).getByTestId('change-warning').textContent).toContain(
        'Choosing another venue moves this venue to it. Items already read stay in the menu; the next full sync decides which of them still exist.',
      )
      // The venue it serves now is not offered; one that serves another venue is shown, not offered.
      const options = within(dialog).getAllByTestId('till-venue-option')
      expect(options.map((option) => option.textContent)).toEqual([
        'Roof terrace',
        'GardenUsed by Venue B',
        'ShopMarked as not used',
      ])
      expect(
        (within(options[1] as HTMLElement).getByRole('radio') as HTMLInputElement).disabled,
      ).toBe(true)
      expect(actions.chooseTillVenueAction).not.toHaveBeenCalled()

      const confirm = within(dialog).getByRole('button', { name: 'Change' }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      await user.click(within(dialog).getByRole('radio', { name: /Roof terrace/ }))
      await user.click(confirm)
      expect(actions.chooseTillVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, bid: 2 })
      await waitFor(() => expect(screen.queryByTestId('change-dialog')).toBeNull())
    })

    it('cancel closes it and changes nothing', async () => {
      const user = userEvent.setup()
      card(linkedMenuSource())
      await user.click(screen.getByRole('button', { name: 'Change…' }))
      const dialog = await screen.findByTestId('change-dialog')
      await user.click(within(dialog).getByRole('radio', { name: /Roof terrace/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByTestId('change-dialog')).toBeNull())
      expect(actions.chooseTillVenueAction).not.toHaveBeenCalled()
    })

    it('keeps the dialog open and says why when the move was refused', async () => {
      const user = userEvent.setup()
      actions.chooseTillVenueAction.mockResolvedValue({ ok: false, error: 'till_venue_taken' })
      card(linkedMenuSource())
      await user.click(screen.getByRole('button', { name: 'Change…' }))
      const dialog = await screen.findByTestId('change-dialog')
      await user.click(within(dialog).getByRole('radio', { name: /Roof terrace/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Change' }))
      expect((await within(dialog).findByRole('alert')).textContent).toBe(
        'That venue in the till already belongs to another venue.',
      )
    })
  })

  it('stores the menu category the manager picks', async () => {
    const user = userEvent.setup()
    actions.chooseCatalogueRootAction.mockResolvedValue({ ok: true })
    card(linkedMenuSource())
    await user.click(screen.getByRole('radio', { name: /Каса Kiosk/ }))
    expect(actions.chooseCatalogueRootAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      catId: 1091,
    })
  })

  it('saves the price for this venue only, and only after a change', async () => {
    const user = userEvent.setup()
    actions.saveVenuePriceAction.mockResolvedValue({ ok: true })
    card(linkedMenuSource())
    const save = screen.getByRole('button', { name: 'Save price' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)
    expect(actions.saveVenuePriceAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      priceSource: 'current_price',
    })
    expect(await screen.findByText('Saved. It applies from the next sync.')).toBeTruthy()
  })

  describe('"Sync this venue"', () => {
    it('presses it when the gate is open, and says it is queued', async () => {
      const user = userEvent.setup()
      actions.syncNowAction.mockResolvedValue({ ok: true })
      card(linkedMenuSource())
      const button = screen.getByRole('button', { name: 'Sync this venue' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(screen.queryByTestId('sync-blocked')).toBeNull()
      await user.click(button)
      expect(actions.syncNowAction).toHaveBeenCalledWith({ venueId: VENUE_ID })
      expect(await screen.findByText('The sync is queued.')).toBeTruthy()
    })

    it.each([
      ['not_manager', 'Only owners and admins can start a sync.'],
      ['no_credentials', 'Save the till credentials first.'],
      ['checking', 'The connection is being checked. Wait until it finishes.'],
      [
        'not_connected',
        'The connection to the till has to work first. See Settings → Integrations.',
      ],
      ['no_root', 'Choose the menu category first.'],
      ['busy', 'A sync is already queued or running.'],
    ] as [SyncBlock, string][])('is off for "%s" and says why', async (reason, text) => {
      const user = userEvent.setup()
      card(linkedMenuSource({ gate: { enabled: false, reason } }))
      const button = screen.getByRole('button', { name: 'Sync this venue' }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(screen.getByTestId('sync-blocked').textContent).toBe(text)
      await user.click(button)
      expect(actions.syncNowAction).not.toHaveBeenCalled()
    })

    it('shows when it last synced, in the venue’s time zone, or that it has not', () => {
      const { unmount } = card(linkedMenuSource())
      // 09:30 UTC is 12:30 in Sofia.
      expect(screen.getByTestId('sync-last').textContent).toMatch(/Last synced .*12:30/)
      unmount()
      card(linkedMenuSource({ lastSyncedAt: null }))
      expect(screen.getByTestId('sync-last').textContent).toBe('Not synced yet.')
    })

    it('shows why the press was refused', async () => {
      const user = userEvent.setup()
      actions.syncNowAction.mockResolvedValue({ ok: false, error: 'already_running' })
      card(linkedMenuSource())
      await user.click(screen.getByRole('button', { name: 'Sync this venue' }))
      expect((await screen.findByRole('alert')).textContent).toBe(
        'A sync is already queued or running.',
      )
    })
  })

  describe('a held full sync (CF-02: nothing was hidden)', () => {
    const held = (reason: 'empty_read' | 'too_many_missing', wouldHide: number, active: number) =>
      linkedMenuSource({
        heldSync: { reason, wouldHide, active, finishedAt: '2026-10-09T10:00:00.000Z' },
      })

    it('warns when the read found far fewer items than the menu has, with the numbers', () => {
      card(held('too_many_missing', 61, 65))
      const warning = screen.getByTestId('sync-held')
      expect(warning.getAttribute('data-reason')).toBe('too_many_missing')
      expect(warning.textContent).toContain('The last full sync was held back')
      expect(warning.textContent).toContain('it would have hidden 61 of 65 items.')
      expect(warning.textContent).toContain('Check the menu category and the venue in the till.')
      expect(within(warning).queryByRole('button')).toBeNull()
    })

    it('says the read found no items at all for an empty read', () => {
      card(held('empty_read', 1, 1))
      expect(screen.getByTestId('sync-held').textContent).toContain(
        'found no items at all and hid nothing',
      )
    })

    it('shows nothing when the latest complete full sync was not held', () => {
      card(linkedMenuSource())
      expect(screen.queryByTestId('sync-held')).toBeNull()
    })
  })

  it('is read-only for someone who cannot manage: what is set, nothing to press', () => {
    card(linkedMenuSource({ canManage: false, gate: { enabled: false, reason: 'not_manager' } }))
    expect(screen.getByTestId('read-only').textContent).toContain('Only owners and admins')
    expect(screen.getByTestId('menu-source-venue').textContent).toBe('Main bar')
    expect(screen.queryByRole('button', { name: 'Change…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save price' })).toBeNull()
    expect((screen.getByRole('radio', { name: /Каса Kiosk/ }) as HTMLInputElement).disabled).toBe(
      true,
    )
    expect(
      (screen.getByRole('button', { name: 'Sync this venue' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('speaks Bulgarian', () => {
    card(linkedMenuSource(), 'bg')
    expect(screen.getByRole('heading', { name: 'Източник на менюто' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Смени…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Синхронизирай това заведение' })).toBeTruthy()
    expect(
      screen.getByText('Текущата цена следва ценовите правила на barsy за това заведение.'),
    ).toBeTruthy()
  })
})

describe('the Menu source card, not linked', () => {
  const unlinked = (overrides: Partial<Extract<MenuSourceView, { state: 'unlinked' }>> = {}) =>
    ({
      state: 'unlinked',
      canManage: true,
      options: [
        { key: 2, name: 'Roof terrace', usedBy: null, notUsed: false, address: 'Sofia, Vitosha' },
        { key: 4, name: 'Shop', usedBy: null, notUsed: true },
      ],
      ...overrides,
    }) satisfies MenuSourceView

  it('offers "Link a barsy venue" with the venues that have none, and warns', async () => {
    const user = userEvent.setup()
    actions.chooseTillVenueAction.mockResolvedValue({ ok: true })
    card(unlinked())
    expect(screen.getByText('This venue is not linked to a venue in the till yet.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Link a barsy venue' })).toBeTruthy()
    const options = screen.getAllByTestId('till-venue-option')
    expect(options.map((option) => option.querySelector('.font-medium')?.textContent)).toEqual([
      'Roof terrace',
      'Shop',
    ])
    expect(screen.getByTestId('venue-address').textContent).toBe('Sofia, Vitosha')
    expect(screen.getByText(/Linking reads this venue's menu from the till/)).toBeTruthy()

    const link = screen.getByRole('button', { name: 'Link' }) as HTMLButtonElement
    expect(link.disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: /Roof terrace/ }))
    await user.click(link)
    expect(actions.chooseTillVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, bid: 2 })
  })

  it('says so when every venue in barsy is linked already', () => {
    card(unlinked({ options: [] }))
    expect(screen.getByTestId('link-none').textContent).toBe(
      'Every venue in the till is linked to a venue already.',
    )
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
  })

  it('shows the refusal', async () => {
    const user = userEvent.setup()
    actions.chooseTillVenueAction.mockResolvedValue({ ok: false, error: 'till_venue_taken' })
    card(unlinked())
    await user.click(screen.getByRole('radio', { name: /Roof terrace/ }))
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect((await screen.findByRole('alert')).textContent).toContain('already belongs')
  })

  it('is read-only for someone who cannot manage', () => {
    card(unlinked({ canManage: false }))
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
    expect(
      (screen.getByRole('radio', { name: /Roof terrace/ }) as HTMLInputElement).matches(
        ':disabled',
      ),
    ).toBe(true)
  })
})

describe('the Menu source card, with no integration', () => {
  it('says so and links to Settings → Integrations', () => {
    card({ state: 'no_integration', canManage: true })
    expect(screen.getByTestId('menu-source-none').textContent).toContain(
      'not connected to a till yet',
    )
    const link = screen.getByRole('link', { name: 'Open Settings → Integrations' })
    expect(link.getAttribute('href')).toBe('/settings/integrations')
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('speaks Bulgarian', () => {
    card({ state: 'no_integration', canManage: true }, 'bg')
    expect(screen.getByRole('link', { name: 'Отвори Настройки → Интеграции' })).toBeTruthy()
  })
})
