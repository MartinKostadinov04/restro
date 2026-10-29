// @vitest-environment jsdom
// The storno, dispute and refund-failed rows of "Needs you" (#222; decision log 5.3, 5.4, 5.11,
// screen 1 Q7): what each says with the strings of the ticket, who gets a button (a manager's own
// session one tap, the shared tablet a manager's PIN, a staff member none), "Storno done" with its
// Undo that sends the same PIN back, and a dispute's evidence opening on the payment's sheet.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActionRow } from '@/server/tonight/view'
import { renderWithIntl } from '@/test-utils'

import { ActionRowItem, type ActionRowView } from './action-rows'
import { RunProvider } from './run'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }))
const stornoDoneAction = vi.hoisted(() => vi.fn())
const stornoUndoAction = vi.hoisted(() => vi.fn())
const paymentDetailAction = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/server/tonight/actions', () => ({
  handleWaiterCallAction: vi.fn(),
  receiptBroughtAction: vi.fn(),
  receiptUnbroughtAction: vi.fn(),
  resumeTableAction: vi.fn(),
  stornoDoneAction,
  stornoUndoAction,
  answerPaymentAction: vi.fn(),
  doneAlertAction: vi.fn(),
}))
vi.mock('@/server/tonight/payment-actions', () => ({ paymentDetailAction }))

const base = (over: Partial<ActionRowView>): ActionRowView => ({
  venueId: 'vn_0123456789ABCDEFGHIJKL',
  source: 'Mistral',
  currency: 'EUR',
  device: false,
  provider: 'Stripe',
  can: {
    openClose: true,
    resume: true,
    pause: true,
    lift: true,
    answer: true,
    followUp: true,
  },
  ...over,
})
const manager = base({})
const tablet = base({
  device: true,
  can: { openClose: true, resume: false, pause: true, lift: false, answer: true, followUp: false },
})
const waiter = base({
  can: { openClose: true, resume: false, pause: true, lift: false, answer: true, followUp: false },
})

const storno: ActionRow = {
  id: 'storno:rf_1',
  kind: 'storno',
  tableId: 'tb_1',
  table: '7',
  numbered: true,
  at: '2026-10-29T21:10:00.000Z',
  storno: {
    refundId: 'rf_0123456789ABCDEFGHIJKL',
    paymentId: 'py_1',
    paymentNumber: 'AB3CD',
    amountMinor: 400,
    chargeMinor: 500,
    serviceDate: '2026-10-28',
    receiptNumber: 'R-000123',
    receiptTime: '2026-10-28 22:15',
    fiscalMemoryNumber: 'FM-77881',
  },
}
const dispute: ActionRow = {
  id: 'dispute:py_9',
  kind: 'dispute',
  tableId: 'tb_3',
  table: '3',
  numbered: true,
  at: '2026-10-29T20:30:00.000Z',
  dispute: {
    paymentId: 'py_9',
    paymentNumber: 'KQ7MD',
    amountMinor: 4600,
    serviceDate: '2026-10-25',
    due: { date: '2026-11-04', time: '11:00' },
  },
}
const failed: ActionRow = {
  id: 'refund_failed:rf_2',
  kind: 'refund_failed',
  tableId: 'tb_1',
  table: '7',
  numbered: true,
  at: '2026-10-29T21:25:00.000Z',
  refundFailed: { refundId: 'rf_2', paymentId: 'py_1', amountMinor: 700 },
}

function draw(row: ActionRow, view: ActionRowView) {
  renderWithIntl(
    <RunProvider>
      <ul>
        <ActionRowItem row={row} view={view} primary={false} ago="5 min ago" />
      </ul>
    </RunProvider>,
  )
}

beforeEach(() => {
  toast.mockClear()
  toast.error.mockClear()
  stornoDoneAction.mockReset()
  stornoUndoAction.mockReset()
  paymentDetailAction.mockReset()
})

