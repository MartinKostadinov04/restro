import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// Pay first on the item sheet and the selection bar (#218; screen plan for #201, part B) on a
// production build, in Bulgarian (the longest words), at the Paying Club venue on the simulated POS
// (scripts/seed-paying-e2e.ts) with a small menu (scripts/seed-pay-first-items-e2e.ts), whose payment
// account e2e/paying-account.ts sets.
//
//   PF6  one item paid first: 2 taps from Structure (the item's name, the "Pay first" card), saved
//        at once, with Undo taken from its own toast.
//   PF7  one item follows the venue again: the same 2 taps ("Same as the venue").
//   PF8  several items at once: the ticks, then 2 taps ("Payment mode…", the mode); one change.
//   No card while card payments are off (the sheet's generic row is gone, the bar has no button);
//   no sideways scroll at 390 px.
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'paying-owner@demo-club.test'
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
      await expect(page).toHaveURL(/\/venues(\/vn_[^/?]+)?(\?.*)?$/, { timeout: 8_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

async function open(browser: Browser, width = 1280, height = 900) {
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  await signIn(page, OWNER)
  return { context, page }
}

const composer = () => `/venues/${venueId}?tab=composer`
const itemRow = (page: Page, name: string) =>
  page.getByTestId('item-row').filter({ has: page.getByRole('button', { name, exact: true }) })

async function openComposer(page: Page) {
  await page.goto(composer())
  await expect(page.getByTestId('composer')).toBeVisible()
  await page.waitForLoadState('networkidle')
}

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

/** Runs `act` and waits for the server action it starts to answer (`needle` is in what it sent). */
async function saved(page: Page, needle: string, act: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined &&
      (response.request().postData() ?? '').includes(needle),
  )
  await act()
  await answered
}

const toastOf = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).last()

/** The sheet's three cards: which one is picked. */
async function picked(page: Page): Promise<string | null> {
  for (const id of ['same', 'pay_first', 'on_bill']) {
    if (await page.getByTestId(`payment-mode-${id}`).isChecked()) return id
  }
  return null
}

test('seeds the venue and its menu, and finds the venue', async ({ browser }) => {
  runScript('./scripts/seed-paying-e2e.ts', 'seed')
  runScript('./e2e/paying-account.ts', 'connected')
  runScript('./scripts/seed-pay-first-items-e2e.ts', 'seed')
  const { context, page } = await open(browser)
  await page
    .getByRole('link', { name: new RegExp(PAYING_VENUE) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
  expect(venueId).toMatch(/^vn_/)
  await context.close()
})

test('no cards and no bar button while card payments are off', async ({ browser }) => {
  const { context, page } = await open(browser)
  await openComposer(page)
  await itemRow(page, 'Негрони').getByTestId('item-select').check()
  await expect(page.getByTestId('selection-bar')).toBeVisible()
  await expect(page.getByTestId('payment-mode')).toHaveCount(0)
  await page.getByTestId('clear-selection').click()
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('item-sheet')).toBeVisible()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  await expect(page.getByTestId('payment-mode-same')).toHaveCount(0)
  await context.close()
})

test('PF6 and PF7: one item paid first, and back to the venue, in 2 taps each, with Undo', async ({
  browser,
}) => {
  runScript('./e2e/paying-account.ts', 'on')
  const { context, page } = await open(browser)
  await openComposer(page)

  // Tap 1: the item's name.
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  // Out of the box: the venue's choice, shown beside it.
  await expect(page.getByTestId('payment-mode-same').locator('xpath=ancestor::label')).toHaveText(
    'Като на заведението (по сметката)',
  )
  expect(await picked(page)).toBe('same')
  await page.getByTestId('payment-mode-same').scrollIntoViewIfNeeded()
  await snapshot(page, 'item-sheet-payment-mode.png')

  // Tap 2: "Pay first". The card is picked at once; the toast carries Undo.
  await saved(page, 'payment_mode', () => page.getByTestId('payment-mode-pay_first').check())
  expect(await picked(page)).toBe('pay_first')
  const toast = toastOf(page, 'Начин на плащане: плаща се предварително')
  await expect(toast).toBeVisible()

  // Undo, inside its own toast: the item follows the venue again.
  await saved(page, 'payment_mode', () => toast.getByRole('button', { name: 'Отмяна' }).click())
  await expect(page.getByTestId('payment-mode-same')).toBeChecked()

  // Again, and it is still there after a reload (saved, not just shown).
  await saved(page, 'payment_mode', () => page.getByTestId('payment-mode-pay_first').check())
  await expect(toastOf(page, 'Начин на плащане: плаща се предварително')).toBeVisible()
  await openComposer(page)
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  await expect(page.getByTestId('payment-mode-pay_first')).toBeChecked()

  // PF7: back to the venue's choice, 2 taps from Structure (the item's name, "Same as the venue").
  await openComposer(page)
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  await saved(page, 'payment_mode', () => page.getByTestId('payment-mode-same').check())
  // In a sentence, so lower case.
  await expect(toastOf(page, 'Начин на плащане: като на заведението (по сметката)')).toBeVisible()
  await openComposer(page)
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('payment-mode-same')).toBeChecked()
  await context.close()
})

