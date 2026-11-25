// @vitest-environment jsdom
// RR-93: typing a PIN on the sheet must not make React log "Cannot update a component (RunProvider)
// while rendering a different component (PinSheet)". React logs that once per pair of components in a
// process, so this is the only test of its file: another test of the PIN sheet would use the warning up.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TonightResult } from '@/server/tonight/tables'
import { renderWithIntl } from '@/test-utils'

import { RunProvider, type RunSpec, useTonightRun } from './run'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

function Open({ spec }: { spec: RunSpec }) {
  const { run } = useTonightRun()
  return (
    <button type="button" onClick={() => run(spec)}>
      go
    </button>
  )
}

describe('the PIN sheet inside a Tonight write (RR-93)', () => {
  it('opens and takes the PIN with no React error about an update during a render', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const act = vi.fn(async (): Promise<TonightResult> => ({ ok: true, details: {} }))
    try {
      renderWithIntl(
        <RunProvider>
          <Open
            spec={{
              id: 'resume',
              done: 'Ordering resumed',
              pin: { level: 'own', title: 'Resume ordering', body: 'Guests can order again.' },
              act,
            }}
          />
        </RunProvider>,
      )
      await userEvent.click(screen.getByRole('button', { name: 'go' }))
      expect(await screen.findByTestId('pin-sheet')).toBeTruthy()
      expect(logged).not.toHaveBeenCalled()
      await userEvent.keyboard('1234')
      await waitFor(() => expect(act).toHaveBeenCalledWith('1234'))
      await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
      expect(logged.mock.calls.map((call) => String(call[0]))).toEqual([])
    } finally {
      logged.mockRestore()
    }
  })
})
