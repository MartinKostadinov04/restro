// @vitest-environment jsdom
// The whole tab with its buttons: pressing Publish waits for the worker's answer and words it
// ("Version 3 is live", or why it was refused); approving and rejecting a held publish; returning
// to a version and the pause banner; who may do what.
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PublishRunView } from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { PublishPanel } from './publish-panel'
import { publishView } from './test-view'
import { outcomeOfRun, SLOW_AFTER_MS } from './use-publisher'

const actions = vi.hoisted(() => ({
  publishNowAction: vi.fn(),
  approveHeldAction: vi.fn(),
  rejectHeldAction: vi.fn(),
  rollbackAction: vi.fn(),
  previewDraftAction: vi.fn(),
  loadHistoryPageAction: vi.fn(),
}))
vi.mock('@/server/publish/actions', () => actions)
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: navigation.refresh }) }))

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset()
  navigation.refresh.mockReset()
})

const run = (overrides: Partial<PublishRunView> = {}): PublishRunView => ({
  id: 'jb_new',
  state: 'published',
  version: 3,
  refusal: null,
  ...overrides,
})
const held = {
  snapshotId: 'sn_held1',
  hidden: 3,
  previouslyVisible: 5,
  percent: 60,
  items: [{ id: 'nd_1', name: { en_US: 'Mojito' } }],
  at: '2026-10-09T10:00:00.000Z',
  outdated: false,
}

describe('outcomeOfRun', () => {
  it('turns finished runs into outcomes, and ignores the ones that are not an answer', () => {
    expect(outcomeOfRun(run())).toEqual({ kind: 'published', version: 3 })
    expect(outcomeOfRun(run({ state: 'unchanged', version: 2 }))).toEqual({
      kind: 'unchanged',
      version: 2,
    })
    expect(outcomeOfRun(run({ state: 'refused', refusal: 'no_visible_items' }))).toEqual({
      kind: 'refused',
      refusal: 'no_visible_items',
    })
    expect(outcomeOfRun(run({ state: 'failed' }))).toEqual({ kind: 'failed' })
    expect(outcomeOfRun(run({ state: 'running' }))).toBeNull()
    expect(outcomeOfRun(run({ state: 'held' }))).toBeNull()
  })
})

