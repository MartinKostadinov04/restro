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
  guestMay: 'night',
  areas: [],
  plans: [],
}

/** A plan of three spots (#580): T1 in the Hall, T2 with no Area, and a round Bar. */
const PLAN: BookingView['plans'][number] = {
  id: 'fp_0123456789ABCDEFGHIJKL',
  name: 'Ground floor',
  aspect: 0.5,
  spots: [
    {
      id: 'sp_T1aaaaaaaaaaaaaaaaaaaa',
      name: 'T1',
      symbol: 'table',
      seats: 4,
      area: 'Hall',
      shape: 'rect',
      rotation: 0,
      box: { left: 5, top: 10, width: 20, height: 40 },
    },
    {
      id: 'sp_T2aaaaaaaaaaaaaaaaaaaa',
      name: 'T2',
      symbol: 'table',
      seats: null,
      area: null,
      shape: 'rect',
      rotation: 90,
      box: { left: 40, top: 10, width: 20, height: 40 },
    },
    {
      id: 'sp_BARaaaaaaaaaaaaaaaaaaa',
      name: 'Bar',
      symbol: 'stool',
      seats: 2,
      area: null,
      shape: 'circle',
      rotation: 0,
      box: { left: 75, top: 10, width: 20, height: 40 },
    },
  ],
}

const SPOTS: BookingView = { ...BOOKING, guestMay: 'spot', plans: [PLAN] }
const AREAS: BookingView = {
  ...BOOKING,
  guestMay: 'area',
  areas: [
    { id: 'ar_HALLaaaaaaaaaaaaaaaaaa', name: 'Hall' },
    { id: 'ar_VIPaaaaaaaaaaaaaaaaaaa', name: 'VIP' },
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
      areaId: null,
      spotIds: [],
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

describe('an Area or a spot on the booking page (#580)', () => {
  it('asks for one of the Areas, and sends the one chosen', () => {
    const binding = bindingOf()
    render(<EditorialMarketBooking view={view} booking={AREAS} binding={binding} />)
    const area = screen.getByLabelText('Area') as HTMLSelectElement
    expect(area.required).toBe(true)
    expect([...area.options].map((option) => option.textContent)).toEqual([
      'Choose an area',
      'Hall',
      'VIP',
    ])
    fireEvent.change(area, { target: { value: 'ar_VIPaaaaaaaaaaaaaaaaaaa' } })
    fill()
    fireEvent.submit(screen.getByRole('button', { name: 'Send the request' }))
    expect(binding.send).toHaveBeenCalledWith(
      expect.objectContaining({ areaId: 'ar_VIPaaaaaaaaaaaaaaaaaaa', spotIds: [] }),
    )
  })

  it('draws the plan with each spot free or taken in words, and sends the spots picked', () => {
    const binding = bindingOf({
      night: {
        night: '2026-11-26',
        answer: 'open',
        spots: {
          sp_T1aaaaaaaaaaaaaaaaaaaa: 'free',
          sp_T2aaaaaaaaaaaaaaaaaaaa: 'taken',
          sp_BARaaaaaaaaaaaaaaaaaaa: 'free',
        },
      },
    })
    render(<EditorialMarketBooking view={view} booking={SPOTS} binding={binding} />)
    expect(screen.getByRole('group', { name: 'Your spot' })).toBeTruthy()
    const t1 = screen.getByRole('button', { name: 'T1, Hall, 4 seats, free' })
    const t2 = screen.getByRole('button', { name: 'T2, taken' }) as HTMLButtonElement
    expect(t2.disabled).toBe(true)
    expect(t1.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(t1)
    expect(t1.getAttribute('aria-pressed')).toBe('true')
    expect(t1.getAttribute('aria-label')).toBe('T1, Hall, 4 seats, picked')
    expect(screen.getByText('Picked: T1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Bar, 2 seats, free' }))
    fill()
    fireEvent.submit(screen.getByRole('button', { name: 'Send the request' }))
    expect(binding.send).toHaveBeenCalledWith(
      expect.objectContaining({
        areaId: null,
        spotIds: ['sp_T1aaaaaaaaaaaaaaaaaaaa', 'sp_BARaaaaaaaaaaaaaaaaaaa'],
      }),
    )
  })

  it('says it is checking until the night answers, and nothing can be picked meanwhile', () => {
    render(<EditorialMarketBooking view={view} booking={SPOTS} binding={bindingOf()} />)
    expect(screen.getByText('Checking which spots are free…')).toBeTruthy()
    for (const spot of screen.getAllByRole('button', { pressed: false })) {
      expect((spot as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByText('No spot picked: the club will seat you.')).toBeTruthy()
  })

  it('says the spot was just taken, and drops it once the night reads it taken', () => {
    const free = {
      night: '2026-11-26',
      answer: 'open' as const,
      spots: {
        sp_T1aaaaaaaaaaaaaaaaaaaa: 'free' as const,
        sp_T2aaaaaaaaaaaaaaaaaaaa: 'free' as const,
        sp_BARaaaaaaaaaaaaaaaaaaa: 'free' as const,
      },
    }
    const { rerender } = render(
      <EditorialMarketBooking view={view} booking={SPOTS} binding={bindingOf({ night: free })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'T2, free' }))
    rerender(
      <EditorialMarketBooking
        view={view}
        booking={SPOTS}
        binding={bindingOf({
          refusal: 'spot_taken',
          night: { ...free, spots: { ...free.spots, sp_T2aaaaaaaaaaaaaaaaaaaa: 'taken' } },
        })}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'Someone just took that spot. Pick another one on the plan.',
    )
    expect(screen.getByRole('button', { name: 'T2, taken' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByText('No spot picked: the club will seat you.')).toBeTruthy()
  })

  it('shows its own answer when the booking confirmed itself', () => {
    render(
      <EditorialMarketBooking
        view={view}
        booking={SPOTS}
        binding={bindingOf({ stage: 'confirmed' })}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Your booking is confirmed')
    expect(document.activeElement?.textContent).toBe('Your booking is confirmed')
  })

  it('speaks Bulgarian on the plan too', () => {
    render(
      <EditorialMarketBooking
        view={view}
        booking={{ ...SPOTS, locale: 'bg_BG' }}
        binding={bindingOf({
          night: {
            night: '2026-11-26',
            answer: 'open',
            spots: { sp_T1aaaaaaaaaaaaaaaaaaaa: 'free' },
          },
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'T1, Hall, 4 места, свободно' })).toBeTruthy()
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
