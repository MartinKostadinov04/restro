import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_EMAIL, ADMIN_PASSWORD, VENUE_NAME } from './support'

// The owner's Settings › Paying (#116; plan `docs/deliverables/2026-10-29-settings-paying-plan.md`)
// on a production build, in Bulgarian (the longest words), against the worker's SIMULATED card
// provider (WORKER_PAYMENTS_SIM, playwright.config.ts): no real provider is ever called. The
// provider's hosted form is a stub, as it is another site.
//
//   Connect leaves for the provider's form; coming back (`connection=return`) reads the account
//   back and says it still needs details; the missing list holds the provider's one line, the
//   two ticks (with Undo), Tables & QR and the venue's details; the details are saved from their
//   card (a malformed ЕИК is refused under its field); the smallest card payment is changed in
//   place and refused below the provider's minimum; Disconnect asks first.
//   Pay first (#216): the card is hidden while card payments are off; once they are on, the
//   venue's item default (PF1) and "Pay first at every table" (PF2) each take 2 taps from Settings
//   (the section, the control), save at once and are put back by Undo.
//   A role without `settings.connect_payments` sees it all read-only; a POS venue whose POS
//   declares nothing for paying has no Paying section (a venue no POS serves is a core test,
//   service/paying-settings.test.ts); no sideways scroll at 390 px.
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'paying-owner@demo-club.test'
const VIEWER = 'paying-viewer@demo-club.test'
const PAYING_VENUE = 'Paying Club Sofia'
const PROVIDER = 'Test card payments'
const LEGAL = {
  name: 'Клуб Нощи ЕООД',
  eik: '123456789',
  address: 'гр. София, ул. Примерна 1',
  privacyUrl: 'https://club.example/privacy',
}

let venueId = ''

async function signIn(page: Page, email: string, password = ADMIN_PASSWORD) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(email)
    await page.getByLabel('Парола').fill(password)
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

const paying = (query = '') => `/venues/${venueId}?tab=settings&section=paying${query}`

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

async function snapshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name), fullPage: true })
}

test('seeds the venue and finds it', async ({ browser }) => {
  runScript('./scripts/seed-paying-e2e.ts', 'seed')
  runScript('./e2e/paying-account.ts', 'none')
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

test('connect leaves for the provider’s form, and coming back says it needs more', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER)
  // The provider's hosted form is another site: stub it.
  await page.route('https://connect.sim-pay.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<p>form</p>' }),
  )
  await page.goto(paying())
  await expect(page.getByRole('heading', { name: 'Плащане', level: 2 })).toBeVisible()
  // The section sits between Ordering and Staff and roles.
  const tabs = await page.getByRole('tab').allTextContents()
  expect(tabs.indexOf('Плащане')).toBe(tabs.indexOf('Поръчки') + 1)
  await expect(page.getByTestId('paying-missing-account')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await snapshot(page, 'paying-never-connected.png')

  const form = page.waitForRequest(/connect\.sim-pay\.test\/onboard\//)
  await page.getByRole('button', { name: `Свържи ${PROVIDER}` }).click()
  await form

  // Back from the form: the account is read back once, and the query goes.
  await page.goto(paying('&connection=return'))
  await expect(
    page.getByText(`${PROVIDER} чака още малко данни. Продължете, когато сте готови.`),
  ).toBeVisible()
  await expect(page).toHaveURL(/section=paying$/)
  await expect(page.getByTestId('paying-account')).toContainText('Свързано')
  // The provider's own requirements are one line, never raw codes.
  await expect(page.getByTestId('paying-missing-card')).toContainText(
    `${PROVIDER} още чака данни от вас.`,
  )
  await expect(page.getByTestId('paying-missing-card')).not.toContainText('business details')

  // A form link that timed out says so and offers to carry on.
  await page.goto(paying('&connection=refresh'))
  await expect(page.getByTestId('paying-connecting')).toContainText('Формата на')
  await page
    .getByRole('button', { name: `Продължи в ${PROVIDER}` })
    .first()
    .click()
  await context.close()
})