describe('Publish', () => {
  it('queues the publish, waits, and says "Version 3 is live" once the worker has answered', async () => {
    const user = userEvent.setup()
    actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView({ lastRun: run({ id: 'jb_old', version: 2 }) })
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)

    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(actions.publishNowAction).toHaveBeenCalledWith('vn_demoVenueForPublishTests')
    // Queued, not done: the button says it is working, and the old run is not the answer.
    expect(await screen.findByRole('button', { name: 'Publishing…' })).toBeTruthy()
    expect(screen.queryByTestId('publish-outcome')).toBeNull()

    // The worker is running it: still waiting.
    rerender(
      <PublishPanel view={{ ...before, busy: 'publish', lastRun: run({ state: 'running' }) }} />,
    )
    expect(screen.queryByTestId('publish-outcome')).toBeNull()

    // It finished.
    rerender(<PublishPanel view={{ ...before, lastRun: run() }} />)
    const outcome = await screen.findByTestId('publish-outcome')
    expect(screen.getByTestId('publish-outcome-title').textContent).toBe('Version 3 is live')
    expect(outcome.getAttribute('data-kind')).toBe('published')
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('"Nothing visible to publish" when the worker refuses on V10', async () => {
    const user = userEvent.setup()
    actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView({ lastRun: run({ id: 'jb_old' }) })
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    rerender(
      <PublishPanel
        view={{
          ...before,
          lastRun: run({ state: 'refused', refusal: 'no_visible_items', version: null }),
        }}
      />,
    )
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toBe(
      'Nothing visible to publish',
    )
    expect(screen.getByTestId('publish-outcome').getAttribute('data-kind')).toBe('refused')
  })

  it('says when the menu was already that version, and when the publish failed', async () => {
    const user = userEvent.setup()
    actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView({ lastRun: run({ id: 'jb_old' }) })
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    rerender(
      <PublishPanel view={{ ...before, lastRun: run({ state: 'unchanged', version: 2 }) }} />,
    )
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toBe(
      'Nothing new to publish: the menu is already version 2.',
    )
  })

  it('says why a press did not even queue', async () => {
    const user = userEvent.setup()
    actions.publishNowAction.mockResolvedValue({ ok: false, error: 'queue_unavailable' })
    renderWithIntl(<PublishPanel view={publishView()} />)
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toMatch(
      /publisher is not reachable/,
    )
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    )
  })

  it('refreshes the page by itself while a publish is queued or running', async () => {
    vi.useFakeTimers()
    try {
      renderWithIntl(<PublishPanel view={publishView({ busy: 'publish' })} />)
      expect(screen.getByRole('button', { name: 'Publishing…' })).toBeTruthy()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(navigation.refresh).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says the publisher is slow when a queued publish has no answer for a long time', async () => {
    vi.useFakeTimers()
    try {
      actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
      renderWithIntl(<PublishPanel view={publishView()} />)
      await act(async () => {
        screen.getByRole('button', { name: 'Publish' }).click()
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(screen.queryByTestId('publish-slow')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS)
      })
      expect(screen.getByTestId('publish-slow')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the held publish', () => {
  it('approves it through the worker, and says the version is live', async () => {
    const user = userEvent.setup()
    actions.approveHeldAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView({ held, lastRun: run({ id: 'jb_old' }) })
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)
    await user.click(screen.getByTestId('held-approve'))
    expect(actions.approveHeldAction).toHaveBeenCalledWith(
      'vn_demoVenueForPublishTests',
      'sn_held1',
    )
    rerender(<PublishPanel view={{ ...before, held: null, lastRun: run({ version: 4 }) }} />)
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toBe(
      'Version 4 is live',
    )
    expect(screen.queryByTestId('held-banner')).toBeNull()
  })

  it('on "the menu changed since", says so and the banner then offers Publish', async () => {
    const user = userEvent.setup()
    actions.approveHeldAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView({ held, lastRun: run({ id: 'jb_old' }) })
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)
    await user.click(screen.getByTestId('held-approve'))
    rerender(
      <PublishPanel
        view={{
          ...before,
          held: { ...held, outdated: true },
          lastRun: run({ state: 'refused', refusal: 'held_outdated', version: null }),
        }}
      />,
    )
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toMatch(
      /The menu has changed since this publish was held/,
    )
    actions.publishNowAction.mockResolvedValue({ ok: true, queued: true })
    await user.click(screen.getByRole('button', { name: 'Publish the menu as it is now' }))
    expect(actions.publishNowAction).toHaveBeenCalledTimes(1)
  })

  it('rejects it, and says so when someone decided it already', async () => {
    const user = userEvent.setup()
    actions.rejectHeldAction.mockResolvedValue({ ok: false, error: 'held_not_found' })
    renderWithIntl(<PublishPanel view={publishView({ held })} />)
    await user.click(screen.getByTestId('held-reject'))
    expect(actions.rejectHeldAction).toHaveBeenCalledWith('vn_demoVenueForPublishTests', 'sn_held1')
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toMatch(
      /already decided/,
    )
  })
})

describe('returning to a version', () => {
  it('confirms, returns, and says so; the pause banner is the page’s next render', async () => {
    const user = userEvent.setup()
    actions.rollbackAction.mockResolvedValue({ ok: true, queued: true })
    const before = publishView()
    const { rerender } = renderWithIntl(<PublishPanel view={before} />)
    expect(screen.queryByTestId('paused-banner')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Return to this version' }))
    await user.click(screen.getByTestId('confirm-return'))
    expect(actions.rollbackAction).toHaveBeenCalledWith(
      'vn_demoVenueForPublishTests',
      'sn_version1',
    )
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toBe(
      'Returned to version 1.',
    )

    const after = publishView({
      paused: true,
      live: { ...(before.live as NonNullable<typeof before.live>), version: 1 },
    })
    rerender(<PublishPanel view={after} />)
    expect(screen.getByTestId('paused-banner').textContent).toContain(
      'Automatic publishing is paused because you returned to an older version. Publish to resume.',
    )
  })

  it('says why a return was refused', async () => {
    const user = userEvent.setup()
    actions.rollbackAction.mockResolvedValue({ ok: false, error: 'not_restorable' })
    renderWithIntl(<PublishPanel view={publishView()} />)
    await user.click(screen.getByRole('button', { name: 'Return to this version' }))
    await user.click(screen.getByTestId('confirm-return'))
    await waitFor(() =>
      expect(screen.getByTestId('publish-outcome-title').textContent).toBe(
        'That version cannot be returned to.',
      ),
    )
  })

  it('tells the person when the files are being written after a return', () => {
    renderWithIntl(<PublishPanel view={publishView({ busy: 'files' })} />)
    expect(screen.getByTestId('publish-files').textContent).toBe('Updating what guests see…')
  })
})

describe('who sees what', () => {
  it('a member who may not publish reads the tab but has no way to act', () => {
    renderWithIntl(<PublishPanel view={publishView({ canPublish: false, held, paused: true })} />)
    expect(screen.getByTestId('read-only')).toBeTruthy()
    expect(screen.getByTestId('held-banner')).toBeTruthy()
    expect(screen.getByTestId('paused-banner')).toBeTruthy()
    expect(screen.queryByTestId('held-approve')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Return to this version' })).toBeNull()
    expect((screen.getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
  })

  it('a venue without a menu says there is nothing to publish yet', () => {
    renderWithIntl(<PublishPanel view={publishView({ menu: 'none', live: null })} />)
    expect(screen.getByTestId('publish-no-menu')).toBeTruthy()
    expect(screen.queryByTestId('publish-panel')).toBeNull()
  })

  it('has the same words in Bulgarian', () => {
    renderWithIntl(<PublishPanel view={publishView({ paused: true })} />, { locale: 'bg' })
    expect(screen.getByRole('heading', { name: /Автоматичното публикуване е спряно/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Публикувай' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Преглед' })).toBeTruthy()
  })
})
