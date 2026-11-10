// Venue › Reservations › Guests (#333, D140), on a production build: the Tonight test club's
// guest list, worked by its owner on a tablet, and looked at by a colleague.
//
//   three letters of a name suggest the regular and a tap fills the phone; a phone already on the
//   list warns in the booking form and in Add a regular, and names who has it; a booking's guest
//   saved to the regulars; the owner's private list, which a colleague never sees; and an erasure,
//   through its dialog, that clears the guest and keeps his booking on the night.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts): Иванова
// on the list with a booking, Стефан Редовен a regular, and the owner a staff member, so they
// keep a list of their own. The admin is read in English; the hours are typed.
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

async function person(
  browser: import('@playwright/test').Browser,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: TABLET })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

/** The fixture's names (`BOOK.late`, `REGULAR` in scripts/e2e/reservations-night.ts). */
const BOOK = { late: 'Иванова' } as const
const REGULAR = { name: 'Стефан Редовен', phone: '+359 888 777 100' } as const
const NEW_REGULAR = { name: 'Нова Редовна', phone: '+359 888 777 200' }
const PRIVATE_NOTE = 'Пие само вода, маса до сцената'

let venueId = ''
let owner: { context: BrowserContext; page: Page }

const rows = (page: Page) => page.getByTestId('rv-row')
const guestRow = (page: Page, name: string) =>
  page.getByTestId('rv-g-row').filter({ hasText: name })
const form = (page: Page) => page.getByTestId('rv-form-sheet')
const card = (page: Page) => page.getByTestId('rv-guest')

