// @vitest-environment jsdom

import type { BookingBinding, BookingView } from '@restro/shell'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditorialMarketBooking } from './booking'
import { BOOKING_CSS } from './booking-css'
import { EDITORIAL_CSS } from './css'
import { richView } from './test-views'

vi.setConfig({ testTimeout: 15_000 })

afterEach(cleanup)

const view = richView()

const BOOKING: BookingView = {
  locale: 'en_US',
  venueName: 'Club Night',
  on: true,
  nights: [
    { date: '2026-11-26', label: 'Thu, 26 Nov', open: true },
    { date: '2026-11-27', label: 'Fri, 27 Nov', open: false },
    { date: '2026-11-28', label: 'Sat, 28 Nov', open: true },
  ],
}

function bindingOf(overrides: Partial<BookingBinding> = {}): BookingBinding {
  return {
    stage: 'form',
    refusal: null,
    night: null,
    checkNight: vi.fn(),
    send: vi.fn(),
    ...overrides,
  }
}

function fill() {
  fireEvent.change(screen.getByLabelText('Guests'), { target: { value: '4' } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ivan' } })
  fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '+359 88 123 4567' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ivan@example.com' } })
}

describe('the booking page of the Editorial Market (#577)', () => {
  it("is drawn in the venue's Style, on the menu's own root", () => {
    const { container } = render(<EditorialMarketBooking view={view} booking={BOOKING} />)
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toBe('rm')
    expect(root.dataset.page).toBe('booking')
    expect(root.getAttribute('style')).toContain('--rm-')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Book a table')
    expect(screen.getByText('Club Night')).toBeTruthy()
  })

  it('offers the nights of the file, the closed one marked', () => {
    render(<EditorialMarketBooking view={view} booking={BOOKING} binding={bindingOf()} />)
    const options = screen.getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['Thu, 26 Nov', 'Fri, 27 Nov (closed)', 'Sat, 28 Nov'])
  })

  it('asks the server about the night the form starts on', () => {
    const binding = bindingOf()
    render(<EditorialMarketBooking view={view} booking={BOOKING} binding={binding} />)
    expect(binding.checkNight).toHaveBeenCalledWith('2026-11-26')
  })

  it('asks the server about a chosen night, and refuses a closed one in words that name another way', () => {
    const binding = bindingOf()
    render(<EditorialMarketBooking view={view} booking={BOOKING} binding={binding} />)
    fireEvent.change(screen.getByLabelText('Night'), { target: { value: '2026-11-27' } })
    expect(binding.checkNight).toHaveBeenCalledWith('2026-11-27')
    expect(screen.getByRole('alert').textContent).toBe(
      'The club is closed that night. Choose another night, or call the club.',
    )
    expect(
      (screen.getByRole('button', { name: 'Send the request' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it("follows the server's answer for the night over the file", () => {
    render(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        binding={bindingOf({ night: { night: '2026-11-26', answer: 'closed_date' } })}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/closed that night/)
  })

  it('sends the form, and never names a status, a spot or an id', () => {
    const binding = bindingOf()
    render(<EditorialMarketBooking view={view} booking={BOOKING} binding={binding} />)
    fill()
    fireEvent.submit(screen.getByRole('button', { name: 'Send the request' }))
    expect(binding.send).toHaveBeenCalledWith({
      night: '2026-11-26',
      partySize: 4,
      name: 'Ivan',
      phone: '+359 88 123 4567',
      email: 'ivan@example.com',
      note: null,
    })
  })

  it('shows the answer screen only once the host says the club took it (D72)', () => {
    const binding = bindingOf()
    const { rerender } = render(
      <EditorialMarketBooking view={view} booking={BOOKING} binding={binding} />,
    )
    fill()
    fireEvent.submit(screen.getByRole('button', { name: 'Send the request' }))
    expect(screen.queryByText('Your request is with the club')).toBeNull()
    rerender(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        binding={bindingOf({ stage: 'sending' })}
      />,
    )
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeTruthy()
    rerender(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        binding={bindingOf({ stage: 'sent' })}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Your request is with the club')
    expect(screen.getByRole('status').textContent).toContain('send you an email')
    // The focus moves to the answer's heading, not lost with the form.
    expect(document.activeElement?.textContent).toBe('Your request is with the club')
  })

  it("words the host's refusal", () => {
    render(
      <EditorialMarketBooking
        view={view}
        booking={BOOKING}
        binding={bindingOf({ refusal: 'human_check' })}
      />,
    )
    expect(screen.getByRole('alert').textContent).toMatch(/person/)
  })

  it('says the club takes no online bookings when the page is off, and links nowhere', () => {
    const { container } = render(
      <EditorialMarketBooking
        view={view}
        booking={{ ...BOOKING, on: false, nights: [] }}
        binding={bindingOf()}
      />,
    )
    expect(screen.getByText('No online bookings')).toBeTruthy()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('form')).toBeNull()
  })

  it('cannot send without a host (a preview)', () => {
    render(<EditorialMarketBooking view={view} booking={BOOKING} />)
    expect(
      (screen.getByRole('button', { name: 'Send the request' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('speaks Bulgarian on a Bulgarian page', () => {
    render(
      <EditorialMarketBooking
        view={view}
        booking={{ ...BOOKING, locale: 'bg_BG' }}
        binding={bindingOf()}
      />,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Резервирайте маса')
  })
})

describe('the booking stylesheet', () => {
  it('holds no colour of its own (R13)', () => {
    expect(BOOKING_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(BOOKING_CSS).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/)
    expect(BOOKING_CSS).not.toMatch(/(?<![-\w])(?:white|black|red|grey|gray)(?![-\w])/i)
  })

  it('has only its own bk- classes, so no menu rule moves', () => {
    const selectors = BOOKING_CSS.match(/^[^@\s{}][^{]*\{/gm) ?? []
    expect(selectors.length).toBeGreaterThan(0)
    for (const selector of selectors) expect(selector, selector).toMatch(/^\.bk-/)
    for (const name of BOOKING_CSS.match(/\.bk-[\w-]+/g) ?? []) {
      expect(EDITORIAL_CSS, name).not.toContain(name)
    }
  })
})
