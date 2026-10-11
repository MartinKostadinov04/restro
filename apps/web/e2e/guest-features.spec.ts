import { type Browser, expect, type Page, test } from '@playwright/test'

import { addressOfVenue } from './menu-path'
import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_SLUG, VENUE_NAME } from './support'

// The composer's "Guest features" panel (brief SH-05b, D71) on a production build, with the REAL
// worker beside it, in English. The demo venue's "Filters (diet and tags)" switch is turned off and
// saved, the menu is published the real way from the Publishing tab, and a fresh browser then finds
// no filter control on the guest page (data-slot="menu.filters"). The switch goes back on and is
// published again, so the specs that read the demo menu afterwards find it as they left it.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const WORKER_WAIT = { timeout: 45_000 }
const SAVED = 'Saved. Guests see it after the next publish'
const FILTERS = 'Filters (diet and tags)'

let page: Page
let venueId = ''
let guestPath = ''

/** The demo venue's guest page on a fresh browser (nothing cached), how many filter controls it has. */
async function guestFilterControls(browser: Browser): Promise<number> {
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`${guestPath}?lang=en`)
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
    return await guest.locator('[data-slot="menu.filters"]').count()
  } finally {
    await context.close()
  }
}

/** Sets the filters switch in the composer's panel, saves it, and closes the panel. */
async function saveFiltersSwitch(on: boolean) {
  await page.goto(`/venues/${venueId}`)
  await expect(page.getByTestId('composer')).toBeVisible()
  await page.getByTestId('open-guest-features').click()
  const panel = page.getByTestId('guest-features-panel')
  await expect(panel).toBeVisible()
  const filters = panel.getByRole('switch', { name: FILTERS })
  if ((await filters.getAttribute('aria-checked')) !== String(on)) await filters.click()
  await panel.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText(SAVED)).toBeVisible()
  await expect(filters).toHaveAttribute('aria-checked', String(on))
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
}

/** Publishes the menu from the Publishing tab; the worker publishes it. */
async function publishFromTab() {
  await page.goto(`/venues/${venueId}?tab=publishing`)
  await expect(page.getByTestId('publish-panel')).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(/is live/, WORKER_WAIT)
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
  // Better Auth allows a few sign-ins per 10 seconds, and the other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(ADMIN_EMAIL)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues$/, { timeout: 5_000 })
      break
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  await page
    .getByTestId('venue-card')
    .filter({ hasText: VENUE_NAME })
    .getByRole('link', { name: 'Отвори' })
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(venueId).not.toBe('')
  const address = await addressOfVenue({ venueId })
  expect(address.slug).toBe(GUEST_SLUG)
  guestPath = address.path
  // English from here on (the sign-in page was in Bulgarian, the default).
  await page
    .context()
    .addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
})

test.afterAll(async () => {
  await page.close()
})

test('before any change, the guest page of the demo menu has its filter control', async ({
  browser,
}) => {
  expect(await guestFilterControls(browser)).toBe(1)
})

test('Filters off in the Guest features panel, saved', async () => {
  await saveFiltersSwitch(false)
})

test('published from the Publishing tab, the guest page has no filter control', async ({
  browser,
}) => {
  await publishFromTab()
  await expect.poll(() => guestFilterControls(browser), WORKER_WAIT).toBe(0)
})

test('Filters back on and published again, the guest page has its filter control again', async ({
  browser,
}) => {
  await saveFiltersSwitch(true)
  await publishFromTab()
  await expect.poll(() => guestFilterControls(browser), WORKER_WAIT).toBe(1)
})
