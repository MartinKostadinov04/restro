import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// Pay first on Tables & QR (#217; screen plan for #201, part B) on a production build, in Bulgarian
// (the longest words), at the Paying Club venue on the simulated POS (scripts/seed-paying-e2e.ts),
// whose payment account e2e/paying-account.ts sets.
//
//   PF4  one area to pay first or not: 2 taps (the row's Select, the option), saved at once, with
//        an Undo taken from its own toast; the area then shows the "Overrides" badge, and the
//        tables that follow it read "Same as the area".
//   PF5  one table to differ from its area: the same 2 taps and Undo.
//   PF9  a member without `settings.payment_tables` reads the line as text, with no control.
//   No row while card payments are off, or on a payment table; no sideways scroll at 390 px.
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'paying-owner@demo-club.test'
const VIEWER = 'paying-viewer@demo-club.test'
const PAYING_VENUE = 'Paying Club Sofia'
const OFF = 'Изключено: всичко по сметката'

let venueId = ''

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues(\/vn_[^/?]+)?(\?.*)?$/, { timeout: 8_000 })
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

/** The area's header row (the first row inside the hall) and a table card that can take pay first. */
const areaRow = (page: Page) => page.getByTestId('hall').getByTestId('pay-first-row').first()
const tableCard = (page: Page) =>
  page
    .getByTestId('table-card')
    .filter({ has: page.getByTestId('pay-first-row') })
    .first()

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

/** Runs `act` and waits for the server action it starts to answer. */
async function saved(page: Page, act: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  )
  await act()
  await answered
}

/** Two taps: the row's Select, then the option. */
async function choose(page: Page, row: ReturnType<typeof areaRow>, option: string) {
  await saved(page, async () => {
    await row.getByTestId('pay-first-select').click()
    await page.getByRole('option', { name: option, exact: true }).click()
  })
}

const toastOf = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).last()

test('seeds the venue with card payments on, and finds it', async ({ browser }) => {
  runScript('./scripts/seed-paying-e2e.ts', 'seed')
  runScript('./e2e/paying-account.ts', 'connected')
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

test('no row while card payments are off', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('table-card').first()).toBeVisible()
  await expect(page.getByTestId('pay-first-row')).toHaveCount(0)
  await context.close()
})

test('PF4: an area to pay first or not in 2 taps, with Undo; its tables follow it', async ({
  browser,
}) => {
  runScript('./e2e/paying-account.ts', 'on')
  const { context, page } = await open(browser, OWNER)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.waitForLoadState('networkidle')
  const area = areaRow(page)
  await expect(area.getByTestId('pay-first-select')).toHaveText(
    'Предварително плащане: Като на заведението (Включено)',
  )
  await expect(area.getByTestId('pay-first-overrides')).toHaveCount(0)
  // The payment table (the last one) has no row: the other two and the area do.
  await expect(page.getByTestId('pay-first-row')).toHaveCount(3)
  await snapshot(page, 'tables-pay-first.png')

  await choose(page, area, OFF)
  await expect(toastOf(page, `Предварително плащане за зона Hall: ${OFF}`)).toBeVisible()
  await expect(area.getByTestId('pay-first-overrides')).toHaveText('Заменя')
  // The area's tables now follow the area.
  await page.waitForLoadState('networkidle')
  await expect(tableCard(page).getByTestId('pay-first-select')).toHaveText(
    `Предварително плащане: Като на зоната (${OFF})`,
  )
  // The choice is kept across a reload.
  await page.reload()
  await expect(areaRow(page).getByTestId('pay-first-select')).toHaveText(
    `Предварително плащане: ${OFF}`,
  )

  // Undo, from its own toast, puts the area back to following the venue.
  await choose(page, areaRow(page), 'Включено')
  const toast = toastOf(page, 'Предварително плащане за зона Hall: Включено')
  await expect(toast).toBeVisible()
  await saved(page, () => toast.getByRole('button', { name: 'Отмяна' }).click())
  await expect(areaRow(page).getByTestId('pay-first-select')).toHaveText(
    `Предварително плащане: ${OFF}`,
  )
  // ...and "Same as the venue" takes the choice away.
  await choose(page, areaRow(page), 'Като на заведението (Включено)')
  await expect(areaRow(page).getByTestId('pay-first-overrides')).toHaveCount(0)
  await context.close()
})

test('PF5: a table that differs from its area in 2 taps, with Undo', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.waitForLoadState('networkidle')
  const card = tableCard(page)
  await expect(card.getByTestId('pay-first-select')).toHaveText(
    'Предварително плащане: Като на заведението (Включено)',
  )
  await choose(page, card.getByTestId('pay-first-row'), OFF)
  const toast = toastOf(page, `Предварително плащане за маса`)
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(OFF)
  await expect(card.getByTestId('pay-first-overrides')).toHaveText('Заменя')
  await expect(card.getByTestId('pay-first-select')).toHaveText(`Предварително плащане: ${OFF}`)
  // Undo, from its own toast.
  await saved(page, () => toast.getByRole('button', { name: 'Отмяна' }).click())
  await expect(card.getByTestId('pay-first-overrides')).toHaveCount(0)
  await expect(card.getByTestId('pay-first-select')).toHaveText(
    'Предварително плащане: Като на заведението (Включено)',
  )
  await context.close()
})

test('PF9: a member without the right reads the line, with no control, at 390 px', async ({
  browser,
}) => {
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('pay-first-row').first()).toBeVisible()
  await expect(page.getByTestId('pay-first-select')).toHaveCount(0)
  await expect(tableCard(page).getByTestId('pay-first-text')).toHaveText(
    'Предварително плащане: Като на заведението (Включено)',
  )
  await snapshot(page, 'tables-pay-first-read-only-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('the longest words wrap on a phone, with no sideways scroll', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER, 390, 844)
  await page.goto(tables())
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await choose(page, areaRow(page), OFF)
  await expect(areaRow(page).getByTestId('pay-first-select')).toHaveText(
    `Предварително плащане: ${OFF}`,
  )
  await expect(tableCard(page).getByTestId('pay-first-select')).toHaveText(
    `Предварително плащане: Като на зоната (${OFF})`,
  )
  await snapshot(page, 'tables-pay-first-phone.png')
  await noSidewaysScroll(page)
  // Leave the venue as it was found.
  await choose(page, areaRow(page), 'Като на заведението (Включено)')
  await expect(areaRow(page).getByTestId('pay-first-overrides')).toHaveCount(0)
  await context.close()
})
