// @vitest-environment jsdom
// The PIN sheet on a shared device (#85, plan §5): the action as its title, its consequence, the
// level of PIN asked, a submit on the fourth digit with no confirm tap, a wrong PIN clearing the
// dots with a sentence that says what to do, and the keyboard working as well as the pad.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TonightResult } from '@/server/tonight/tables'
import { renderWithIntl } from '@/test-utils'

import { PinSheet } from './pin-sheet'

const ACCEPTED: TonightResult = { ok: true, details: {} }

function sheet(
  onSubmit: (pin: string) => Promise<TonightResult>,
  level: 'own' | 'manager' = 'own',
) {
  const onLeave = vi.fn()
  renderWithIntl(
    <PinSheet
      title="Resume ordering"
      body="Guests can order from their phones again."
      level={level}
      onLeave={onLeave}
      onSubmit={onSubmit}
    />,
  )
  return { onLeave }
}

describe('PinSheet', () => {
  it('names the action and its consequence, and asks for the level of PIN', () => {
    sheet(async () => ACCEPTED, 'manager')
    expect(screen.getByText('Resume ordering')).toBeTruthy()
    expect(screen.getByText('Guests can order from their phones again.')).toBeTruthy()
    expect(screen.getByText("Enter a manager's PIN")).toBeTruthy()
  })

  it('submits on the fourth digit of the pad, with no confirm button', async () => {
    const onSubmit = vi.fn(async () => ACCEPTED)
    sheet(onSubmit)
    for (const digit of ['1', '2', '3'])
      await userEvent.click(screen.getByRole('button', { name: digit }))
    expect(onSubmit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '4' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('1234'))
    expect(screen.queryByRole('button', { name: /confirm|ok/i })).toBeNull()
  })

  it('takes the keyboard as well as the pad', async () => {
    const onSubmit = vi.fn(async () => ACCEPTED)
    sheet(onSubmit)
    await userEvent.keyboard('4321')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('4321'))
  })

  it('clears the dots and says the PIN was wrong', async () => {
    const onSubmit = vi.fn(async (): Promise<TonightResult> => ({ ok: false, error: 'pin_wrong' }))
    sheet(onSubmit)
    await userEvent.keyboard('9999')
    expect(await screen.findByText('Wrong PIN. Try again.')).toBeTruthy()
    // The next four digits are a fresh try.
    await userEvent.keyboard('1111')
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit).toHaveBeenLastCalledWith('1111')
  })

  it("tells a staff PIN that a manager's is needed", async () => {
    const onSubmit = vi.fn(
      async (): Promise<TonightResult> => ({ ok: false, error: 'permission_denied' }),
    )
    sheet(onSubmit, 'manager')
    await userEvent.keyboard('1234')
    expect(
      await screen.findByText("This PIN belongs to staff. A manager's PIN is needed."),
    ).toBeTruthy()
  })

  it('tells a device that waited how long, in the person’s words', async () => {
    const onSubmit = vi.fn(
      async (): Promise<TonightResult> => ({
        ok: false,
        error: 'device_waiting',
        retryAfterSeconds: 45,
      }),
    )
    sheet(onSubmit)
    await userEvent.keyboard('0000')
    expect(await screen.findByText(/Wait 45 seconds/)).toBeTruthy()
  })

  it('leaves with a visible button and loses nothing', async () => {
    const { onLeave } = sheet(async () => ACCEPTED)
    await userEvent.click(screen.getByRole('button', { name: 'Leave it' }))
    expect(onLeave).toHaveBeenCalled()
  })
})
