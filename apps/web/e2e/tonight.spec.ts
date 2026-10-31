// Tonight, screen 1: the actions and the tables (#85; plan
// docs/deliverables/2026-10-21-tonight-screen-1-plan.md), on a production build. Every story is
// done by tapping and the taps are counted against the plan's targets (a PIN typed on the pad is
// not a tap, the plan's rule); the states of the plan's section 5 are checked, so are the 44 px
// targets, the phone's one switch and the live announcement of a new row.
//
// Three people: a waiter with a phone of their own (a staff member with a sign-in), the bar
// tablet's account (marked a shared device after it signs in, so a PIN names who answers) and the
// manager's own session is not needed here (a manager's phone asks no PIN: the unit tests of the
// view and core's engine tests cover the rights). The fixture is scripts/seed-tonight-e2e.ts, run
// before each test to set the night. The admin is read in English.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_PIN_PEPPER,
  TONIGHT_TABLET_EMAIL,
  TONIGHT_WAITER_EMAIL,
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
      await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight|\/venues$/, {
        timeout: 8_000,
      })
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
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

const tonight = (page: Page) => page.getByTestId('tonight')
const rows = (page: Page) => page.getByTestId('action-row')
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)

async function openTonight(page: Page, night: string) {
  seed('night', night)
  await page.goto(`${page.url().replace(/\?.*$/, '')}?tab=tonight`)
  await expect(tonight(page)).toBeVisible()
}

/** Types a PIN on the sheet's pad with the keyboard; the sheet submits on the fourth digit. */
async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-sheet')).toBeVisible()
  await page.keyboard.type(pin)
}

let tablet: { context: BrowserContext; page: Page }
let waiter: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  waiter = await person(browser, TONIGHT_WAITER_EMAIL, TABLET)
  tablet = await person(browser, TONIGHT_TABLET_EMAIL, TABLET)
  // The bar tablet's session becomes a shared device, as the owner's "mark this device" does.
  seed('device', TONIGHT_TABLET_EMAIL)
})

test.afterAll(async () => {
  await waiter?.context.close()
  await tablet?.context.close()
})

test('a staff-only sign-in lands on Tonight, whose tab sits after Tables & QR', async () => {
  const { page } = waiter
  await page.goto('/venues')
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight/)
  // The venue's own tabs; Tonight has tabs of its own below them (#86).
  const tabs = page.getByRole('tablist', { name: 'Switch tab' }).getByRole('tab')
  await expect(tabs).toHaveText(['Studio', 'Tables & QR', 'Tonight', 'Settings'])
  await expect(page.getByRole('tab', { name: 'Tonight' })).toHaveAttribute('aria-selected', 'true')
})

test('a shared tablet has no Studio or Tables & QR: an old link lands on Tonight (RR-83, RR-84)', async () => {
  const { page } = tablet
  await page.goto('/venues')
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+\?tab=tonight/)
  const venue = new URL(page.url()).pathname
  await page.goto(`${venue}?tab=studio`)
  await expect(page).toHaveURL(new RegExp(`${venue}\\?tab=tonight`))
  await page.goto(`${venue}?tab=tables`)
  await expect(page).toHaveURL(new RegExp(`${venue}\\?tab=tonight`))
  // A PIN unlocks Tonight only (D122 §9, RR-85), so there is no tab to choose.
  await page.goto(`${venue}?tab=settings`)
  await expect(page).toHaveURL(new RegExp(`${venue}\\?tab=tonight`))
  await expect(page.getByRole('tablist', { name: 'Switch tab' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
})

test('Needs you is ordered by what costs most to leave, with the notice apart', async () => {
  const { page } = waiter
  await openTonight(page, 'busy')
  await expect(rows(page)).toHaveCount(4)
  const kinds = await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
  expect(kinds).toEqual(['check', 'approval', 'paused', 'call'])
  // The count beside "Needs you" is the rows; the out-of-stock notice (no button) is not one.
  await expect(page.getByTestId('needs-count')).toHaveText('4')
  const notice = page.getByTestId('stock-notice')
  await expect(notice).toContainText('Out of stock in')
  await expect(notice).toContainText('Mojito, Negroni')
  await expect(notice.getByRole('button')).toHaveCount(0)
  // The top row is a sent order to check: its two answers sit at equal weight, both outline, so
  // neither is a default (plan §4, Q9); the only filled button is a top row's single answer.
  const filled = await tonight(page)
    .locator('[data-testid="action-row"] button[data-variant="default"]')
    .count()
  expect(filled).toBe(0)
  // Restro found it on the bill by itself (#135): a meta line, and staff still answer.
  await expect(rows(page).first().getByTestId('landed-late')).toContainText(
    'Restro found it on the bill at',
  )
  await expect(rows(page).first().getByRole('button')).toHaveText([
    'Found on the bill',
    'Not on the bill',
  ])
  // An approval is read-only: the POS decides (plan §10 Q4).
  await expect(rows(page).nth(1)).toContainText('Approve or decline it in')
  await expect(rows(page).nth(1).getByRole('button')).toHaveCount(0)
})

test('on a personal session: Handled and Resume are one tap with no PIN', async () => {
  const { page } = waiter
  await openTonight(page, 'busy')
  const call = new Taps()
  await call.tap(
    rows(page).filter({ hasText: 'Table 2: Waiter' }).getByRole('button', { name: 'Handled' }),
  )
  await expect(toast(page, 'Table 2: handled')).toBeVisible()
  await expect(rows(page)).toHaveCount(3)
  expect(call.count).toBe(1)
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)

  const resume = new Taps()
  await resume.tap(
    rows(page)
      .filter({ hasText: 'Sent order not confirmed' })
      .getByRole('button', { name: 'Found on the bill' }),
  )
  await expect(toast(page, 'Saved: found on the bill')).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Sent order not confirmed' })).toHaveCount(0)
  expect(resume.count).toBe(1)
})

test('a table opens in one tap with Undo, and closes in two', async () => {
  const { page } = waiter
  await openTonight(page, 'busy')
  await expect(page.getByTestId('open-count')).toHaveText('4 of 6 open for phones')
  const open = new Taps()
  await open.tap(tile(page, 'Table 5'))
  await expect(page.getByTestId('open-count')).toHaveText('5 of 6 open for phones')
  expect(open.count).toBe(1)
  // Undo is the toast's own button: the table is closed again.
  await toast(page, 'Table 5 is open for phones').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('open-count')).toHaveText('4 of 6 open for phones')

  const close = new Taps()
  await close.tap(tile(page, 'Table 4'))
  await close.tap(page.getByTestId('table-sheet').getByRole('button', { name: 'Close for phones' }))
  await expect(page.getByTestId('open-count')).toHaveText('3 of 6 open for phones')
  expect(close.count).toBe(2)
})