test('the missing list: a tick with Undo, Tables & QR, the details, the smallest payment', async ({
  browser,
}) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(paying())
  await page.waitForLoadState('networkidle')
  const till = page.getByRole('checkbox', { name: /Избрах начин на плащане „карта“ в/ })
  await till.click()
  await expect(page.getByText('Запазено').first()).toBeVisible()
  await expect(page.getByTestId('paying-missing-cardTypeInTill')).toHaveCount(0)
  await page.getByRole('button', { name: 'Отмяна' }).click()
  await expect(page.getByTestId('paying-missing-cardTypeInTill')).toBeVisible()
  // The payment-table item goes to Tables & QR.
  await page.getByRole('link', { name: 'Към „Маси и QR“' }).click()
  await expect(page).toHaveURL(/tab=tables/)

  await page.goto(paying())
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('paying-missing-details')).toBeVisible()
  // A malformed ЕИК or link is refused under its field and nothing is saved.
  await page.getByLabel('Име на фирмата').fill(LEGAL.name)
  await page.getByLabel('ЕИК').fill('123')
  await page.getByLabel('Седалище и адрес на управление').fill(LEGAL.address)
  await page.getByLabel('Връзка към политиката за поверителност').fill('http://club.example')
  await expect(page.getByText('Незапазено')).toBeVisible()
  await page.getByTestId('paying-legal-save').click()
  await expect(page.getByText('ЕИК е от 9 или 13 цифри.')).toBeVisible()
  await expect(page.getByText('Въведете пълна връзка, която започва с https://.')).toBeVisible()
  await page.getByLabel('ЕИК').fill(LEGAL.eik)
  await page.getByLabel('Връзка към политиката за поверителност').fill(LEGAL.privacyUrl)
  await page.getByTestId('paying-legal-save').click()
  await expect(page.getByText('Запазено').first()).toBeVisible()
  await expect(page.getByTestId('paying-missing-details')).toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('ЕИК')).toHaveValue(LEGAL.eik)
  await expect(page.getByLabel('Име на фирмата')).toHaveValue(LEGAL.name)

  // The smallest card payment is changed in place; below the provider's minimum it is refused.
  await page.getByTestId('paying-min-edit').click()
  const min = page.getByLabel('Най-малко плащане с карта')
  await min.fill('0.20')
  await min.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Не може да е под' })).toBeVisible()
  await min.fill('5')
  await min.press('Enter')
  await expect(page.getByText('Запазено').first()).toBeVisible()
  await expect(page.getByTestId('paying-min-value')).toContainText('5')
  await page.reload()
  await expect(page.getByTestId('paying-min-value')).toContainText('5')
  await expect(page.getByTestId('paying-tips')).toContainText('Бакшиш не се предлага')
  await snapshot(page, 'paying-connected-missing.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('Disconnect asks first, then the venue is as never connected', async ({ browser }) => {
  const { context, page } = await open(browser, OWNER)
  await page.goto(paying())
  await page.waitForLoadState('networkidle')
  await page.getByTestId('paying-account-menu').click()
  await page.getByRole('menuitem', { name: 'Прекъсни…' }).click()
  await expect(page.getByRole('dialog')).toContainText(`Да прекъсна ли ${PROVIDER}?`)
  await page.getByRole('button', { name: 'Остави свързано' }).click()
  await expect(page.getByTestId('paying-account')).toBeVisible()
  await page.getByTestId('paying-account-menu').click()
  await page.getByRole('menuitem', { name: 'Прекъсни…' }).click()
  await page.getByTestId('paying-disconnect-confirm').click()
  await expect(page.getByText(`${PROVIDER} е прекъснат`)).toBeVisible()
  await expect(page.getByTestId('paying-connect')).toBeVisible()
  await context.close()
})

