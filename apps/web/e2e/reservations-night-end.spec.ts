// Ending the night (#332), on a production build: the Tonight test club's owner ends the night
// early on a tablet, then puts one party back on its own sheet.
//
//   the confirm dialog's preview with its open-bills count and the warning before the closing hour,
//   "Keep the night open" closing nothing, the night ended (banner on Tonight and on Reservations,
//   the bills-still-open row on Tonight), one No-show put back with its Undo while the other stays
//   closed (there is no bulk undo), and both Bulgarian buttons whole at 390 px.
//
// The closing hour's own tick, the sweep once the night has passed, a held card keeping its table
// and the count written once are pinned on Postgres (packages/core night-end.test.ts) and as rules
// (night-end-rules.test.ts); the worker does not run here.
//
// The fixture: scripts/seed-tonight-e2e.ts `night busy` (open tables, Table 1 with a round sent onto
// its bill) and `book book` (Иванова booked past her hour and Димитров still to come, both
// Reserved; Петров seated). e2e/night-end-hours.ts gives the club a closing hour still ahead
// (06:59), so ending the night now is ending it early. The admin is read in English, then in
// Bulgarian for the 390 px check.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScript, runScriptWith } from './global-setup'
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

let venueId = ''
let owner: { context: BrowserContext; page: Page }

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const rows = (page: Page) => page.getByTestId('rv-row')
const sheet = (page: Page) => page.getByTestId('rv-sheet')

async function openTonight(page: Page) {
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(page.getByRole('button', { name: /^(More actions|Още действия)$/ })).toBeVisible()
}

async function openReservations(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
}

/** Opens the dialog from Tonight's tables menu and waits for its preview to be counted. */
async function openDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^(More actions|Още действия)$/ }).click()
  await page.getByTestId('night-end-open').click()
  const dialog = page.getByTestId('night-end-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-busy', 'false')
  return dialog
}

/** The element's text fits its box: nothing clipped sideways at this width. */
async function fitsWhole(button: Locator) {
  await expect(button).toBeVisible()
  const { scroll, client, right, viewport } = await button.evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
    right: el.getBoundingClientRect().right,
    viewport: document.documentElement.clientWidth,
  }))
  expect(scroll).toBeLessThanOrEqual(client)
  expect(right).toBeLessThanOrEqual(viewport)
}

async function inBulgarianOnAPhone(page: Page) {
  await page.setViewportSize(PHONE)
  await owner.context.addCookies([
    { name: 'NEXT_LOCALE', value: 'bg', url: new URL(page.url()).origin },
  ])
}

