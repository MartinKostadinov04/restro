// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { LiveCard } from './live-card'
import { NO_CHANGES, publishView, readyDraft } from './test-view'

describe('the Live card', () => {
  it('shows the live version, when, by whom and why, and links to the guest page', () => {
    renderWithIntl(<LiveCard view={publishView()} busy={false} onPublish={vi.fn()} />)
    expect(screen.getByTestId('live-version-number').textContent).toBe('Version 2')
    expect(screen.getByText('Live')).toBeTruthy()
    // 09:30 UTC is 12:30 in Sofia.
    expect(screen.getByTestId('live-meta').textContent).toMatch(
      /^Published by hand, .*12:30, by Maria Ivanova$/,
    )
    const link = screen.getByRole('link', { name: /Open the guest page/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/m/demo-club')
    expect(link.target).toBe('_blank')
    expect(screen.queryByTestId('live-nothing')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('names the sync and the system, and a person we no longer know', () => {
    const base = publishView().live
    if (base === null) throw new Error('the test view has a live version')
    const cases = [
      [{ kind: 'sync' as const }, 'by barsy sync'],
      [{ kind: 'system' as const }, 'by the system'],
      [{ kind: 'person' as const, name: null }, 'by a team member'],
    ] as const
    for (const [actor, text] of cases) {
      const { unmount } = renderWithIntl(
        <LiveCard
          view={publishView({ live: { ...base, reason: 'auto_sync', actor } })}
          busy={false}
          onPublish={vi.fn()}
        />,
      )
      expect(screen.getByTestId('live-meta').textContent).toMatch(
        new RegExp(`^Published automatically after a sync, .*, ${text}$`),
      )
      unmount()
    }
  })

  it('says who returned the menu to this version, and when', () => {
    const base = publishView().live
    if (base === null) throw new Error('the test view has a live version')
    renderWithIntl(
      <LiveCard
        view={publishView({
          live: {
            ...base,
            returned: { at: '2026-10-10T07:15:00.000Z', actor: { kind: 'person', name: 'Ivan' } },
          },
        })}
        busy={false}
        onPublish={vi.fn()}
      />,
    )
    expect(screen.getByTestId('live-returned').textContent).toMatch(
      /^Returned to this version on .*10:15 by Ivan\.$/,
    )
  })

  it('before the first publish says so, counts what is ready, and offers Publish', async () => {
    const user = userEvent.setup()
    const onPublish = vi.fn()
    const added = [1, 2, 3].map((n) => ({ id: `nd_${n}`, name: { en_US: `Drink ${n}` } }))
    renderWithIntl(
      <LiveCard
        view={publishView({
          live: null,
          draft: readyDraft({ ...NO_CHANGES, identical: false, total: 3, added }),
        })}
        busy={false}
        onPublish={onPublish}
      />,
    )
    expect(screen.getByText('Nothing published yet')).toBeTruthy()
    expect(screen.getByText(/3 items are ready/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /guest page/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(onPublish).toHaveBeenCalledTimes(1)
  })

  it('before the first publish, with nothing to show, offers no Publish', () => {
    renderWithIntl(
      <LiveCard
        view={publishView({ live: null, draft: { state: 'nothing_visible' } })}
        busy={false}
        onPublish={vi.fn()}
      />,
    )
    expect(screen.getByText('Nothing published yet')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<LiveCard view={publishView()} busy={false} onPublish={vi.fn()} />, {
      locale: 'bg',
    })
    expect(screen.getByTestId('live-version-number').textContent).toBe('Версия 2')
    expect(screen.getByText('На живо')).toBeTruthy()
    expect(screen.getByTestId('live-meta').textContent).toMatch(/^Публикувана ръчно, .*, от Maria/)
  })
})
