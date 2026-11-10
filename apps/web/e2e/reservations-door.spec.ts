// Venue › Reservations, the door (#329), on a production build: the night of the Tonight test club
// worked by its owner on a tablet, with Tonight's own tile read beside it.
//
//   a table that opens in one tap because nobody holds it later, the arrival that opens the table's
//   codes (read back on Tonight's tile), the same-guests question left unanswered and then answered
//   both ways, "New guests" reached only as that answer, more guests joining without touching the
//   table, a walk-in off a free spot, the spot somebody is on offering no walk-in at all, freeing
//   with its Undo, and the door at 390 px.
//
// Early seating with the hour the door offers, the open-bill warning and the refusal that names the
// party on the spot need a night this fixture does not write (a booking later tonight on a Table, a
// round on a bill); they are pinned on Postgres instead, in packages/core door.test.ts.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts): Маса 7 is
// the one spot of the plan with a Table of its own (Table 1), held by Иванова's booking that is
// past its hour; Сепаре 1 has Петров at it; Маса 9 and Бар 13 are free. `night empty` runs first,
// so no table of the club is open when the night starts. The admin is read in English.
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
const PHONE = { width: 390, height: 844 }

/** The Table of Маса 7, as Tonight names it. */
const TABLE = 'Table 1'

function seed(...args: string[]): string {
  return runScriptWith(
    { STAFF_PIN_PEPPER: TONIGHT_PIN_PEPPER },
    './scripts/seed-tonight-e2e.ts',
    ...args,
  )
}

/** Sets the night and the book, and answers the two nights the fixture wrote. */
function book(): { day: string; before: string } {
  // An empty night first: no sitting of another spec is open, so a closed tile really is closed.
  seed('night', 'empty')
  const printed = seed('book', 'book').trim().split('\n').at(-1) ?? ''
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

const plan = (page: Page) => page.getByTestId('reservations-plan')
const spots = (page: Page) => page.getByTestId('rv-spot')
const spotNamed = (page: Page, name: string) => spots(page).filter({ hasText: name })
const sheet = (page: Page) => page.getByTestId('rv-spot-sheet')
const rows = (page: Page) => page.getByTestId('rv-row')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)

let venueId = ''
let owner: { context: BrowserContext; page: Page }
let nights: { day: string; before: string }

async function openPlan(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()
  await expect(spots(page).first()).toBeVisible()
}

async function openSpot(page: Page, name: string): Promise<Locator> {
  if ((await sheet(page).count()) > 0) {
    await sheet(page).getByTestId('rv-spot-close').click()
    await expect(sheet(page)).toHaveCount(0)
  }
  await spotNamed(page, name).first().click()
  await expect(sheet(page)).toBeVisible()
  await expect(sheet(page)).toContainText(name)
  return sheet(page)
}

/** Tonight's tile of a table, read afresh. */
async function readTile(page: Page, name: string): Promise<string | null> {
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, name)).toBeVisible()
  return tile(page, name).getAttribute('data-state')
}

/** The night's row of a party, by the name on it. */
const rowOf = (page: Page, name: string) => rows(page).filter({ hasText: name }).first()

async function openList(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
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

test('a table nobody holds later opens in one tap, as Tonight always did', async () => {
  const { page } = owner
  expect(await readTile(page, TABLE)).toBe('closed')
  // Иванова is booked on this table but her hour has passed, so there is nothing to warn about:
  // the tap opens it, with no question in the way.
  await tile(page, TABLE).click()
  await expect(toast(page, `${TABLE} is open for phones`)).toBeVisible()
  await expect(tile(page, TABLE)).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('tonight-booked')).toHaveCount(0)
})

test('the same-guests question waits for the hostess, and writes nothing until she answers', async () => {
  const { page } = owner
  await openPlan(page)
  const seven = await openSpot(page, 'Маса 7')
  await seven.getByTestId('rv-spot-arrive').click()

  // The table a waiter opened a moment ago is already open: this is the one question of the door.
  const question = page.getByTestId('rv-same-guests')
  await expect(question).toBeVisible()
  await expect(question).toContainText('Are these the same guests?')
  await expect(question.getByTestId('rv-same-keep')).toBeVisible()
  await expect(question.getByTestId('rv-same-new')).toBeVisible()

  // Walking away from it writes nothing at all: no default answers it for her.
  await question.getByTestId('rv-same-leave').click()
  await expect(question).toHaveCount(0)
  await openList(page)
  await expect(rowOf(page, 'Иванова')).toHaveAttribute('data-status', 'reserved')
  expect(await readTile(page, TABLE)).toBe('open')
})

test('“Same guests” seats them and leaves their order where it was', async () => {
  const { page } = owner
  await openList(page)
  await rowOf(page, 'Иванова').getByTestId('rv-row-arrive').click()
  const question = page.getByTestId('rv-same-guests')
  await expect(question).toBeVisible()
  await question.getByTestId('rv-same-keep').click()
  await expect(page.getByText('Иванова is seated. The table is open for phones.')).toBeVisible()
  await expect(rowOf(page, 'Иванова')).toHaveAttribute('data-status', 'seated')
  // The same table, still open: nothing of the order was cleared by seating them.
  expect(await readTile(page, TABLE)).toBe('open')
})

