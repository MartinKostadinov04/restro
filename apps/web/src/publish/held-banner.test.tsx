// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BusyView, HeldView } from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { HELD_NAMES_SHOWN, HeldBanner } from './held-banner'
import { PublisherProvider } from './publisher-context'
import { VENUE_ID } from './test-view'

const actions = vi.hoisted(() => ({
  approveHeldAction: vi.fn(),
  rejectHeldAction: vi.fn(),
  publishNowAction: vi.fn(),
}))
vi.mock('@/server/publish/actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) {
    action.mockReset()
    action.mockResolvedValue({ ok: true, queued: true })
  }
})

const MENU = 'nd_heldMenuForTests'
const names = ['Mojito', 'Spritz', 'Negroni']
const held = (overrides: Partial<HeldView> = {}): HeldView => ({
  snapshotId: 'sn_held1',
  hidden: 3,
  previouslyVisible: 5,
  percent: 60,
  items: names.map((name, index) => ({ id: `nd_${index}`, name: { en_US: name } })),
  at: '2026-10-09T10:00:00.000Z',
  outdated: false,
  ...overrides,
})

function render(
  banner: HeldView,
  options: { canPublish?: boolean; busy?: BusyView; menu?: string | null; locale?: 'bg' } = {},
) {
  renderWithIntl(
    <PublisherProvider venueId={VENUE_ID} state={{ lastRun: null, busy: options.busy ?? null }}>
      <HeldBanner
        held={banner}
        menuId={MENU}
        menu={options.menu ?? null}
        canPublish={options.canPublish ?? true}
        canPublishNow
      />
    </PublisherProvider>,
    options.locale === undefined ? {} : { locale: options.locale },
  )
}

describe('the held-publish banner (V11)', () => {
  it('says how many items an automatic publish would hide, which, and offers Approve and Reject', async () => {
    const user = userEvent.setup()
    render(held())
    expect(
      screen.getByText('An automatic publish was held: it would hide 3 of 5 items (60%)'),
    ).toBeTruthy()
    expect(screen.getByTestId('held-items').textContent).toBe(
      'Would be hiddenMojito, Negroni, Spritz',
    )

    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(actions.approveHeldAction).toHaveBeenCalledWith(VENUE_ID, 'sn_held1')
    expect(actions.publishNowAction).not.toHaveBeenCalled()
  })

  it('Reject turns the hold down', async () => {
    const user = userEvent.setup()
    render(held())
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(actions.rejectHeldAction).toHaveBeenCalledWith(VENUE_ID, 'sn_held1')
  })

  it('names the first few and counts the rest, from the whole count', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `nd_${index}`,
      name: { en_US: `Drink ${index}` },
    }))
    render(held({ hidden: 12, previouslyVisible: 20, percent: 60, items: many }))
    const text = screen.getByTestId('held-items').textContent ?? ''
    expect(text).toContain('Drink 0')
    expect(text).toContain(`Drink ${HELD_NAMES_SHOWN - 1}`)
    expect(text).not.toContain(`Drink ${HELD_NAMES_SHOWN},`)
    expect(text).toContain(`and ${12 - HELD_NAMES_SHOWN} more`)
  })

  it('counts the items even when their names are no longer known', () => {
    render(held({ items: [] }))
    expect(screen.queryByTestId('held-items')).toBeNull()
    expect(screen.getByText(/would hide 3 of 5 items/)).toBeTruthy()
  })

  it('when the menu has changed since the hold, offers to publish that menu as it is now instead of Approve', async () => {
    const user = userEvent.setup()
    render(held({ outdated: true }))
    expect(screen.getByText(/The menu has changed since this publish was held/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Publish the menu as it is now' }))
    expect(actions.publishNowAction).toHaveBeenCalledWith(VENUE_ID, MENU)
  })

  it('names the menu when the venue has several', () => {
    render(held(), { menu: 'Terrace' })
    expect(screen.getByTestId('held-banner').textContent).toContain('Terrace')
    expect(screen.getByTestId('held-banner').getAttribute('data-menu')).toBe(MENU)
  })

  it('stops the buttons while something is already happening', () => {
    render(held(), { busy: 'publish' })
    expect(
      (screen.getByRole('button', { name: 'Approve and publish' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('shows the facts but no buttons to anyone who may not decide', () => {
    render(held(), { canPublish: false })
    expect(screen.getByText(/would hide 3 of 5 items/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('speaks Bulgarian', () => {
    render(held(), { locale: 'bg' })
    expect(
      screen.getByText('Автоматична публикация е задържана: щеше да скрие 3 от 5 артикула (60%)'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Одобри и публикувай' })).toBeTruthy()
  })
})
