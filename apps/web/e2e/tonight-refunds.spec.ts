// Refunds and disputes on Tonight (#222; decision log 5.1–5.17), on a production build: four
// captured card payments as `payment.observe` leaves them (`refunds` night of
// scripts/seed-tonight-e2e.ts). Table 1 was partly refunded in the provider's dashboard and its
// storno is not made; Table 2's refund has its storno already; Table 3's payment is disputed and
// open with the provider's answer-by date in five days; Table 4's dispute was lost.
//
// The owner reads the storno row and the dispute row; a waiter's own phone reads neither; on the
// shared tablet "Storno done" asks a manager's PIN (a staff PIN is told so), saves at once, and its
// 8-second toast offers an Undo that brings the row back; the dispute opens the payment's sheet
// with its refunds, its state and the "Dispute evidence" text; the end of the night lists the
// refund with no storno under "To fix" and sections 5 and 6. The admin is read in English.
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

async function open(page: Page, view = 'actions') {
  const suffix = view === 'actions' ? '' : `&view=${view}`
  await page.goto(`${venueUrl(page)}?tab=tonight${suffix}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('[aria-label="Sections of Tonight"]:visible').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('action-row')
const rowOf = (page: Page, table: string) => rows(page).filter({ hasText: `Table ${table}` })
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

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
  seed('night', 'refunds')
})

test.afterAll(async () => {
  await waiter?.context.close()
  await tablet?.context.close()
  await owner?.context.close()
})

test('the owner reads the storno of a refund and the card dispute, with what each needs', async () => {
  const { page } = owner
  await open(page)
  // Table 2's storno was made and Table 4's dispute was lost: neither has a row.
  await expect(rows(page)).toHaveCount(2)
  await expect(rowOf(page, '2')).toHaveCount(0)
  await expect(rowOf(page, '4')).toHaveCount(0)

  const storno = rowOf(page, '1')
  await expect(storno).toHaveAttribute('data-kind', 'storno')
  await expect(storno).toContainText('Make the storno in')
  await expect(storno).toContainText(/Refund of €5\.00 for Table 1, night of \d{1,2} \w+\./)
  await expect(storno).toContainText(/Receipt R-000123 of \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
  await expect(storno).toContainText('fiscal memory FM-77881')
  await expect(storno.getByRole('button')).toHaveText(['Storno done'])

  const dispute = rowOf(page, '3')
  await expect(dispute).toHaveAttribute('data-kind', 'dispute')
  await expect(dispute).toContainText('Card dispute')
  await expect(dispute).toContainText(/Payment of €38\.00 \(Table 3, \d{1,2} \w+\)\./)
  await expect(dispute).toContainText(/Answer in .+ by \d{1,2} \w+/)
  await expect(dispute.getByRole('button')).toHaveText(['See the evidence'])
  // Neither is an alarm: no table turns red for money that is already back with the guest.
  await expect(page.locator('[data-testid="table-tile"][data-state="payment"]')).toHaveCount(0)
})

test("a waiter's own phone reads neither", async () => {
  const { page } = waiter
  await open(page)
  await expect(rows(page)).toHaveCount(0)
})

test('the dispute opens the payment’s sheet with the refunds, the state and the evidence', async () => {
  const { page } = owner
  await open(page)
  await rowOf(page, '3').getByRole('button', { name: 'See the evidence' }).click()
  const sheet = page.getByTestId('payment-sheet')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByTestId('payment-dispute')).toContainText('Disputed')
  await expect(sheet.getByTestId('payment-dispute')).toContainText(/Answer in .+ by \d{1,2} \w+/)
  const evidence = sheet.getByTestId('dispute-evidence')
  await expect(evidence).toContainText('Dispute evidence')
  await expect(evidence).toContainText("Restro doesn't answer disputes.")
  const text = evidence.getByTestId('dispute-evidence-text')
  // The fields of D122 §8, with no link and no card digits.
  for (const field of [
    "Guest's table: Table 3",
    'Gin tonic',
    'Authorisation code: A1B2C3',
    'Receipt number: R-000125',
    'Fiscal memory number: FM-77881',
    '3-D Secure: authenticated by the bank',
    'Dispute: open',
  ]) {
    await expect(text).toContainText(field)
  }
  await expect(text).not.toContainText(/https?:/)
  await expect(evidence.getByRole('button')).toHaveText([
    'Copy as text',
    'Copy in English',
    'Print',
  ])
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('payment-sheet')).toHaveCount(0)
})

test('on the tablet "Storno done" asks a manager’s PIN, saves at once, and Undo brings the row back', async () => {
  const { page } = tablet
  await open(page)
  // The tablet reads both rows; only the storno has a button there (the evidence is a manager's).
  await expect(rows(page)).toHaveCount(2)
  await expect(rowOf(page, '3').getByRole('button')).toHaveCount(0)

  const done = new Taps()
  await done.tap(rowOf(page, '1').getByRole('button', { name: 'Storno done' }))
  const sheet = page.getByTestId('pin-sheet')
  await expect(sheet).toContainText("Enter a manager's PIN")
  await expect(sheet).toContainText('We record that the storno is done in')
  await expect(sheet).toContainText("Restro doesn't check it.")
  await typePin(page, '1234')
  await expect(sheet).toContainText("This PIN belongs to staff. A manager's PIN is needed.")
  await typePin(page, '4321')
  await expect(toast(page, 'Storno recorded')).toBeVisible()
  await expect(rowOf(page, '1')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  expect(done.count).toBe(1)

  // The Undo (inside its own toast) takes the answer back as the same manager.
  const undo = new Taps()
  await undo.tap(toast(page, 'Storno recorded').getByRole('button', { name: 'Undo' }))
  await expect(rowOf(page, '1')).toHaveCount(1)
  await expect(rows(page)).toHaveCount(2)
  expect(undo.count).toBe(1)

  // Answered again, it stays answered after a reload.
  await rowOf(page, '1').getByRole('button', { name: 'Storno done' }).click()
  await typePin(page, '4321')
  await expect(toast(page, 'Storno recorded').first()).toBeVisible()
  await expect(rowOf(page, '1')).toHaveCount(0)
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(rowOf(page, '1')).toHaveCount(0)
  await expect(rowOf(page, '3')).toHaveCount(1)
})

test('the Log words the storno and its Undo', async () => {
  const { page } = owner
  await open(page, 'log')
  const log = page.getByTestId('log-list')
  await expect(log).toContainText('Storno done')
  await expect(log).toContainText('Storno taken back')
})

test('the end of the night lists the refund with no storno and the dispute, with their sections', async () => {
  seed('night', 'refunds')
  const { page } = owner
  await open(page, 'night')
  // "To fix": one line for the refund with no storno, no amount.
  const fix = page.getByTestId('night-fix-list')
  await expect(fix.getByTestId('night-fix-storno')).toHaveCount(1)
  await expect(fix.getByTestId('night-fix-storno')).toContainText('Table 1')
  await expect(fix.getByTestId('night-fix-storno')).toContainText('storno not done')
  await expect(fix.getByTestId('night-fix-storno')).not.toContainText('€')

  // Section 5: both refunds of the night, the answered one with who and when.
  const refunds = page.getByTestId('night-refunds-list')
  await expect(refunds.getByTestId('night-refund')).toHaveCount(2)
  await expect(refunds).toContainText('storno not done')
  await expect(refunds).toContainText(/Storno done · /)
  await expect(refunds).toContainText('€5.00')

  // Section 6: the disputes opened on the night, each with its answer-by date, then how many are open.
  const disputes = page.getByTestId('night-disputes-list')
  await expect(disputes.getByTestId('night-dispute')).toHaveCount(2)
  await expect(disputes).toContainText(/Answer in .+ by \d{1,2} \w+/)
  await expect(page.getByTestId('night-disputes-open')).toContainText('Disputes still open: 1')

  // A refund opens its payment’s sheet.
  await refunds.getByTestId('night-refund').first().click()
  await expect(page.getByTestId('payment-sheet')).toBeVisible()
  await expect(page.getByTestId('payment-refunds')).toContainText(/Refunded|Partly refunded/)
  await page.keyboard.press('Escape')
})
