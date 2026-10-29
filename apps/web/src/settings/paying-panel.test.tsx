// @vitest-environment jsdom
import type { LegalDetails } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  disconnectPayingAction,
  finishConnectionAction,
  savePayingAction,
  startConnectionAction,
  tickPayingCheckAction,
} from '@/server/settings/paying-actions'
import type { PayingView } from '@/server/settings/paying-view'
import { renderWithIntl } from '@/test-utils'

import { PayingPanel } from './paying-panel'

vi.mock('@/server/settings/paying-actions', () => ({
  disconnectPayingAction: vi.fn(),
  finishConnectionAction: vi.fn(),
  savePayingAction: vi.fn(),
  startConnectionAction: vi.fn(),
  tickPayingCheckAction: vi.fn(),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), message: vi.fn() },
}))
const replace = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, refresh }),
  usePathname: () => '/venues/vn_0000000000000000000001',
}))

const VENUE = 'vn_0000000000000000000001'
const LEGAL: LegalDetails = {
  name: 'Club Nights EOOD',
  eik: '123456789',
  address: 'Sofia, 1 Example Street',
  privacyUrl: 'https://club.example/privacy',
}
const OK = { ok: true, details: {} } as const

/** A view of a connected account whose card checks are all missing, as the loader would send it. */
function view(overrides: Partial<PayingView> = {}): PayingView {
  const passed = (check: PayingView['checks'][number]['check']) =>
    overrides.missing === undefined ? false : !overrides.missing.includes(check)
  return {
    venueId: VENUE,
    state: 'connected',
    accountName: 'Club Nights',
    checks: [
      { check: 'cardPayments', passed: passed('cardPayments'), source: 'provider' },
      { check: 'cardTypeInTill', passed: passed('cardTypeInTill'), source: 'owner' },
      { check: 'paymentTables', passed: passed('paymentTables'), source: 'venue' },
      { check: 'receiptEmailsOff', passed: passed('receiptEmailsOff'), source: 'owner' },
    ],
    missing: ['cardPayments', 'cardTypeInTill', 'paymentTables', 'receiptEmailsOff'],
    providerMissing: ['business details'],
    payingOn: false,
    lostReason: null,
    canConnect: true,
    minCardMinor: null,
    providerMinimumMinor: 50,
    currency: 'EUR',
    provider: 'Testpay',
    source: 'Testtill',
    tips: false,
    legal: null,
    email: 'owner@example.com',
    ...overrides,
  }
}

beforeEach(() => {
  for (const action of [
    disconnectPayingAction,
    finishConnectionAction,
    savePayingAction,
    startConnectionAction,
    tickPayingCheckAction,
  ]) {
    vi.mocked(action).mockReset()
  }
  vi.mocked(disconnectPayingAction).mockResolvedValue(OK)
  vi.mocked(savePayingAction).mockResolvedValue(OK)
  vi.mocked(tickPayingCheckAction).mockResolvedValue(OK)
  vi.mocked(finishConnectionAction).mockResolvedValue({ ...OK, ready: false })
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  replace.mockReset()
  refresh.mockReset()
})