describe('the storno row', () => {
  it('says what the storno at the till needs: the refund, the night, the receipt, its time and the fiscal memory', () => {
    draw(storno, manager)
    expect(screen.getByText('Make the storno in Mistral')).toBeTruthy()
    expect(
      screen.getByText(
        /Refund of .*4\.00.* for Table 7, night of 28 October\. Receipt R-000123 of 2026-10-28 22:15, fiscal memory FM-77881\./,
      ),
    ).toBeTruthy()
  })

  it('gives a manager one tap, the tablet a button and a staff member’s own phone none', () => {
    draw(storno, manager)
    expect(screen.getByRole('button', { name: 'Storno done' })).toBeTruthy()
  })

  it('draws no button for a staff member', () => {
    draw(storno, waiter)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('saves at once for a manager, and the toast’s Undo sends the token back', async () => {
    stornoDoneAction.mockResolvedValue({
      ok: true,
      details: { changed: true, undoEntry: 4821, undoAt: '2026-10-29T21:11:00.000Z' },
    })
    stornoUndoAction.mockResolvedValue({ ok: true, details: { changed: true } })
    draw(storno, manager)
    await userEvent.click(screen.getByRole('button', { name: 'Storno done' }))
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(stornoDoneAction).toHaveBeenCalledWith({
      venueId: manager.venueId,
      refundId: 'rf_0123456789ABCDEFGHIJKL',
      pin: undefined,
    })
    const [text, options] = toast.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(text).toBe('Storno recorded')
    expect(options.action.label).toBe('Undo')
    options.action.onClick()
    expect(stornoUndoAction).toHaveBeenCalledWith({
      venueId: manager.venueId,
      refundId: 'rf_0123456789ABCDEFGHIJKL',
      undo: { entry: 4821 },
      pin: undefined,
    })
  })

  it('asks a manager’s PIN on the tablet, says what is recorded, and sends the PIN on with the Undo', async () => {
    stornoDoneAction.mockResolvedValue({
      ok: true,
      details: { changed: true, undoEntry: 9, undoAt: '2026-10-29T21:11:00.000Z' },
    })
    stornoUndoAction.mockResolvedValue({ ok: true, details: { changed: true } })
    draw(storno, tablet)
    await userEvent.click(screen.getByRole('button', { name: 'Storno done' }))
    expect(screen.getByText("Enter a manager's PIN")).toBeTruthy()
    // The manager confirming is told the true amount (5.00), which the row (4.00) leaves out.
    expect(
      screen.getByText(
        /Refund of .*5\.00.* for Table 7, night of 28 October\. .* We record that the storno is done in Mistral\. Restro doesn't check it\./,
      ),
    ).toBeTruthy()
    await userEvent.keyboard('4321')
    await waitFor(() => expect(stornoDoneAction).toHaveBeenCalled())
    expect(stornoDoneAction.mock.calls[0]?.[0]).toMatchObject({ pin: '4321' })
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    const options = toast.mock.calls[0]?.[1] as { action: { onClick: () => void } }
    options.action.onClick()
    expect(stornoUndoAction).toHaveBeenCalledWith(
      expect.objectContaining({ undo: { entry: 9 }, pin: '4321' }),
    )
  })

  it('says a staff member’s PIN is not enough, and words a second answer as someone else’s', async () => {
    stornoDoneAction.mockResolvedValueOnce({ ok: false, error: 'permission_denied' })
    draw(storno, tablet)
    await userEvent.click(screen.getByRole('button', { name: 'Storno done' }))
    await userEvent.keyboard('1111')
    // A staff member's PIN where a manager's is needed is not a wrong PIN.
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/manager/i))
  })

  it('shows the second answer in the words of the first', async () => {
    stornoDoneAction.mockResolvedValue({ ok: false, error: 'storno_answered' })
    draw(storno, manager)
    await userEvent.click(screen.getByRole('button', { name: 'Storno done' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(toast.error.mock.calls[0]?.[0]).toBe('Someone already answered: Storno done.')
  })
})

describe('the dispute row', () => {
  it('says the payment and the provider’s answer-by date', () => {
    draw(dispute, manager)
    expect(screen.getByText('Card dispute')).toBeTruthy()
    expect(screen.getByText(/Payment of .*46\.00.* \(Table 3, 25 October\)\./)).toBeTruthy()
    expect(screen.getByText(/Answer in Stripe by 4 November/)).toBeTruthy()
  })

  it('names no provider’s date when the provider gave none', () => {
    draw({ ...dispute, dispute: { ...(dispute.dispute as object), due: null } as never }, manager)
    expect(screen.queryByText(/Answer in/)).toBeNull()
  })

  it('opens the evidence on the payment’s sheet for a manager, and has no button for the tablet', async () => {
    paymentDetailAction.mockResolvedValue({ ok: false })
    draw(dispute, manager)
    await userEvent.click(screen.getByRole('button', { name: 'See the evidence' }))
    await waitFor(() =>
      expect(paymentDetailAction).toHaveBeenCalledWith({
        venueId: manager.venueId,
        paymentId: 'py_9',
      }),
    )
  })

  it('has no button for the tablet or a waiter', () => {
    draw(dispute, tablet)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the refund that did not go through', () => {
  it('asks the manager to check with the accountant, with nothing to press', () => {
    draw(failed, manager)
    expect(
      screen.getByText(
        /A refund of .*7\.00.* didn't go through at Stripe\. The storno was already made: check with your accountant\./,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
