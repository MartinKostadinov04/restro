// Venue › Reservations, the pay rule a party carries (#334; D122 §5, D135, D141), on a production
// build: the book of the Tonight test club, worked by its owner on a tablet and read by a waiter
// whose role works the night.
//
//   the rule picked on the party's sheet with one line of scope and an Undo on its toast, the line
//   that says a table's own rule wins and which rule that is, and the same section for a role
//   without the right: the rule in words and one line saying who may change it.
//
// The fixture is scripts/seed-tonight-e2e.ts `book book-pay-rule`, the only scene that gives the
// club pay-first settings: Маса 7 — the one spot of the plan with a Table — pays first whatever a
// party is told, and the house rule is everything on the bill. The admin is read in English.
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

/** The party of the fixture that holds Маса 7, the spot with a Table of its own. */
const AT_TABLE_7 = 'Иванова'
/** A party with no spot at all, so nothing is above its own rule. */
const NO_SPOT = 'Димитров'

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

let venueId = ''
let owner: { context: BrowserContext; page: Page }

const rows = (page: Page) => page.getByTestId('rv-row')
const section = (page: Page) => page.getByTestId('rv-pay-rule')

/** Opens the night's list, then one party's sheet, and answers with its pay-rule section. */
async function openPayRule(page: Page, party: string) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
  await rows(page).filter({ hasText: party }).click()
  await expect(page.getByTestId('rv-sheet')).toBeVisible()
  await expect(section(page)).toBeVisible()
  return section(page)
}

/** Picks one of the radio cards by the words on it: the input itself is for screen readers. */
const pick = (page: Page, label: string) =>
  page.getByTestId('rv-pay-rule-choices').getByText(label, { exact: true }).click()

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('book', 'book-pay-rule')
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

test('the rule is picked on the sheet, said as this sitting only, and undone from the toast', async () => {
  const { page } = owner
  const pay = await openPayRule(page, NO_SPOT)

  // Empty reads as the club's rule, never as a blank: that is what is in force.
  await expect(pay).toContainText('Pay rule')
  await expect(page.getByTestId('rv-pay-rule-venue')).toBeChecked()
  await expect(pay).toContainText('This party, this sitting only.')
  // Nothing above this party's own rule, so the sheet says nothing about a table.
  await expect(page.getByTestId('rv-pay-rule-beaten')).toHaveCount(0)

  // One tap writes, with no Save of its own, and the toast says what now holds.
  await pick(page, 'Pay first')
  await expect(page.getByText('Pay rule: Pay first')).toBeVisible()
  await expect(page.getByTestId('rv-pay-rule-pay_first')).toBeChecked()

  // Undo on the toast is the opposite write: the club's rule again, and the sheet follows.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText("Pay rule: The club's rule")).toBeVisible()
  await expect(page.getByTestId('rv-pay-rule-venue')).toBeChecked()

  // It survives a read: the sheet draws what the server holds, not what was tapped.
  await openPayRule(page, NO_SPOT)
  await expect(page.getByTestId('rv-pay-rule-venue')).toBeChecked()
})

test("a table's own rule wins, and the sheet says which rule applies and why", async () => {
  const { page } = owner
  await openPayRule(page, AT_TABLE_7)

  // Said whether or not a rule is set, so a manager knows before they tap (D122 §5).
  await expect(page.getByTestId('rv-pay-rule-beaten')).toHaveText(
    'Маса 7 has its own rule: Pay first. That one applies.',
  )
  // And the choice is still theirs to make: the line is what is in force, not a refusal.
  await pick(page, 'Everything on the bill')
  await expect(page.getByText('Pay rule: Everything on the bill')).toBeVisible()
  await expect(page.getByTestId('rv-pay-rule-on_bill')).toBeChecked()
  await expect(page.getByTestId('rv-pay-rule-beaten')).toHaveText(
    'Маса 7 has its own rule: Pay first. That one applies.',
  )
})

test('a role that works the night but may not decide how a party pays reads who may', async ({
  browser,
}) => {
  const waiter = await person(browser, TONIGHT_WAITER_EMAIL)
  try {
    const pay = await openPayRule(waiter.page, AT_TABLE_7)
    // The rule in words, and no control: never a dead one (D123, D141).
    await expect(waiter.page.getByTestId('rv-pay-rule-choices')).toHaveCount(0)
    await expect(waiter.page.getByTestId('rv-pay-rule-value')).toHaveText('Everything on the bill')
    await expect(waiter.page.getByTestId('rv-pay-rule-cant')).toHaveText(
      'Only someone who sets the pay rule changes it.',
    )
    // The same two lines everybody reads: what holds here, and for how long.
    await expect(pay).toContainText('This party, this sitting only.')
    await expect(waiter.page.getByTestId('rv-pay-rule-beaten')).toHaveText(
      'Маса 7 has its own rule: Pay first. That one applies.',
    )
  } finally {
    await waiter.context.close()
  }
})
