// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { HeldView } from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { HELD_NAMES_SHOWN, HeldBanner } from './held-banner'
import { publishView } from './test-view'

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
  options: { canPublish?: boolean; busy?: boolean } = {},
  handlers = { onApprove: vi.fn(), onReject: vi.fn(), onPublish: vi.fn() },
) {
  renderWithIntl(
    <HeldBanner
      held={banner}
      view={publishView({ canPublish: options.canPublish ?? true, held: banner })}
      busy={options.busy ?? false}
      {...handlers}
    />,
  )
  return handlers
}

describe('the held-publish banner (V11)', () => {
  it('says how many items an automatic publish would hide, which, and offers Approve and Reject', async () => {
    const user = userEvent.setup()
    const handlers = render(held())
    expect(
      screen.getByText('An automatic publish was held: it would hide 3 of 5 items (60%)'),
    ).toBeTruthy()
    expect(screen.getByTestId('held-items').textContent).toBe(
      'Would be hiddenMojito, Spritz, Negroni',
    )

    await user.click(screen.getByRole('button', { name: 'Approve and publish' }))
    expect(handlers.onApprove).toHaveBeenCalledWith('sn_held1')
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(handlers.onReject).toHaveBeenCalledWith('sn_held1')
    expect(handlers.onPublish).not.toHaveBeenCalled()
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

  it('when the menu has changed since the hold, says so and offers a plain Publish instead of Approve', async () => {
    const user = userEvent.setup()
    const handlers = render(held({ outdated: true }))
    expect(screen.getByText(/The menu has changed since this publish was held/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Publish the menu as it is now' }))
    expect(handlers.onPublish).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Reject' }))
    expect(handlers.onReject).toHaveBeenCalledWith('sn_held1')
  })

  it('stops the buttons while something is already happening', () => {
    render(held(), { busy: true })
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
    renderWithIntl(
      <HeldBanner
        held={held()}
        view={publishView({ held: held() })}
        busy={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onPublish={vi.fn()}
      />,
      { locale: 'bg' },
    )
    expect(
      screen.getByText('Автоматична публикация е задържана: щеше да скрие 3 от 5 артикула (60%)'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Одобри и публикувай' })).toBeTruthy()
  })
})
