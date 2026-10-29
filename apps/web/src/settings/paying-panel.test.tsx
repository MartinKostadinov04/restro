// @vitest-environment jsdom
import type { LegalDetails } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  disconnectPayingAction,
  finishConnectionAction,
  savePayFirstAction,
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
  savePayFirstAction: vi.fn(),
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
  // `missing` in an override names the failing checks; the server adds the details while unsaved.
  const failing = (
    overrides.missing ?? ['cardPayments', 'cardTypeInTill', 'paymentTables', 'receiptEmailsOff']
  ).filter((check) => check !== 'legalDetails')
  const legal = overrides.legal ?? null
  const passed = (check: PayingView['checks'][number]['check']) => !failing.includes(check)
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
    payingOn: false,
    lostReason: null,
    canConnect: true,
    minCardMinor: null,
    providerMinimumMinor: 50,
    currency: 'EUR',
    provider: 'Testpay',
    source: 'Testtill',
    tips: false,
    payFirst: null,
    email: 'owner@example.com',
    ...overrides,
    legal,
    missing: legal === null ? [...failing, 'legalDetails'] : failing,
  }
}

beforeEach(() => {
  for (const action of [
    disconnectPayingAction,
    finishConnectionAction,
    savePayFirstAction,
    savePayingAction,
    startConnectionAction,
    tickPayingCheckAction,
  ]) {
    vi.mocked(action).mockReset()
  }
  vi.mocked(disconnectPayingAction).mockResolvedValue(OK)
  vi.mocked(savePayingAction).mockResolvedValue(OK)
  vi.mocked(savePayFirstAction).mockResolvedValue(OK)
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

  it('drops ?connection=refresh from the address once it has said so', async () => {
    renderWithIntl(<PayingPanel view={view({ state: 'connecting' })} connection="refresh" />)
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(expect.stringContaining('section=paying')),
    )
    expect(replace.mock.calls[0]?.[0]).not.toContain('connection=')
    expect(screen.getByTestId('paying-connecting').textContent).toContain('form timed out')
  })

  it('stops the details fields at their stored lengths and strips spaces from a pasted ЕИК', async () => {
    const user = userEvent.setup()
    renderWithIntl(<PayingPanel view={view()} connection={undefined} />)
    expect(screen.getByLabelText('Legal name').getAttribute('maxlength')).toBe('200')
    expect(screen.getByLabelText('Registered address').getAttribute('maxlength')).toBe('300')
    expect(screen.getByLabelText('Privacy notice link').getAttribute('maxlength')).toBe('500')
    await user.type(screen.getByLabelText('Legal name'), LEGAL.name)
    await user.type(screen.getByLabelText('ЕИК (company number)'), '123 456 789')
    await user.type(screen.getByLabelText('Registered address'), LEGAL.address)
    await user.type(screen.getByLabelText('Privacy notice link'), LEGAL.privacyUrl)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(savePayingAction).toHaveBeenCalledWith({
        venueId: VENUE,
        changes: { legalDetails: LEGAL },
      }),
    )
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

  describe('the Pay first card (#216)', () => {
    const card = { itemMode: 'on_bill', applies: true, overrides: 0 } as const

    it('is not drawn where pay first cannot take effect', () => {
      renderWithIntl(<PayingPanel view={view({ payFirst: null })} connection={undefined} />)
      expect(screen.queryByTestId('paying-pay-first')).toBeNull()
    })

    it('shows the venue default picked and the switch on, with nothing about areas yet', () => {
      renderWithIntl(<PayingPanel view={view({ payFirst: card })} connection={undefined} />)
      const section = screen.getByTestId('paying-pay-first')
      expect(
        (within(section).getByTestId('paying-pf-mode-on_bill') as HTMLInputElement).checked,
      ).toBe(true)
      expect(within(section).getByRole('switch').getAttribute('aria-checked')).toBe('true')
      expect(screen.queryByTestId('paying-pf-overrides')).toBeNull()
      expect(screen.queryByTestId('paying-pf-off-d')).toBeNull()
    })

    it('saves the item default at once, with Undo that puts the previous one back', async () => {
      const user = userEvent.setup()
      renderWithIntl(<PayingPanel view={view({ payFirst: card })} connection={undefined} />)
      await user.click(screen.getByTestId('paying-pf-mode-pay_first'))
      await waitFor(() =>
        expect(savePayFirstAction).toHaveBeenCalledWith({
          venueId: VENUE,
          change: { itemMode: 'pay_first' },
        }),
      )
      const toasted = vi.mocked(toast.success).mock.calls[0]
      expect(toasted?.[0]).toBe('Items without their own choice: Pay first')
      const options = toasted?.[1] as { action: { onClick: () => void } } | undefined
      options?.action.onClick()
      await waitFor(() =>
        expect(savePayFirstAction).toHaveBeenLastCalledWith({
          venueId: VENUE,
          change: { itemMode: 'on_bill' },
        }),
      )
    })

    it('saves the switch at once, with Undo, and says what off means', async () => {
      const user = userEvent.setup()
      renderWithIntl(<PayingPanel view={view({ payFirst: card })} connection={undefined} />)
      await user.click(within(screen.getByTestId('paying-pay-first')).getByRole('switch'))
      await waitFor(() =>
        expect(savePayFirstAction).toHaveBeenCalledWith({
          venueId: VENUE,
          change: { applies: false },
        }),
      )
      expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe('Everything is ordered on the bill')
      const options = vi.mocked(toast.success).mock.calls[0]?.[1] as
        | { action: { onClick: () => void } }
        | undefined
      options?.action.onClick()
      await waitFor(() =>
        expect(savePayFirstAction).toHaveBeenLastCalledWith({
          venueId: VENUE,
          change: { applies: true },
        }),
      )
    })

    it('shows the consequence line when off and counts the areas and tables that differ', () => {
      renderWithIntl(
        <PayingPanel
          view={view({ payFirst: { itemMode: 'pay_first', applies: false, overrides: 3 } })}
          connection={undefined}
        />,
      )
      expect(screen.getByTestId('paying-pf-off-d').textContent).toContain('Tables & QR')
      const overrides = screen.getByTestId('paying-pf-overrides')
      expect(overrides.textContent).toContain('3 areas and tables have their own choice.')
      expect(
        within(overrides).getByRole('link', { name: 'Go to Tables & QR' }).getAttribute('href'),
      ).toBe(`/venues/${VENUE}?tab=tables`)
    })

    it('is text only without the right: no radios, no switch', () => {
      renderWithIntl(
        <PayingPanel
          view={view({ canConnect: false, payFirst: { ...card, overrides: 1 } })}
          connection={undefined}
        />,
      )
      const section = screen.getByTestId('paying-pay-first')
      expect(within(section).queryAllByRole('radio')).toHaveLength(0)
      expect(within(section).queryAllByRole('switch')).toHaveLength(0)
      expect(screen.getByTestId('paying-pf-mode-text').textContent).toContain('On the bill')
      expect(screen.getByTestId('paying-pf-applies-text').textContent).toBe('On')
    })
  })
})
