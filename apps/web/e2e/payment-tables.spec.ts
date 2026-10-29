import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_EMAIL, ADMIN_PASSWORD, VENUE_NAME } from './support'

// Marking payment tables on Tables & QR (#215; screen plan for #201, part A) on a production build,
// in Bulgarian (the longest words), at the Paying Club venue on the simulated POS (it can take
// payments: scripts/seed-paying-e2e.ts), whose tables e2e/payment-tables-state.ts gives two bars.
//
//   PT1  a table becomes its bar's payment table in 3 taps ("…", the menu item, the dialog's
//        confirm), and the dialog names the consequence (hidden, its code stops for good); an
//        older sign-in than 15 minutes adds the password, and the mark then goes through.
//   PT2  stopping is 2 taps ("…", the menu item) with an Undo toast that marks again; the table
//        stays hidden and without a code.
//   PT3  the banner names the bars without a payment table, and is gone once each has one.
//   PT4  a member without `settings.payment_tables` sees the badges and the banner, no menu items.
//   A card of a payment table offers neither a code nor Show; a venue whose POS can't take
//   payments shows none of it; no sideways scroll at 390 px.
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'paying-owner@demo-club.test'
const VIEWER = 'paying-viewer@demo-club.test'
const PAYING_VENUE = 'Paying Club Sofia'

let venueId = ''

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues$/, { timeout: 8_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

async function open(browser: Browser, email: string, width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  await signIn(page, email)
  return { context, page }
}

const tables = () => `/venues/${venueId}?tab=tables`

/** The Nth table card of the Paying Club's one hall: tables 1, 2 and 3 in order. */
const card = (page: Page, number: 1 | 2 | 3) => page.getByTestId('table-card').nth(number - 1)

async function snapshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name), fullPage: true })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

/** PT1 from a card: "…", the menu item, the dialog's confirm: three taps. */
async function markPaymentTable(page: Page, number: 1 | 2 | 3) {
  await card(page, number).getByTestId('table-menu').click()
  await page.getByTestId('mark-payment-table').click()
  await page
    .getByTestId('confirm-payment-table')
    .getByRole('button', { name: 'Използвай за плащане' })
    .click()
}

