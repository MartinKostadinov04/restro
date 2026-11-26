// A group payment in Tonight (#545; D160 §2 and §3, decision log 2.16): on a production build, over
// the `group-paid` and `sharing` nights of scripts/seed-tonight-e2e.ts. Both are one payment over
// Tables 1 and 2, made at Table 1.
// - `group-paid` is captured: Tonight raises a card for each table it covered, Table 1's the one to
//   bring the receipt, Table 2's telling its waiter the table is paid and where the receipt goes
//   (Martin 11-25: a group payment reaches every table's waiter).
// - `sharing` is gathering its holds, €60 of €100: the sheet of either table reads it, and "Cancel
//   sharing" lets every hold go in three taps (the tile, the button, the confirmation).
// The admin is read in English.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import { signInAs } from './sign-in'
import { TONIGHT_PIN_PEPPER, TONIGHT_TABLET_EMAIL } from './support'

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
  await signInAs(page, email, { lands: /\/venues\/vn_[^/?]+|\/venues$/ })
  if (/\/venues\/vn_/.test(page.url())) return
  await page
    .getByRole('link', { name: /Tonight Club/ })
    .first()
    .click({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/venues\/vn_/, { timeout: 20_000 })
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
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)

let tablet: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  tablet = await person(browser, TONIGHT_TABLET_EMAIL)
  seed('device', TONIGHT_TABLET_EMAIL)
})

test.afterAll(async () => {
  await tablet?.context.close()
})

test('a group payment across two tables raises a waiter card for both, the paying table bringing the receipt', async () => {
  seed('night', 'group-paid')
  const { page } = tablet
  await open(page)
  await expect(rows(page)).toHaveCount(2)
  const bring = rows(page).filter({ hasText: 'Bring the receipt' })
  const paid = rows(page).filter({ hasText: 'Table paid' })
  await expect(bring).toHaveCount(1)
  await expect(paid).toHaveCount(1)
  // Table 1 paid: its card says which other table the one payment covered, and has the button.
  await expect(bring).toContainText(
    /Table 1: paid from the phone with ref [A-Z0-9]{5}, €36\.00\. It also paid for Table 2\./,
  )
  await expect(bring.getByRole('button')).toHaveText(['Brought'])
  // Table 2's card names its own table, the table that paid and the same payment number, and has
  // no button: its waiter learns the table is settled, and does not bring a receipt for it.
  await expect(paid).toContainText(
    /Table 2: paid together with Table 1, ref [A-Z0-9]{5}\. The receipt goes to Table 1\./,
  )
  await expect(paid.getByRole('button')).toHaveCount(0)
  const numbers = await rows(page).evaluateAll((els) =>
    els.map((el) => /ref ([A-Z0-9]{5})/.exec(el.textContent ?? '')?.[1]),
  )
  expect(new Set(numbers).size).toBe(1)
})

test('one "Brought" clears the payment from both tables, and Undo brings both back', async () => {
  const { page } = tablet
  await open(page)
  await expect(rows(page)).toHaveCount(2)
  const taps = new Taps()
  await taps.tap(rows(page).filter({ hasText: 'Bring the receipt' }).getByRole('button'))
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
  expect(taps.count).toBe(1)
  await toast(page, 'Receipt for Table 1 brought').getByRole('button', { name: 'Undo' }).click()
  await expect(rows(page)).toHaveCount(2)
})

test('a share gathering reads what is held and the time left on both tables, never who', async () => {
  seed('night', 'sharing')
  const { page } = tablet
  await open(page)
  for (const name of ['Table 1', 'Table 2']) {
    await expect(tile(page, name)).toHaveAttribute('data-state', 'payment')
  }
  await tile(page, 'Table 2').click()
  const sheet = page.getByTestId('table-sheet')
  await expect(sheet.getByTestId('sh-share')).toHaveText(
    /^Being shared · €60\.00 of €100\.00 · \d+ min left$/,
  )
  await expect(sheet.getByRole('button', { name: 'Cancel sharing' })).toBeVisible()
  await expect(sheet).not.toContainText(/ph_|handle|card ending/)
})

test('Cancel sharing asks once, then lets every hold go, in three taps', async () => {
  const { page } = tablet
  await open(page)
  const taps = new Taps()
  await taps.tap(tile(page, 'Table 2'))
  await taps.tap(page.getByTestId('table-sheet').getByRole('button', { name: 'Cancel sharing' }))
  const dialog = page.getByRole('dialog').filter({ hasText: 'Cancel sharing?' })
  await expect(dialog).toContainText('Every held amount is let go. Nothing is charged.')
  await taps.tap(dialog.getByRole('button', { name: 'Cancel sharing' }))
  await expect(toast(page, 'Sharing cancelled. Nothing was charged.')).toBeVisible()
  // No PIN on the shared tablet: nothing is charged, as closing a table asks none.
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  for (const name of ['Table 1', 'Table 2']) {
    await expect(tile(page, name)).not.toHaveAttribute('data-state', 'payment')
  }
  // The story's target: the tile, the button, the confirmation.
  expect(taps.count).toBe(3)
})
