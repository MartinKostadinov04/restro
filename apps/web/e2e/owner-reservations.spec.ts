import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// The owner's Settings › Reservations (#325) on a production build, in Bulgarian (the longest
// words), at a venue made by hand (reservations are Restro's own, on every venue):
//
//   The section sits right after Ordering. With no turn time saved it asks for one first and shows
//   no switch; once the hold time is saved the three switches open.
//   A switch saves at once and Undo puts it back; the hold time is saved in place; a closed date is
//   added through its dialog and removed in one tap (Undo adds it back); a spot's seats are changed
//   and kept after a reload.
//   A role without `settings.reservations` sees it all as text, with no control.
//   No sideways scroll at 390 px.
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'reservations-owner@demo-club.test'
const VIEWER = 'reservations-viewer@demo-club.test'
const VENUE = 'Reservations Club Sofia'

let venueId = ''

async function signIn(page: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      // A staff-only account (the viewer) lands on a screen of its venue, not on the list: the
      // night's list, since its role works tonight's reservations (D141, #326).
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

const reservations = () => `/venues/${venueId}?tab=settings&section=reservations`

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
}

async function snapshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name), fullPage: true })
}

test('seeds the venue and finds it', async ({ browser }) => {
  runScript('./scripts/seed-reservations-e2e.ts', 'seed')
  runScript('./e2e/reservations-state.ts', 'fresh')
  const { context, page } = await open(browser, OWNER)
  await page
    .getByRole('link', { name: new RegExp(VENUE) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
  expect(venueId).toMatch(/^vn_/)
  await context.close()
})

test('asks for the hold time first, then opens the switches', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  await expect(page.getByRole('heading', { name: 'Резервации', level: 2 })).toBeVisible()
  // The section sits right after Ordering, asked of the sections' own list: the venue's tab bar
  // has a Reservations tab of its own now (#326).
  const sections = await page
    .getByRole('tablist', { name: 'Смяна на секцията' })
    .getByRole('tab')
    .allTextContents()
  expect(sections.indexOf('Резервации')).toBe(sections.indexOf('Поръчки') + 1)
  // One line links to Hours instead of repeating the working hours.
  await expect(page.getByTestId('rs-hours-link')).toHaveAttribute(
    'href',
    `/venues/${venueId}?tab=settings&section=hours`,
  )
  // Nothing saved yet: the hold time is asked for, no switch is drawn, and a closed date waits.
  await expect(page.getByTestId('rs-hold-first')).toBeVisible()
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByTestId('rs-closed-empty')).toContainText(
    'Добави вечерите, в които клубът е затворен',
  )
  await expect(page.getByTestId('rs-closed-add')).toHaveCount(0)

  const hold = page.getByLabel('Мястото се пази')
  await hold.fill('120')
  await hold.press('Enter')
  await expect(page.getByText('Запазено').first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Мястото се пази')).toHaveValue('120')
  await expect(page.getByTestId('rs-hold-first')).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(3)
  await snapshot(page, 'reservations-desktop.png')
  await context.close()
})

test('a switch saves at once and Undo puts it back', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  const toastOf = (text: string) =>
    page.locator('[data-sonner-toast]').filter({ hasText: text }).last()
  const phone = page.getByRole('switch', { name: 'Телефонът е задължителен' })
  // On by default (D135).
  await expect(phone).toHaveAttribute('aria-checked', 'true')
  await phone.click()
  await expect(phone).toHaveAttribute('aria-checked', 'false')
  await expect(toastOf('Запазено')).toBeVisible()
  await toastOf('Запазено').getByRole('button', { name: 'Отмяна' }).click()
  await expect(phone).toHaveAttribute('aria-checked', 'true')
  // Editing the past is off by default and says what it lets people do.
  const past = page.getByRole('switch', { name: 'Разреши редакция на минала вечер' })
  await expect(past).toHaveAttribute('aria-checked', 'false')
  // The private guest list is on by default.
  await expect(
    page.getByRole('switch', { name: 'Управителят води личен списък с гости' }),
  ).toHaveAttribute('aria-checked', 'true')
  // The hold time is changed in place and kept after a reload.
  await page.getByLabel('Мястото се пази').fill('90')
  await page.getByLabel('Мястото се пази').press('Enter')
  await expect(toastOf('Запазено')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Мястото се пази')).toHaveValue('90')
  await context.close()
})

test('adds a closed date through its dialog and removes it in one tap', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  await page.getByTestId('rs-closed-add').click()
  await page.getByTestId('rs-closed-date').fill('2030-12-24')
  await page.getByTestId('rs-closed-confirm').click()
  const row = page.locator('[data-testid="rs-closed-row"][data-date="2030-12-24"]')
  await expect(row).toBeVisible()
  await page.reload()
  await expect(row).toBeVisible()
  await row.getByTestId('rs-closed-remove').click()
  await expect(row).toHaveCount(0)
  // Undo adds it back.
  await page
    .locator('[data-sonner-toast]')
    .filter({ hasText: 'Затворената дата е махната' })
    .last()
    .getByRole('button', { name: 'Отмяна' })
    .click()
  await expect(row).toBeVisible()
  await context.close()
})

test('changes a spot’s seats and keeps them after a reload', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  await expect(page.getByTestId('rs-spot-row')).toHaveCount(3)
  // "12" has its own seats; "Sofa" takes its kind's.
  await expect(page.getByLabel(/^12/)).toHaveValue('6')
  await expect(page.getByLabel(/^Sofa/)).toHaveValue('')
  await expect(page.getByLabel(/^Sofa/)).toHaveAttribute('placeholder', '8')
  await page.getByLabel(/^Sofa/).fill('10')
  await page.getByLabel(/^Sofa/).press('Enter')
  await expect(page.getByText('Местата са запазени').first()).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(/^Sofa/)).toHaveValue('10')
  await expect(
    page.getByText('Само предупреждение — по-голяма компания никога не се отказва.'),
  ).toBeVisible()
  await context.close()
})

test('a role without the right sees everything read-only', async ({ browser }) => {
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(reservations())
  const panel = page.getByTestId('reservations-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('settings-readonly')).toBeVisible()
  // No switches, fields or buttons: never disabled ones.
  await expect(panel.getByRole('switch')).toHaveCount(0)
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  await expect(panel.getByRole('button')).toHaveCount(0)
  await expect(panel.getByTestId('rs-hold-value')).toHaveText('90 мин')
  await expect(panel.getByTestId('rs-phone-value')).toBeVisible()
  await snapshot(page, 'reservations-read-only-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('fits a phone: the longest Bulgarian text, no sideways scroll', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER, 390, 844)
  await page.goto(reservations())
  await expect(page.getByText('Разреши редакция на минала вечер')).toBeVisible()
  await expect(page.getByText('Управителят води личен списък с гости')).toBeVisible()
  await snapshot(page, 'reservations-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})