test('seeds the venue, gives its tables two bars and finds it', async ({ browser }) => {
  runScript('./scripts/seed-paying-e2e.ts', 'seed')
  runScript('./e2e/payment-tables-state.ts', 'two-bars')
  const { context, page } = await open(browser, OWNER)
  await page
    .getByRole('link', { name: new RegExp(PAYING_VENUE) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
  expect(venueId).toMatch(/^vn_/)
  await context.close()
})

test('PT3: the banner names the bars without a payment table; PT1: marking asks first, in 3 taps', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  const banner = page.getByTestId('payment-tables-banner')
  await expect(banner).toContainText('Маркирайте маса за плащане за всеки бар')
  await expect(banner).toContainText('Main bar, Roof bar')
  // Each table shows the bar the POS gives it.
  await expect(card(page, 1).getByTestId('table-bar')).toHaveText('Бар: Main bar')
  await expect(card(page, 3).getByTestId('table-bar')).toHaveText('Бар: Roof bar')
  // No card is a payment table yet.
  await expect(page.getByTestId('payment-table-badge')).toHaveCount(0)

  // Table 3 gets a code first, so the dialog has the sticker to name.
  await page.getByTestId('create-all').click()
  await expect(page.locator('[data-testid="table-card"][data-has-code="true"]')).toHaveCount(3)

  // Tap 1 and 2: "…" and the item. Tap 3 is the dialog's confirm.
  await card(page, 3).getByTestId('table-menu').click()
  await page.getByTestId('mark-payment-table').click()
  const dialog = page.getByTestId('confirm-payment-table')
  await expect(dialog).toContainText('Да използвам ли маса 3 за плащане?')
  await expect(dialog).toContainText('карта за Roof bar')
  await expect(dialog).toContainText('кодът ѝ спира завинаги')
  await snapshot(page, 'payment-table-mark-dialog.png')
  // "Keep for guests" changes nothing.
  await dialog.getByRole('button', { name: 'Остави за гости' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('payment-table-badge')).toHaveCount(0)

  await markPaymentTable(page, 3)
  await expect(page.getByText('Маса 3 е маса за плащане')).toBeVisible()
  await expect(card(page, 3).getByTestId('payment-table-badge')).toHaveText('Маса за плащане')
  await expect(card(page, 3).getByTestId('table-bar')).toHaveText('Бар: Roof bar')
  await expect(card(page, 3)).toHaveAttribute('data-has-code', 'false')
  // The bar has one now: the banner names the other.
  await expect(banner).toContainText('Main bar')
  await expect(banner).not.toContainText('Roof bar')

  // A payment table offers neither a code nor Show, and no menu picker.
  await card(page, 3).getByTestId('table-menu').click()
  await expect(page.getByTestId('toggle-hidden')).toHaveCount(0)
  await expect(page.getByTestId('create-code')).toHaveCount(0)
  await expect(page.getByTestId('new-code')).toHaveCount(0)
  await expect(page.getByTestId('turn-off-code')).toHaveCount(0)
  await expect(page.getByTestId('unmark-payment-table')).toBeVisible()
  await page.keyboard.press('Escape')
  await snapshot(page, 'payment-table-marked.png')
  await context.close()
})

test('PT2: stopping is 2 taps with Undo, and the table stays hidden without a code', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(tables())
  await expect(card(page, 3).getByTestId('payment-table-badge')).toBeVisible()

  // Tap 1 and 2: "…" and the item. No question.
  await card(page, 3).getByTestId('table-menu').click()
  await page.getByTestId('unmark-payment-table').click()
  await expect(
    page.getByText('Маса 3 вече не е за плащане. Остава скрита и без код.'),
  ).toBeVisible()
  await expect(card(page, 3).getByTestId('payment-table-badge')).toHaveCount(0)
  await expect(card(page, 3).getByTestId('table-hidden')).toBeVisible()
  await expect(card(page, 3)).toHaveAttribute('data-has-code', 'false')
  // The table stays hidden, so the roof bar has no table for guests and needs no payment table.
  await expect(page.getByTestId('payment-tables-banner')).not.toContainText('Roof bar')

  // Undo marks it again, with no dialog.
  await page.getByRole('button', { name: 'Отмяна' }).click()
  await expect(card(page, 3).getByTestId('payment-table-badge')).toBeVisible()
  await expect(page.getByTestId('confirm-payment-table')).toHaveCount(0)
  await expect(page.getByTestId('payment-tables-banner')).not.toContainText('Roof bar')
  await context.close()
})

test('PT4: a member without the right sees the badges and the banner, no menu items', async ({
  browser,
}) => {
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await expect(card(page, 3).getByTestId('payment-table-badge')).toBeVisible()
  await expect(card(page, 3).getByTestId('table-bar')).toHaveText('Бар: Roof bar')
  await expect(page.getByTestId('payment-tables-banner')).toContainText('Main bar')
  // Never a disabled menu: there is no menu at all.
  await expect(page.getByTestId('table-menu')).toHaveCount(0)
  await expect(page.getByTestId('mark-payment-table')).toHaveCount(0)
  await snapshot(page, 'payment-tables-read-only-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('an older sign-in asks for the password, then the mark goes through; the banner is gone', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER, 390, 844)
  await page.goto(tables())
  await expect(page.getByTestId('payment-tables-banner')).toContainText('Main bar')
  runScript('./e2e/payment-tables-state.ts', 'old-sign-in', OWNER)

  await markPaymentTable(page, 1)
  const password = page.getByRole('dialog').filter({ hasText: 'Въведете паролата си' })
  await expect(password).toBeVisible()
  await password.getByLabel('Парола').fill(ADMIN_PASSWORD)
  await password.getByRole('button', { name: 'Потвърди' }).click()
  await expect(page.getByText('Маса 1 е маса за плащане')).toBeVisible()
  await expect(card(page, 1).getByTestId('payment-table-badge')).toBeVisible()
  // Every bar has one: no banner.
  await expect(page.getByTestId('payment-tables-banner')).toHaveCount(0)
  await snapshot(page, 'payment-tables-all-marked-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('a POS venue whose POS can’t take payments shows none of it', async ({ browser }) => {
  const { context, page } = await open(browser, ADMIN_EMAIL)
  await page
    .getByRole('link', { name: new RegExp(VENUE_NAME) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  const demoVenue = new URL(page.url()).pathname.split('/')[2] ?? ''
  await page.goto(`/venues/${demoVenue}?tab=tables`)
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await expect(page.getByTestId('payment-tables-banner')).toHaveCount(0)
  await expect(page.getByTestId('payment-table-badge')).toHaveCount(0)
  await expect(page.getByTestId('table-bar')).toHaveCount(0)
  const menu = page.getByTestId('table-menu').first()
  if ((await menu.count()) > 0) {
    await menu.click()
    await expect(page.getByTestId('mark-payment-table')).toHaveCount(0)
  }
  await context.close()
})

test('leaves the venue as the other specs expect it', async () => {
  runScript('./e2e/payment-tables-state.ts', 'no-bars')
})
