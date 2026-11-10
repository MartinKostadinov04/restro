// Venue › Reservations, the waiting list (#330; D137), on a production build: the queue the hostess
// runs by hand, on the book of the Tonight test club, worked by its owner on a tablet.
//
//   a booking with no spot yet stays a booking (#328) and never joins the queue, "Add a party" is
//   the list's own door, the queue is offered oldest first on the list and on a free spot's sheet,
//   a freed table is given to the party that has waited longest in one move (its codes open with
//   it), a spot given from the list is three taps, and leaving the queue is the ordinary Cancel.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts). The admin
// is read in English. Маса 7 is the fixture's only spot with a Table, so it is the one spot whose
// codes a seating can be read on (Tonight's tile); Маса 9 is a free spot of the plan.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

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
/** The fixture's only spot with a Table, and the free spot a party is given from the list. */
const TABLE_SPOT = 'Маса 7'
const TABLE = 'Table 1'
const FREE_SPOT = 'Маса 9'
/** The party of the fixture holding Маса 7, past her hour. */
const BOOKED = 'Иванова'

const FIRST = { name: 'Първа Чакаща', phone: '+359 888 777 201' }
const SECOND = { name: 'Втора Чакаща', phone: '+359 888 777 202' }
const THIRD = { name: 'Трета Чакаща', phone: '+359 888 777 203' }
/** A booking taken with no spot yet (#328): it must stay a booking, not become a waiting line. */
const NO_SPOT = { name: 'Без Място', phone: '+359 888 777 204' }

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
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

const plan = (page: Page) => page.getByTestId('reservations-plan')
const spots = (page: Page) => page.getByTestId('rv-spot')
const spotNamed = (page: Page, name: string) => spots(page).filter({ hasText: name })
const spotSheet = (page: Page) => page.getByTestId('rv-spot-sheet')
const rows = (page: Page) => page.getByTestId('rv-row')
const rowOf = (page: Page, name: string) => rows(page).filter({ hasText: name }).first()
const form = (page: Page) => page.getByTestId('rv-form-sheet')
const waitingForm = (page: Page) => page.getByTestId('rv-wl-form')
const give = (page: Page) => page.getByTestId('rv-give')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)

let venueId = ''
let owner: { context: BrowserContext; page: Page }

async function openList(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

/** The night's list under the queue's own filter. */
async function openQueue(page: Page) {
  await openList(page)
  await page.getByTestId('rv-filter-waiting').click()
  await expect(page.getByTestId('rv-waiting-note')).toBeVisible()
}

async function openPlan(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()
  await expect(spots(page).first()).toBeVisible()
}

async function openSpot(page: Page, name: string): Promise<Locator> {
  if ((await spotSheet(page).count()) > 0) {
    await spotSheet(page).getByTestId('rv-spot-close').click()
    await expect(spotSheet(page)).toHaveCount(0)
  }
  await spotNamed(page, name).first().click()
  await expect(spotSheet(page)).toBeVisible()
  await expect(spotSheet(page)).toContainText(name)
  return spotSheet(page)
}

/** Tonight's tile of a table, read afresh: "open" is the codes a phone can use. */
async function readTile(page: Page, name: string): Promise<string | null> {
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, name)).toBeVisible()
  return tile(page, name).getAttribute('data-state')
}

/**
 * A party written down on the list: "Add a party", which is the list's own door and the only way
 * onto it by hand (#330). No hour and no spot are asked for — having neither is what the list is.
 */
