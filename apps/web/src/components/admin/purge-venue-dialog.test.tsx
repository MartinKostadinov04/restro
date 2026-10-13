// @vitest-environment jsdom
// "Delete permanently" (S3, D83): the dialog that says in plain words what goes, the typed name
// that opens the button, and what happens with the server's answers. The list around it is tested
// in deleted-venues-list.test.tsx.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { purgeVenueAction } from '@/server/venues-actions'
import { renderWithIntl } from '@/test-utils'

import { PurgeVenueDialog } from './purge-venue-dialog'

vi.mock('@/server/venues-actions', () => ({ purgeVenueAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast: toasts }))

const VENUE_ID = 'vn_abcdefghijklmnopqrstuv'
const NAME = 'Neon Cellar'
const ERASED_ON = 'Nov 10, 2026'

const purged = vi.fn()

/** The dialog with an opener, as the list has it. */
function Host() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="opener">
        open
      </button>
      <PurgeVenueDialog
        open={open}
        onOpenChange={setOpen}
        venueId={VENUE_ID}
        venueName={NAME}
        erasedOn={ERASED_ON}
        onPurged={purged}
      />
    </>
  )
}

function dialog(locale?: 'bg') {
  renderWithIntl(<Host />, locale ? { locale } : {})
  return userEvent.setup({ delay: null })
}

const opener = () => screen.getByTestId('opener')
const typed = () => screen.getByTestId('purge-venue-confirm-input') as HTMLInputElement
const confirm = () => screen.getByTestId('purge-venue-confirm') as HTMLButtonElement

beforeEach(() => {
  vi.mocked(purgeVenueAction).mockReset()
  vi.mocked(purgeVenueAction).mockResolvedValue({ ok: true, name: NAME, queued: true })
  toasts.success.mockReset()
  toasts.warning.mockReset()
  purged.mockReset()
})

describe('the Delete permanently dialog', () => {
  it('is not there until it is opened', () => {
    dialog()
    expect(screen.queryByTestId('purge-venue-dialog')).toBeNull()
  })

  it('says what goes, in plain words, and names the venue and the day the bin would erase it', async () => {
    const user = dialog()
    await user.click(opener())
    expect(screen.getByRole('dialog', { name: `Delete ${NAME} permanently?` })).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).toContain(`without waiting until ${ERASED_ON}`)
    expect(screen.getByRole('dialog').textContent).toContain('cannot be undone')
    const effects = screen.getByTestId('purge-venue-effects').textContent ?? ''
    // What is erased …
    expect(effects).toContain('menus, sections and items')
    expect(effects).toContain('every published version')
    expect(effects).toContain('tables and QR codes')
    // … what never comes back, what is freed, and what stays.
    expect(effects).toContain('The codes never come back')
    expect(effects).toContain('address name is freed')
    expect(effects).toContain('Items that the till or another venue still uses stay')
  })

  it('keeps the button shut until the venue’s name is typed exactly (spaces around it do not count)', async () => {
    const user = dialog()
    await user.click(opener())
    expect(confirm().disabled).toBe(true)
    await user.type(typed(), 'Neon')
    expect(confirm().disabled).toBe(true)
    await user.clear(typed())
    await user.type(typed(), 'neon cellar')
    expect(confirm().disabled).toBe(true)
    await user.clear(typed())
    await user.type(typed(), `  ${NAME}  `)
    expect(confirm().disabled).toBe(false)
    expect(purgeVenueAction).not.toHaveBeenCalled()
  })

  it('erases with the typed name, closes, tells the list and says it is on its way', async () => {
    const user = dialog()
    await user.click(opener())
    await user.type(typed(), NAME)
    await user.click(confirm())

    await waitFor(() => expect(purged).toHaveBeenCalledTimes(1))
    expect(purgeVenueAction).toHaveBeenCalledWith({ venueId: VENUE_ID, confirmName: NAME })
    expect(toasts.success).toHaveBeenCalledWith(`${NAME} is being erased. It leaves this list now.`)
    expect(toasts.warning).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('purge-venue-dialog')).toBeNull())
  })

  it('warns, and still lets the venue go, when the erase could not be queued (the daily purge does it)', async () => {
    vi.mocked(purgeVenueAction).mockResolvedValue({ ok: true, name: NAME, queued: false })
    const user = dialog()
    await user.click(opener())
    await user.type(typed(), NAME)
    await user.click(confirm())

    await waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1))
    expect(toasts.warning).toHaveBeenCalledWith(
      `${NAME} could not be sent to be erased just now. It is erased by itself on ${ERASED_ON}.`,
    )
    expect(toasts.success).not.toHaveBeenCalled()
    expect(purged).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['not_allowed', 'Only an owner can delete a venue permanently.'],
    ['invalid', 'This venue could not be found.'],
    ['not_deleted', 'This venue is not in the deleted venues. Delete it first.'],
    ['name_mismatch', 'The name does not match. Type it exactly as shown.'],
    ['failed', 'Something went wrong. The venue was not deleted, try again.'],
  ] as const)('shows the answer %s and stays open', async (error, text) => {
    vi.mocked(purgeVenueAction).mockResolvedValue({ ok: false, error })
    const user = dialog()
    await user.click(opener())
    await user.type(typed(), NAME)
    await user.click(confirm())
    expect((await screen.findByTestId('purge-venue-error')).textContent).toBe(text)
    expect(purged).not.toHaveBeenCalled()
    expect(toasts.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('purge-venue-dialog')).toBeTruthy()
    // Typing again clears the message.
    await user.type(typed(), 'x')
    expect(screen.queryByTestId('purge-venue-error')).toBeNull()
  })

  it('shows "failed" when the call itself breaks', async () => {
    vi.mocked(purgeVenueAction).mockRejectedValue(new Error('network'))
    const user = dialog()
    await user.click(opener())
    await user.type(typed(), NAME)
    await user.click(confirm())
    expect((await screen.findByTestId('purge-venue-error')).textContent).toContain(
      'Something went wrong',
    )
    expect(purged).not.toHaveBeenCalled()
  })

  it('starts empty each time it is opened, and Cancel closes it without a call', async () => {
    const user = dialog()
    await user.click(opener())
    await user.type(typed(), 'Neon')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByTestId('purge-venue-dialog')).toBeNull())
    await user.click(opener())
    expect(typed().value).toBe('')
    expect(purgeVenueAction).not.toHaveBeenCalled()
    expect(purged).not.toHaveBeenCalled()
  })

  it('is in Bulgarian when the interface is', async () => {
    const user = dialog('bg')
    await user.click(opener())
    expect(screen.getByRole('dialog', { name: `Да изтрием ли ${NAME} завинаги?` })).toBeTruthy()
    expect(screen.getByTestId('purge-venue-effects').textContent).toContain(
      'Кодовете никога не се връщат',
    )
    expect(confirm().textContent).toBe('Изтрий завинаги')
  })
})
