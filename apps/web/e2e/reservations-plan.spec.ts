// Venue › Reservations, the floor plan (#327), on a production build: the room of the Tonight test
// club, read by its owner on a tablet and on a phone.
//
//   the plan one tap from the night's list, the legend naming all five states, every spot with its
//   name, its kind's symbol and its state in a word, the kind filter, a spot's own sheet (with its
//   Table, or the line that says it has none), blocking with a reason that is required, the
//   refusal that names the party booked there, unblocking in one tap, the plan moved and zoomed by
//   keyboard alone, a night that has passed read-only, and the whole thing at 390 px.
//
// The fixture is scripts/seed-tonight-e2e.ts `book` (scripts/e2e/reservations-night.ts): one plan
// of eight spots with five kinds, a terrace plan beside it, Маса 7 held by a late booking, Сепаре 1
// with a party at it and Маса 8 blocked for repair. The admin is read in English.
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
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

/** Sets the book and the plan, and answers the two nights the fixture wrote. */
function book(): { day: string; before: string } {
  const printed = seed('book', 'book').trim().split('\n').at(-1) ?? ''
  return JSON.parse(printed) as { day: string; before: string }
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

const plan = (page: Page) => page.getByTestId('reservations-plan')
const spots = (page: Page) => page.getByTestId('rv-spot')
const spotNamed = (page: Page, name: string) => spots(page).filter({ hasText: name })
const sheet = (page: Page) => page.getByTestId('rv-spot-sheet')

let venueId = ''
let owner: { context: BrowserContext; page: Page }
let nights: { day: string; before: string }

/** Enters the plan afresh, as a hostess coming back to the screen does. */
async function openPlan(page: Page) {
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()
  await expect(spots(page).first()).toBeVisible()
}

/** The transform the room is drawn with, so a move or a zoom can be seen. */
const roomTransform = (page: Page) =>
  page.getByTestId('rv-plan-room').evaluate((node) => node.style.transform)

async function openSpot(page: Page, name: string): Promise<Locator> {
  // A sheet left open stands over the plan and would swallow the tap, so it is closed first.
  if ((await sheet(page).count()) > 0) {
    await sheet(page).getByTestId('rv-spot-close').click()
    await expect(sheet(page)).toHaveCount(0)
  }
  await spotNamed(page, name).first().click()
  await expect(sheet(page)).toBeVisible()
  await expect(sheet(page)).toContainText(name)
  return sheet(page)
}

test.beforeAll(async ({ browser }) => {
  seed('seed')
  nights = book()
  owner = await person(browser, TONIGHT_OWNER_EMAIL, TABLET)
  await owner.page
    .getByRole('link', { name: new RegExp(TONIGHT_VENUE_NAME) })
    .first()
    .click()
  await expect(owner.page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(owner.page.url()).pathname.split('/')[2] ?? ''
})

test.afterAll(async () => {
  await owner?.context.close()
})

test('the plan is one tap from the list, and its legend names all six states', async () => {
  const { page } = owner
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()

  // One tap: the views are a row at every width, never a dropdown (the ticket's tap budget).
  const views = page.getByRole('tablist', { name: 'Views of Reservations' })
  await expect(views.getByRole('tab')).toHaveText(['List', 'Plan', 'Guests'])
  await views.getByRole('tab', { name: 'Plan' }).click()
  await expect(plan(page)).toBeVisible()
  await expect(page).toHaveURL(/view=plan/)

  // The legend is on the screen, not behind anything, and every state is a word beside a symbol.
  const legend = page.getByTestId('rv-legend').getByRole('listitem')
  // "In use" is the sixth (#329): a table a waiter opened for phones with nobody booked on it.
  await expect(legend).toHaveText(['Free', 'Held', 'Sitting', 'In use', 'Late', 'Blocked'])
  for (const state of ['free', 'held', 'sitting', 'in_use', 'late', 'blocked']) {
    await expect(page.getByTestId('rv-legend').locator(`[data-state="${state}"] svg`)).toHaveCount(
      1,
    )
  }
  // Which plan is drawn is said, and the club's second plan is one tap away.
  await expect(plan(page)).toContainText('Основна зала')
  await expect(page.getByRole('button', { name: 'Тераса' })).toBeVisible()
})

test('every spot carries its name, its kind and its state in a word', async () => {
  const { page } = owner
  await openPlan(page)
  await expect(spots(page)).toHaveCount(8)

  // The late booking, the party at the table and the spot kept back for repair: each a word.
  const late = spotNamed(page, 'Маса 7').first()
  await expect(late).toHaveAttribute('data-state', 'late')
  await expect(late).toContainText('Late')
  const sitting = spotNamed(page, 'Сепаре 1').first()
  await expect(sitting).toHaveAttribute('data-state', 'sitting')
  await expect(sitting).toContainText('Sitting')
  const blocked = spotNamed(page, 'Маса 8').first()
  await expect(blocked).toHaveAttribute('data-state', 'blocked')
  await expect(blocked).toContainText('Blocked · repair')
  await expect(spotNamed(page, 'Бар 13').first()).toHaveAttribute('data-state', 'free')

  // A screen reader hears all three without opening anything, and the shape is a folder name.
  await expect(late).toHaveAttribute('aria-label', 'Spot Маса 7, Маси, Late')
  await expect(late).toHaveAttribute('data-shape', 'rect')
  await expect(spotNamed(page, 'Бар плот').first()).toHaveAttribute('data-shape', 'pill')
  // Nothing was left undrawn: every stored shape of the fixture passed the folder's check.
  await expect(page.getByTestId('rv-unreadable')).toHaveCount(0)
})

test('the kind filter leaves one kind on one tap, and only the kinds that filter are offered', async () => {
  const { page } = owner
  await openPlan(page)
  await expect(page.getByTestId('rv-kind-all')).toHaveText('All')
  // The club's `Бар` kind does not filter, so it is not a chip; its spot is still on the plan.
  await expect(page.getByTestId('rv-kind-counter')).toHaveCount(0)
  await expect(spotNamed(page, 'Бар плот')).toHaveCount(1)

  await page.getByTestId('rv-kind-stool').click()
  await expect(page.getByTestId('rv-kind-stool')).toHaveAttribute('aria-pressed', 'true')
  await expect(spots(page)).toHaveCount(2)
  await expect(spotNamed(page, 'Бар 12 вляво')).toHaveCount(1)

  await page.getByTestId('rv-kind-table').click()
  await expect(spots(page)).toHaveCount(3)
  await page.getByTestId('rv-kind-all').click()
  await expect(spots(page)).toHaveCount(8)
})

test('a tap on a spot says what it holds, and a spot that is no table is offered no code', async () => {
  const { page } = owner
  await openPlan(page)
  const held = await openSpot(page, 'Маса 7')
  await expect(held.getByTestId('rv-spot-state')).toContainText('Late')
  // Who booked it, from when, and how many — the night's own holds, on the spot.
  await expect(held.getByTestId('rv-spot-hold')).toHaveCount(1)
  await expect(held.getByTestId('rv-spot-holds')).toContainText('Иванова')
  // Its Table is named by what staff call it; the code itself never reaches the page (rule 3).
  await expect(held.getByTestId('rv-spot-table')).toBeVisible()

  // Two taps to the spot's own history, out of the one Log (D141).
  await held.getByTestId('rv-spot-history').click()
  await expect(held.getByTestId('rv-spot-log').getByRole('listitem').first()).toBeVisible()
  await held.getByTestId('rv-spot-close').click()
  await expect(sheet(page)).toHaveCount(0)

  // A bar stool is not a table: no code, and nothing about orders.
  const stool = await openSpot(page, 'Бар 12 вляво')
  await expect(stool.getByTestId('rv-spot-no-table')).toBeVisible()
  await expect(stool.getByTestId('rv-spot-table')).toHaveCount(0)
  await expect(stool.getByTestId('rv-spot-nothing')).toBeVisible()
  await stool.getByTestId('rv-spot-close').click()
})

test('blocking a spot needs a reason, and unblocking it is one tap', async () => {
  const { page } = owner
  await openPlan(page)
  const free = await openSpot(page, 'Маса 9')
  await free.getByTestId('rv-block').click()
  const dialog = page.getByTestId('rv-block-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Block Маса 9?')
  // Nothing is chosen for the hostess: the reason is required, so Block cannot be tapped yet.
  await expect(dialog.getByTestId('rv-block-do')).toBeDisabled()
  await dialog.getByTestId('rv-reason-repair').click()
  await expect(dialog.getByTestId('rv-block-do')).toBeEnabled()
  await dialog.getByTestId('rv-block-do').click()

  await expect(page.getByTestId('rv-block-dialog')).toHaveCount(0)
  await expect(page.getByText('Маса 9 is blocked.')).toBeVisible()
  await expect(spotNamed(page, 'Маса 9').first()).toHaveAttribute('data-state', 'blocked')
  await expect(spotNamed(page, 'Маса 9').first()).toContainText('Blocked · repair')

  // The spot's own sheet stayed open behind the dialog and now reads the block, so unblocking is
  // one tap from where the hostess already is.
  const blocked = sheet(page)
  await expect(blocked).toContainText('until somebody lifts it')
  await blocked.getByTestId('rv-unblock').click()
  await expect(page.getByText('Маса 9 is free again.')).toBeVisible()
  await expect(spotNamed(page, 'Маса 9').first()).toHaveAttribute('data-state', 'free')
})

test('blocking a spot a party has booked is refused, and the refusal names the party', async () => {
  const { page } = owner
  await openPlan(page)
  const held = await openSpot(page, 'Маса 7')
  await held.getByTestId('rv-block').click()
  const dialog = page.getByTestId('rv-block-dialog')
  await dialog.getByTestId('rv-reason-private_event').click()
  await dialog.getByTestId('rv-block-do').click()

  // The notice stays on the screen and says whose booking is in the way (#327, the ticket's own
  // acceptance line), so the hostess knows what to do next.
  const refusal = page.getByText(/Иванова is booked on Маса 7/)
  await expect(refusal).toBeVisible()
  await expect(refusal).toContainText('Move them first')
  await expect(spotNamed(page, 'Маса 7').first()).toHaveAttribute('data-state', 'late')
  // The sheet is where it was: a refusal changes nothing, not even the screen the hostess is on.
  await expect(held.getByTestId('rv-block')).toBeVisible()
  await held.getByTestId('rv-spot-close').click()
})

test('the plan moves and zooms by keyboard alone, and the buttons do the same', async () => {
  const { page } = owner
  await openPlan(page)
  // The canvas is a viewport, not a control: a keyboard reaches the plan through its own buttons,
  // and the keys work from anywhere inside the region.
  await page.getByTestId('rv-zoom-out').focus()
  const first = await roomTransform(page)

  // 2.1.1: the arrows move the plan and plus and minus zoom it, with no pointer at all.
  await page.keyboard.press('ArrowRight')
  const moved = await roomTransform(page)
  expect(moved).not.toBe(first)
  await page.keyboard.press('+')
  const zoomed = await roomTransform(page)
  expect(zoomed).not.toBe(moved)
  expect(zoomed).toMatch(/scale\(/)
  // Back to the whole room in one key.
  await page.keyboard.press('0')
  expect(await roomTransform(page)).toBe(first)

  // 2.5.7: the same two moves without any dragging, for anyone who cannot pinch.
  await page.getByTestId('rv-zoom-in').click()
  expect(await roomTransform(page)).not.toBe(first)
  await page.getByTestId('rv-zoom-fit').click()
  expect(await roomTransform(page)).toBe(first)

  // Tab reaches the spots themselves, because each one is a button.
  await page.getByTestId('rv-zoom-fit').focus()
  await page.keyboard.press('Tab')
  await expect(spots(page).first()).toBeFocused()
})

test('a night that has passed is drawn and read-only, and the plan opens on tonight again', async () => {
  const { page } = owner
  await openPlan(page)
  await page.getByTestId('day-button').click()
  await page.getByTestId(`day-${nights.before}`).click()

  await expect(page.getByTestId('rv-plan-banner')).toHaveAttribute('data-kind', 'passed')
  await expect(page.getByTestId('rv-plan-banner')).toContainText('It can be read, not changed.')
  // The room is still drawn, a month back (D141): it is the night's record, not an empty screen.
  await expect(spots(page)).toHaveCount(8)
  // Nothing on it offers to change it.
  const old = await openSpot(page, 'Маса 9')
  await expect(old.getByTestId('rv-block')).toHaveCount(0)
  await old.getByTestId('rv-spot-close').click()

  // Coming back to the tab opens on tonight, whatever night was chosen before.
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await openPlan(page)
  await expect(page.getByTestId('rv-plan-banner')).toHaveCount(0)
})

test('at 390 px the plan reads, the long name clips, and the sheet holds all of it', async ({
  browser,
}) => {
  const phone = await person(browser, TONIGHT_OWNER_EMAIL, PHONE)
  try {
    await openPlan(phone.page)
    await expect(phone.page.getByTestId('rv-legend')).toBeVisible()
    // Nothing pushes the page sideways, with the club's longest Bulgarian names on the tiles.
    const overflow = await phone.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)

    // „Бар 12 вляво“ is wider than its stool: the tile clips it, the sheet reads it whole.
    const stool = spotNamed(phone.page, 'Бар 12').first()
    const clipped = await stool
      .locator('span.truncate')
      .first()
      .evaluate((node) => node.scrollWidth > node.clientWidth + 1)
    expect(clipped).toBe(true)
    const drawer = await openSpot(phone.page, 'Бар 12 вляво')
    await expect(drawer).toContainText('Бар 12 вляво')
  } finally {
    await phone.context.close()
  }
})