async function inEnglishOnATablet(page: Page) {
  await page.setViewportSize(TABLET)
  await owner.context.addCookies([
    { name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin },
  ])
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  seed('night', 'busy')
  seed('book', 'book')
  runScript('./e2e/night-end-hours.ts', 'set')
  const context = await browser.newContext({ viewport: TABLET })
  const page = await context.newPage()
  await signIn(page, TONIGHT_OWNER_EMAIL)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  owner = { context, page }
  await page
    .getByRole('link', { name: new RegExp(TONIGHT_VENUE_NAME) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
})

test.afterAll(async () => {
  await owner?.context.close()
  // The club as the other specs expect it: no hours, no open table, a fresh book.
  runScript('./e2e/night-end-hours.ts', 'clear')
  seed('night', 'empty')
  seed('book', 'book')
})

test('the preview counts the open bills and warns before the closing hour; Keep closes nothing', async () => {
  const { page } = owner
  await openTonight(page)
  await expect(page.getByTestId('night-ended')).toHaveCount(0)

  const dialog = await openDialog(page)
  await expect(dialog.getByRole('heading')).toHaveText('End the night now?')
  // The consequence in the preview's numbers: Петров finishes, the two booked parties become
  // No-show, and the open tables' codes close.
  await expect(dialog.getByTestId('night-end-preview')).toContainText(
    /1 party becomes Finished, 2 become No-show, and \d+ table codes? closes?\./,
  )
  // The open bills, counted, and the closing hour that has not come yet.
  await expect(dialog.getByTestId('night-end-bills')).toHaveText(
    /^\d+ bills? (is|are) still open\.$/,
  )
  await expect(dialog.getByTestId('night-end-early')).toContainText('Your club closes at 06:59.')
  await expect(dialog.getByTestId('night-end-confirm')).toHaveText('End the night early')

  // Keeping the night open is the safe way out: nothing closed, nothing written.
  await dialog.getByRole('button', { name: 'Keep the night open' }).click()
  await expect(dialog).toHaveCount(0)
  await openTonight(page)
  await expect(page.getByTestId('night-ended')).toHaveCount(0)
  await expect(page.locator('[data-testid="action-row"][data-kind="night_end"]')).toHaveCount(0)

  // In Bulgarian at 390 px the menu's „Приключи вечерта“ reads whole, and so does the confirm.
  await inBulgarianOnAPhone(page)
  await page.goto(`/venues/${venueId}?tab=tonight`)
  // On a phone Tonight shows one part at a time: the tables menu sits on the Tables part.
  await page.getByRole('button', { name: 'Маси', exact: true }).click()
  await page.getByRole('button', { name: 'Още действия' }).click()
  const item = page.getByTestId('night-end-open')
  await expect(item).toHaveText('Приключи вечерта')
  await fitsWhole(item)
  await item.click()
  const confirm = page.getByTestId('night-end-confirm')
  await expect(confirm).toBeEnabled()
  await fitsWhole(confirm)
  await page
    .getByTestId('night-end-dialog')
    .getByRole('button', { name: /^Остави/ })
    .click()
  await inEnglishOnATablet(page)
})

test('ending it closes the night: the banner on Tonight and Reservations, and the bills row', async () => {
  const { page } = owner
  await openTonight(page)
  const dialog = await openDialog(page)
  const bills = (await dialog.getByTestId('night-end-bills').textContent()) ?? ''
  const count = Number(/^(\d+)/.exec(bills)?.[1])
  expect(count).toBeGreaterThan(0)

  await dialog.getByTestId('night-end-confirm').click()
  await expect(toast(page, 'The night is ended')).toBeVisible()
  await expect(page.getByTestId('night-ended')).toHaveText('This night is closed.')
  // The bills the close left open are one alert row, with the hour and where to close them.
  const row = page.locator('[data-testid="action-row"][data-kind="night_end"]')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`${count} bill`)
  await expect(row).toContainText('The night ended at')
  // The night has ended and every table closed with it (no card is held in this night), so the
  // tables menu has nothing left to offer: neither Close all nor ending the night again.
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)

  await openReservations(page)
  await expect(page.locator('[data-testid="rv-banner"][data-kind="closed"]')).toContainText(
    'This night is closed.',
  )
  await expect(rows(page).filter({ hasText: 'Иванова' })).toContainText('No-show')
  await expect(rows(page).filter({ hasText: 'Димитров' })).toContainText('No-show')
  await expect(rows(page).filter({ hasText: 'Петров' })).toContainText('Finished')
})

test('one reservation is put back on its own sheet, with an Undo; the others stay closed', async () => {
  const { page } = owner
  await openReservations(page)
  await rows(page).filter({ hasText: 'Иванова' }).click()
  await expect(sheet(page)).toBeVisible()
  // Two taps: the button, and no confirmation after it.
  await sheet(page).getByTestId('rv-put-back').click()
  const back = toast(page, 'Иванова is back on the night.')
  await expect(back).toBeVisible()
  await expect(back.getByRole('button', { name: 'Undo' })).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Иванова' })).toContainText('Coming')
  // One reservation, never the night: Димитров is still a No-show.
  await expect(rows(page).filter({ hasText: 'Димитров' })).toContainText('No-show')

  // The Undo gives the party back to the night's end.
  await back.getByRole('button', { name: 'Undo' }).click()
  await expect(toast(page, 'Closed again, as the night’s end left it.')).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Иванова' })).toContainText('No-show')
})

test('in Bulgarian at 390 px the put-back button reads whole', async () => {
  const { page } = owner
  await inBulgarianOnAPhone(page)
  await openReservations(page)
  await rows(page).filter({ hasText: 'Димитров' }).click()
  const button = sheet(page).getByTestId('rv-put-back')
  await expect(button).toHaveText('Върни резервацията')
  await fitsWhole(button)
})
