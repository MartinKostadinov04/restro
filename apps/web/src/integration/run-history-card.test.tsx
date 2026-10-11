// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { RunHistoryCard } from './run-history-card'
import { run } from './test-view'

const view = (runs: ReturnType<typeof run>[]) => ({ runs, timeZone: 'Europe/Sofia' })

describe('the run history', () => {
  it('has an empty state', () => {
    renderWithIntl(<RunHistoryCard view={view([])} />)
    expect(screen.getByTestId('history-empty').textContent).toContain('No sync yet')
    expect(screen.queryByTestId('run-history')).toBeNull()
  })

  it('lists the runs as given (newest first) with kind, start, duration and status', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({ id: 'jb_a', kind: 'barsy_full_pull' }),
          run({
            id: 'jb_b',
            kind: 'barsy_connect',
            startedAt: '2026-10-09T09:00:00.000Z',
            finishedAt: '2026-10-09T09:00:03.000Z',
            counters: { venues: 2, languages: 3 },
          }),
          run({ id: 'jb_c', kind: 'barsy_incremental', status: 'failed' }),
        ])}
      />,
    )
    const rows = screen.getAllByTestId('run-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0] as HTMLElement).getByText('Full sync')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Connection check')).toBeTruthy()
    expect(within(rows[2] as HTMLElement).getByText('Quick sync')).toBeTruthy()
    // 10:00 UTC is 13:00 in Sofia; 1 minute 12 seconds.
    expect(within(rows[0] as HTMLElement).getByTestId('run-started').textContent).toMatch(/13:00/)
    expect(within(rows[0] as HTMLElement).getByTestId('run-duration').textContent).toBe(
      '1 min 12 s',
    )
    expect(within(rows[1] as HTMLElement).getByTestId('run-duration').textContent).toBe('3 s')
    expect(within(rows[0] as HTMLElement).getByTestId('run-status').textContent).toBe('Completed')
    expect(within(rows[2] as HTMLElement).getByTestId('run-status').textContent).toBe('Failed')
  })

  it('lists the counters of a run', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            counters: {
              articles_seen: 58,
              categories_seen: 9,
              created: 50,
              updated: 3,
              unchanged: 5,
              missing: 1,
              deleted: 0,
              reactivated: 2,
              failed_pages: 1,
              refused_writes: 4,
              ops_applied: 999,
            },
          }),
        ])}
      />,
    )
    const counters = screen.getByTestId('run-counters')
    for (const [label, value] of [
      ['Articles seen', '58'],
      ['Categories seen', '9'],
      ['Created', '50'],
      ['Updated', '3'],
      ['Unchanged', '5'],
      ['Missing', '1'],
      ['Deleted', '0'],
      ['Reactivated', '2'],
      ['Failed pages', '1'],
      ['Refused writes', '4'],
    ]) {
      const term = within(counters).getByText(label as string)
      expect(term.nextElementSibling?.textContent).toBe(value)
    }
    // A counter the tab does not label is not shown.
    expect(counters.textContent).not.toContain('999')
  })

  it('shows "deletion check skipped" when the run skipped it', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            id: 'jb_skip',
            details: { notes: ['deletion check skipped: 1 of 3 pages failed'], refused: [] },
          }),
          run({ id: 'jb_ok' }),
        ])}
      />,
    )
    const rows = screen.getAllByTestId('run-row')
    expect(within(rows[0] as HTMLElement).getByTestId('run-deletion-skipped').textContent).toBe(
      'Deletion check skipped',
    )
    expect(within(rows[1] as HTMLElement).queryByTestId('run-deletion-skipped')).toBeNull()
  })

  it('opens a row to the notes and the refused writes (field and reason)', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            counters: { refused_writes: 3 },
            details: {
              notes: ['deletion check skipped: 1 of 3 pages failed'],
              refused: [
                { fieldKey: 'for_sale', code: 'less_cautious' },
                { fieldKey: 'price', code: 'layer_not_allowed' },
                { fieldKey: null, code: 'brand_new_code' },
              ],
            },
          }),
        ])}
      />,
    )
    expect(screen.queryByTestId('run-details')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Show the details of the run from/ }))

    const details = screen.getByTestId('run-details')
    expect(within(details).getByText('deletion check skipped: 1 of 3 pages failed')).toBeTruthy()
    const refused = within(details).getAllByTestId('refused-write')
    expect(refused).toHaveLength(3)
    expect(refused[0]?.textContent).toContain('for_sale')
    expect(refused[0]?.textContent).toContain('Would make the menu less cautious than the till')
    expect(refused[1]?.textContent).toContain('This source may not write this field')
    // A code without words shows as "Refused" plus the code; a write with no field is "(structure)".
    expect(refused[2]?.textContent).toContain('(structure)')
    expect(refused[2]?.textContent).toContain('Refused')
    expect(refused[2]?.textContent).toContain('brand_new_code')

    await user.click(screen.getByRole('button', { name: /Hide the details of the run from/ }))
    expect(screen.queryByTestId('run-details')).toBeNull()
  })

  it('shows the error of a failed run that has no structured details (an older row)', async () => {
    const user = userEvent.setup()
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            status: 'failed',
            details: null,
            errorSummary: 'barsy refused the credentials (HTTP 401)',
          }),
        ])}
      />,
    )
    await user.click(screen.getByRole('button', { name: /Show the details/ }))
    expect(screen.getByTestId('run-details').textContent).toContain(
      'barsy refused the credentials (HTTP 401)',
    )
  })

  it('says so when a run has nothing more to tell', async () => {
    const user = userEvent.setup()
    renderWithIntl(<RunHistoryCard view={view([run()])} />)
    await user.click(screen.getByRole('button', { name: /Show the details/ }))
    expect(screen.getByTestId('run-details').textContent).toBe('Nothing else to report.')
  })

  it('shows a run that is still running without a duration', () => {
    renderWithIntl(
      <RunHistoryCard view={view([run({ status: 'running', finishedAt: null, counters: {} })])} />,
    )
    expect(screen.getByTestId('run-status').textContent).toBe('Running')
    expect(screen.getByTestId('run-duration').textContent).toBe('—')
  })

  it('never shows an id', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([run({ details: { notes: [], refused: [{ fieldKey: 'price', code: 'x' }] } })])}
      />,
    )
    expect(screen.getByTestId('run-history').textContent).not.toMatch(/jb_|nd_|\bin_/)
  })

  it('speaks Bulgarian', () => {
    renderWithIntl(<RunHistoryCard view={view([run()])} />, { locale: 'bg' })
    expect(screen.getByText('Пълна синхронизация')).toBeTruthy()
    expect(screen.getByTestId('run-duration').textContent).toBe('1 мин 12 с')
  })

  it('shows a short "Held" badge on a full sync that held its conclusion back, instead of "Deletion check skipped"', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            id: 'jb_held',
            details: {
              notes: [],
              refused: [],
              deletionCheckSkipped: true,
              absenceHeld: { reason: 'too_many_missing', wouldHide: 61, active: 65 },
            },
          }),
          run({
            id: 'jb_skipped',
            details: { notes: [], refused: [], deletionCheckSkipped: true },
          }),
          run({ id: 'jb_plain' }),
        ])}
      />,
    )
    const [heldRow, skippedRow, plainRow] = screen.getAllByTestId('run-row') as HTMLElement[]
    expect(within(heldRow as HTMLElement).getByTestId('run-held').textContent).toBe('Held')
    expect(within(heldRow as HTMLElement).queryByTestId('run-deletion-skipped')).toBeNull()
    expect(within(skippedRow as HTMLElement).queryByTestId('run-held')).toBeNull()
    expect(within(skippedRow as HTMLElement).getByTestId('run-deletion-skipped')).toBeTruthy()
    expect(within(plainRow as HTMLElement).queryByTestId('run-held')).toBeNull()
  })

  it('says "Задържана" in Bulgarian', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({
            details: {
              notes: [],
              refused: [],
              absenceHeld: { reason: 'empty_read', wouldHide: 3, active: 3 },
            },
          }),
        ])}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('run-held').textContent).toBe('Задържана')
  })

  it('names the venue each run was for, and a dash for a connection check or an older run', () => {
    renderWithIntl(
      <RunHistoryCard
        view={view([
          run({ id: 'jb_a', venue: { id: 'vn_a', name: 'Main bar' } }),
          run({ id: 'jb_b', venue: { id: 'vn_b', name: 'Roof' }, kind: 'barsy_incremental' }),
          run({ id: 'jb_c', venue: null, kind: 'barsy_connect' }),
        ])}
      />,
    )
    const rows = screen.getAllByTestId('run-row')
    expect(within(rows[0] as HTMLElement).getByTestId('run-venue').textContent).toBe('Main bar')
    expect(within(rows[1] as HTMLElement).getByTestId('run-venue').textContent).toBe('Roof')
    expect(within(rows[2] as HTMLElement).getByTestId('run-venue').textContent).toBe('—')
  })

  it('labels a tables read', () => {
    renderWithIntl(<RunHistoryCard view={view([run({ kind: 'places_read' })])} />)
    expect(screen.getByText('Tables read')).toBeTruthy()
  })
})