test('on the shared tablet: Handled asks no PIN; Resume asks the person’s own', async () => {
  const { page } = tablet
  await openTonight(page, 'busy')
  const call = new Taps()
  await call.tap(
    rows(page).filter({ hasText: 'Table 2: Waiter' }).getByRole('button', { name: 'Handled' }),
  )
  await expect(toast(page, 'Table 2: handled')).toBeVisible()
  await expect(page.getByTestId('pin-sheet')).toHaveCount(0)
  expect(call.count).toBe(1)

  const resume = new Taps()
  await resume.tap(
    rows(page)
      .filter({ hasText: 'Table 3 is paused' })
      .getByRole('button', { name: 'Resume table' }),
  )
  const sheet = page.getByTestId('pin-sheet')
  await expect(sheet).toContainText('Enter your PIN')
  await expect(sheet).toContainText('Guests at Table 3 can order again.')
  // A wrong PIN clears the dots and says what to do; the right one closes the sheet on its fourth digit.
  await typePin(page, '9999')
  await expect(sheet).toContainText('Wrong PIN. Try again.')
  await typePin(page, '1234')
  await expect(sheet).toHaveCount(0)
  await expect(rows(page).filter({ hasText: 'Table 3 is paused' })).toHaveCount(0)
  expect(resume.count).toBe(1)

  // The unconfirmed order: one tap and the PIN, which names what will be recorded.
  const check = new Taps()
  await check.tap(
    rows(page)
      .filter({ hasText: 'Sent order not confirmed' })
      .getByRole('button', { name: 'Not on the bill' }),
  )
  await expect(page.getByTestId('pin-sheet')).toContainText(
    'The order counts as not sent and Table 1 can order again.',
  )
  await typePin(page, '1234')
  await expect(toast(page, 'Saved: not on the bill')).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Sent order not confirmed' })).toHaveCount(0)
  expect(check.count).toBe(1)
})

test('pausing ordering is two taps; lifting it needs a manager’s PIN on the tablet', async () => {
  const { page } = tablet
  await openTonight(page, 'empty')
  await page.getByRole('button', { name: 'Open all' }).first().click()
  await typePin(page, '1234')
  await expect(page.getByTestId('open-count')).toHaveText('6 of 6 open for phones')

  const pause = new Taps()
  await pause.tap(page.getByRole('button', { name: 'Pause ordering' }))
  await pause.tap(page.getByRole('menuitem', { name: 'Main bar' }))
  const banner = page.getByTestId('pause-banner')
  await expect(banner).toContainText('Ordering at Main bar was paused by the bar tablet')
  expect(pause.count).toBe(2)
  // The paused bar's heading and tiles read Paused; the other bar is as it was. The menu now
  // leaves out the bar already paused (all bars stays: it covers the rest).
  await expect(page.getByRole('heading', { name: /Main bar/ })).toContainText('Paused')
  await expect(tile(page, 'Table 1')).toHaveAttribute('data-state', 'paused')
  await expect(tile(page, 'Table 4')).toHaveAttribute('data-state', 'open')
  await page.getByRole('button', { name: 'Pause ordering' }).click()
  await expect(page.getByRole('menuitem')).toHaveText(['All bars', 'Second bar'])
  await page.keyboard.press('Escape')

  const lift = new Taps()
  await lift.tap(banner.getByRole('button', { name: 'Resume ordering' }))
  const sheet = page.getByTestId('pin-sheet')
  await expect(sheet).toContainText("Enter a manager's PIN")
  await typePin(page, '1234')
  await expect(sheet).toContainText("This PIN belongs to staff. A manager's PIN is needed.")
  await typePin(page, '4321')
  await expect(page.getByTestId('pause-banner')).toHaveCount(0)
  expect(lift.count).toBe(1)
})

