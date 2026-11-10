// Venue › Reservations, Change tables (#331; D137, D110), on a production build: the night of the
// Tonight test club worked by its owner on a tablet, with Tonight's own tiles read beside it.
//
//   a move that closes the old table's codes and opens the new one's, with the line that the bill
//   stays where it was; an added spot that opens its code with no such line, because no bill is
//   left anywhere; the open-bill warning the door gives, given here too; a spot booked later by
//   somebody else refused by that party's name, and a blocked spot refused by its reason; the swap
//   of two seated parties in one save, with the codes of both following; and the sheet at 390 px
//   with the plan's own zoom inside it (#382).
//
// The fixture is scripts/seed-tonight-e2e.ts `book book-change-tables` (scripts/e2e/reservations-
// night.ts), after `night empty`: Маса 7, Маса 9, Сепаре 1 and Бар 13 have Tables 1–4. Иванова sits
// at Маса 7 with a round on Table 1's bill; Петров sits at Сепаре 1 (Table 3, no bill); Table 4 is
// open with a bill and nobody holds Бар 13; Маса 9's Table 2 is closed. Колев holds Бар 12 вляво
// from an hour on, which is in the way of Димитров (booked later, no spot). Маса 8 is blocked for
// repair. The admin is read in English.
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

const rows = (page: Page) => page.getByTestId('rv-row')
const rowOf = (page: Page, name: string) => rows(page).filter({ hasText: name }).first()
const changing = (page: Page) => page.getByTestId('rv-ct-sheet')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)
const plan = (page: Page) => page.getByTestId('reservations-plan')
const planSpot = (page: Page, name: string) =>
  page.getByTestId('reservations-plan').getByTestId('rv-spot').filter({ hasText: name }).first()

let venueId = ''
let owner: { context: BrowserContext; page: Page }

async function openList(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

/** Opens Change tables from the party's own sheet on the night's list. */
async function changeTablesOf(page: Page, name: string): Promise<Locator> {
  await openList(page)
  await rowOf(page, name).click()
  const detail = page.getByTestId('rv-sheet')
  await expect(detail).toBeVisible()
  await detail.getByTestId('rv-sheet-change-tables').click()
  const sheet = changing(page)
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('rv-pick-plan')).toBeVisible()
  return sheet
}

/** A tap on a spot of the sheet's plan. */
async function tap(sheet: Locator, name: string) {
  await sheet.getByTestId('rv-pick-plan').getByTestId('rv-spot').filter({ hasText: name }).click()
}

/** Who holds a spot tonight, as its sheet on the plan says. */
async function holdsOn(page: Page, name: string): Promise<Locator> {
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()
  await planSpot(page, name).click()
  const sheet = page.getByTestId('rv-spot-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText(name)
  return sheet.getByTestId('rv-spot-holds')
}

/** Tonight's tile of a table, read afresh. */
async function readTile(page: Page, name: string): Promise<string | null> {
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, name)).toBeVisible()
  return tile(page, name).getAttribute('data-state')
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  // An empty night first: no sitting of another spec is open, so the scene's tables are the only
  // open ones.
  seed('night', 'empty')
  seed('book', 'book-change-tables')
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

test('a move closes the old table’s codes, opens the new one’s, and says the bill stays', async () => {
  const { page } = owner
  expect(await readTile(page, 'Table 1')).toBe('open')
  expect(await readTile(page, 'Table 2')).toBe('closed')

  const sheet = await changeTablesOf(page, 'Иванова')
  await expect(sheet.getByTestId('rv-ct-chosen')).toContainText('Маса 7')
  // Nothing on the sheet adds the party's tables up: there is no total to read at all.
  await expect(sheet).not.toContainText('Total')

  // Маса 7 off, Маса 9 on: that is the move, in the same three taps as anything else.
  await tap(sheet, 'Маса 7')
  await tap(sheet, 'Маса 9')
  await expect(sheet.getByTestId('rv-ct-chosen')).toContainText('Маса 9')
  await expect(sheet.getByTestId('rv-ct-chosen')).not.toContainText('Маса 7')
  await sheet.getByTestId('rv-ct-save').click()

  await expect(toast(page, 'Tables changed.')).toBeVisible()
  // Restro moves no bill (D110): the round stays on Table 1 until staff move it at the till.
  await expect(toast(page, 'The bill stays on Маса 7. Move it at the till.')).toBeVisible()
  await expect(changing(page)).toHaveCount(0)

  expect(await readTile(page, 'Table 1')).toBe('closed')
  expect(await readTile(page, 'Table 2')).toBe('open')
})

test('an added spot opens its code, and with no bill left behind there is no bill line', async () => {
  const { page } = owner
  const sheet = await changeTablesOf(page, 'Иванова')
  await tap(sheet, 'Маса 7')
  await expect(sheet.getByTestId('rv-ct-chosen')).toContainText('Маса 9, Маса 7')
  await sheet.getByTestId('rv-ct-save').click()

  await expect(toast(page, 'Tables changed.')).toBeVisible()
  await expect(toast(page, 'The bill stays')).toHaveCount(0)
  // Table 1 opens again for her, as a new sitting: the round left on it was the till's to move.
  expect(await readTile(page, 'Table 1')).toBe('open')
  expect(await readTile(page, 'Table 2')).toBe('open')
})

