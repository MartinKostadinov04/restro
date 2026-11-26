// What the booking page's choice specs share (#580): the fixture (scripts/seed-booking-e2e.ts) in
// one of its modes, what it left in the club's book, the stubbed Turnstile and the page itself on
// a 390 px phone, the narrowest width a Bulgarian line must fit (CLAUDE.md, the screen plans).
import { devices, expect, type Page } from '@playwright/test'

import { runScript } from './global-setup'

/** A phone 390 px wide: Pixel 7's browser, narrowed to the width the screen plans check. */
export const PHONE_390 = { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }

/** The same phone for a second guest's page (`browser.newPage`), which takes no browser type. */
const { defaultBrowserType: _browserType, ...phoneContext } = PHONE_390
export const PHONE_390_CONTEXT = phoneContext

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

export interface Seeded {
  readonly path: string
  readonly open: string
  readonly closed: string
}

/** One online booking of the night, as the club's book holds it. */
export interface Booked {
  readonly status: string
  readonly area: string | null
  readonly spots: readonly string[]
}

function lastLine<T>(output: string, event: string): T {
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes(event))
  if (!line) throw new Error(`the seed printed no ${event}:\n${output}`)
  return JSON.parse(line) as T
}

/** Seeds Booking Club with online booking on and guests choosing an Area or their own spot. */
export function seedChoice(mode: 'area' | 'spot'): Seeded {
  return lastLine<Seeded>(
    runScript('./scripts/seed-booking-e2e.ts', 'seed', SIM, 'on', mode),
    'seed_booking_e2e_done',
  )
}

/** The online bookings of a night: Requested or Reserved, the Area asked for, the spots held. */
export function booked(night: string): Booked[] {
  return lastLine<{ rows: Booked[] }>(
    runScript('./scripts/seed-booking-e2e.ts', 'asked', night),
    'seed_booking_e2e_asked',
  ).rows
}

/** The booking screen's own alert (Next's route announcer is an alert too). */
export const refusal = (page: Page) => page.locator('[data-page="booking"]').getByRole('alert')

/** A phone number of its own per guest: asking twice for the same night is answered once. */
export const guestPhone = () =>
  `+359 888 ${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`

export async function openBooking(page: Page, path: string): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
  await page.goto(`${path}?lang=en`)
  await expect(page.locator('[data-page="booking"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Book a table' })).toBeVisible()
}

/** Fills who is coming: the night is chosen first, by the caller. */
export async function fillGuest(page: Page, name: string): Promise<void> {
  await page.getByLabel('Guests').fill('2')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Phone').fill(guestPhone())
  await page.getByLabel('Email').fill('guest@example.com')
}

/** The page is no wider than the phone: nothing scrolls sideways but the plan's own frame. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    view: window.innerWidth,
  }))
  expect(widths.page).toBeLessThanOrEqual(widths.view)
}