async function openList(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

async function openGuests(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations&view=guests`)
  await expect(page.getByTestId('reservations-guests')).toBeVisible()
}

async function openCard(page: Page, name: string) {
  await guestRow(page, name).getByTestId('rv-g-open').click()
  await expect(card(page)).toBeVisible()
  await expect(card(page).getByTestId('rv-g-counts')).toBeVisible()
}

/** Settings-class writes ask for the password again after 15 minutes; a slow run answers it. */
async function passwordIfAsked(page: Page) {
  const dialog = page
    .getByRole('dialog')
    .filter({ hasText: 'Enter your password to change settings' })
  if (await dialog.isVisible()) {
    await dialog.getByLabel('Password').fill(ADMIN_PASSWORD)
    await dialog.getByRole('button', { name: 'Confirm' }).click()
  }
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('book', 'book')
  owner = await person(browser, TONIGHT_OWNER_EMAIL)
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

test('three letters suggest the regular, and a tap fills the name and the phone', async () => {
  const { page } = owner
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await expect(form(page)).toBeVisible()

  // Two letters ask nothing; the third lists the regular, with his number.
  await page.getByTestId('rv-f-name').fill(REGULAR.name.slice(0, 2))
  await page.waitForTimeout(600)
  await expect(page.getByTestId('rv-f-suggest-option')).toHaveCount(0)
  await page.getByTestId('rv-f-name').fill(REGULAR.name.slice(0, 3))
  const option = page.getByTestId('rv-f-suggest-option').filter({ hasText: REGULAR.name })
  await expect(option).toBeVisible()
  await expect(option).toContainText(REGULAR.phone)

  await option.click()
  await expect(page.getByTestId('rv-f-name')).toHaveValue(REGULAR.name)
  await expect(page.getByTestId('rv-f-phone')).toHaveValue(REGULAR.phone)
  await expect(page.getByTestId('rv-f-suggest-option')).toHaveCount(0)
  // He is a regular already: nothing to tick, and no warning about his own number.
  await expect(page.getByTestId('rv-f-regular')).toHaveCount(0)
  await expect(page.getByTestId('rv-w-listed')).toHaveCount(0)

  await page.getByTestId('rv-f-guests').fill('4')
  await page.getByTestId('rv-f-time').fill('22:00')
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText('Reservation saved.')).toBeVisible()
  await expect(form(page)).toHaveCount(0)
  await expect(rows(page).filter({ hasText: REGULAR.name })).toHaveCount(1)
})

test('a phone already on the list warns and names its guest, in the form and in Add a regular', async () => {
  const { page } = owner
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await page.getByTestId('rv-f-name').fill('Друг Човек')
  await page.getByTestId('rv-f-phone').fill('+359 888 123 456')
  await expect(page.getByTestId('rv-w-listed')).toContainText(
    `${BOOK.late} is already on the list with this phone.`,
  )
  // It only warns: Save is there to tap. This booking is left untaken.
  await expect(page.getByTestId('rv-f-save')).toBeEnabled()
  await page.getByTestId('rv-f-close').click()
  await page.getByTestId('rv-leave-do').click()
  await expect(form(page)).toHaveCount(0)

  // Add a regular with the same number written the national way: one guest per number.
  await openGuests(page)
  await page.getByTestId('rv-g-add').click()
  const dialog = page.getByTestId('rv-g-add-dialog')
  await dialog.getByTestId('rv-g-add-name').fill('Още Някой')
  await dialog.getByTestId('rv-g-add-phone').fill('0888 123 456')
  await dialog.getByTestId('rv-g-add-save').click()
  await expect(dialog.getByTestId('rv-g-add-exists')).toContainText(
    `${BOOK.late} is already on the list with this phone.`,
  )
  // She can proceed with the guest who has it: Иванова goes on the regulars, nobody is doubled.
  await dialog.getByTestId('rv-g-add-use').click()
  await expect(dialog).toHaveCount(0)
  // The guest it saved opens on their card.
  await expect(card(page)).toContainText(BOOK.late)
  await card(page).getByTestId('rv-g-close').click()
  await expect(card(page)).toHaveCount(0)
  await page.getByTestId('rv-g-filter-regulars').click()
  await expect(guestRow(page, BOOK.late)).toHaveCount(1)
  await expect(guestRow(page, 'Още Някой')).toHaveCount(0)
})

test("a booking's guest is saved to the regulars with one tick", async () => {
  const { page } = owner
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await page.getByTestId('rv-f-name').fill(NEW_REGULAR.name)
  await page.getByTestId('rv-f-phone').fill(NEW_REGULAR.phone)
  await page.getByTestId('rv-f-guests').fill('2')
  await page.getByTestId('rv-f-time').fill('23:00')
  // A spot, because the tick is a booking's (D141, "create a booking"): a save with no spot writes
  // a party onto the waiting list instead (#330), and the regulars are never written by a walk-in.
  await page.getByTestId('rv-f-pick-list').click()
  await page.getByTestId('rv-pick-Маса 9').click()
  await page.getByTestId('rv-f-regular').click()
  await expect(page.getByTestId('rv-f-regular')).toBeChecked()
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText('Reservation saved.')).toBeVisible()
  await expect(form(page)).toHaveCount(0)

  await openGuests(page)
  await page.getByTestId('rv-g-filter-regulars').click()
  await expect(guestRow(page, NEW_REGULAR.name)).toHaveCount(1)
  await expect(guestRow(page, NEW_REGULAR.name)).toContainText('Regular')
})

test("the owner's private list is theirs: a colleague sees neither the list nor its note", async ({
  browser,
}) => {
  const { page } = owner
  await openGuests(page)
  await openCard(page, REGULAR.name)
  const mine = card(page).getByTestId('rv-g-mine')
  await expect(mine).toContainText('Only you see this list and its notes.')
  await mine.getByTestId('rv-g-mine-note').fill(PRIVATE_NOTE)
  await mine.getByTestId('rv-g-mine-save').click()
  await passwordIfAsked(page)
  await expect(page.getByText('Saved on your own list.')).toBeVisible()
  await card(page).getByTestId('rv-g-close').click()
  await page.getByTestId('rv-g-filter-mine').click()
  await expect(guestRow(page, REGULAR.name)).toHaveCount(1)

  // The waiter works the same book, and the same guest's card has nothing of the owner's list.
  const waiter = await person(browser, TONIGHT_WAITER_EMAIL)
  try {
    await openGuests(waiter.page)
    await expect(guestRow(waiter.page, REGULAR.name)).toHaveCount(1)
    await expect(waiter.page.getByTestId('rv-g-filter-mine')).toHaveCount(0)
    await openCard(waiter.page, REGULAR.name)
    await expect(card(waiter.page).getByTestId('rv-g-mine')).toHaveCount(0)
    await expect(card(waiter.page)).not.toContainText(PRIVATE_NOTE)
    await expect(waiter.page.getByText(PRIVATE_NOTE)).toHaveCount(0)
  } finally {
    await waiter.context.close()
  }
})

test('an erasure says what it clears, and the booking stays on the night without him', async () => {
  const { page } = owner
  await openList(page)
  await expect(rows(page).filter({ hasText: REGULAR.name })).toHaveCount(1)
  const before = await rows(page).count()

  await openGuests(page)
  await openCard(page, REGULAR.name)
  await card(page).getByTestId('rv-g-more').click()
  await page.getByTestId('rv-g-erase').click()
  const dialog = page.getByTestId('rv-g-erase-dialog')
  await expect(dialog).toContainText(`Erase ${REGULAR.name}'s details?`)
  await expect(dialog).toContainText('His past bookings stay, with the party size and the table')
  await expect(dialog).toContainText('The card payment provider keeps its own record')
  await dialog.getByTestId('rv-g-erase-dialog-do').click()
  await passwordIfAsked(page)
  await expect(
    page.getByText('The details are erased. The bookings stay, with the party size and the table.'),
  ).toBeVisible()

  // He is in no list: not the venue's, not the regulars, not the owner's own.
  await openGuests(page)
  await expect(guestRow(page, REGULAR.name)).toHaveCount(0)
  await page.getByTestId('rv-g-filter-mine').click()
  await expect(guestRow(page, REGULAR.name)).toHaveCount(0)

  // The night keeps the booking — every row is still there — and his name is on none of them.
  await openList(page)
  await expect(rows(page)).toHaveCount(before)
  await expect(rows(page).filter({ hasText: REGULAR.name })).toHaveCount(0)
})
