// RR-88: a lost connection must not replace Tonight with the browser's own offline page. Tonight and
// the end-of-night page ask the server again every 5 seconds; offline that asked-again fails and Next
// used to fall back to a full browser navigation. On a production build (`next start`, as this
// project's e2e script runs), with the browser's offline switch: the screen stays with one calm line
// that says when it was last current, a tap gives the "Not saved" toast, and coming back online takes
// the line away and brings the data up to date. A signed-out session still goes to sign-in.
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
  TONIGHT_PIN_PEPPER,
  TONIGHT_WAITER_EMAIL,
} from './support'

test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const PHONE = { width: 390, height: 844 }
/** Three of Tonight's 5-second refreshes, and a little over. */
const THREE_REFRESHES_MS = 16_000

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
      // The list may send a person with one venue straight into it; if it does not, open the club.
      const inside = await page.waitForURL(/\/venues\/vn_/, { timeout: 10_000 }).then(
        () => true,
        () => false,
      )
      if (inside) return
      // The card's own link (the sidebar is shut at phone width); the page is still in Bulgarian.
      await page
        .getByRole('link', { name: /^(Отвори|Open)$/ })
        .first()
        .click()
      await expect(page).toHaveURL(/\/venues\/vn_/, { timeout: 30_000 })
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
  const context = await browser.newContext({ viewport: PHONE })
  const page = await context.newPage()
  await signIn(page, email)
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  return { context, page }
}

const venueUrl = (page: Page) => page.url().replace(/\?.*$/, '')
const rows = (page: Page) => page.getByTestId('action-row')
const line = (page: Page) => page.getByTestId('offline-line')
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const NOT_SAVED = 'Not saved. Check the connection and press it again.'
const LINE = /^No connection\. This is how things stood at \d{2}:\d{2}\. It refreshes by itself\.$/

async function openTonight(page: Page, night: string, view = '') {
  seed('night', night)
  await page.goto(`${venueUrl(page)}?tab=tonight${view}`)
}

let waiter: { context: BrowserContext; page: Page }
let owner: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  // Two sign-ins, which Better Auth's limiter may make wait for each other.
  test.setTimeout(120_000)
  seed('seed')
  waiter = await person(browser, TONIGHT_WAITER_EMAIL)
  owner = await person(browser, TONIGHT_OWNER_EMAIL)
})

test.afterAll(async () => {
  await waiter?.context.close()
  await owner?.context.close()
})

test('Tonight stays on screen with one line while offline, and catches up when it is back', async () => {
  const { page, context } = waiter
  await openTonight(page, 'busy')
  await expect(page.getByTestId('tonight')).toBeVisible()
  await expect(rows(page)).toHaveCount(4)
  await expect(line(page)).toHaveCount(0)

  await context.setOffline(true)
  await page.waitForTimeout(THREE_REFRESHES_MS)
  // Still the page, not the browser's error page.
  expect(page.url()).not.toMatch(/^chrome-error:/)
  await expect(page.getByTestId('tonight')).toBeVisible()
  await expect(line(page)).toHaveText(LINE)
  await expect(rows(page)).toHaveCount(4)

  // A tap says it was not saved, and the toast is seen.
  await rows(page)
    .filter({ hasText: 'Table 2: Waiter' })
    .getByRole('button', { name: 'Handled' })
    .click()
  await expect(toast(page, NOT_SAVED)).toBeVisible()
  await expect(page.getByTestId('tonight')).toBeVisible()
  expect(page.url()).not.toMatch(/^chrome-error:/)
  await expect(rows(page)).toHaveCount(4)

  // Something happens at the venue while the phone is cut off; back online it shows, the line goes.
  seed('call', '3')
  await context.setOffline(false)
  await expect(line(page)).toHaveCount(0, { timeout: 15_000 })
  await expect(rows(page)).toHaveCount(5, { timeout: 15_000 })
})

test('the end-of-night page does the same', async () => {
  const { page, context } = owner
  await openTonight(page, 'flow', '&view=night')
  await expect(page.getByTestId('tonight-night')).toBeVisible()
  await expect(page.getByTestId('night-fix-count')).toHaveText('1')
  const calls = page.getByTestId('night-totals-list').locator('div', { hasText: 'Waiter calls' })
  const before = Number((await calls.first().innerText()).replace(/\D/g, ''))

  await context.setOffline(true)
  await page.waitForTimeout(THREE_REFRESHES_MS)
  expect(page.url()).not.toMatch(/^chrome-error:/)
  await expect(page.getByTestId('tonight-night')).toBeVisible()
  await expect(line(page)).toHaveText(LINE)

  await page.getByTestId('night-fix-list').getByRole('button', { name: 'Not on the bill' }).click()
  await expect(toast(page, NOT_SAVED)).toBeVisible()
  await expect(page.getByTestId('night-fix-count')).toHaveText('1')

  seed('call', '1')
  await context.setOffline(false)
  await expect(line(page)).toHaveCount(0, { timeout: 15_000 })
  await expect(calls.first()).toContainText(String(before + 1), { timeout: 15_000 })
})

test('a signed-out session still goes to sign-in, not to the offline line', async ({ browser }) => {
  const { context, page } = await person(browser, TONIGHT_WAITER_EMAIL)
  try {
    await openTonight(page, 'busy')
    await expect(page.getByTestId('tonight')).toBeVisible()
    await context.clearCookies({ name: /session/ })
    await page.waitForURL(/\/login/, { timeout: 20_000 })
    await expect(line(page)).toHaveCount(0)
  } finally {
    await context.close()
  }
})
