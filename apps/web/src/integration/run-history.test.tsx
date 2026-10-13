// @vitest-environment jsdom
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { run } from '@/connectors/test-view'
import { renderWithIntl } from '@/test-utils'
import { RunHistory } from './run-history'

type Options = { locale?: 'en' | 'bg'; showVenue?: boolean; source?: string; connector?: string }

function renderHistory(runs: ReturnType<typeof run>[], options: Options = {}) {
  return renderWithIntl(
    <RunHistory
      runs={runs}
      timeZone="Europe/Sofia"
      connector={options.connector ?? 'barsy'}
      source={options.source ?? 'barsy'}
      showVenue={options.showVenue ?? true}
    />,
    { locale: options.locale ?? 'en' },
  )
}

/** Opens the collapsed list, as a person does. */
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('history-toggle'))
}

describe('the run history (collapsed: one line, the list under a button)', () => {
  it('has an empty state', () => {
    renderHistory([])
    expect(screen.getByTestId('history-empty').textContent).toContain('No sync yet')
    expect(screen.queryByTestId('run-history')).toBeNull()
    expect(screen.queryByTestId('history-toggle')).toBeNull()
  })

  it('shows the last run on one line and keeps the list closed', () => {
    renderHistory([
      run({ id: 'jb_a', kind: 'barsy_full_pull' }),
      run({ id: 'jb_b', kind: 'barsy_connect' }),
    ])
    // 10:00 UTC is 13:00 in Sofia.
    expect(screen.getByTestId('history-last').textContent).toMatch(
      /^Last run: Full sync · Completed · .*13:00/,
    )
    expect(screen.queryByTestId('run-history')).toBeNull()
    expect(screen.queryAllByTestId('run-row')).toHaveLength(0)
    const toggle = screen.getByTestId('history-toggle')
    expect(toggle.textContent).toBe('Show the last 2 runs')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the list under the button and closes it again', async () => {
    const user = userEvent.setup()
    renderHistory([run({ id: 'jb_a' })])
    expect(screen.getByTestId('history-toggle').textContent).toBe('Show the last run')
    await open(user)
    expect(screen.getAllByTestId('run-row')).toHaveLength(1)
    expect(screen.getByTestId('history-toggle').textContent).toBe('Hide the list')
    expect(screen.getByTestId('history-toggle').getAttribute('aria-expanded')).toBe('true')
    await open(user)
    expect(screen.queryByTestId('run-history')).toBeNull()
  })

  it('lists the runs as given (newest first) with kind, start, duration and status', async () => {
    const user = userEvent.setup()
    renderHistory([
      run({ id: 'jb_a', kind: 'barsy_full_pull' }),
      run({
        id: 'jb_b',
        kind: 'barsy_connect',
        startedAt: '2026-10-09T09:00:00.000Z',
        finishedAt: '2026-10-09T09:00:03.000Z',
        counters: { venues: 2, languages: 3 },
      }),
      run({ id: 'jb_c', kind: 'barsy_incremental', status: 'failed' }),
    ])
    await open(user)
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

  it('lists the counters of a run, naming the system where a counter does', async () => {
    const user = userEvent.setup()
    renderHistory(
      [
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
            venues: 3,
            ops_applied: 999,
          },
        }),
      ],
      { source: 'Another POS' },
    )
    await open(user)
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
      ['Another POS venues', '3'],
    ]) {
      const term = within(counters).getByText(label as string)
      expect(term.nextElementSibling?.textContent).toBe(value)
    }
    // A counter the screen does not label is not shown.
    expect(counters.textContent).not.toContain('999')
  })

  it('shows "deletion check skipped" when the run skipped it', async () => {
    const user = userEvent.setup()
    renderHistory([
      run({
        id: 'jb_skip',
        details: { notes: ['deletion check skipped: 1 of 3 pages failed'], refused: [] },
      }),
      run({ id: 'jb_ok' }),
    ])
    await open(user)
    const rows = screen.getAllByTestId('run-row')
    expect(within(rows[0] as HTMLElement).getByTestId('run-deletion-skipped').textContent).toBe(
      'Deletion check skipped',
    )
    expect(within(rows[1] as HTMLElement).queryByTestId('run-deletion-skipped')).toBeNull()
  })

  it('opens a row to the notes and the refused writes (field and reason)', async () => {
    const user = userEvent.setup()
    renderHistory([
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
    ])
    await open(user)
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

  it('names the system in the words of a refusal that names it', async () => {
    const user = userEvent.setup()
    renderHistory(
      [run({ details: { notes: [], refused: [{ fieldKey: 'name', code: 'not_linked' }] } })],
      { source: 'Another POS' },
    )
    await open(user)
    await user.click(screen.getByRole('button', { name: /Show the details/ }))
    expect(screen.getByTestId('refused-write').textContent).toContain('Not linked to Another POS')
  })

  it('shows the error of a failed run that has no structured details (an older row)', async () => {
    const user = userEvent.setup()
    renderHistory([
      run({
        status: 'failed',
        details: null,
        errorSummary: 'barsy refused the credentials (HTTP 401)',
      }),
    ])
    await open(user)
    await user.click(screen.getByRole('button', { name: /Show the details/ }))
    expect(screen.getByTestId('run-details').textContent).toContain(
      'barsy refused the credentials (HTTP 401)',
    )
  })

  it('says so when a run has nothing more to tell', async () => {
    const user = userEvent.setup()
    renderHistory([run()])
    await open(user)
    await user.click(screen.getByRole('button', { name: /Show the details/ }))
    expect(screen.getByTestId('run-details').textContent).toBe('Nothing else to report.')
  })

  it('shows a run that is still running without a duration', async () => {
    const user = userEvent.setup()
    renderHistory([run({ status: 'running', finishedAt: null, counters: {} })])
    expect(screen.getByTestId('history-last').textContent).toContain('Running')
    await open(user)
    expect(screen.getByTestId('run-status').textContent).toBe('Running')
    expect(screen.getByTestId('run-duration').textContent).toBe('—')
  })

  it('never shows an id', async () => {
    const user = userEvent.setup()
    renderHistory([run({ details: { notes: [], refused: [{ fieldKey: 'price', code: 'x' }] } })])
    await open(user)
    expect(screen.getByTestId('history').textContent).not.toMatch(/jb_|nd_|\bin_/)
  })

  it('speaks Bulgarian', async () => {
    const user = userEvent.setup()
    renderHistory([run()], { locale: 'bg' })
    expect(screen.getByTestId('history-last').textContent).toMatch(
      /^Последно изпълнение: Пълна синхронизация · Завършено/,
    )
    await open(user)
    expect(screen.getByTestId('run-duration').textContent).toBe('1 мин 12 с')
    expect(screen.getByTestId('history-toggle').textContent).toBe('Скрий списъка')
  })

  it('shows a short "Held" badge on a full sync that held its conclusion back, instead of "Deletion check skipped"', async () => {
    const user = userEvent.setup()
    renderHistory([
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
    ])
    await open(user)
    const [heldRow, skippedRow, plainRow] = screen.getAllByTestId('run-row') as HTMLElement[]
    expect(within(heldRow as HTMLElement).getByTestId('run-held').textContent).toBe('Held')
    expect(within(heldRow as HTMLElement).queryByTestId('run-deletion-skipped')).toBeNull()
    expect(within(skippedRow as HTMLElement).queryByTestId('run-held')).toBeNull()
    expect(within(skippedRow as HTMLElement).getByTestId('run-deletion-skipped')).toBeTruthy()
    expect(within(plainRow as HTMLElement).queryByTestId('run-held')).toBeNull()
  })

  it('says "Задържана" in Bulgarian', async () => {
    const user = userEvent.setup()
    renderHistory(
      [
        run({
          details: {
            notes: [],
            refused: [],
            absenceHeld: { reason: 'empty_read', wouldHide: 3, active: 3 },
          },
        }),
      ],
      { locale: 'bg' },
    )
    await open(user)
    expect(screen.getByTestId('run-held').textContent).toBe('Задържана')
  })

  it('names the venue each run was for, and a dash for a connection check or an older run', async () => {
    const user = userEvent.setup()
    renderHistory([
      run({ id: 'jb_a', venue: { id: 'vn_a', name: 'Main bar' } }),
      run({ id: 'jb_b', venue: { id: 'vn_b', name: 'Roof' }, kind: 'barsy_incremental' }),
      run({ id: 'jb_c', venue: null, kind: 'barsy_connect' }),
    ])
    await open(user)
    const rows = screen.getAllByTestId('run-row')
    expect(within(rows[0] as HTMLElement).getByTestId('run-venue').textContent).toBe('Main bar')
    expect(within(rows[1] as HTMLElement).getByTestId('run-venue').textContent).toBe('Roof')
    expect(within(rows[2] as HTMLElement).getByTestId('run-venue').textContent).toBe('—')
  })

  it('leaves the venue column out of one venue’s own history', async () => {
    const user = userEvent.setup()
    renderHistory([run()], { showVenue: false })
    await open(user)
    expect(screen.queryByTestId('run-venue')).toBeNull()
  })

  it('labels a tables read, and calls a kind nobody labels "Other"', async () => {
    const user = userEvent.setup()
    renderHistory([run({ kind: 'places_read' }), run({ id: 'jb_x', kind: 'something_new' })])
    await open(user)
    expect(screen.getByText('Tables read')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
  })

  it('does not borrow another connector’s names for its runs', async () => {
    const user = userEvent.setup()
    renderHistory([run({ kind: 'barsy_full_pull' })], { connector: 'some_other_pos' })
    await open(user)
    expect(screen.queryByText('Full sync')).toBeNull()
    expect(screen.getByText('Other')).toBeTruthy()
  })
})
