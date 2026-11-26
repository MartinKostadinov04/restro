// A guest's own link to his booking (#579; spec #322 stories 8 and 34), on a production build: a
// guest of Booking Club's Demo Bar books a night on his phone, opens his own link, sees the booking
// and cancels it after the one question; the club's list then shows it cancelled. A link that opens
// nothing gets the one plain page.
//
// The link is the one the worker writes into the guest's emails, worked out by the fixture from the
// booking's id with the test servers' key (playwright.config.ts). The fixture is scripts/seed-booking-e2e.ts. Cloudflare's
// Turnstile script is stubbed in the page; the server checks its token with Cloudflare's published
// test secret.

import { devices, expect, type Page, test } from '@playwright/test'

import { runScript, runScriptWith } from './global-setup'
import { ADMIN_PASSWORD, E2E_GUEST_LINK_KEY } from './support'

test.use({ ...devices['Pixel 7'] })
test.describe.configure({ mode: 'serial' })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`
const OWNER_EMAIL = 'booking-owner@demo-club.test'
const TABLET = { width: 1180, height: 820 }

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

interface Seeded {
  readonly path: string
  readonly open: string
}

interface Booked {
  readonly id: string
  readonly status: string
  readonly venue_id: string
  /** The path of his own link as the worker writes it into his emails. */
  readonly link: string | null
}

function lastLine<T>(output: string, event: string): T {
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes(event))
  if (!line) throw new Error(`the seed printed no ${event}:\n${output}`)
  return JSON.parse(line) as T
}

const booked = (night: string, name: string) =>
  lastLine<Booked>(
    runScriptWith(
      { GUEST_LINK_KEY: E2E_GUEST_LINK_KEY },
      './scripts/seed-booking-e2e.ts',
      'booked',
      night,
      name,
    ),
    'seed_booking_e2e_booked',
  )

async function stubTurnstile(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
}

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues(\/vn_[^/?]+\?tab=\w+)?$/, { timeout: 8_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

/** The booking screen's facts, label by label. */
async function facts(page: Page): Promise<Record<string, string>> {
  const screen = page.locator('[data-page="booking"]')
  const terms = await screen.getByRole('term').allTextContents()
  const values = await screen.getByRole('definition').allTextContents()
  return Object.fromEntries(terms.map((term, index) => [term, values[index] ?? '']))
}

let seeded: Seeded

test.beforeAll(() => {
  seeded = lastLine<Seeded>(
    runScript('./scripts/seed-booking-e2e.ts', 'seed', SIM, 'on'),
    'seed_booking_e2e_done',
  )
  runScript('./scripts/seed-booking-e2e.ts', 'owner', OWNER_EMAIL)
})

test('a guest opens his own link, cancels, and the club’s list shows it cancelled', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const name = `Link Guest ${Math.random().toString(36).slice(2, 8)}`

  // He books a night on the booking page.
  await stubTurnstile(page)
  await page.goto(`${seeded.path}?lang=en`)
  await expect(page.locator('[data-page="booking"]')).toBeVisible({ timeout: 20_000 })
  await page.getByLabel('Night').selectOption(seeded.open)
  await page.getByLabel('Guests').fill('3')
  await page.getByLabel('Name').fill(name)
  await page
    .getByLabel('Phone')
    .fill(`+359 888 ${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`)
  await page.getByLabel('Email').fill('link-guest@example.com')
  await page.getByRole('button', { name: 'Send the request' }).click()
  await expect(page.getByRole('status')).toContainText('Your request is with the club', {
    timeout: 20_000,
  })
  const booking = booked(seeded.open, name)
  expect(booking.status).toBe('requested')

  // His own link: that booking, no form, and a Cancel.
  if (booking.link === null) throw new Error('the booking stored no link for the test key')
  expect(booking.link.startsWith(`${seeded.path}/`)).toBe(true)
  await page.goto(`${booking.link}?lang=en`)
  await expect(page.getByRole('heading', { level: 1, name: 'Your booking' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('[data-page="booking"] dl')).toBeVisible()
  expect(await facts(page)).toMatchObject({ Guests: '3', Status: 'Waiting for the club’s answer' })
  await expect(page.locator('form')).toHaveCount(0)
  await expect(page.locator('[data-page="booking"]')).not.toContainText('link-guest@example.com')
  // The address keeps the token in its path, never in the query.
  expect(new URL(page.url()).pathname).toBe(booking.link)
  expect(new URL(page.url()).search).not.toContain(booking.link.slice(seeded.path.length + 1))

  await page.getByRole('button', { name: 'Cancel the booking' }).click()
  await expect(
    page.getByText(
      'Cancel this booking? The club will be told. You cannot undo this from the link.',
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Yes, cancel it' }).click()
  await expect(page.locator('[data-page="booking"]').getByRole('status')).toHaveText(
    'Your booking is cancelled. The club has been told.',
    { timeout: 20_000 },
  )
  expect((await facts(page)).Status).toBe('Cancelled')
  await expect(page.getByRole('button', { name: 'Cancel the booking' })).toHaveCount(0)
  expect(booked(seeded.open, name).status).toBe('cancelled')

  // The club's list shows it as any cancellation.
  const staff = await browser.newContext({ viewport: TABLET })
  try {
    const desk = await staff.newPage()
    await signIn(desk, OWNER_EMAIL)
    await staff.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(desk.url()).origin }])
    await desk.goto(`/venues/${booking.venue_id}?tab=reservations&day=${seeded.open}`)
    await expect(desk.getByTestId('reservations-night')).toBeVisible({ timeout: 20_000 })
    const row = desk.getByTestId('rv-row').filter({ hasText: name })
    await expect(row).toHaveAttribute('data-status', 'cancelled')
  } finally {
    await staff.close()
  }
})

test('a link that opens nothing gets one plain page', async ({ page }) => {
  for (const token of ['A'.repeat(43), 'not-a-real-token']) {
    await page.goto(`${seeded.path}/${token}?lang=en`)
    await expect(page.getByRole('heading', { name: 'This booking has passed' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(
      page.getByText('This link no longer opens a booking. Call the club if you need to.'),
    ).toBeVisible()
    await expect(page.locator('[data-page="booking"] dl')).toHaveCount(0)
  }
})
