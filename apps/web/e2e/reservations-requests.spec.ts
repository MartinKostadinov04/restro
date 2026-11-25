// Venue › Reservations, answering an online request (#578; spec #322, Implementation Decision 2),
// on a production build: the book of the Tonight test club with two requests nobody has answered,
// worked by its owner on a tablet.
//
//   the "Requested" chip with the night's count, its row, Confirm, the spot chosen and done; then
//   Decline, which asks once naming the guest, and the chip still drawn at 0 once nothing waits.
//
// The fixture is scripts/seed-tonight-e2e.ts `book book-requests`. The admin is read in English.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_VENUE_NAME,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const TABLET = { width: 1180, height: 820 }

/** The fixture's two requests and the spot nobody holds (`BOOK` in reservations-night.ts). */
const REQUESTED = 'Стоянова'
const REQUESTED_TOO = 'Николова'
const FREE_SPOT = 'Маса 9'

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
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

let venueId = ''
let owner: { context: BrowserContext; page: Page }

const rows = (page: Page) => page.getByTestId('rv-row')
const chip = (page: Page) => page.getByTestId('rv-filter-requested')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

async function openNight(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('book', 'book-requests')
  const context = await browser.newContext({ viewport: TABLET })
  const page = await context.newPage()
  await signIn(page, TONIGHT_OWNER_EMAIL)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  owner = { context, page }
  await page
    .getByRole('link', { name: new RegExp(TONIGHT_VENUE_NAME) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
})

test.afterAll(async () => {
  await owner?.context.close()
})

test('a request is confirmed from its chip, with the spot chosen in the dialog', async () => {
  const { page } = owner
  await openNight(page)

  // The chip carries the night's count of requests nobody has answered.
  await expect(chip(page)).toContainText('Requested')
  await expect(chip(page)).toContainText('2')
  await chip(page).click()
  await expect(rows(page)).toHaveCount(2)
  await rows(page).filter({ hasText: REQUESTED }).click()

  // The sheet reads Requested, and Confirm is its one filled button, Decline beside it.
  const sheet = page.getByTestId('rv-sheet')
  await expect(sheet).toContainText('Requested')
  await expect(page.getByTestId('rv-sheet-decline')).toBeVisible()
  await expect(page.getByTestId('rv-cancel')).toHaveCount(0)
  await page.getByTestId('rv-sheet-confirm').click()

  // Choose then act: the spot from the list, then the one Confirm.
  const dialog = page.getByTestId('rv-confirm')
  await expect(dialog).toContainText(`Confirm ${REQUESTED}’s request`)
  await page.getByTestId('rv-confirm-list').click()
  await page.getByTestId(`rv-pick-${FREE_SPOT}`).click()
  await page.getByTestId('rv-confirm-do').click()

  await expect(toast(page, 'Reservation confirmed.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(sheet).toContainText('Coming')
  await expect(sheet).toContainText(FREE_SPOT)
  await expect(page.getByTestId('rv-sheet-confirm')).toHaveCount(0)
})

test('a request is declined after one question naming the guest, and the chip stays at 0', async () => {
  const { page } = owner
  await openNight(page)
  await expect(chip(page)).toContainText('1')
  await chip(page).click()
  await rows(page).filter({ hasText: REQUESTED_TOO }).click()
  await page.getByTestId('rv-sheet-decline').click()

  const dialog = page.getByTestId('rv-decline-dialog')
  await expect(dialog).toContainText(`Decline ${REQUESTED_TOO}’s request?`)
  // The guest left no email on the fixture, so the dialog promises none.
  await expect(dialog).not.toContainText('gets an email')
  await page.getByTestId('rv-decline-dialog-do').click()

  await expect(toast(page, 'Request declined.')).toBeVisible()
  const sheet = page.getByTestId('rv-sheet')
  await expect(sheet).toContainText('Declined')
  await expect(page.getByTestId('rv-sheet-decline')).toHaveCount(0)
  await page.getByTestId('rv-close').click()

  // Nothing waits on an answer, and the chip says so rather than vanishing.
  await openNight(page)
  await expect(chip(page)).toBeVisible()
  await expect(chip(page)).toContainText('0')
  await expect(page.getByTestId('rv-filter-declined')).toContainText('1')
})