test('a table still open with a bill gets the door’s question before anything is written', async () => {
  const { page } = owner
  const sheet = await changeTablesOf(page, 'Иванова')
  // Бар 13's Table 4 was opened by a waiter and has a round on it; nobody holds the spot.
  await tap(sheet, 'Бар 13')
  await sheet.getByTestId('rv-ct-save').click()

  const question = page.getByTestId('rv-same-guests')
  await expect(question).toBeVisible()
  await expect(question).toContainText('The table is already open for phones.')
  await expect(question).toContainText('A round the waiter already rang stays on the bill.')
  // Walking away from it writes nothing: Бар 13 is still nobody's.
  await question.getByTestId('rv-same-leave').click()
  await expect(question).toHaveCount(0)
  await changing(page).getByTestId('rv-ct-close').click()

  await holdsOn(page, 'Бар 13')
  await expect(page.getByTestId('rv-spot-sheet').getByTestId('rv-spot-nothing')).toBeVisible()
  expect(await readTile(page, 'Table 4')).toBe('open')
})

test('a spot somebody booked later is refused by their name, and a blocked one by its reason', async () => {
  const { page } = owner
  // Димитров comes in an hour and a half; Колев holds Бар 12 вляво from an hour on.
  const sheet = await changeTablesOf(page, 'Димитров')
  await expect(sheet.getByTestId('rv-ct-save')).toBeDisabled()

  // A blocked spot is refused at the tap, by the reason the club gave.
  await tap(sheet, 'Маса 8')
  await expect(toast(page, 'Маса 8 is blocked: repair.')).toBeVisible()
  await expect(sheet.getByTestId('rv-ct-chosen')).not.toContainText('Маса 8')

  await tap(sheet, 'Бар 12 вляво')
  await sheet.getByTestId('rv-ct-save').click()
  await expect(toast(page, 'Колев holds Бар 12 вляво from')).toBeVisible()
  await expect(toast(page, 'Pick another spot.')).toBeVisible()
  // Never half-moved: the sheet stays open and the party still has no spot.
  await expect(changing(page)).toBeVisible()
  await changing(page).getByTestId('rv-ct-close').click()
  const later = await holdsOn(page, 'Бар 12 вляво')
  await expect(later).toContainText('Колев')
  await expect(later).not.toContainText('Димитров')
})

test('the swap is one save: both seated parties end on the other’s spots, codes and all', async () => {
  const { page } = owner
  const sheet = await changeTablesOf(page, 'Иванова')
  // Петров is at Сепаре 1 right now: tapping it asks to swap, naming him.
  await tap(sheet, 'Сепаре 1')
  const ask = page.getByTestId('rv-ct-swap-dialog')
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('Swap with Петров?')
  await expect(ask).toContainText('Both parties change tables and all their codes follow.')
  await ask.getByRole('button', { name: 'Swap with Петров' }).click()
  await expect(ask).toHaveCount(0)

  await expect(sheet.getByTestId('rv-ct-chosen')).toContainText('Сепаре 1')
  await expect(sheet.getByTestId('rv-ct-chosen')).not.toContainText('Маса 9')
  const line = sheet.getByTestId('rv-ct-swap')
  await expect(line).toContainText('Петров moves to')
  await expect(line).toContainText('Маса 9')
  await expect(line).toContainText('Маса 7')
  await sheet.getByTestId('rv-ct-save').click()
  await expect(toast(page, 'Tables changed.')).toBeVisible()
  // Nothing was ordered since Иванова's tables reopened, so no bill is left anywhere.
  await expect(toast(page, 'The bill stays')).toHaveCount(0)

  await expect(await holdsOn(page, 'Сепаре 1')).toContainText('Иванова')
  await expect(await holdsOn(page, 'Маса 9')).toContainText('Петров')
  await expect(await holdsOn(page, 'Маса 7')).toContainText('Петров')
  // Every table of both parties is open for the party now at it.
  for (const table of ['Table 1', 'Table 2', 'Table 3']) {
    expect(await readTile(page, table)).toBe('open')
  }
})

test('the sheet reads whole at 390 px, with the plan’s own zoom and nothing pushed sideways', async ({
  browser,
}) => {
  const phone = await person(browser, TONIGHT_OWNER_EMAIL, PHONE)
  try {
    const page = phone.page
    // From the spot's own sheet this time: the other way in.
    await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
    await expect(plan(page)).toBeVisible()
    await planSpot(page, 'Сепаре 1').click()
    const spotSheet = page.getByTestId('rv-spot-sheet')
    await expect(spotSheet).toBeVisible()
    await spotSheet.getByTestId('rv-spot-change-tables').click()
    const sheet = changing(page)
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Иванова')

    const frame = sheet.getByTestId('rv-pick-plan')
    await expect(frame).toBeVisible()
    const inner = frame.locator(':scope > div').first()
    const before = await inner.getAttribute('style')
    await sheet.getByTestId('rv-pick-zoom-in').click()
    await expect(inner).not.toHaveAttribute('style', before ?? '')
    await sheet.getByTestId('rv-pick-zoom-fit').click()

    for (const id of ['rv-pick-zoom-in', 'rv-ct-save', 'rv-ct-close']) {
      const box = await sheet.getByTestId(id).boundingBox()
      expect(box?.width ?? 0).toBeLessThanOrEqual(PHONE.width)
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  } finally {
    await phone.context.close()
  }
})
