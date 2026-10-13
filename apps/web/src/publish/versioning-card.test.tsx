// @vitest-environment jsdom
// Settings › Versioning (D96): the live version and the ones to return to, per menu; the return
// asks first; the purge sentence; who may return.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  keptEntries,
  type VersionEntry,
  type VersioningMenu,
  type VersioningView,
} from '@/server/publish/view'
import { renderWithIntl } from '@/test-utils'
import { entry, VENUE_ID } from './test-view'
import { VersioningCard } from './versioning-card'

const actions = vi.hoisted(() => ({ rollbackAction: vi.fn() }))
vi.mock('@/server/publish/actions', () => actions)

beforeEach(() => {
  actions.rollbackAction.mockReset()
  actions.rollbackAction.mockResolvedValue({ ok: true, queued: true })
})

const counts = {
  total: 1,
  added: 0,
  hidden: 0,
  priceChanged: 1,
  renamed: 0,
  otherChanged: 0,
  areas: 0,
}

function menu(overrides: Partial<VersioningMenu> = {}): VersioningMenu {
  return {
    menuId: 'nd_mainMenuForTests',
    name: 'Demo Club',
    live: true,
    liveVersion: {
      version: 2,
      publishedAt: '2026-10-02T10:00:00.000Z',
      reason: 'manual',
      actor: { kind: 'person', name: 'Maria Ivanova' },
      returned: null,
    },
    entries: [entry(2, { counts }), entry(1, { first: true })],
    ...overrides,
  }
}

function view(overrides: Partial<VersioningView> = {}): VersioningView {
  return {
    venueId: VENUE_ID,
    canPublish: true,
    timeZone: 'Europe/Sofia',
    menus: [menu()],
    ...overrides,
  }
}

const rows = () => screen.getAllByTestId('history-row')

