// @vitest-environment jsdom
// The warnings under the venue header (D97): only what applies (D96): a held publish per menu,
// the pause after a return with "Resume", and the address switched off.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MenuPublishState, VenuePublishState } from '@/server/publish/summary'
import { renderWithIntl } from '@/test-utils'
import { PublisherProvider } from './publisher-context'
import { barMenu, VENUE_ID } from './test-view'
import { VenueWarnings } from './venue-warnings'

const summary = vi.hoisted(() => ({ venuePublishState: vi.fn() }))
vi.mock('@/server/publish/summary', () => summary)
const actions = vi.hoisted(() => ({
  approveHeldAction: vi.fn(),
  rejectHeldAction: vi.fn(),
  publishNowAction: vi.fn(),
  resumeAutoPublishAction: vi.fn(),
}))
vi.mock('@/server/publish/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  summary.venuePublishState.mockReset()
  for (const action of Object.values(actions)) {
    action.mockReset()
    action.mockResolvedValue({ ok: true, queued: false })
  }
})

const menu = (overrides: Partial<MenuPublishState> = {}): MenuPublishState => ({
  ...barMenu(),
  held: null,
  ...overrides,
})
const held = {
  snapshotId: 'sn_held1',
  hidden: 3,
  previouslyVisible: 5,
  percent: 60,
  items: [],
  at: '2026-10-09T10:00:00.000Z',
  outdated: false,
}

async function render(state: Partial<VenuePublishState>, canPublish = true) {
  summary.venuePublishState.mockResolvedValue({
    venueId: VENUE_ID,
    menus: [menu()],
    paused: false,
    addressServed: true,
    lastRun: null,
    ...state,
  })
  const ui = await VenueWarnings({ tenantId: 'tn_demo', venueId: VENUE_ID, canPublish })
  renderWithIntl(
    <PublisherProvider venueId={VENUE_ID} state={{ lastRun: null, busy: null }}>
      {ui}
    </PublisherProvider>,
  )
}

describe('the warnings under the venue header', () => {
  it('shows nothing when nothing needs action', async () => {
    await render({})
    expect(screen.queryByTestId('venue-warnings')).toBeNull()
    expect(summary.venuePublishState).toHaveBeenCalledWith('tn_demo', VENUE_ID)
  })

  it('shows a held publish with Approve and Reject, naming the menu when there are several', async () => {
    await render({
      menus: [menu(), menu({ menuId: 'nd_brunch', name: 'Brunch', live: false, held })],
    })
    const banner = screen.getByTestId('held-banner')
    expect(banner.textContent).toContain('Brunch')
    expect(banner.getAttribute('data-menu')).toBe('nd_brunch')
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeTruthy()
  })

  it('shows the pause after a return, and Resume lifts it without publishing', async () => {
    const user = userEvent.setup()
    await render({ paused: true })
    expect(screen.getByTestId('paused-banner').textContent).toContain(
      'Automatic publishing is paused because you returned to an older version.',
    )
    await user.click(screen.getByTestId('paused-resume'))
    expect(actions.resumeAutoPublishAction).toHaveBeenCalledWith(VENUE_ID)
    expect(actions.publishNowAction).not.toHaveBeenCalled()
  })

  it('offers no Resume to anyone who may not publish', async () => {
    await render({ paused: true }, false)
    expect(screen.getByTestId('paused-banner')).toBeTruthy()
    expect(screen.queryByTestId('paused-resume')).toBeNull()
  })

  it('says the address is switched off and that a publish puts it back (D86)', async () => {
    await render({ addressServed: false })
    expect(screen.getByTestId('address-off-banner').textContent).toContain(
      'The menu address is switched off. Publish to put it back.',
    )
  })
})
