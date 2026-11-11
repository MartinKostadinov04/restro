import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// The plan editor (#397) on a production build, in Bulgarian, at a venue that is new on every run
// (`scripts/seed-reservations-e2e.ts plan-editor`): no plan, no spot kind, no settings. Nothing of
// the plan is written by a fixture; every step goes through the screens, so through the server
// actions and `applyService`:
//
//   With no plan, the night's plan and the new booking's spots say so plainly and lead to the
//   editor. The owner starts the plan, adds two spots, moves one with the keys and gives it its
//   own seats; all of it is still there after a reload. A booking is then put on that spot, picked
//   from the plan, and the editor says a booking holds it.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

const OWNER = 'plan-editor-owner@demo-club.test'
const PARTY = { name: 'План Тестов', phone: '+359 888 397 001' }

let venueId = ''
/** The first spot's name, as the "New spot" dialog gave it in the layout test. */
let firstSpot = ''
let owner: { context: BrowserContext; page: Page }

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

async function person(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await signIn(page, email)
  return { context, page }
}

const settings = () => `/venues/${venueId}?tab=settings&section=reservations`
const night = (view = '') => `/venues/${venueId}?tab=reservations${view}`
const spots = (page: Page) => page.getByTestId('pe-canvas').getByTestId('pe-spot')
const rows = (page: Page) => page.getByTestId('pe-spot-row')

test.beforeAll(async ({ browser }) => {
  const printed = runScript('./scripts/seed-reservations-e2e.ts', 'plan-editor')
  venueId = (JSON.parse(printed.trim().split('\n').at(-1) ?? '{}') as { venueId: string }).venueId
  expect(venueId).toMatch(/^vn_/)
  owner = await person(browser, OWNER)
})

test.afterAll(async () => {
  await owner?.context.close()
})

test('the hold time is set first, as on any venue', async () => {
  const { page } = owner
  await page.goto(settings())
  const hold = page.getByLabel('Мястото се пази')
  await hold.fill('120')
  await hold.press('Enter')
  await expect(page.getByText('Запазено').first()).toBeVisible()
})

test('with no plan, the plan screens say so and lead to the editor', async () => {
  const { page } = owner
  // A new booking: no picker that would open on nothing, one honest line instead.
  await page.goto(night())
  await page.getByTestId('rv-new').first().click()
  await expect(page.getByTestId('rv-f-no-plan')).toContainText('Още няма план на залата')
  await expect(page.getByTestId('rv-f-pick-plan')).toHaveCount(0)

  // The night's plan: the same line, and the way to the editor.
  await page.goto(night('&view=plan'))
  const none = page.getByTestId('rv-no-plan')
  await expect(none).toContainText('Още няма план на залата')
  await expect(page.getByText('Екипът на Restro рисува')).toHaveCount(0)
  await none.getByTestId('rv-no-plan-go').click()
  await expect(page).toHaveURL(/tab=settings&section=reservations/)
  await expect(page.getByTestId('pe-empty')).toBeVisible()
})

test('lays a plan out from nothing, and keeps it after a reload', async () => {
  const { page } = owner
  await page.goto(settings())
  await page.getByTestId('pe-start').click()
  await expect(page.getByText('Планът е започнат').first()).toBeVisible()

  // Two spots, each named for its kind ("Маса 1", "Маса 2") unless the owner types another name.
  const names: string[] = []
  for (let n = 1; n <= 2; n += 1) {
    await page.getByTestId('pe-add-spot').click()
    const dialog = page.getByTestId('pe-new-spot')
    await expect(dialog).toBeVisible()
    const name = await dialog.getByTestId('pe-new-spot-name').inputValue()
    expect(name).not.toBe('')
    names.push(name)
    await dialog.getByTestId('pe-new-spot-save').click()
    await expect(page.getByText(`Добавено: ${name}`).first()).toBeVisible()
    await expect(spots(page)).toHaveCount(n)
  }
  expect(new Set(names).size).toBe(2)
  const [first = ''] = names
  firstSpot = first

  // Moved with the keys: three steps right, saved once the keys stop.
  const tile = spots(page).filter({ hasText: first })
  const x = Number(await tile.getAttribute('data-x'))
  await tile.focus()
  await tile.press('ArrowRight')
  await tile.press('ArrowRight')
  await tile.press('ArrowRight')
  await expect(page.getByText(`Преместено: ${first}`).first()).toBeVisible()

  // Its own seats, through the spot's sheet.
  await rows(page).filter({ hasText: first }).click()
  const sheet = page.getByTestId('pe-spot-sheet')
  await expect(sheet).toBeVisible()
  await sheet.getByTestId('pe-spot-seats').fill('6')
  await sheet.getByTestId('pe-spot-seats').press('Enter')
  await expect(page.getByText('Запазено').first()).toBeVisible()
  await sheet.getByTestId('pe-spot-done').click()

  await page.reload()
  await expect(spots(page)).toHaveCount(2)
  await expect(spots(page).filter({ hasText: first })).toHaveAttribute('data-x', String(x + 3))
  await rows(page).filter({ hasText: first }).click()
  await expect(page.getByTestId('pe-spot-seats')).toHaveValue('6')
})

test('a booking is put on a spot picked from the plan, and the editor says it holds one', async () => {
  const { page } = owner
  const first = firstSpot
  expect(first).not.toBe('')

  await page.goto(night())
  await page.getByTestId('rv-new').first().click()
  const form = page.getByTestId('rv-form-sheet')
  await expect(form).toBeVisible()
  await page.getByTestId('rv-f-name').fill(PARTY.name)
  await page.getByTestId('rv-f-phone').fill(PARTY.phone)
  await page.getByTestId('rv-f-guests').fill('4')
  await page.getByTestId('rv-f-time').fill('23:00')
  await page.getByTestId('rv-f-pick-plan').click()
  await page.getByTestId('rv-pick-plan').getByTestId('rv-spot').filter({ hasText: first }).click()
  await page.getByTestId('rv-f-pick-done').click()
  await expect(page.getByTestId('rv-f-spots')).toContainText(first)
  await page.getByTestId('rv-f-save').click()
  await expect(page.getByText('Резервацията е запазена.').first()).toBeVisible()
  await expect(form).toHaveCount(0)
  await expect(page.getByTestId('rv-row').filter({ hasText: PARTY.name })).toContainText(first)

  // The night's plan draws the spot the editor laid out.
  await page.goto(night('&view=plan'))
  await expect(page.getByTestId('rv-plan')).toBeVisible()
  await expect(page.getByTestId('rv-spot').filter({ hasText: first })).toHaveCount(1)

  // Back in the editor, the spot says a booking holds it before anything is removed.
  await page.goto(settings())
  await rows(page).filter({ hasText: first }).click()
  await expect(page.getByTestId('pe-spot-booked')).toBeVisible()
})
