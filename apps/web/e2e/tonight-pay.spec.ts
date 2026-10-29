// Tonight's money (#115; plan docs/deliverables/2026-10-29-tonight-paying-plan.md), on a production
// build: four card payments wait for a manager (`pay` night of scripts/seed-tonight-e2e.ts): Tables
// 1 and 2 were closed on the till with no answer, Tables 3 and 4 were paid first with an order
// nobody knows is on the till. Each is answered both ways — receipt printed / no receipt, on the
// till / not on the till — on the shared tablet behind a manager's PIN, and on an owner's own
// session with one tap, also from the end of the night; a waiter's own phone sees the question
// and who answers it, with no button. The Log words the till's answers as the till's, never as a
// receipt's. The admin is read in English.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_TABLET_EMAIL,
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
      await expect(page).toHaveURL(/\/venues\/vn_[^/?]+|\/venues$/, { timeout: 8_000 })
      if (/\/venues\/vn_/.test(page.url())) return
      await page
        .getByRole('link', { name: /Tonight Club/ })
        .first()
        .click()
      await expect(page).toHaveURL(/\/venues\/vn_/)
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

/** The taps of one story, counted: every click on a control goes through `tap`. */
class Taps {
  count = 0
  async tap(target: Locator) {
    this.count += 1
    await target.click()
  }
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

const venueUrl = (page: Page) => page.url().replace(/\?.*$/, '')

async function openPay(page: Page, view = 'actions', night = 'pay') {
  seed('night', night)
  const suffix = view === 'actions' ? '' : `&view=${view}`
  await page.goto(`${venueUrl(page)}?tab=tonight${suffix}`)
  await expect(page.locator('[aria-label="Sections of Tonight"]:visible').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('action-row')
const rowOf = (page: Page, table: string) => rows(page).filter({ hasText: `Table ${table}` })
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)

/** Types a PIN on the sheet's pad with the keyboard; the sheet submits on the fourth digit. */
async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-sheet')).toBeVisible()
  await page.keyboard.type(pin)
}

let tablet: { context: BrowserContext; page: Page }
let waiter: { context: BrowserContext; page: Page }
let owner: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  waiter = await person(browser, TONIGHT_WAITER_EMAIL)
  tablet = await person(browser, TONIGHT_TABLET_EMAIL)
  owner = await person(browser, TONIGHT_OWNER_EMAIL)
  // The bar tablet's session becomes a shared device, as the owner's "mark this device" does.
  seed('device', TONIGHT_TABLET_EMAIL)
})

test.afterAll(async () => {
  await waiter?.context.close()
  await tablet?.context.close()
  await owner?.context.close()
})

test("a waiter's own phone sees the questions and who answers them, with no button", async () => {
  const { page } = waiter
  await openPay(page)
  await expect(rows(page)).toHaveCount(4)
  const kinds = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
  expect(kinds).toEqual(['pay', 'pay', 'pay', 'pay'])
  for (const row of await rows(page).all()) {
    await expect(row).toContainText('Payment not confirmed')
    await expect(row.getByTestId('money-who')).toHaveText('A manager or owner answers this.')
    await expect(row.getByRole('button')).toHaveCount(0)
  }
  // The table's tile reads Payment while a question waits for its answer.
  await expect(tile(page, 'Table 1')).toHaveAttribute('data-state', 'payment')
  await expect(tile(page, 'Table 1')).toContainText('Payment')
  // The pay-first round asks about the till, not about a receipt.
  await expect(rowOf(page, '3')).toContainText('Is the order on the till?')
  await expect(rowOf(page, '3')).toContainText('Paid first · order P3X1')
  await expect(rowOf(page, '1')).toContainText('Was the receipt printed?')
  await expect(rowOf(page, '1')).toContainText('€38.00 on hold')
})

