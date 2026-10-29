// "Bring the receipt" on Tonight (#200; screen 1 S7, the paying plan), on a production build: three
// captured card payments (`receipts` night of scripts/seed-tonight-e2e.ts). Tables 1 and 2 left a
// paper receipt to bring (Table 1's has the POS's receipt number, Table 2's has none); Table 3's was
// brought already. On the shared bar tablet one tap on "Brought" clears the row with no PIN and the
// 8-second toast offers Undo, which brings it back; the Log names the account and words the Undo;
// the end of the night lists the receipt never brought by table and payment number, with no amount.
// The admin is read in English.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_TABLET_EMAIL,
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
  await expect(page.locator('[aria-label="Sections of Tonight"]:visible').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('action-row')
const rowOf = (page: Page, table: string) => rows(page).filter({ hasText: `Table ${table}` })
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

let tablet: { context: BrowserContext; page: Page }
let owner: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  tablet = await person(browser, TONIGHT_TABLET_EMAIL)
  owner = await person(browser, TONIGHT_OWNER_EMAIL)
  // The bar tablet's session becomes a shared device, as the owner's "mark this device" does.
  seed('device', TONIGHT_TABLET_EMAIL)
  seed('night', 'receipts')
})

test.afterAll(async () => {
  await tablet?.context.close()
  await owner?.context.close()
})

test('a captured payment shows "Bring the receipt" with the number the guest shows, oldest first', async () => {
  const { page } = tablet
  await open(page)
  await expect(rows(page)).toHaveCount(2)
  const kinds = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
  expect(kinds).toEqual(['receipt', 'receipt'])
  // Table 1 was captured first. Only a table with a receipt to bring has a row: Table 3's was
  // brought already.
  await expect(rows(page).first()).toContainText('Table 1')
  await expect(rowOf(page, '3')).toHaveCount(0)
  for (const row of await rows(page).all()) {
    await expect(row).toContainText('Bring the receipt')
    // The payment number (five letters or digits) and what was charged, tip included.
    await expect(row).toContainText(/paid from the phone with ref [A-Z0-9]{5}, €38\.00\./)
    await expect(row.getByRole('button')).toHaveText(['Brought'])
  }
  // The POS's receipt number is shown where it gave one.
  await expect(rowOf(page, '1')).toContainText('Receipt R-000123')
  await expect(rowOf(page, '2')).not.toContainText('Receipt R-')
  // A receipt to bring is not an alarm: the table's tile does not turn red.
  await expect(
    page.locator('[data-testid="table-tile"][aria-label^="Table 1"]'),
  ).not.toHaveAttribute('data-state', 'payment')
})

test('one tap on "Brought" clears the row with no PIN, and Undo brings it back', async () => {
  const { page } = tablet
  await open(page)
  const brought = new Taps()
  await brought.tap(rowOf(page, '1').getByRole('button', { name: 'Brought' }))
  // The device's account is named in the Log, so no PIN is asked.
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  await expect(toast(page, 'Receipt for Table 1 brought')).toBeVisible()
  await expect(rowOf(page, '1')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
  expect(brought.count).toBe(1)

  const undo = new Taps()
  await undo.tap(toast(page, 'Receipt for Table 1 brought').getByRole('button', { name: 'Undo' }))
  await expect(rowOf(page, '1')).toHaveCount(1)
  await expect(rows(page)).toHaveCount(2)
  expect(undo.count).toBe(1)

  // Marked again, it stays marked.
  await rowOf(page, '1').getByRole('button', { name: 'Brought' }).click()
  await expect(rowOf(page, '1')).toHaveCount(0)
  await page.reload()
  await expect(rowOf(page, '1')).toHaveCount(0)
  await expect(rowOf(page, '2')).toHaveCount(1)
})

test('the Log words the mark and its Undo, with the number the guest shows and no amount', async () => {
  const { page } = owner
  await page.goto(`${venueUrl(page)}?tab=tonight&view=log`)
  await expect(page.getByTestId('tonight-log')).toBeVisible()
  const log = page.getByTestId('log-list')
  await expect(log).toContainText('Receipt for Table 1 brought')
  await expect(log).toContainText(/undid "receipt brought" · payment [A-Z0-9]{5}/)
  await expect(log).not.toContainText('€38')
})

test('the end of the night lists the receipt never brought, by table and payment number', async () => {
  const { page } = owner
  await open(page, 'night')
  const left = page.getByTestId('night-fix-notbrought')
  await expect(left).toHaveCount(1)
  await expect(left).toContainText(/Payment, Table 2: receipt not brought · payment [A-Z0-9]{5}/)
  // No amount on this line, as on the group's message.
  await expect(left).not.toContainText('€')
})