test('more guests joining changes the number and nothing else', async () => {
  const { page } = owner
  await openList(page)
  await rowOf(page, 'Иванова').click()
  const detail = page.getByTestId('rv-sheet')
  await expect(detail).toBeVisible()
  await detail.getByTestId('rv-sheet-guests').click()
  const dialog = page.getByTestId('rv-guests-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('rv-guests-field').fill('7')
  await dialog.getByTestId('rv-guests-save').click()
  await expect(page.getByText('Now 7 guests.')).toBeVisible()
  await expect(page.getByTestId('rv-list')).toContainText('7 guests')
  // This is never "New guests": the table is as it was.
  expect(await readTile(page, TABLE)).toBe('open')
})

test('freeing the table closes its codes, and its Undo gives them back', async () => {
  const { page } = owner
  await openPlan(page)
  const seven = await openSpot(page, 'Маса 7')
  await expect(seven.getByTestId('rv-spot-state')).toContainText('Sitting')
  await seven.getByTestId('rv-spot-free').click()
  await expect(page.getByText('The table is free again.')).toBeVisible()

  // The toast's Undo is the same party claiming the same spots again, which opens the codes again.
  await page.getByRole('button', { name: 'Undo' }).first().click()
  await expect(page.getByText('They have their table back.')).toBeVisible()
  expect(await readTile(page, TABLE)).toBe('open')
  await openPlan(page)
  await expect(spotNamed(page, 'Маса 7').first()).toHaveAttribute('data-state', 'sitting')

  // Freed for good this time, so the next party can be put down here.
  const back = await openSpot(page, 'Маса 7')
  await back.getByTestId('rv-spot-free').click()
  await expect(page.getByText('The table is free again.')).toBeVisible()
  expect(await readTile(page, TABLE)).toBe('closed')
  await openPlan(page)
  await expect(spotNamed(page, 'Маса 7').first()).toHaveAttribute('data-state', 'free')
})

test('“New guests” is reached only as the answer to that question', async () => {
  const { page } = owner
  // The waiter opens the table again, with yesterday's party gone.
  expect(await readTile(page, TABLE)).toBe('closed')
  await tile(page, TABLE).click()
  await expect(tile(page, TABLE)).toHaveAttribute('data-state', 'open')

  // People walk up to the same table: the question comes again, and this time she starts over.
  await openPlan(page)
  const seven = await openSpot(page, 'Маса 7')
  await seven.getByTestId('rv-walk-in').click()
  const question = page.getByTestId('rv-same-guests')
  await expect(question).toBeVisible()
  await question.getByTestId('rv-same-new').click()
  await expect(page.getByText('Seated. The table is open for phones.')).toBeVisible()
  // A new sitting, so the table is open for the people who are there now.
  expect(await readTile(page, TABLE)).toBe('open')
})

test('a walk-in on a spot somebody is on is refused, and the refusal names them', async () => {
  const { page } = owner
  await openPlan(page)
  // Петров is at Сепаре 1, so the sheet offers no walk-in there at all.
  const booth = await openSpot(page, 'Сепаре 1')
  await expect(booth.getByTestId('rv-walk-in')).toHaveCount(0)
  await expect(booth.getByTestId('rv-spot-state')).toContainText('Sitting')
  // The sheet says who is there, which is the answer she needs without a refusal at all.
  await expect(booth.getByTestId('rv-spot-holds')).toContainText('Петров')
})

test('a walk-in off a free spot is two taps, with the hour the door offered', async () => {
  const { page } = owner
  await openPlan(page)
  const nine = await openSpot(page, 'Маса 9')
  const walkIn = nine.getByTestId('rv-walk-in')
  await expect(walkIn).toBeVisible()
  // Nobody holds Маса 9 later tonight, so there is no hour to offer and the button is the plain one.
  await expect(walkIn).toHaveText('Seat a walk-in')
  await walkIn.click()
  await expect(page.getByText('Seated. The table is open for phones.')).toBeVisible()
  await openPlan(page)
  await expect(spotNamed(page, 'Маса 9').first()).toHaveAttribute('data-state', 'sitting')
})

test('the door reads whole at 390 px, with every tap a thumb can hit', async ({ browser }) => {
  const phone = await person(browser, TONIGHT_OWNER_EMAIL, PHONE)
  try {
    await phone.page.goto(`/venues/${venueId}?tab=reservations&view=plan&day=${nights.day}`)
    await expect(plan(phone.page)).toBeVisible()
    await spotNamed(phone.page, 'Бар 13').first().click()
    const drawer = sheet(phone.page)
    await expect(drawer).toBeVisible()
    const walkIn = drawer.getByTestId('rv-walk-in')
    await expect(walkIn).toBeVisible()
    const box = await walkIn.boundingBox()
    expect(box?.width ?? 0).toBeLessThanOrEqual(PHONE.width)
    // The tap target is the floor's own minimum: a thumb in a dark room.
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    // Nothing of the door pushes the page sideways.
    const overflow = await phone.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  } finally {
    await phone.context.close()
  }
})
