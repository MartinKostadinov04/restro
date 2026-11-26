// @vitest-environment jsdom

import type { BookingView, GuestLinkBinding, GuestLinkBooking } from '@restro/shell'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketBooking } from './booking'
import { BOOKING_CSS } from './booking-css'
import { BOOKING_LINK_CSS } from './booking-link-css'
import { EDITORIAL_CSS } from './css'
import { richView } from './test-views'

vi.setConfig({ testTimeout: 15_000 })

afterEach(cleanup)

const view = richView()

const BOOKING: BookingView = {
  locale: 'en_US',
  venueName: 'Club Night',
  on: true,
  nights: [{ date: '2026-11-28', label: 'Sat, 28 Nov', open: true }],
}

const CONFIRMED: GuestLinkBooking = {
  night: '2026-11-28',
  time: '22:30',
  partySize: 4,
  spots: ['Bar 2', 'Bar 10'],
  state: 'confirmed',
  canCancel: true,
  nightStarted: false,
}

function linkOf(overrides: Partial<GuestLinkBinding> = {}): GuestLinkBinding {
  return {
    stage: 'shown',
    booking: CONFIRMED,
    cancelling: false,
    refusal: null,
    cancel: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function draw(link: GuestLinkBinding, booking: BookingView = BOOKING) {
  return render(<EditorialMarketBooking view={view} booking={booking} guestLink={link} />)
}

function facts(): Record<string, string> {
  const terms = screen.getAllByRole('term').map((term) => term.textContent ?? '')
  const values = screen.getAllByRole('definition').map((value) => value.textContent ?? '')
  return Object.fromEntries(terms.map((term, index) => [term, values[index] ?? '']))
}

describe("a guest's own link to his booking (#579)", () => {
  it('shows that booking in the venue’s Style: night, hour, party, spots and state, no form', () => {
    const { container } = draw(linkOf())
    expect((container.firstElementChild as HTMLElement).dataset.page).toBe('booking')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your booking')
    expect(facts()).toEqual({
      Night: 'Sat, Nov 28',
      Time: '22:30',
      Guests: '4',
      Spots: 'Bar 2, Bar 10',
      Status: 'Confirmed',
    })
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByLabelText('Phone')).toBeNull()
  })

  it('leaves out the spots before the club gives any', () => {
    draw(linkOf({ booking: { ...CONFIRMED, spots: [], state: 'requested' } }))
    expect(facts()).not.toHaveProperty('Spots')
    expect(facts().Status).toBe('Waiting for the club’s answer')
  })

  it('asks once before a cancel, saying the club is told and the link cannot undo it', () => {
    const link = linkOf()
    draw(link)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the booking' }))
    expect(link.cancel).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'Cancel this booking? The club will be told. You cannot undo this from the link.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'No, keep it' }))
    expect(screen.queryByRole('button', { name: 'Yes, cancel it' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the booking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    expect(link.cancel).toHaveBeenCalledTimes(1)
  })

  it('says cancelled only once the host says the server did it (D72)', () => {
    const link = linkOf()
    const { rerender } = draw(link)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the booking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }))
    rerender(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        guestLink={{ ...link, cancelling: true }}
      />,
    )
    expect(screen.queryByText('Your booking is cancelled. The club has been told.')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    rerender(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        guestLink={{ ...link, booking: { ...CONFIRMED, state: 'cancelled', canCancel: false } }}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe(
      'Your booking is cancelled. The club has been told.',
    )
    expect(facts().Status).toBe('Cancelled')
    expect(screen.queryByRole('button', { name: 'Cancel the booking' })).toBeNull()
  })

  it('offers no cancel once the night has started, and names the call to the club', () => {
    draw(linkOf({ booking: { ...CONFIRMED, canCancel: false, nightStarted: true } }))
    expect(screen.queryByRole('button', { name: 'Cancel the booking' })).toBeNull()
    expect(
      screen.getByText('The night has started. To change the booking, call the club.'),
    ).toBeTruthy()
  })

  it("words the server's refusal", () => {
    draw(linkOf({ refusal: 'night_started' }))
    expect(screen.getByRole('alert').textContent).toBe(
      'The night has started. To change the booking, call the club.',
    )
  })

  it('draws one plain page for a link that opens nothing, whatever the reason', () => {
    draw(linkOf({ stage: 'gone', booking: null }), { ...BOOKING, on: false })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('This booking has passed')
    expect(
      screen.getByText('This link no longer opens a booking. Call the club if you need to.'),
    ).toBeTruthy()
    expect(screen.queryAllByRole('term')).toEqual([])
  })

  it('offers to try again after a read that failed', () => {
    const link = linkOf({ stage: 'failed', booking: null })
    draw(link)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(link.retry).toHaveBeenCalledTimes(1)
  })

  it('speaks Bulgarian on a Bulgarian page', () => {
    draw(linkOf(), { ...BOOKING, locale: 'bg_BG' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Вашата резервация')
    expect(facts()['Статус']).toBe('Потвърдена')
    expect(screen.getByRole('button', { name: 'Отменете резервацията' })).toBeTruthy()
  })
})

describe('the booking link stylesheet', () => {
  it('holds no colour of its own (R13)', () => {
    expect(BOOKING_LINK_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(BOOKING_LINK_CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/)
    expect(BOOKING_LINK_CSS).not.toMatch(/(?<![-\w])(?:white|black|red|grey|gray)(?![-\w])/i)
  })

  it('has only its own bk- classes, none of the menu’s or the form’s', () => {
    const selectors = BOOKING_LINK_CSS.match(/^[^@\s{}][^{]*\{/gm) ?? []
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(selector, selector).toMatch(/^\.bk-/)
    for (const name of new Set(BOOKING_LINK_CSS.match(/\.bk-[\w-]+/g) ?? [])) {
      expect(EDITORIAL_CSS, name).not.toContain(`${name} `)
      expect(BOOKING_CSS, name).not.toContain(`${name} {`)
    }
  })
})
