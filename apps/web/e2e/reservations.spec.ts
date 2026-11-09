// Venue › Reservations, the night's list (#326), on a production build: the book of the Tonight
// test club, read by its owner on a tablet and on a phone.
//
//   tonight's order and every row as it stands, the filters and their counts, the date moving to
//   the night before and the screen opening on today again, a night that has passed read-only
//   (and the one line that says whether the club allows corrections), one reservation's sheet with
//   its history and its call link, and a role without the key not being shown the tab at all.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts), which
// says which two nights it wrote. The admin is read in English.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_VENUE_NAME,
  TONIGHT_WAITER_EMAIL,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const TABLET = { width: 1180, height: 820 }
const PHONE = { width: 390, height: 844 }

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

/** Sets the book and answers the two nights it wrote. */
function book(scene: 'book' | 'book-past-open' = 'book'): { day: string; before: string } {
  const printed = seed('book', scene).trim().split('\n').at(-1) ?? ''
  return JSON.parse(printed) as { day: string; before: string }
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

async function person(
  browser: import('@playwright/test').Browser,
  email: string,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

const screen = (page: Page) => page.getByTestId('reservations-night')
const rows = (page: Page) => page.getByTestId('rv-row')
const banner = (page: Page) => page.getByTestId('rv-banner')

let venueId = ''
let owner: { context: BrowserContext; page: Page }
let nights: { day: string; before: string }

/** Enters the tab afresh, as a person coming back to the screen does. */
async function openReservations(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(screen(page)).toBeVisible()
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  nights = book()
  owner = await person(browser, TONIGHT_OWNER_EMAIL, TABLET)
  await owner.page
    .getByRole('link', { name: new RegExp(TONIGHT_VENUE_NAME) })
    .first()
    .click()
  await expect(owner.page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(owner.page.url()).pathname.split('/')[2] ?? ''
})

test.afterAll(async () => {
  await owner?.context.close()
})

test('the tab sits after Tonight and opens on tonight, in arrival order', async () => {
  const { page } = owner
  const tabs = page.getByRole('tablist', { name: 'Switch tab' }).getByRole('tab')
  await expect(tabs).toHaveText(['Composer', 'Tables & QR', 'Tonight', 'Reservations', 'Settings'])

  await openReservations(page)
  await expect(rows(page)).toHaveCount(4)
  // The night's own order: who came first, then the late booking, then the party still to come.
  // The hour, the name, the party and the spot are all on the row, unopened.
  const first = rows(page).first()
  await expect(first).toContainText('Петров')
  await expect(first).toContainText('2 guests')
  await expect(first).toContainText('Сепаре 1')
  await expect(first).toContainText('Seated')
  await expect(rows(page).nth(1)).toContainText('Иванова')
  await expect(rows(page).nth(1)).toContainText('Маса 7')
  await expect(rows(page).last()).toContainText('Димитров')

  // Late is a word on the row, not a colour alone, and one line says nothing is freed by itself.
  await expect(rows(page).nth(1).getByTestId('rv-late')).toBeVisible()
  await expect(page.getByTestId('rv-late-note')).toContainText('No spot is freed by itself')
  // The club's own undo of a mis-tapped walk-in reads as the club's, under Cancelled with the rest.
  const undone = rows(page).filter({ hasText: 'Георгиев' })
  await expect(undone).toContainText('Cancelled')
  await expect(undone.getByTestId('rv-by-club')).toHaveText('by the club')
  // No banner: the night is on.
  await expect(banner(page)).toHaveCount(0)
})

test('a filter carries its count and leaves one state on one tap', async () => {
  const { page } = owner
  await openReservations(page)
  await expect(page.getByTestId('rv-filter-all')).toHaveText('All4')
  await expect(page.getByTestId('rv-filter-seated')).toHaveText('Seated1')
  await expect(page.getByTestId('rv-filter-late')).toHaveText('Late1')
  // A state the night holds nothing of has no chip.
  await expect(page.getByTestId('rv-filter-no_show')).toHaveCount(0)

  await page.getByTestId('rv-filter-cancelled').click()
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Георгиев')
  await expect(page.getByTestId('rv-filter-cancelled')).toHaveAttribute('aria-pressed', 'true')
  // The counts are the night's, not the filtered list's.
  await expect(page.getByTestId('rv-filter-all')).toHaveText('All4')
})

test('the date moves to the night before, and the screen opens on today again', async () => {
  const { page } = owner
  await openReservations(page)
  await page.getByTestId('day-button').click()
  await page.getByTestId(`day-${nights.before}`).click()

  // A night that has passed: its one row, read-only, and the line that says so.
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText('Тодорова')
  await expect(banner(page)).toHaveAttribute('data-kind', 'passed')
  await expect(banner(page)).toContainText('It can be read, not changed.')
  // Nothing on a night that has passed offers to change it.
  await expect(page.getByTestId('rv-new').first()).toBeDisabled()

  // Entering the tab again opens on today, whatever was chosen before (#326).
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await openReservations(page)
  await expect(rows(page)).toHaveCount(4)
  await expect(banner(page)).toHaveCount(0)
})

test('a passed night says plainly where the club allows corrections', async () => {
  const { page } = owner
  const open = book('book-past-open')
  await openReservations(page)
  await page.getByTestId('day-button').click()
  await page.getByTestId(`day-${open.before}`).click()
  await expect(banner(page)).toHaveAttribute('data-kind', 'open')
  await expect(banner(page)).toContainText('allows changes to it')
  book()
})

test('one reservation’s sheet holds everything about it, with its history and a call link', async () => {
  const { page } = owner
  await openReservations(page)
  await rows(page).filter({ hasText: 'Иванова' }).click()
  const sheet = page.getByTestId('rv-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Иванова')
  await expect(sheet).toContainText('Маса 7')
  await expect(sheet).toContainText('Торта в 01:00')
  await expect(sheet).toContainText('Maria')
  // Its history, in the Log's own words, newest last; no contact detail in a line (D140).
  const history = sheet.getByTestId('rv-history').getByRole('listitem')
  await expect(history).toHaveCount(3)
  await expect(history.first()).toContainText('Maria')
  await expect(sheet.getByTestId('rv-history')).not.toContainText('359888')
  // Calling the guest is one tap, and only here.
  await expect(sheet.getByTestId('rv-call')).toHaveAttribute('href', 'tel:+359888123456')
  // No money section (#326): part 2 fills the record.
  await expect(sheet).not.toContainText('BGN')

  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('rv-sheet')).toHaveCount(0)
})

test('on a phone the night is a list of its own, and the sheet is a drawer', async ({
  browser,
}) => {
  const phone = await person(browser, TONIGHT_OWNER_EMAIL, PHONE)
  try {
    await openReservations(phone.page)
    await expect(rows(phone.page)).toHaveCount(4)
    // No sideways scroll at 390 px, with the longest Bulgarian names on the rows.
    const overflow = await phone.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
    await rows(phone.page).first().click()
    await expect(phone.page.getByTestId('rv-sheet')).toBeVisible()
  } finally {
    await phone.context.close()
  }
})

test('a role without “working tonight’s reservations” is not shown the tab', async ({
  browser,
}) => {
  const waiter = await person(browser, TONIGHT_WAITER_EMAIL, TABLET)
  try {
    await waiter.page.goto(`/venues/${venueId}?tab=reservations`)
    await expect(waiter.page.getByRole('tab', { name: 'Reservations' })).toHaveCount(0)
    await expect(waiter.page.getByTestId('reservations-night')).toHaveCount(0)
  } finally {
    await waiter.context.close()
  }
})
