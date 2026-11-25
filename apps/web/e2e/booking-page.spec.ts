// The booking page, night only (#577; spec #322), on a production build, on a phone: Booking Club's
// Demo Bar in the Editorial Style, open every night, with one closed date three nights ahead.
//
//   - a guest books a night: the night, how many, name, phone, email and a note; the answer says the
//     request is with the club and an email will follow, and the club's book holds one Requested
//     reservation for that night, with no spot;
//   - the closed night is marked closed in the list, and choosing it is refused in words that name
//     another way, with Send off;
//   - with online booking off, the page says the club takes no online bookings and links nowhere.
//
// The fixture is scripts/seed-booking-e2e.ts. Cloudflare's Turnstile script is stubbed in the page;
// the server checks its token with Cloudflare's published test secret (playwright.config.ts).
import { devices, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'

test.use({ ...devices['Pixel 7'] })
test.describe.configure({ mode: 'serial' })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

interface Seeded {
  readonly path: string
  readonly open: string
  readonly closed: string
}

function lastLine<T>(output: string, event: string): T {
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes(event))
  if (!line) throw new Error(`the seed printed no ${event}:\n${output}`)
  return JSON.parse(line) as T
}

function seed(mode: 'on' | 'off'): Seeded {
  return lastLine<Seeded>(
    runScript('./scripts/seed-booking-e2e.ts', 'seed', SIM, mode),
    'seed_booking_e2e_done',
  )
}

function requested(night: string): { party_size: number; spots: number }[] {
  return lastLine<{ rows: { party_size: number; spots: number }[] }>(
    runScript('./scripts/seed-booking-e2e.ts', 'requested', night),
    'seed_booking_e2e_requested',
  ).rows
}

async function openPage(page: Page, path: string): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
  await page.goto(`${path}?lang=en`)
  await expect(page.locator('[data-page="booking"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Book a table' })).toBeVisible()
}

test.describe('the booking page', () => {
  let seeded: Seeded

  test.beforeAll(() => {
    seeded = seed('on')
  })

  test('a guest books a night and sees that the request is with the club', async ({ page }) => {
    test.setTimeout(90_000)
    await openPage(page, seeded.path)
    const before = requested(seeded.open).length

    await page.getByLabel('Night').selectOption(seeded.open)
    await page.getByLabel('Guests').fill('4')
    await page.getByLabel('Name').fill('Mira Ivanova')
    await page.getByLabel('Phone').fill('+359 888 123 456')
    await page.getByLabel('Email').fill('mira@example.com')
    await page.getByLabel('Note (optional)').fill('A birthday')
    await page.getByRole('button', { name: 'Send the request' }).click()

    const answer = page.getByRole('status')
    await expect(answer).toContainText('Your request is with the club', { timeout: 20_000 })
    await expect(answer).toContainText('The club will look at it and send you an email.')
    await expect(page.getByRole('button', { name: 'Send the request' })).toHaveCount(0)

    // It arrived as Requested: one more for that night, the guest's number of people, no spot.
    const rows = requested(seeded.open)
    expect(rows).toHaveLength(before + 1)
    expect(rows.at(-1)).toEqual({ party_size: 4, spots: 0 })
  })

  test('a closed night is marked closed and refused in words that name another way', async ({
    page,
  }) => {
    await openPage(page, seeded.path)
    const night = page.getByLabel('Night')
    await expect(night.locator(`option[value="${seeded.closed}"]`)).toContainText('(closed)')

    await night.selectOption(seeded.closed)
    await expect(page.getByRole('alert')).toHaveText(
      'The club is closed that night. Choose another night, or call the club.',
    )
    await expect(page.getByRole('button', { name: 'Send the request' })).toBeDisabled()

    // Another night clears it.
    await night.selectOption(seeded.open)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send the request' })).toBeEnabled()
  })
})

test('with online booking off, the page says so and links nowhere', async ({ page }) => {
  const { path } = seed('off')
  await openPage(page, path)
  await expect(page.getByRole('heading', { name: 'No online bookings' })).toBeVisible()
  await expect(
    page.getByText('This club takes no online bookings. Call the club or ask at the door.'),
  ).toBeVisible()
  await expect(page.locator('form')).toHaveCount(0)
  await expect(page.locator('[data-page="booking"] a')).toHaveCount(0)
})