test('pay first: hidden while card payments are off, 2 taps with Undo once they are on', async ({
  browser,
}) => {
  runScript('./e2e/paying-account.ts', 'connected')
  const { context, page } = await open(browser, OWNER)
  await page.goto(paying())
  await expect(page.getByTestId('paying-account')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(page.getByTestId('paying-pay-first')).toHaveCount(0)

  runScript('./e2e/paying-account.ts', 'on')
  // From the Settings tab: tap 1 is the section, tap 2 is the control.
  await page.goto(`/venues/${venueId}?tab=settings`)
  await page.getByRole('tab', { name: 'Плащане' }).click()
  const card = page.getByTestId('paying-pay-first')
  await expect(card).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(card.getByTestId('paying-pf-mode-on_bill')).toBeChecked()
  await expect(card.getByTestId('paying-pf-applies')).toBeChecked()
  await expect(card.getByTestId('paying-pf-overrides')).toHaveCount(0)
  await snapshot(page, 'paying-pay-first.png')

  // The controls show a choice at once, so each step waits for the server action to answer
  // before it reloads or does the next thing; and an Undo is taken from its own toast.
  const toastOf = (text: string) =>
    page.locator('[data-sonner-toast]').filter({ hasText: text }).last()
  const undoOf = (text: string) => toastOf(text).getByRole('button', { name: 'Отмяна' })

  // PF1: the whole menu paid first. Undo (a toast, gone after a reload) puts it back at once.
  const PF1 = 'Артикули без собствен избор: плаща се предварително'
  await saved(page, () => card.getByTestId('paying-pf-mode-pay_first').check())
  await expect(toastOf(PF1)).toBeVisible()
  await expect(card.getByTestId('paying-pf-mode-pay_first')).toBeChecked()
  await saved(page, () => undoOf(PF1).click())
  await expect(card.getByTestId('paying-pf-mode-on_bill')).toBeChecked()
  // ...and the choice itself is kept across a reload.
  await saved(page, () => card.getByTestId('paying-pf-mode-pay_first').check())
  await page.reload()
  await expect(page.getByTestId('paying-pf-mode-pay_first')).toBeChecked()
  await saved(page, () => page.getByTestId('paying-pf-mode-on_bill').check())
  await expect(page.getByTestId('paying-pf-mode-on_bill')).toBeChecked()

  // PF2: everything on the bill at every table, with its consequence line; Undo puts it back.
  const PF2 = 'Всичко се поръчва по сметката'
  await saved(page, () => page.getByTestId('paying-pf-applies').click())
  await expect(toastOf(PF2)).toBeVisible()
  await expect(page.getByTestId('paying-pf-off-d')).toBeVisible()
  await saved(page, () => undoOf(PF2).click())
  await expect(page.getByTestId('paying-pf-applies')).toBeChecked()
  await expect(page.getByTestId('paying-pf-off-d')).toHaveCount(0)
  await context.close()
})

test('pay first is text only for a role without the right, with no sideways scroll', async ({
  browser,
}) => {
  runScript('./e2e/paying-account.ts', 'on')
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(paying())
  const card = page.getByTestId('paying-pay-first')
  await expect(card).toBeVisible()
  await expect(card.getByRole('radio')).toHaveCount(0)
  await expect(card.getByRole('switch')).toHaveCount(0)
  await expect(card.getByTestId('paying-pf-mode-text')).toContainText('По сметката')
  await snapshot(page, 'paying-pay-first-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('a role without the right sees everything read-only', async ({ browser }) => {
  runScript('./e2e/paying-account.ts', 'connected')
  const { context, page } = await open(browser, VIEWER, 390, 844)
  await page.goto(paying())
  const panel = page.getByTestId('paying-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('paying-readonly')).toHaveText(
    'Само човек с право да свързва плащанията може да ги промени.',
  )
  await expect(panel.getByTestId('paying-account')).toBeVisible()
  await expect(panel.getByTestId('paying-missing')).toBeVisible()
  // No buttons, ticks or inputs: never disabled ones.
  await expect(panel.getByRole('button')).toHaveCount(0)
  await expect(panel.getByRole('checkbox')).toHaveCount(0)
  await expect(panel.getByRole('textbox')).toHaveCount(0)
  await snapshot(page, 'paying-read-only-phone.png')
  await noSidewaysScroll(page)
  await context.close()
})

test('a POS venue whose POS can’t take payments has no Paying section', async ({ browser }) => {
  const { context, page } = await open(browser, ADMIN_EMAIL)
  await page
    .getByRole('link', { name: new RegExp(VENUE_NAME) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  const demoVenue = new URL(page.url()).pathname.split('/')[2] ?? ''
  await page.goto(`/venues/${demoVenue}?tab=settings&section=paying`)
  await expect(page.getByRole('tab', { name: 'Поръчки' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Плащане' })).toHaveCount(0)
  await expect(page.getByTestId('paying-panel')).toHaveCount(0)
  await context.close()
})