test("on the tablet a manager's PIN answers: receipt printed / no receipt, on the till / not on the till", async () => {
  const { page } = tablet
  await openPay(page)
  await expect(rows(page)).toHaveCount(4)
  // Nothing is filled: a money question has two answers at equal weight, both outline.
  expect(
    await page
      .getByTestId('tonight')
      .locator('[data-testid="action-row"] button[data-variant="default"]')
      .count(),
  ).toBe(0)
  await expect(rowOf(page, '1').getByRole('button')).toHaveText(['Receipt printed', 'No receipt'])
  await expect(rowOf(page, '3').getByRole('button')).toHaveText(['On the till', 'Not on the till'])

  // Receipt printed: one tap and the PIN, which names the consequence. A staff PIN is told so.
  const printed = new Taps()
  await printed.tap(rowOf(page, '1').getByRole('button', { name: 'Receipt printed' }))
  const sheet = page.getByTestId('pin-sheet')
  await expect(sheet).toContainText("Enter a manager's PIN")
  await expect(sheet).toContainText(
    "The guest's card will be charged €38.00. This can't be undone.",
  )
  await typePin(page, '1234')
  await expect(sheet).toContainText("This PIN belongs to staff. A manager's PIN is needed.")
  await typePin(page, '4321')
  await expect(toast(page, 'Card charged €38.00')).toBeVisible()
  await expect(rowOf(page, '1')).toHaveCount(0)
  expect(printed.count).toBe(1)

  const noReceipt = new Taps()
  await noReceipt.tap(rowOf(page, '2').getByRole('button', { name: 'No receipt' }))
  await expect(sheet).toContainText('The held €38.00 is released and the items go back to Table 2.')
  await typePin(page, '4321')
  await expect(toast(page, 'Money released')).toBeVisible()
  await expect(rowOf(page, '2')).toHaveCount(0)
  expect(noReceipt.count).toBe(1)

  const onTill = new Taps()
  await onTill.tap(rowOf(page, '3').getByRole('button', { name: 'On the till', exact: true }))
  await expect(sheet).toContainText('closes it and charges the card €38.00')
  await typePin(page, '4321')
  await expect(toast(page, 'Saved: on the till')).toBeVisible()
  await expect(rowOf(page, '3')).toHaveCount(0)
  expect(onTill.count).toBe(1)

  const notOnTill = new Taps()
  await notOnTill.tap(rowOf(page, '4').getByRole('button', { name: 'Not on the till' }))
  await expect(sheet).toContainText('The held €38.00 is released. Nothing is charged.')
  await typePin(page, '4321')
  await expect(rowOf(page, '4')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
})

test("an owner answers in one tap, and the Log words a till answer as the till's", async () => {
  const { page } = owner
  await openPay(page)
  const printed = new Taps()
  await printed.tap(rowOf(page, '1').getByRole('button', { name: 'Receipt printed' }))
  await expect(toast(page, 'Card charged €38.00')).toBeVisible()
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  await expect(rowOf(page, '1')).toHaveCount(0)
  expect(printed.count).toBe(1)

  const onTill = new Taps()
  await onTill.tap(rowOf(page, '3').getByRole('button', { name: 'On the till', exact: true }))
  await expect(toast(page, 'Saved: on the till')).toBeVisible()
  const notOnTill = new Taps()
  await notOnTill.tap(rowOf(page, '4').getByRole('button', { name: 'Not on the till' }))
  await expect(rowOf(page, '4')).toHaveCount(0)

  // The Log, Money kind: each answer in its own words, none of the till's as "Receipt printed".
  await page.goto(`${venueUrl(page)}?tab=tonight&view=log`)
  await expect(page.getByTestId('tonight-log')).toBeVisible()
  // A menu still closing from the last pick can eat the click that opens it: open until it's there.
  await expect(async () => {
    const item = page.getByTestId('kind-money')
    if (!(await item.isVisible())) await page.getByTestId('kind-button').click()
    await item.click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  const log = page.getByTestId('log-list')
  await expect(log).toContainText('Payment for Table 1: Receipt printed')
  await expect(log).toContainText('Payment for Table 3: On the till')
  await expect(log).toContainText('Payment for Table 4: Not on the till')
  await expect(log).not.toContainText('Payment for Table 3: Receipt printed')
  await expect(log).not.toContainText('Payment for Table 4: No receipt')

  // A payment line opens the payment's sheet.
  await log.getByText('Payment for Table 1: Receipt printed').click()
  const sheet = page.getByTestId('payment-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Payment for Table 1')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('the end of the night lists the payment to fix and answers it, with the money totals', async () => {
  const { page } = owner
  await openPay(page, 'night')
  const fix = page.getByTestId('night-fix-list')
  await expect(fix.getByTestId('action-row')).toHaveCount(4)
  await expect(page.getByTestId('night-pay-summary')).toContainText('4 payments')
  await expect(page.getByTestId('night-totals-list')).toContainText('Payments not confirmed')
  await expect(page.getByTestId('night-totals-list')).toContainText('Held on unconfirmed payments')

  const answer = new Taps()
  await answer.tap(
    fix
      .getByTestId('action-row')
      .filter({ hasText: 'Table 2' })
      .getByRole('button', { name: 'No receipt' }),
  )
  await expect(toast(page, 'Money released')).toBeVisible()
  await expect(fix.getByTestId('action-row').filter({ hasText: 'Table 2' })).toHaveCount(0)
  expect(answer.count).toBe(1)

  // A payment opens its sheet from the list of the night's payments.
  await page.getByTestId('night-pay-list').getByTestId('night-pay-row').first().click()
  await expect(page.getByTestId('payment-sheet')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('payment-sheet')).toHaveCount(0)
})

test("items stuck on a payment table are marked moved back with the person's own PIN", async () => {
  const { page } = tablet
  await openPay(page, 'actions', 'pay-stuck')
  const row = rows(page).filter({ hasText: 'Items stuck on a payment table' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Table 5')
  const moved = new Taps()
  await moved.tap(row.getByRole('button', { name: 'Moved back' }))
  const sheet = page.getByTestId('pin-sheet')
  await expect(sheet).toContainText('Enter your PIN')
  await typePin(page, '1234')
  await expect(toast(page, 'Items moved back')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
  expect(moved.count).toBe(1)
})