describe('Settings › Paying', () => {
  it('offers Connect and the provider’s lede before anything is connected', () => {
    renderWithIntl(
      <PayingPanel view={view({ state: null, accountName: null })} connection={undefined} />,
    )
    expect(screen.getByRole('button', { name: 'Connect Testpay' })).toBeTruthy()
    expect(screen.getByText(/Guests pay their bill by card/).textContent).toContain('Testpay')
    // The account comes first in the missing list.
    expect(
      within(screen.getByTestId('paying-missing')).getAllByRole('listitem')[0]?.textContent,
    ).toBe('Connect Testpay')
  })

  it('shows the provider’s own requirements as one line, never the raw words', () => {
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    const card = screen.getByTestId('paying-missing-card')
    expect(card.textContent).toContain('Testpay still needs details from you.')
    expect(card.textContent).not.toContain('business details')
    expect(within(card).getByRole('button', { name: 'Continue in Testpay' })).toBeTruthy()
  })

  it('sends the owner to the provider’s form from Connect', async () => {
    vi.mocked(startConnectionAction).mockResolvedValue({ ok: false, error: 'payments_off' })
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view({ state: null })} connection={undefined} />)
    await user.click(screen.getByRole('button', { name: 'Connect Testpay' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn't open Testpay. Check the connection and press it again.",
        expect.anything(),
      ),
    )
    expect(startConnectionAction).toHaveBeenCalledWith({ venueId: VENUE })
  })

  it('ticks a check at once with Undo, and takes it back', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    await user.click(
      screen.getByRole('checkbox', { name: 'I chose the card payment type in Testtill' }),
    )
    await waitFor(() =>
      expect(tickPayingCheckAction).toHaveBeenCalledWith({
        venueId: VENUE,
        check: 'cardTypeInTill',
        done: true,
      }),
    )
    const toasted = vi.mocked(toast.success).mock.calls[0]
    expect(toasted?.[0]).toBe('Saved')
    const options = toasted?.[1] as { action: { onClick: () => void } } | undefined
    options?.action.onClick()
    await waitFor(() =>
      expect(tickPayingCheckAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        check: 'cardTypeInTill',
        done: false,
      }),
    )
  })

  it('links the payment-table item to Tables & QR', () => {
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    const link = screen.getByRole('link', { name: 'Go to Tables & QR' })
    expect(link.getAttribute('href')).toBe(`/venues/${VENUE}?tab=tables`)
  })

  it('lists the details as one missing check until they are saved, then not', () => {
    const { rerender } = renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    expect(screen.getByTestId('paying-missing-details')).toBeTruthy()
    rerender(<PayingPanel view={view({ legal: LEGAL })} connection={undefined} />)
    expect(screen.queryByTestId('paying-missing-details')).toBeNull()
  })

  it('says card payments are on, with no missing list, when everything passes', () => {
    renderWithIntl(
      <PayingPanel
        view={view({ payingOn: true, missing: [], legal: LEGAL, tips: true })}
        connection={undefined}
      />,
    )
    expect(screen.getByTestId('paying-on').textContent).toBe('Card payments are on.')
    expect(screen.queryByTestId('paying-missing')).toBeNull()
    expect(screen.getByTestId('paying-tips').textContent).toContain('Guests can add a tip.')
  })

  it('offers Reconnect, not dismissible, on lost access, and a restricted account words it', () => {
    const { rerender } = renderWithIntl(
      <PayingPanel
        view={view({ state: 'lost_access', lostReason: 'access_removed' })}
        connection={undefined}
      />,
    )
    expect(screen.getByTestId('paying-lost').textContent).toContain('Restro lost access')
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    rerender(
      <PayingPanel
        view={view({ state: 'lost_access', lostReason: 'account_restricted' })}
        connection={undefined}
      />,
    )
    expect(screen.getByTestId('paying-lost').textContent).toContain("can't take card payments")
  })

  it('reads the account back on return and says what happened', async () => {
    renderWithIntl(<PayingPanel view={view()} connection="return" />)
    await waitFor(() => expect(finishConnectionAction).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Testpay still needs a few details. Continue when you're ready.",
      ),
    )
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('section=paying'))
    expect(refresh).toHaveBeenCalled()
  })

  it('says the form timed out on a refresh and offers to continue', () => {
    renderWithIntl(<PayingPanel view={view({ state: 'connecting' })} connection="refresh" />)
    expect(screen.getByTestId('paying-connecting').textContent).toContain('form timed out')
    expect(screen.getByRole('button', { name: 'Continue in Testpay' })).toBeTruthy()
  })

  it('disconnects only after the dialog, and words a payment in flight', async () => {
    vi.mocked(disconnectPayingAction).mockResolvedValue({ ok: false, error: 'payment_in_flight' })
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    await user.click(screen.getByTestId('paying-account-menu'))
    await user.click(await screen.findByRole('menuitem', { name: 'Disconnect…' }))
    expect(screen.getByRole('dialog').textContent).toContain('Disconnect Testpay?')
    expect(disconnectPayingAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A guest is paying right now. Disconnect once the payment ends, in a few minutes.',
        expect.anything(),
      ),
    )
  })

  it('edits the smallest card payment in place and refuses below the provider’s minimum', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    expect(screen.getByTestId('paying-min-value').textContent).toBe("€0.50 (Testpay's minimum)")
    await user.click(screen.getByTestId('paying-min-edit'))
    const input = screen.getByLabelText('Smallest card payment')
    await user.clear(input)
    await user.type(input, '0.20{Enter}')
    expect(screen.getByRole('alert').textContent).toBe("Can't be below €0.50, Testpay's minimum.")
    expect(savePayingAction).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, '1001{Enter}')
    expect(screen.getByRole('alert').textContent).toBe("Can't be above €1,000.00.")
    await user.clear(input)
    await user.type(input, '5{Enter}')
    await waitFor(() =>
      expect(savePayingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { minCardMinor: 500 },
      }),
    )
  })

  it('keeps the details form unsaved until all four are filled, then saves them with Undo', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.hasAttribute('disabled')).toBe(true)
    await user.type(screen.getByLabelText('Legal name'), LEGAL.name)
    expect(screen.getByText('Unsaved')).toBeTruthy()
    await user.type(screen.getByLabelText('ЕИК (company number)'), '12345')
    await user.type(screen.getByLabelText('Privacy notice link'), 'http://club.example')
    await user.click(save)
    expect(savePayingAction).not.toHaveBeenCalled()
    expect(screen.getByText('ЕИК is 9 or 13 digits.')).toBeTruthy()
    expect(screen.getByText('Enter a full link starting with https://.')).toBeTruthy()
    expect(screen.getByText('Fill this in to turn card payments on.')).toBeTruthy()
    await user.clear(screen.getByLabelText('ЕИК (company number)'))
    await user.type(screen.getByLabelText('ЕИК (company number)'), LEGAL.eik)
    await user.type(screen.getByLabelText('Registered address'), LEGAL.address)
    await user.clear(screen.getByLabelText('Privacy notice link'))
    await user.type(screen.getByLabelText('Privacy notice link'), LEGAL.privacyUrl)
    await user.click(save)
    await waitFor(() =>
      expect(savePayingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { legalDetails: LEGAL },
      }),
    )
  })

  it('is read-only without the right: no buttons, ticks or inputs, and says so', () => {
    renderWithIntl(
      <PayingPanel view={view({ canConnect: false, legal: LEGAL })} connection={undefined} />,
    )
    expect(screen.getByTestId('paying-readonly').textContent).toBe(
      'Only someone allowed to connect payments can change these.',
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.getByTestId('paying-legal').textContent).toContain(LEGAL.eik)
    expect(screen.getByTestId('paying-missing-cardTypeInTill').textContent).toBe(
      'I chose the card payment type in Testtill',
    )
  })

  it('words the tips line when the POS cannot record a tip', () => {
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    expect(screen.getByTestId('paying-tips').textContent).toBe(
      "Tips aren't offered: Testtill can't put a tip on the same receipt yet.",
    )
  })
})
