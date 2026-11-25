// Linked groups on the night's screens (#540; D160 §1, decision log 1.6 to 1.8), on a production
// build: the Tonight test club worked by its owner on a tablet. Reading only: nothing here writes
// except the one Change tables flow that proves seating on several tables is still today's count.
//
// Each story of the ticket's screen plan has its taps counted against its target:
//   1. seat one party on several tables (Change tables): today's count, 4 (the row, Change tables,
//      the spot, Save);
//   2. a group's tables in one outline on Reservations › Plan, and the same outline on a table that
//      stands apart: 0 taps;
//   3. a waiter reads the party, its tables and the group's total on a table's sheet: 1 tap (the
//      tile).
//
// The fixture is scripts/seed-tonight-e2e.ts `book book-linked-groups`
// (scripts/e2e/reservations-night.ts): Иванова on Маса 7 and Сепаре 1, which touch, and on Бар 13,
// which stands apart (Tables 1, 3 and 4; Table 4's bill was not read), and Петров on Маса 9 and
// Маса 10 (Tables 2 and 5). The admin is read in English.
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

/** A story's taps: every press of a control goes through here, so the count is the story's own. */
function counted() {
  let taps = 0
  return {
    get taps() {
      return taps
    },
    async tap(target: Locator) {
      taps += 1
      await target.click()
    },
  }
}

const tile = (page: Page, name: string) =>
  page.locator(`[data-testid="table-tile"][aria-label^="${name}"]`)
const plan = (page: Page) => page.getByTestId('reservations-plan')
const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

let venueId = ''
let owner: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  // An empty night first: no sitting of another spec is open, so the scene's tables are the only
  // open ones.
  seed('night', 'empty')
  seed('book', 'book-linked-groups')
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
})

test('story 2: a party’s tables share one outline on the plan, and the table apart gets the same one, in 0 taps', async () => {
  const { page } = owner
  const story = counted()
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()

  // Иванова: two tables that touch (one outline round both) and one apart (the same outline on its
  // own). Петров: two tables, one outline.
  const outlines = plan(page).getByTestId('rv-group-outline')
  await expect(outlines).toHaveCount(3)
  expect(
    (await outlines.evaluateAll((all) => all.map((one) => one.getAttribute('data-spots')))).sort(),
  ).toEqual(['1', '2', '2'])

  // Two neighbouring parties are told apart by more than colour: each outline carries its party's
  // name (WCAG 1.4.1), and the lone table carries Иванова's too, so it is not missed.
  const names = plan(page).getByTestId('rv-group-name')
  await expect(names).toHaveCount(3)
  expect((await names.allTextContents()).sort()).toEqual(['Иванова', 'Иванова', 'Петров'])

  // The outline takes no tap: the spots under it stay the plan's own buttons.
  await expect(plan(page).getByTestId('rv-group-outlines')).toHaveCSS('pointer-events', 'none')
  expect(story.taps).toBe(0)
})

test('story 2: a spot of the party says whose it is to a screen reader', async () => {
  const { page } = owner
  await page.goto(`/venues/${venueId}?tab=reservations&view=plan`)
  await expect(plan(page)).toBeVisible()
  await expect(
    plan(page).getByRole('button', { name: /^Spot Бар 13, .*, party Иванова$/ }),
  ).toBeVisible()
  await expect(
    plan(page).getByRole('button', { name: /^Spot Маса 10, .*, party Петров$/ }),
  ).toBeVisible()
})

test('story 3: a member table’s sheet names the party, its tables and the total, in 1 tap', async () => {
  const { page } = owner
  const story = counted()
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, 'Table 1')).toBeVisible()
  await story.tap(tile(page, 'Table 1'))

  const sheet = page.getByTestId('table-sheet')
  await expect(sheet.getByTestId('sh-group')).toHaveText('Party · 3 tables')
  await expect(sheet.getByTestId('sh-group-tables')).toHaveText('Table 1, Table 3, Table 4')
  // Table 4 could not be read: the total is what the other two came to, and it says so.
  await expect(sheet.getByTestId('sh-group-total')).toContainText('Party total')
  await expect(sheet.getByTestId('sh-group-total')).toContainText(/22[.,]00/)
  await expect(sheet.getByTestId('sh-group-updating')).toHaveText('Table 4 is updating')
  await expect(sheet.getByTestId('sh-group-not-final')).toHaveText('The total is not final yet')
  expect(story.taps).toBe(1)
})

test('story 3: a party whose tables all read has a final total and no updating line', async () => {
  const { page } = owner
  const story = counted()
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, 'Table 2')).toBeVisible()
  await story.tap(tile(page, 'Table 2'))

  const sheet = page.getByTestId('table-sheet')
  await expect(sheet.getByTestId('sh-group')).toHaveText('Party · 2 tables')
  await expect(sheet.getByTestId('sh-group-tables')).toHaveText('Table 2, Table 5')
  await expect(sheet.getByTestId('sh-group-total')).toContainText(/5[.,]00/)
  await expect(sheet.getByTestId('sh-group-updating')).toHaveCount(0)
  await expect(sheet.getByTestId('sh-group-not-final')).toHaveCount(0)
  expect(story.taps).toBe(1)
})

test('a table nobody is seated at shows no party line', async () => {
  const { page } = owner
  await page.goto(`/venues/${venueId}?tab=tonight`)
  await expect(tile(page, 'Table 6')).toBeVisible()
  await tile(page, 'Table 6').click()
  await expect(page.getByTestId('table-sheet')).toBeVisible()
  await expect(page.getByTestId('sh-group')).toHaveCount(0)
})

test('story 1: seating a party on one more table is still 4 taps, today’s count', async () => {
  const { page } = owner
  const story = counted()
  await page.goto(`/venues/${venueId}?tab=reservations`)
  await expect(page.getByTestId('reservations-night')).toBeVisible()
  await story.tap(page.getByTestId('rv-row').filter({ hasText: 'Иванова' }).first())
  const detail = page.getByTestId('rv-sheet')
  await expect(detail).toBeVisible()
  await story.tap(detail.getByTestId('rv-sheet-change-tables'))
  const sheet = page.getByTestId('rv-ct-sheet')
  await expect(sheet.getByTestId('rv-pick-plan')).toBeVisible()
  await story.tap(
    sheet.getByTestId('rv-pick-plan').getByTestId('rv-spot').filter({ hasText: 'Бар 12 вляво' }),
  )
  await story.tap(sheet.getByTestId('rv-ct-save'))
  await expect(toast(page, 'Tables changed.')).toBeVisible()
  expect(story.taps).toBe(4)
})