describe('Settings › Versioning', () => {
  it('lists the versions newest first, marks the live one, and says what each changed', () => {
    renderWithIntl(<VersioningCard view={view()} />)
    expect(rows().map((row) => row.getAttribute('data-version'))).toEqual(['2', '1'])
    const [second, first] = rows() as [HTMLElement, HTMLElement]
    expect(within(second).getByText('Live')).toBeTruthy()
    expect(within(second).getByTestId('history-what').textContent).toBe('1 with a new price')
    expect(second.textContent).toContain('Published by hand')
    expect(second.textContent).toContain('Maria Ivanova')
    expect(within(first).getByTestId('history-what').textContent).toBe('First version')
    // Dates are the venue's: 10:00 UTC on 1 Oct is 13:00 in Sofia.
    expect(first.textContent).toMatch(/13:00/)
  })

  it('says how many versions are kept and when the purge erases the rest', () => {
    renderWithIntl(<VersioningCard view={view()} />)
    expect(
      screen.getByText(
        'The version guests see now and up to 2 earlier ones you can return to, newest first.',
      ),
    ).toBeTruthy()
    expect(screen.getByTestId('versioning-purge').textContent).toBe(
      'Earlier versions are erased 30 days after they were made (the live one never is), and the log of changes is kept for 61 days.',
    )
  })

  it('asks first, then returns to that version and says so', async () => {
    const user = userEvent.setup()
    renderWithIntl(<VersioningCard view={view()} />)
    const [second, first] = rows() as [HTMLElement, HTMLElement]
    expect(within(second).queryByRole('button', { name: 'Return to this version' })).toBeNull()
    await user.click(within(first).getByRole('button', { name: 'Return to this version' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Return to version 1?')).toBeTruthy()
    expect(actions.rollbackAction).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Return to version 1' }))
    expect(actions.rollbackAction).toHaveBeenCalledWith(VENUE_ID, 'sn_version1')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByTestId('publish-outcome-title').textContent).toBe('Returned to version 1.')
  })

  it('says why a return was not done', async () => {
    const user = userEvent.setup()
    actions.rollbackAction.mockResolvedValue({ ok: false, error: 'not_restorable' })
    renderWithIntl(<VersioningCard view={view()} />)
    await user.click(screen.getByRole('button', { name: 'Return to this version' }))
    await user.click(screen.getByRole('button', { name: 'Return to version 1' }))
    expect((await screen.findByTestId('publish-outcome-title')).textContent).toBe(
      'That version cannot be returned to.',
    )
  })

  it('says when the live version was returned to, and shows held and rejected publishes as what they were', () => {
    renderWithIntl(
      <VersioningCard
        view={view({
          menus: [
            menu({
              liveVersion: {
                version: 1,
                publishedAt: '2026-10-01T10:00:00.000Z',
                reason: 'manual',
                actor: { kind: 'person', name: 'Maria Ivanova' },
                returned: { at: '2026-10-05T10:00:00.000Z', actor: { kind: 'person', name: null } },
              },
              entries: [
                entry(4, {
                  status: 'held',
                  reason: 'auto_sync',
                  actor: { kind: 'sync' },
                  held: { hidden: 3, previouslyVisible: 5 },
                }),
                entry(2, { counts }),
                entry(1, { first: true }),
              ],
            }),
          ],
        })}
      />,
    )
    const [held, second, first] = rows() as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(held).getByText('Held')).toBeTruthy()
    expect(within(held).getByTestId('history-what').textContent).toBe(
      'Would have hidden 3 of 5 items',
    )
    expect(within(held).queryByRole('button')).toBeNull()
    expect(within(first).getByText('Live')).toBeTruthy()
    expect(within(first).getByTestId('live-returned').textContent).toContain(
      'Returned to this version on',
    )
    expect(within(second).getByRole('button', { name: 'Return to this version' })).toBeTruthy()
  })

  it('shows every menu’s versions under its name when the venue has several', () => {
    renderWithIntl(
      <VersioningCard
        view={view({
          menus: [
            menu(),
            menu({
              menuId: 'nd_brunch',
              name: 'Brunch',
              live: false,
              liveVersion: null,
              entries: [],
            }),
          ],
        })}
      />,
    )
    const blocks = screen.getAllByTestId('versioning-menu')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.textContent).toContain('Demo Club')
    expect(blocks[0]?.textContent).toContain('Live menu')
    expect(within(blocks[1] as HTMLElement).getByTestId('history-empty').textContent).toBe(
      'Nothing has been published yet.',
    )
  })

  it('shows the versions but no way back to anyone who may not publish', () => {
    renderWithIntl(<VersioningCard view={view({ canPublish: false })} />)
    expect(rows()).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Return to this version' })).toBeNull()
    expect(screen.getByTestId('read-only')).toBeTruthy()
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<VersioningCard view={view()} />, { locale: 'bg' })
    expect(screen.getByRole('button', { name: 'Върни се към тази версия' })).toBeTruthy()
  })
})

describe('keptEntries: what the page shows of a menu’s history (D96)', () => {
  const now = new Date('2026-10-20T12:00:00.000Z')
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T10:00:00.000Z`
  const versions = (entries: VersionEntry[]) => entries.map((one) => one.version)

  it('keeps the live one and the two newest earlier published ones', () => {
    const entries = [5, 4, 3, 2, 1].map((version) => entry(version, { at: at(10 + version) }))
    expect(versions(keptEntries(entries, 5, now))).toEqual([5, 4, 3])
    // Returned to version 2: it is live, and the two newest others can be returned to.
    expect(versions(keptEntries(entries, 2, now))).toEqual([5, 4, 2])
  })

  it('leaves out returns, and earlier versions older than 30 days; keeps held and rejected ones', () => {
    const entries = [
      entry(6, { status: 'held', reason: 'auto_sync', at: at(19) }),
      entry(5, { reason: 'rollback', at: at(18) }),
      entry(4, { status: 'rejected', reason: 'auto_sync', at: at(17) }),
      entry(3, { at: at(15) }),
      entry(2, { at: '2026-09-01T10:00:00.000Z' }),
      entry(1, { at: '2026-08-01T10:00:00.000Z' }),
    ]
    expect(versions(keptEntries(entries, 3, now))).toEqual([6, 4, 3])
    expect(versions(keptEntries(entries, 1, now))).toEqual([6, 4, 3, 1])
  })
})