test('PF8: several items at once from the selection bar, one change', async ({ browser }) => {
  const { context, page } = await open(browser)
  await openComposer(page)

  // The ticks, then 2 taps: "Payment mode…", the mode.
  // The lowest row is ticked last, with the bar already showing: the page scrolls it clear of the bar.
  await itemRow(page, 'Мохито').getByTestId('item-select').check()
  await itemRow(page, 'Шприц').getByTestId('item-select').check()
  await itemRow(page, 'Кола').getByTestId('item-select').check()
  await expect(page.getByTestId('selection-count')).toHaveText('Избрани са 3 артикула')
  await page.getByTestId('payment-mode').click()
  await expect(page.getByTestId('payment-mode-option-same')).toHaveText(
    'Като на заведението (по сметката)',
  )
  await snapshot(page, 'selection-bar-payment-mode.png')
  await saved(page, 'itemIds', () => page.getByTestId('payment-mode-option-pay_first').click())
  await expect(toastOf(page, '3 артикула: плаща се предварително')).toBeVisible()

  // Every ticked item took it; the one that was not ticked did not.
  await page.getByTestId('clear-selection').click()
  for (const [name, expected] of [
    ['Мохито', 'pay_first'],
    ['Шприц', 'pay_first'],
    ['Кола', 'pay_first'],
    ['Негрони', 'same'],
  ] as const) {
    await itemRow(page, name).getByRole('button', { name, exact: true }).click()
    await expect(page.getByTestId('item-sheet-details')).toBeVisible()
    await expect(page.getByTestId(`payment-mode-${expected}`)).toBeChecked()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  }

  // Taking it away from the same three is one change too.
  await openComposer(page)
  for (const name of ['Мохито', 'Шприц', 'Кола']) {
    await itemRow(page, name).getByTestId('item-select').check()
  }
  await page.getByTestId('payment-mode').click()
  await saved(page, 'itemIds', () => page.getByTestId('payment-mode-option-same').click())
  await expect(toastOf(page, '3 артикула: като на заведението (по сметката)')).toBeVisible()
  await context.close()
})

test('the cards fit a phone: no sideways scroll at 390 px', async ({ browser }) => {
  const { context, page } = await open(browser, 390, 844)
  await openComposer(page)
  await itemRow(page, 'Негрони').getByRole('button', { name: 'Негрони', exact: true }).click()
  await expect(page.getByTestId('item-sheet-details')).toBeVisible()
  await page.getByTestId('payment-mode-same').scrollIntoViewIfNeeded()
  await noSidewaysScroll(page)
  await snapshot(page, 'item-sheet-payment-mode-phone.png')
  await context.close()
})
