// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SyncSettingsView } from '@/server/integration/view'
import { renderWithIntl } from '@/test-utils'
import { SyncSettingsForm } from './sync-settings-form'
import { integrationView, VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ saveSyncSettingsAction: vi.fn() }))
vi.mock('@/server/integration/actions', () => actions)

beforeEach(() => {
  actions.saveSyncSettingsAction.mockReset()
})

const withSettings = (patch: Partial<SyncSettingsView>) => {
  const base = integrationView()
  return integrationView({ syncSettings: { ...base.syncSettings, ...patch } })
}
const saveButton = () => screen.getByRole('button', { name: 'Save automatic sync' })
const interval = () => screen.getByRole('combobox', { name: 'Check every' })
const time = () => screen.getByLabelText('Time of day') as HTMLInputElement
const check = () => screen.getByRole('switch', { name: 'Check for changes automatically' })
const full = () => screen.getByRole('switch', { name: 'Read the whole catalogue once a day' })

describe('the sync settings form', () => {
  it('shows what is saved: the defaults, with a one-line explanation for each control', () => {
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    expect(check().getAttribute('aria-checked')).toBe('true')
    expect(interval().textContent).toBe('5 minutes')
    expect(full().getAttribute('aria-checked')).toBe('true')
    expect(time().value).toBe('12:00')
    expect(screen.getByRole('radio', { name: /Publish automatically/ })).toHaveProperty(
      'checked',
      true,
    )
    expect(screen.getByRole('radio', { name: /Show them on the menu/ })).toHaveProperty(
      'checked',
      true,
    )
    for (const help of [
      'Reads only what changed in barsy since the last check.',
      'Also notices what was deleted in barsy. Best at a quiet hour.',
      'Venue time (Europe/Sofia).',
      'Guests see changes from barsy within about a minute.',
      'Changes from barsy wait until you publish them in the Publishing tab.',
      'A new item is on the menu with the next publish.',
      'New items stay hidden in the composer until you show them.',
    ]) {
      expect(screen.getByText(help), help).toBeTruthy()
    }
  })

  it('says when the next syncs are planned, in the venue’s clock', () => {
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    // 09:35 UTC is 12:35 in Sofia (summer time); the full read is at noon on the 10th.
    expect(screen.getByTestId('sync-next').textContent).toBe(
      'Next change check about 12:35. Next full read Oct 10, 12:00.',
    )
  })

  it.each([
    [{ nextFullPullAt: null, fullPullEnabled: false }, 'Next change check about 12:35.'],
    [{ nextIncrementalAt: null, incrementalEnabled: false }, 'Next full read Oct 10, 12:00.'],
    [
      {
        nextIncrementalAt: null,
        nextFullPullAt: null,
        incrementalEnabled: false,
        fullPullEnabled: false,
      },
      'Automatic syncing is switched off.',
    ],
    [
      { scheduleActive: false, nextIncrementalAt: null, nextFullPullAt: null },
      'Automatic syncing starts once the connection works and the catalogue is chosen.',
    ],
  ] as [Partial<SyncSettingsView>, string][])('names only what is planned: %j', (patch, text) => {
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={withSettings(patch)} />)
    expect(screen.getByTestId('sync-next').textContent).toBe(text)
  })

  it('saves nothing until something changes, then sends every setting whole', async () => {
    const user = userEvent.setup()
    actions.saveSyncSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    await user.click(interval())
    await user.click(await screen.findByRole('option', { name: '15 minutes' }))
    fireEvent.change(time(), { target: { value: '04:30' } })
    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(screen.getByRole('radio', { name: /Keep them hidden until I review them/ }))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    await user.click(saveButton())

    expect(actions.saveSyncSettingsAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      schedule: {
        incremental_enabled: true,
        incremental_minutes: 15,
        full_pull_enabled: true,
        full_pull_time: '04:30',
      },
      publish: { after_sync: 'manual', new_items: 'hold' },
    })
    expect(await screen.findByText('Saved. It applies from the next minute.')).toBeTruthy()
  })

  it('switches each loop off on its own, and closes its interval or time with it', async () => {
    const user = userEvent.setup()
    actions.saveSyncSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    await user.click(check())
    expect(interval().hasAttribute('disabled')).toBe(true)
    expect(time().disabled).toBe(false)
    await user.click(full())
    expect(time().disabled).toBe(true)
    await user.click(saveButton())
    expect(actions.saveSyncSettingsAction).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: expect.objectContaining({
          incremental_enabled: false,
          incremental_minutes: 5,
          full_pull_enabled: false,
          full_pull_time: '12:00',
        }),
      }),
    )
  })

  it('does not offer to save a time of day that is not one', () => {
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    fireEvent.change(time(), { target: { value: '' } })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(time().getAttribute('aria-invalid')).toBe('true')
  })

  it('shows why a save was refused', async () => {
    const user = userEvent.setup()
    actions.saveSyncSettingsAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Only owners and admins can do this.',
    )
    expect(screen.queryByText('Saved. It applies from the next minute.')).toBeNull()
  })

  it('takes the "saved" notice away at the next change', async () => {
    const user = userEvent.setup()
    actions.saveSyncSettingsAction.mockResolvedValue({ ok: true })
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />)
    await user.click(screen.getByRole('radio', { name: /Wait until I press Publish/ }))
    await user.click(saveButton())
    expect(await screen.findByText('Saved. It applies from the next minute.')).toBeTruthy()
    await user.click(screen.getByRole('radio', { name: /Publish automatically/ }))
    expect(screen.queryByText('Saved. It applies from the next minute.')).toBeNull()
  })

  it('is read-only for everyone but owners and admins', () => {
    renderWithIntl(
      <SyncSettingsForm venueId={VENUE_ID} view={integrationView({ canManage: false })} />,
    )
    expect(screen.queryByRole('button', { name: 'Save automatic sync' })).toBeNull()
    expect(interval().hasAttribute('disabled')).toBe(true)
    expect(time().disabled).toBe(true)
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLInputElement).disabled).toBe(true)
    }
    expect(check().hasAttribute('disabled')).toBe(true)
    expect(full().hasAttribute('disabled')).toBe(true)
    // The saved values are still shown.
    expect(time().value).toBe('12:00')
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<SyncSettingsForm venueId={VENUE_ID} view={integrationView()} />, {
      locale: 'bg',
    })
    expect(screen.getByRole('switch', { name: 'Проверявай за промени автоматично' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Запази автоматичната синхронизация' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Публикувай автоматично/ })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Проверявай на всеки' }).textContent).toBe(
      '5 минути',
    )
  })
})
