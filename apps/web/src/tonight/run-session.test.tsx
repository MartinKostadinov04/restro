// @vitest-environment jsdom
// A write on a shared device whose person is still on it (D141 12.11, #324): the PIN that started
// their own short session already named them, so the sheet does not open again — a run of record
// work is typed once. Two things must hold: the write goes straight through, and a `pin_required`
// from the server still brings the sheet up, so a session that ran out or an action this person may
// not do is never a dead end.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TonightResult } from '@/server/tonight/tables'
import { renderWithIntl } from '@/test-utils'

import { RunProvider, type RunSpec, useTonightRun } from './run'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

function Button({ spec }: { spec: RunSpec }) {
  const { run } = useTonightRun()
  return (
    <button type="button" onClick={() => run(spec)}>
      go
    </button>
  )
}

const pin = { level: 'own' as const, title: 'Not on the bill', body: 'Table 1 can order again.' }

async function tapOnTheDevice(act: RunSpec['act']) {
  renderWithIntl(
    <RunProvider asks={false}>
      <Button spec={{ id: 'answer:so_1', done: 'Saved: not on the bill', pin, act }} />
    </RunProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'go' }))
}

describe('a write while the device remembers the person (#324)', () => {
  beforeEach(() => {
    toast.mockClear()
    toast.error.mockClear()
  })

  it('runs at once with no PIN, and the toast names the person the session holds', async () => {
    const act = vi.fn(async (): Promise<TonightResult> => ({ ok: true, details: { who: 'Maria' } }))
    await tapOnTheDevice(act)
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(act).toHaveBeenCalledWith(undefined)
    expect(screen.queryByTestId('pin-sheet')).toBeNull()
    expect(toast.mock.calls[0]?.[0]).toBe('Saved: not on the bill · Maria')
  })

  it('still opens the sheet for an answer that moves money, which the sheet confirms', async () => {
    const act = vi.fn(async (): Promise<TonightResult> => ({ ok: true, details: {} }))
    renderWithIntl(
      <RunProvider asks={false}>
        <Button
          spec={{
            id: 'pay:py_1',
            done: 'Card charged',
            pin: { ...pin, level: 'manager', confirm: true },
            act,
          }}
        />
      </RunProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(await screen.findByTestId('pin-sheet')).toBeTruthy()
    expect(act).not.toHaveBeenCalled()
  })

  it('opens the sheet when the server asks for a PIN after all, and runs it with the PIN', async () => {
    const act = vi.fn(
      async (entered?: string): Promise<TonightResult> =>
        entered === undefined
          ? { ok: false, error: 'pin_required' }
          : { ok: true, details: { who: 'Ivan' } },
    )
    await tapOnTheDevice(act)
    expect(await screen.findByTestId('pin-sheet')).toBeTruthy()
    // The refusal is not an error toast: the sheet is the answer.
    expect(toast.error).not.toHaveBeenCalled()
    await userEvent.keyboard('4321')
    await waitFor(() => expect(act).toHaveBeenCalledWith('4321'))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('pin-sheet')).toBeNull()
  })
})