test('a staff pause names its bar and who started it; Restro’s own pause has no button', async () => {
  const { page } = tablet
  await openTonight(page, 'bar-paused')
  const banner = page.getByTestId('pause-banner')
  await expect(banner).toHaveCount(1)
  await expect(banner).toContainText('Ordering at Second bar was paused by Maria at')
  await expect(page.getByRole('heading', { name: /Second bar/ })).toContainText('Paused')
  await expect(tile(page, 'Table 4')).toHaveAttribute('data-state', 'paused')
  await expect(tile(page, 'Table 1')).not.toHaveAttribute('data-state', 'paused')

  await openTonight(page, 'restro-paused')
  const restro = page.getByTestId('pause-banner')
  await expect(restro).toHaveAttribute('data-kind', 'restro')
  await expect(restro).toContainText("Restro paused ordering because it can't reach")
  await expect(restro.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pause ordering' })).toHaveCount(0)
})

test('the empty states: tables not open, and nothing waiting', async () => {
  const { page } = tablet
  await openTonight(page, 'empty')
  await expect(page.getByText("Tables aren't open yet")).toBeVisible()
  // On an empty night the one filled button is "Open all".
  await expect(page.getByRole('button', { name: 'Open all' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open all' })).toHaveAttribute(
    'data-variant',
    'default',
  )

  seed('night', 'many')
  // Every table open, with two calls each: the rows fill the column, which scrolls on its own.
  await page.reload()
  await expect(rows(page)).toHaveCount(12)
  const column = page.locator('section[aria-labelledby="needs-title"]').locator('xpath=..')
  await expect.poll(() => column.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
})

test('a new waiter call is announced to a screen reader', async () => {
  const { page } = tablet
  await openTonight(page, 'busy')
  await expect(rows(page)).toHaveCount(4)
  seed('call', '3')
  await expect(page.getByTestId('announcement')).toContainText('Table 3: Waiter', {
    timeout: 15_000,
  })
  await expect(rows(page)).toHaveCount(5)
})

test('the targets are 44 px or more on the tablet, in both themes', async () => {
  const { page, context } = tablet
  for (const theme of ['light', 'dark']) {
    await context.addCookies([
      { name: 'restro_theme', value: theme, url: new URL(page.url()).origin },
    ])
    await openTonight(page, 'busy')
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^((?!dark).)*$/)
    const small = await tonight(page)
      .locator('button, [role="menuitem"]')
      .evaluateAll((els) =>
        els
          .map((el) => {
            const box = el.getBoundingClientRect()
            return { text: (el.textContent ?? '').trim().slice(0, 30), h: box.height, w: box.width }
          })
          .filter((box) => box.h > 0 && (box.h < 44 || box.w < 44)),
      )
    expect(small).toEqual([])
    await page.screenshot({ path: `test-results/tonight/tablet-${theme}.png`, fullPage: false })
  }
})

test('on a phone: one column, a switch between Needs you and Tables, no sideways scroll', async () => {
  const { page } = waiter
  await page.setViewportSize(PHONE)
  await openTonight(page, 'busy')
  const part = page.getByRole('button', { name: /^Needs you/ })
  await expect(part).toHaveAttribute('aria-pressed', 'true')
  await expect(rows(page).first()).toBeVisible()
  // Tables is one more tap.
  const taps = new Taps()
  await taps.tap(page.getByRole('button', { name: 'Tables', exact: true }))
  await expect(page.getByTestId('table-tile').first()).toBeVisible()
  expect(taps.count).toBe(1)
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  )
  expect(sideways).toBe(false)
  const small = await tonight(page)
    .locator('button')
    .evaluateAll((els) =>
      els
        .map((el) => ({
          text: (el.textContent ?? '').trim().slice(0, 30),
          h: el.getBoundingClientRect().height,
        }))
        .filter((box) => box.h > 0 && box.h < 44),
    )
  expect(small).toEqual([])
  // A table's details are a bottom drawer on a phone.
  await tile(page, 'Table 2').click()
  await expect(page.getByTestId('table-sheet')).toBeVisible()
  await page.screenshot({ path: 'test-results/tonight/phone.png' })
  await page.setViewportSize(TABLET)
})
