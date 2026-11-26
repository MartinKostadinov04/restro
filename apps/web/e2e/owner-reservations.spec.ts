import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { signInAs } from './sign-in'

// The owner's Settings › Reservations (#325) on a production build, in Bulgarian (the longest
// words), at a venue made by hand (reservations are Restro's own, on every venue):
//
//   The section sits right after Ordering. With no turn time saved it asks for one first and shows
//   no switch; once the hold time is saved the three switches open.
//   A switch saves at once and Undo puts it back; the hold time is saved in place; a closed date is
//   added through its dialog and removed in one tap (Undo adds it back); the plan editor (#397)
//   lists the floor's spots, and a spot's seats are changed in its sheet and kept after a reload.
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
  // A staff-only account (the viewer) lands on a screen of its venue, not on the list: the
  // night's list, since its role works tonight's reservations (D141, #326).
  await signInAs(page, email, { lands: /\/venues(\/vn_[^/?]+)?(\?.*)?$/ })
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
  // Reservations' Settings are their own (D156): the sidebar marks them, with no row of sections.
  await expect(page.getByRole('link', { name: 'Настройки на резервациите' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.getByRole('tablist', { name: 'Смяна на секцията' })).toHaveCount(0)
  // One line links to Hours instead of repeating the working hours.
  await expect(page.getByTestId('rs-hours-link')).toHaveAttribute(
    'href',
    `/venues/${venueId}?tab=settings&section=hours`,
  )
  // Nothing saved yet: the hold time is asked for, no switch is drawn, and a closed date waits.
  await expect(page.getByTestId('rs-hold-first')).toBeVisible()
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByTestId('rs-closed-empty')).toContainText(
    'Добавете вечерите, в които клубът е затворен',
  )
  await expect(page.getByTestId('rs-closed-add')).toHaveCount(0)

  const hold = page.getByLabel('Мястото се пази')
  await hold.fill('120')
  await hold.press('Enter')
  // The toast says what changed (S14 of the 11-18 screen round).
  await expect(page.getByText('Мястото се пази 120 мин.').first()).toBeVisible()
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
  await expect(toastOf('Телефонът вече не е задължителен.')).toBeVisible()
  await toastOf('Телефонът вече не е задължителен.').getByRole('button', { name: 'Отмяна' }).click()
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
  await expect(toastOf('Мястото се пази 90 мин.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Мястото се пази')).toHaveValue('90')
  await context.close()
})

test('adds a closed date through its dialog and removes it in one tap', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  await page.getByTestId('rs-closed-add').click()
  await page.getByTestId('rs-closed-date').fill('24.12.2030')
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

test('changes a spot’s seats in the plan editor and keeps them after a reload', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(reservations())
  const rows = page.getByTestId('pe-spot-row')
  await expect(rows).toHaveCount(3)
  await expect(page.getByTestId('pe-canvas').getByTestId('pe-spot')).toHaveCount(3)
  // "12" has its own seats; "Sofa" takes its kind's, shown as the field's hint.
  await rows.filter({ hasText: '12' }).click()
  await expect(page.getByTestId('pe-spot-seats')).toHaveValue('6')
  await page.getByTestId('pe-spot-done').click()
  await rows.filter({ hasText: 'Sofa' }).click()
  const seats = page.getByTestId('pe-spot-seats')
  await expect(seats).toHaveValue('')
  await expect(seats).toHaveAttribute('placeholder', '8')
  await seats.fill('10')
  await seats.press('Enter')
  await expect(page.getByText('Седящи на Sofa: 10.').first()).toBeVisible()
  await page.reload()
  await page.getByTestId('pe-spot-row').filter({ hasText: 'Sofa' }).click()
  await expect(page.getByTestId('pe-spot-seats')).toHaveValue('10')
  await context.close()
})

test('a role without the right sees everything read-only', async ({ browser }) => {
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(reservations())
  const panel = page.getByTestId('reservations-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('settings-readonly')).toBeVisible()
  // No switches, fields or buttons that change anything: never disabled ones. The only buttons
  // are for looking (the plan's zoom and the folded spot list, S13), and none is disabled.
  await expect(panel.getByRole('switch')).toHaveCount(0)
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  const looking = ['pe-zoom-out', 'pe-zoom-in', 'pe-zoom-fit', 'pe-spot-list-toggle']
  const buttons = panel.getByRole('button')
  await expect(buttons).toHaveCount(looking.length)
  for (const id of looking) await expect(panel.getByTestId(id)).toBeEnabled()
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
