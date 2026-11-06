// @vitest-environment jsdom
// Tonight's "Needs you" block when nothing waits (RR-O33): a venue with tables nobody has opened is
// told to open them, with the button; a venue with no tables at all is told where to add them, in
// its own line, with no button to a thing that cannot be done.
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { TonightView } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { TonightPanel } from './tonight-panel'

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  unstable_rethrow: vi.fn(),
}))
vi.mock('@/server/tonight/actions', () => ({}))
vi.mock('@/server/tonight/tables', () => ({}))
vi.mock('@/server/tonight/payment-actions', () => ({}))
vi.mock('@/server/tonight/night-actions', () => ({}))

const draw = (over: Partial<TonightView>) =>
  renderWithIntl(
    <TonightPanel
      view={
        {
          venueId: 'vn_0123456789ABCDEFGHIJKL',
          source: 'Mistral',
          currency: 'EUR',
          provider: null,
          device: false,
          operator: false,
          can: { openClose: true, resume: true, pause: true, lift: true },
          banners: [],
          paying: null,
          rows: [],
          outOfStock: [],
          groups: [],
          openCount: 0,
          tableCount: 0,
          pausableBars: [],
          canPauseAll: false,
          now: '2026-11-06T20:00:00.000Z',
          timezone: 'Europe/Sofia',
          ...over,
        } as unknown as TonightView
      }
    />,
  )

describe('Tonight with nothing waiting', () => {
  it('tells a venue with no tables where to add them, and offers no Open all', () => {
    draw({})
    expect(screen.getByText('There are no tables yet')).toBeTruthy()
    expect(screen.queryByText("Tables aren't open yet")).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open all' })).toBeNull()
  })
})
