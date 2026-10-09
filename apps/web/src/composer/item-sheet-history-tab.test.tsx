// @vitest-environment jsdom
import { VENUE_MENU_TEMPLATE } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { HistoryEntry, HistoryPage } from '@/server/item-sheet/types'
import { renderWithIntl } from '@/test-utils'

import { ItemSheetHistoryTab } from './item-sheet-history-tab'

// The tab's default loader is a server action; tests hand in their own.
vi.mock('@/server/item-sheet/actions', () => ({ loadItemHistoryAction: vi.fn() }))

const definition = (key: string) =>
  VENUE_MENU_TEMPLATE.nodeTypes.item?.fields.find((field) => field.key === key) ?? null

function entry(seq: number, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    seq,
    at: '2026-10-09T09:30:00.000Z',
    fieldKey: 'description',
    definition: definition('description'),
    layer: 'manual',
    scope: 'master',
    oldValue: null,
    newValue: { bg_BG: 'Горчив' },
    kind: 'set',
    actor: { kind: 'user', name: 'Anna Test' },
    source: 'manual',
    ...overrides,
  }
}

function setup(pages: HistoryPage[], locale: 'en' | 'bg' = 'en') {
  const queue = [...pages]
  const load = vi.fn(async () => queue.shift() ?? { entries: [], nextBefore: null })
  const view = renderWithIntl(
    <ItemSheetHistoryTab venueId="vn_x" itemId="nd_x" revision={1} load={load} />,
    { locale },
  )
  return { load, ...view }
}

describe('the History tab', () => {
  it("shows who changed what, from what to what, and when (in the venue's time zone)", async () => {
    setup([
      {
        entries: [
          entry(3, {
            kind: 'changed',
            oldValue: { bg_BG: 'Горчив' },
            newValue: { bg_BG: 'Горчив и свеж' },
          }),
        ],
        nextBefore: null,
      },
    ])
    const line = await screen.findByTestId('history-entry')
    const sentence = within(line).getByTestId('history-sentence')
    expect(sentence.textContent).toContain('Anna Test changed Description from')
    expect(within(sentence).getByText('Горчив')).toBeTruthy()
    expect(within(sentence).getByText('Горчив и свеж')).toBeTruthy()
    // 09:30 UTC on 9 October 2026 is 12:30 in Sofia (UTC+3).
    expect(within(line).getByText(/12:30/)).toBeTruthy()
    expect(within(line).getByText('Owned here')).toBeTruthy()
  })

  it('words a first value, a removal and a barsy pull', async () => {
    setup([
      {
        entries: [
          entry(4, {
            kind: 'cleared',
            oldValue: ['gluten'],
            newValue: null,
            fieldKey: 'allergens',
            definition: definition('allergens'),
            layer: 'override',
          }),
          entry(3, {
            actor: { kind: 'integration', name: null },
            layer: 'barsy',
            source: 'barsy:in_x',
            fieldKey: 'name',
            definition: definition('name'),
            newValue: { bg_BG: 'Негрони' },
          }),
          entry(2, { actor: { kind: 'user', name: null } }),
        ],
        nextBefore: null,
      },
    ])
    const lines = await screen.findAllByTestId('history-sentence')
    expect(lines[0]?.textContent).toMatch(/^Anna Test removed Allergens \(it was Gluten\)$/)
    // A name is drawn by its field type: a language chip, then the text.
    expect(lines[1]?.textContent).toMatch(/^The barsy sync set Name to BGНегрони$/)
    expect(lines[2]?.textContent).toMatch(/^Someone set Description to /)
    const entries = screen.getAllByTestId('history-entry')
    expect(within(entries[0] as HTMLElement).getByText('Overridden')).toBeTruthy()
    expect(within(entries[1] as HTMLElement).getByText('From barsy')).toBeTruthy()
  })

  it('shows a field the template no longer has as plain text', async () => {
    setup([
      {
        entries: [entry(1, { fieldKey: 'old_field', definition: null, newValue: 'x' })],
        nextBefore: null,
      },
    ])
    const sentence = await screen.findByTestId('history-sentence')
    expect(sentence.textContent).toContain('old_field')
    expect(within(sentence).getByText('"x"')).toBeTruthy()
  })

  it('loads the next page on request and stops when there are no more', async () => {
    const { load } = setup([
      { entries: [entry(30), entry(29)], nextBefore: 29 },
      { entries: [entry(28)], nextBefore: null },
    ])
    expect(await screen.findAllByTestId('history-entry')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show older' }))
    await waitFor(() => expect(screen.getAllByTestId('history-entry')).toHaveLength(3))
    expect(load).toHaveBeenLastCalledWith('vn_x', 'nd_x', 29)
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('says so when there is nothing yet, and when loading fails', async () => {
    const first = setup([{ entries: [], nextBefore: null }])
    expect(await screen.findByText('No changes yet.')).toBeTruthy()
    first.unmount()

    const load = vi.fn(async () => {
      throw new Error('boom')
    })
    renderWithIntl(<ItemSheetHistoryTab venueId="vn_x" itemId="nd_x" revision={1} load={load} />)
    expect((await screen.findByRole('alert')).textContent).toBe('The history could not be loaded.')
  })

  it('reloads from the first page when the item changed', async () => {
    const load = vi.fn(async () => ({ entries: [entry(1)], nextBefore: null }))
    const { rerender } = renderWithIntl(
      <ItemSheetHistoryTab venueId="vn_x" itemId="nd_x" revision={1} load={load} />,
    )
    await screen.findByTestId('history-entry')
    expect(load).toHaveBeenCalledTimes(1)
    rerender(<ItemSheetHistoryTab venueId="vn_x" itemId="nd_x" revision={2} load={load} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('writes the sentence in Bulgarian', async () => {
    setup([{ entries: [entry(1)], nextBefore: null }], 'bg')
    const sentence = await screen.findByTestId('history-sentence')
    expect(sentence.textContent).toMatch(/^Anna Test зададе Описание: /)
  })
})
