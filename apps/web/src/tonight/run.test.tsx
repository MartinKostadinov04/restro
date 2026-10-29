// @vitest-environment jsdom
// How a write of Tonight ends in its toast (#200): the toast offers Undo only when the write
// changed something. A repeat tap that finds the mark already made (`changed: false`) must not
// give Undo, or it would take back another device's mark. Without a rule (`undoWhen`) the toast
// always offers it, as the other Undos of the screen do. Sonner is a stand-in that records the
// toasts.
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TonightResult } from '@/server/tonight/tables'
import { renderWithIntl } from '@/test-utils'

import { RunProvider, type RunSpec, useTonightRun, wroteSomething } from './run'

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

const answered = (changed: boolean): TonightResult => ({ ok: true, details: { changed } })

async function tap(spec: Omit<RunSpec, 'id' | 'done'>) {
  renderWithIntl(
    <RunProvider>
      <Button spec={{ id: 'receipt:py_1', done: 'Receipt for Table 1 brought', ...spec }} />
    </RunProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'go' }))
  await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
  return toast.mock.calls[0] as [string, { id: string; action?: { label: string } }]
}

describe('the toast after a write', () => {
  beforeEach(() => {
    toast.mockClear()
    toast.error.mockClear()
  })

  it('offers Undo when the write changed something', async () => {
    const undo = vi.fn(async () => answered(true))
    const [text, options] = await tap({
      act: async () => answered(true),
      undo,
      undoWhen: (done) => done.details.changed === true,
    })
    expect(text).toBe('Receipt for Table 1 brought')
    expect(options.id).toBe('receipt:py_1')
    expect(options.action?.label).toBe('Undo')
  })

  it('gives no Undo when the write found it done already (changed: false)', async () => {
    const [text, options] = await tap({
      act: async () => answered(false),
      undo: vi.fn(async () => answered(true)),
      undoWhen: (done) => done.details.changed === true,
    })
    // The toast still says it is done; it only has no way to take someone else's mark back.
    expect(text).toBe('Receipt for Table 1 brought')
    expect(options.action).toBeUndefined()
  })

  it('always offers Undo when the write names no rule', async () => {
    const [, changed] = await tap({
      act: async () => answered(false),
      undo: vi.fn(async () => answered(true)),
    })
    expect(changed.action?.label).toBe('Undo')
  })

  it('hands the undo token of the write to its Undo, and offers none when it wrote nothing', async () => {
    const undo = vi.fn(async () => answered(true))
    const [, options] = await tap({
      act: async (): Promise<TonightResult> => ({
        ok: true,
        details: { undoEntry: 4821, undoAt: '2026-10-29T20:00:00.000Z' },
      }),
      undo,
      undoWhen: wroteSomething,
    })
    expect(options.action?.label).toBe('Undo')
    ;(options.action as unknown as { onClick: () => void }).onClick()
    // No PIN was asked, so the Undo has none to send on.
    expect(undo).toHaveBeenCalledWith(expect.anything(), { entry: 4821 }, undefined)

    cleanup()
    toast.mockClear()
    const [, repeat] = await tap({
      act: async () => answered(false),
      undo: vi.fn(async () => answered(true)),
      undoWhen: wroteSomething,
    })
    expect(repeat.action).toBeUndefined()
  })

  it('hands the PIN the write was entered with to its Undo, so the same person takes it back', async () => {
    const undo = vi.fn(async () => answered(true))
    const act = vi.fn(
      async (_pin?: string): Promise<TonightResult> => ({
        ok: true,
        details: { undoEntry: 77, undoAt: '2026-10-29T20:00:00.000Z' },
      }),
    )
    renderWithIntl(
      <RunProvider>
        <Button
          spec={{
            id: 'storno:rf_1',
            done: 'Storno recorded',
            pin: { level: 'manager', title: 'Storno done', body: 'We record it.' },
            act,
            undo,
            undoWhen: wroteSomething,
          }}
        />
      </RunProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'go' }))
    await userEvent.keyboard('4321')
    await waitFor(() => expect(act).toHaveBeenCalledWith('4321'))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    const options = toast.mock.calls[0]?.[1] as { action?: { onClick: () => void } }
    options.action?.onClick()
    expect(undo).toHaveBeenCalledWith(expect.anything(), { entry: 77 }, '4321')
  })

  it('shows the words of the two Undo refusals in the error toast', async () => {
    for (const [error, text] of [
      ['undo_expired', 'Too late to undo.'],
      ['undo_stale', 'Someone else has changed this since.'],
    ] as const) {
      cleanup()
      toast.mockClear()
      toast.error.mockClear()
      const [, options] = await tap({
        act: async (): Promise<TonightResult> => ({ ok: true, details: { undoEntry: 1 } }),
        undo: vi.fn(async (): Promise<TonightResult> => ({ ok: false, error })),
      })
      ;(options.action as unknown as { onClick: () => void }).onClick()
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
      expect(toast.error.mock.calls[0]?.[0]).toBe(text)
    }
  })

  it('offers none for a write that has no inverse', async () => {
    const [, options] = await tap({ act: async () => answered(true) })
    expect(options.action).toBeUndefined()
  })

  it('shows the error toast, and no success toast, when the write fails', async () => {
    renderWithIntl(
      <RunProvider>
        <Button
          spec={{
            id: 'receipt:py_1',
            done: 'Receipt for Table 1 brought',
            act: async (): Promise<TonightResult> => ({ ok: false, error: 'no_receipt_to_bring' }),
            undo: vi.fn(async () => answered(true)),
          }}
        />
      </RunProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast).not.toHaveBeenCalled()
    expect(toast.error.mock.calls[0]?.[0]).toBe(
      "There's no receipt to bring for this payment. The page will refresh.",
    )
  })
})
