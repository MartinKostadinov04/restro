// @vitest-environment jsdom
// Settings › Publish = the Automation settings (D82, D96): the sync mode with its schedule in the
// venue's time zone, publish after a sync, inherited values, saving, and who may change them.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AutomationView } from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { AutomationSettings } from './automation-settings'
import { VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({ saveAutomationAction: vi.fn() }))
vi.mock('@/server/publish/actions', () => actions)

beforeEach(() => {
  actions.saveAutomationAction.mockReset()
  actions.saveAutomationAction.mockResolvedValue({ ok: true, queued: true })
})

const own: AutomationView = {
  source: 'TillOne',
  timeZone: 'Europe/Sofia',
  sync: { mode: 'auto', incremental_minutes: 5, full_pull_time: '12:00' },
  syncInherited: false,
  afterSync: 'auto',
  afterSyncInherited: false,
}

const render = (view: AutomationView = own, canManage = true, locale?: 'bg') =>
  renderWithIntl(
    <AutomationSettings venueId={VENUE_ID} canManage={canManage} view={view} />,
    locale === undefined ? {} : { locale },
  )

const save = () => screen.getByTestId('automation-save') as HTMLButtonElement
const radio = (id: string) => screen.getByTestId(id) as HTMLInputElement

describe('the Automation settings', () => {
  it('shows the sync mode with its schedule in the venue’s time zone, and the rule after a sync, naming the POS', () => {
    render()
    expect(screen.getByText('Reading the menu from TillOne')).toBeTruthy()
    expect(radio('automation-sync-auto').checked).toBe(true)
    expect((screen.getByTestId('automation-time') as HTMLInputElement).value).toBe('12:00')
    expect(screen.getByTestId('automation-zone').textContent).toBe('Europe/Sofia')
    expect(screen.getByTestId('automation-interval').textContent).toContain('5 minutes')
    expect(radio('automation-after-auto').checked).toBe(true)
    // D96: no "new items from the till" rule any more.
    expect(screen.queryByText(/New items/)).toBeNull()
    expect(screen.queryByTestId('automation-inherited')).toBeNull()
  })

  it('saves nothing until something changes, then sends the mode, the schedule and the rule', async () => {
    const user = userEvent.setup()
    render()
    expect(save().disabled).toBe(true)
    await user.clear(screen.getByTestId('automation-time'))
    await user.type(screen.getByTestId('automation-time'), '06:30')
    await user.click(radio('automation-after-manual'))
    expect(save().disabled).toBe(false)
    await user.click(save())
    expect(actions.saveAutomationAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      sync: { mode: 'auto', incremental_minutes: 5, full_pull_time: '06:30' },
      afterSync: 'manual',
    })
    expect((await screen.findByTestId('automation-saved')).textContent).toBe(
      'Saved. The settings apply from the next sync of this venue.',
    )
  })

  it('manual mode hides the schedule and keeps it for later', async () => {
    const user = userEvent.setup()
    render()
    await user.click(radio('automation-sync-manual'))
    expect(screen.queryByTestId('automation-time')).toBeNull()
    await user.click(save())
    expect(actions.saveAutomationAction).toHaveBeenCalledWith({
      venueId: VENUE_ID,
      sync: { mode: 'manual', incremental_minutes: 5, full_pull_time: '12:00' },
      afterSync: 'auto',
    })
  })

  it('says when the values are still the connection’s, and saving them makes them the venue’s', async () => {
    const user = userEvent.setup()
    render({ ...own, syncInherited: true })
    expect(screen.getByTestId('automation-inherited').textContent).toContain(
      'before they moved to the venue',
    )
    expect(save().disabled).toBe(false)
    await user.click(save())
    expect(actions.saveAutomationAction).toHaveBeenCalledTimes(1)
  })

  it('says why a save did not work', async () => {
    const user = userEvent.setup()
    actions.saveAutomationAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    render({ ...own, afterSyncInherited: true })
    await user.click(save())
    expect((await screen.findByTestId('automation-error')).textContent).toBe(
      'Only an owner or admin can do that.',
    )
  })

  it('shows what is set but no Save to anyone who may not change it', () => {
    render(own, false)
    expect(screen.queryByTestId('automation-save')).toBeNull()
    expect(radio('automation-sync-auto').disabled).toBe(true)
  })

  it('speaks Bulgarian', () => {
    render(own, true, 'bg')
    expect(screen.getByText('Четене на менюто от TillOne')).toBeTruthy()
    expect(screen.getByText('Публикувай автоматично')).toBeTruthy()
  })
})
