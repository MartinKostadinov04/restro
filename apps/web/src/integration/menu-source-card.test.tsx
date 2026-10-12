// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { barsyVenueSource, linkedMenuSource, run, VENUE_ID } from '@/connectors/test-view'
import type { MenuSourceView, SyncBlock } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { MenuSourceCard } from './menu-source-card'

const actions = vi.hoisted(() => ({
  saveVenueSourceAction: vi.fn(),
  syncNowAction: vi.fn(),
}))
vi.mock('@/server/integration/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
})

const card = (view: MenuSourceView, locale: 'en' | 'bg' = 'en') =>
  renderWithIntl(<MenuSourceCard venueId={VENUE_ID} view={view} />, { locale })

describe('the Menu source card of a venue made by hand', () => {
  it('shows neither part: no card at all', () => {
    const { container } = card({ state: 'none' })
    expect(container.innerHTML).toBe('')
    expect(screen.queryByTestId('menu-source')).toBeNull()
  })
})

describe('the Menu source card of a POS venue: the common part', () => {
  it('names the instance and the venue in the system, read-only (a source never changes, D87)', () => {
    card(linkedMenuSource())
    expect(screen.getByRole('heading', { name: 'Menu source' })).toBeTruthy()
    expect(screen.getByTestId('menu-source-instance').textContent).toBe('barsy – Sofia')
    expect(screen.getByTestId('menu-source-venue').textContent).toBe('Main bar')
    expect(screen.getByText('Venue in barsy')).toBeTruthy()
    // Nothing to change it with: no "Change…", no picker, no category tree.
    const root = screen.getByTestId('menu-source')
    expect(within(root).queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Change|Link/ })).toBeNull()
    expect(screen.queryByTestId('catalogue-tree')).toBeNull()
    expect(screen.queryByText(/Menu category/)).toBeNull()
  })

  it('uses the system’s name where the card names it', () => {
    card(linkedMenuSource({ source: 'Another POS' }))
    expect(screen.getByText('Venue in Another POS')).toBeTruthy()
    expect(screen.getByText(/the Another POS connection and the venue in it/)).toBeTruthy()
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
      ['no_credentials', 'Save the barsy credentials first, in Settings → Integrations.'],
      ['checking', 'The connection is being checked. Wait until it finishes.'],
      ['not_connected', 'The connection to barsy has to work first. See Settings → Integrations.'],
      [
        'no_menu',
        'barsy has not reported the menus of this venue yet. Check the connection again.',
      ],
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
      expect(warning.textContent).toContain('Check the venue and its menus in barsy.')
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

  describe('the venue’s own history, collapsed', () => {
    it('says there is no sync yet', () => {
      card(linkedMenuSource())
      expect(screen.getByTestId('history-empty').textContent).toContain('No sync yet')
    })

    it('shows the last run on one line and opens the list under a button, without a venue column', async () => {
      const user = userEvent.setup()
      card(linkedMenuSource({ runs: [run({ id: 'jb_a' }), run({ id: 'jb_b' })] }))
      expect(screen.getByTestId('history-last').textContent).toMatch(/^Last run: Full sync/)
      expect(screen.queryAllByTestId('run-row')).toHaveLength(0)
      await user.click(screen.getByTestId('history-toggle'))
      expect(screen.getAllByTestId('run-row')).toHaveLength(2)
      expect(screen.queryByTestId('run-venue')).toBeNull()
    })
  })

  it('is read-only for someone who cannot manage: what is set, nothing to press', () => {
    card(linkedMenuSource({ canManage: false, gate: { enabled: false, reason: 'not_manager' } }))
    expect(screen.getByTestId('read-only').textContent).toContain('Only owners and admins')
    expect(screen.getByTestId('menu-source-venue').textContent).toBe('Main bar')
    expect(screen.queryByRole('button', { name: 'Save price' })).toBeNull()
    expect(screen.getByRole('radio', { name: /Base price/ }).matches(':disabled')).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Sync this venue' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('speaks Bulgarian', () => {
    card(linkedMenuSource(), 'bg')
    expect(screen.getByRole('heading', { name: 'Източник на менюто' })).toBeTruthy()
    expect(screen.getByText('Заведение в barsy')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Синхронизирай това заведение' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Базова цена/ })).toBeTruthy()
  })
})

describe('the Menu source card of a POS venue: the connector’s part (barsy: the price shown)', () => {
  it('shows the price the venue shows, Base by default', () => {
    card(linkedMenuSource())
    expect(screen.getByText('Price shown')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Base price/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(screen.getByText('(default)')).toBeTruthy()
    expect(screen.queryByTestId('price-warning')).toBeNull()
  })

  it('shows the venue’s own current price when that is what it saved, with the warning', () => {
    card(linkedMenuSource({ connector: barsyVenueSource({ priceSource: 'current_price' }) }))
    expect((screen.getByRole('radio', { name: /Current price/ }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect(screen.getByTestId('price-warning').textContent).toContain(
      'Time-based rules, such as a happy hour, may show late in the menu until Lukanet confirms',
    )
  })

  it('warns as soon as Current price is picked, before it is saved', async () => {
    const user = userEvent.setup()
    card(linkedMenuSource())
    expect(screen.queryByTestId('price-warning')).toBeNull()
    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    expect(screen.getByTestId('price-warning')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /Base price/ }))
    expect(screen.queryByTestId('price-warning')).toBeNull()
  })

  it('saves the price for this venue only, through the generic action, and only after a change', async () => {
    const user = userEvent.setup()
    actions.saveVenueSourceAction.mockResolvedValue({ ok: true })
    card(linkedMenuSource())
    const save = screen.getByRole('button', { name: 'Save price' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    expect(save.disabled).toBe(false)
    await user.click(save)
    expect(actions.saveVenueSourceAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      settings: { priceSource: 'current_price' },
    })
    expect(await screen.findByText('Saved. It applies from the next sync.')).toBeTruthy()
  })

  it('shows a refusal from the server', async () => {
    const user = userEvent.setup()
    actions.saveVenueSourceAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    card(linkedMenuSource())
    await user.click(screen.getByRole('radio', { name: /Current price/ }))
    await user.click(screen.getByRole('button', { name: 'Save price' }))
    expect((await screen.findByTestId('integration-error')).textContent).toBe(
      'Only owners and admins can do this.',
    )
  })

  it('is not drawn for a kind of connector that supplies no part', () => {
    card(
      linkedMenuSource({
        source: 'Another POS',
        // A connector this build does not know supplies nothing, and the common part still shows.
        connector: { kind: 'unknown' } as never,
      }),
    )
    expect(screen.queryByText('Price shown')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sync this venue' })).toBeTruthy()
  })
})
