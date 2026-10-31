// @vitest-environment jsdom
// Restro's own pause (RR-58, D120): nobody at the venue can lift it, so only the Restro team's
// session sees its button, and tapping it lifts as the team. A staff pause keeps its own button.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PauseBanner, TonightView } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { PauseBanners } from './pause-banners'
import { RunProvider } from './run'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const liftRestroPauseAction = vi.hoisted(() => vi.fn())
const liftOrderingAction = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/actions', () => ({
  liftOrderingAction,
  liftRestroPauseAction,
  pauseOrderingAction: vi.fn(),
}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const restro: PauseBanner = {
  id: 'pa_restro',
  kind: 'restro',
  barId: null,
  barName: null,
  who: null,
  at: '21:10',
}

function draw(over: Partial<TonightView>) {
  const view = {
    venueId: VENUE,
    source: 'Mistral',
    device: false,
    operator: false,
    paying: null,
    banners: [restro],
    can: { lift: true },
    ...over,
  } as unknown as TonightView
  renderWithIntl(
    <RunProvider>
      <PauseBanners view={view} />
    </RunProvider>,
  )
}

describe('the banner of a Restro pause', () => {
  beforeEach(() => {
    toast.mockClear()
    liftRestroPauseAction.mockReset()
    liftOrderingAction.mockReset()
  })

  it('has no button for anyone at the venue, a manager who may lift a pause included', () => {
    draw({})
    expect(screen.getByTestId('pause-banner').getAttribute('data-kind')).toBe('restro')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('lifts for the Restro team, as the team, with no Undo', async () => {
    liftRestroPauseAction.mockResolvedValue({ ok: true, details: { lifted: true } })
    draw({ operator: true })
    await userEvent.click(screen.getByRole('button', { name: 'Resume ordering' }))
    await waitFor(() =>
      expect(liftRestroPauseAction).toHaveBeenCalledWith({ venueId: VENUE, pauseId: 'pa_restro' }),
    )
    expect(liftOrderingAction).not.toHaveBeenCalled()
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0]?.[1]).not.toHaveProperty('action')
  })
})