async function writeDown(page: Page, party: { name: string; phone: string }, guests: number) {
  await openList(page)
  await page.getByTestId('rv-wl-add').click()
  await expect(waitingForm(page)).toBeVisible()
  await page.getByTestId('rv-wl-name').fill(party.name)
  await page.getByTestId('rv-wl-phone').fill(party.phone)
  await page.getByTestId('rv-wl-guests').fill(String(guests))
  await page.getByTestId('rv-wl-save').click()
  await expect(toast(page, `${party.name} is on the waiting list.`)).toBeVisible()
  await expect(waitingForm(page)).toHaveCount(0)
  // It writes the queue she is looking at, so the list she lands on is the queue itself.
  await expect(page.getByTestId('rv-waiting-note')).toBeVisible()
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('book', 'book')
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

test('a booking with no spot yet is a booking, and never joins the waiting list', async () => {
  const { page } = owner
  // #328's booking the hostess gives a table later: the form is saved with no spot chosen, and
  // #329 marks such a party present on the spots she picks at the door. The waiting list has its
  // own door, so nothing on this form can put a party on the queue.
  await openList(page)
  await page.getByTestId('rv-new').first().click()
  await expect(form(page)).toBeVisible()
  await page.getByTestId('rv-f-name').fill(NO_SPOT.name)
  await page.getByTestId('rv-f-phone').fill(NO_SPOT.phone)
  await page.getByTestId('rv-f-guests').fill('5')
  await page.getByTestId('rv-f-time').fill('23:45')
  await page.getByTestId('rv-f-save').click()
  await expect(toast(page, 'Reservation saved.')).toBeVisible()
  await expect(form(page)).toHaveCount(0)

  await openList(page)
  await expect(rowOf(page, NO_SPOT.name)).toHaveAttribute('data-status', 'reserved')
  await expect(rowOf(page, NO_SPOT.name)).toContainText('5 guests')
  // Nobody is waiting, so the queue's own filter is not even drawn yet.
  await expect(page.getByTestId('rv-filter-waiting')).toHaveCount(0)
})

test('“Add a party” writes a party onto the night’s list under “Waiting”', async () => {
  const { page } = owner
  await writeDown(page, FIRST, 4)

  // It is a row of the night like any other, and the queue is that list under a filter: the chip
  // is there because the night now holds somebody waiting, and the row says so in a word.
  await openList(page)
  await expect(rowOf(page, FIRST.name)).toHaveAttribute('data-status', 'waiting')
  await openQueue(page)
  await expect(page.getByTestId('rv-waiting-note')).toContainText('Oldest first')
  const row = rowOf(page, FIRST.name)
  await expect(row).toContainText('4 guests')
  await expect(row).toContainText('Waiting for')
  // A queue is a list of whom to ring next, so the number is on the row as a link (D137).
  await expect(row.getByTestId('rv-row-call')).toHaveAttribute('href', /^tel:/)
  // A party put on the list by hand is a walk-in in the data, but the row shows the state it is
  // in: Waiting already says there is no spot, so a Walk-in tag would only repeat it.
  await expect(row).not.toContainText('Walk-in')
})

test('the queue is offered oldest first, on the list and on a free spot’s sheet', async () => {
  const { page } = owner
  await writeDown(page, SECOND, 2)

  await openQueue(page)
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText(FIRST.name)
  await expect(rows(page).nth(1)).toContainText(SECOND.name)

  // The plan reads the same queue, so a free spot offers it in the same order — never its own.
  await openPlan(page)
  const free = await openSpot(page, FREE_SPOT)
  await expect(free.getByTestId('rv-from-waiting')).toBeVisible()
  const offered = free.getByTestId('rv-seat-waiting')
  await expect(offered).toHaveCount(2)
  await expect(offered.nth(0)).toContainText(FIRST.name)
  await expect(offered.nth(1)).toContainText(SECOND.name)
})

test('a freed table is given to the party that waited longest, and its codes open with it', async () => {
  const { page } = owner
  // The night's own party is seated on the table and then leaves: the codes close with her.
  await openPlan(page)
  const booked = await openSpot(page, TABLE_SPOT)
  await booked.getByTestId('rv-spot-arrive').click()
  await expect(toast(page, `${BOOKED} is seated.`)).toBeVisible()
  expect(await readTile(page, TABLE)).toBe('open')
  await openPlan(page)
  const sitting = await openSpot(page, TABLE_SPOT)
  await sitting.getByTestId('rv-spot-free').click()
  await expect(toast(page, 'The table is free again.')).toBeVisible()
  expect(await readTile(page, TABLE)).toBe('closed')

  // Two taps from the plan: the freed spot, then the party at the top of the queue. One move —
  // she is seated here and the table's codes open, with no "Arrived" left to tap (#329's path).
  await openPlan(page)
  const freed = await openSpot(page, TABLE_SPOT)
  await freed.getByTestId('rv-seat-waiting').first().click()
  await expect(toast(page, `${FIRST.name} is seated on ${TABLE_SPOT}.`)).toBeVisible()
  expect(await readTile(page, TABLE)).toBe('open')

  await openList(page)
  await expect(rowOf(page, FIRST.name)).toHaveAttribute('data-status', 'seated')
  await expect(rowOf(page, FIRST.name)).toContainText(TABLE_SPOT)
  // Seated is out of the queue: her place in it was given up with her waiting.
  await openQueue(page)
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page).first()).toContainText(SECOND.name)
})

test('a spot given from the list is three taps, and seats the party in the same move', async () => {
  const { page } = owner
  // Tap one: the filter. Tap two: the party's own button on its row.
  await openQueue(page)
  await rowOf(page, SECOND.name).getByTestId('rv-row-give').click()
  await expect(give(page)).toBeVisible()
  await expect(give(page)).toContainText(`${SECOND.name} has waited`)

  // Tap three: the spot. The tap is the choice and the act — no Select, no second button.
  await give(page).getByTestId('rv-spot').filter({ hasText: FREE_SPOT }).first().click()
  await expect(toast(page, `${SECOND.name} is seated on ${FREE_SPOT}.`)).toBeVisible()
  await expect(give(page)).toHaveCount(0)

  await openList(page)
  await expect(rowOf(page, SECOND.name)).toHaveAttribute('data-status', 'seated')
  await expect(rowOf(page, SECOND.name)).toContainText(FREE_SPOT)
})

test('leaving the queue is the ordinary Cancel, with no status of its own', async () => {
  const { page } = owner
  await writeDown(page, THIRD, 3)
  await openQueue(page)
  await rowOf(page, THIRD.name).click()
  await expect(page.getByTestId('rv-sheet')).toBeVisible()
  await page.getByTestId('rv-cancel').click()
  const dialog = page.getByTestId('rv-cancel-dialog')
  await expect(dialog).toContainText('stays on the night as Cancelled')
  await dialog.getByTestId('rv-cancel-dialog-do').click()
  await expect(toast(page, 'Reservation cancelled.')).toBeVisible()
  await page.getByTestId('rv-close').click()

  // Out of the queue, and on the night in its own state: nothing was invented for leaving it.
  await openList(page)
  await expect(rowOf(page, THIRD.name)).toHaveAttribute('data-status', 'cancelled')
  await expect(page.getByTestId('rv-filter-waiting')).toHaveCount(0)
  await page.getByTestId('rv-filter-cancelled').click()
  await expect(rowOf(page, THIRD.name)).toBeVisible()
})
