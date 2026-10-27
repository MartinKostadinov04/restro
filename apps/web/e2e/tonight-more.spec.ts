// Tonight's other three screens (#86; plans docs/deliverables/2026-10-27-tonight-{sent-orders,log,
// end-of-night}-plan.md), on a production build. Every story is done by tapping and the taps are
// counted against the plans' targets (typing is not a tap); the states of the plans' section 5 are
// checked, so are the permissions (the Log only with log.view, the CSV only with night.view_full),
// the 44 px targets, the phone at 390 px and both themes. The fixture is
// scripts/seed-tonight-e2e.ts (the `flow` night: one sent order in every state, its steps in the
// Log, a reason code with no word, an answered problem and an earlier night already closed; the
// `crowd` night: 230 sent orders). The admin is read in English.
//
// Three people: the owner (holds every permission), a waiter with a phone of their own (Staff:
// the end of the night's first sections, no Log) and the bar tablet's account (a shared device, so
// a PIN names who answers).
import { type BrowserContext, expect, type Locator, type Page, test } from '@playwright/test'

import { runScriptWith } from './global-setup'
import {
  ADMIN_PASSWORD,
  TONIGHT_OWNER_EMAIL,
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
      await expect(page).toHaveURL(/\/venues\/vn_[^/?]+|\/venues$/, { timeout: 8_000 })
      if (/\/venues\/vn_/.test(page.url())) return
      // The owner lands on the venues list: open the Tonight Club.
      await page
        .getByRole('link', { name: /Tonight Club/ })
        .first()
        .click()
      await expect(page).toHaveURL(/\/venues\/vn_/)
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

/** The venue's address without a query, from wherever the page is. */
const venueUrl = (page: Page) => page.url().replace(/\?.*$/, '')

async function open(page: Page, night: string | null, view = 'actions', extra = '') {
  if (night !== null) seed('night', night)
  const suffix = view === 'actions' ? '' : `&view=${view}`
  await page.goto(`${venueUrl(page)}?tab=tonight${suffix}${extra}`)
  // The tab bar from 1024 px, a dropdown below it: whichever is drawn.
  await expect(page.locator('[aria-label="Sections of Tonight"]:visible').first()).toBeVisible()
}

const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })
const sentRows = (page: Page) => page.getByTestId('sent-row')
const refs = (page: Page) =>
  sentRows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-reference')))
const innerTabs = (page: Page) =>
  page.getByRole('tablist', { name: 'Sections of Tonight' }).getByRole('tab')

/** Types a PIN on the sheet's pad with the keyboard; the sheet submits on the fourth digit. */
async function typePin(page: Page, pin: string) {
  await expect(page.getByTestId('pin-sheet')).toBeVisible()
  await page.keyboard.type(pin)
}

let owner: { context: BrowserContext; page: Page }
let waiter: { context: BrowserContext; page: Page }
let tablet: { context: BrowserContext; page: Page }

test.beforeAll(async ({ browser }) => {
  seed('seed')
  owner = await person(browser, TONIGHT_OWNER_EMAIL, TABLET)
  waiter = await person(browser, TONIGHT_WAITER_EMAIL, TABLET)
  tablet = await person(browser, TONIGHT_TABLET_EMAIL, TABLET)
  seed('device', TONIGHT_TABLET_EMAIL)
})

test.afterAll(async () => {
  await owner?.context.close()
  await waiter?.context.close()
  await tablet?.context.close()
})

test('Tonight lists the Log and the end of the night only for roles that may open them', async () => {
  await open(owner.page, 'flow')
  await expect(innerTabs(owner.page)).toHaveText([
    'Actions and tables',
    'Sent orders',
    'Log',
    'End of night',
  ])
  await open(waiter.page, null)
  await expect(innerTabs(waiter.page)).toHaveText([
    'Actions and tables',
    'Sent orders',
    'End of night',
  ])
  // A link to the Log opens the first tab for a role without log.view.
  await waiter.page.goto(`${venueUrl(waiter.page)}?tab=tonight&view=log`)
  await expect(waiter.page.getByRole('tab', { name: 'Actions and tables' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(waiter.page.getByTestId('tonight-log')).toHaveCount(0)
})

test.describe('sent orders', () => {
  test('lists the night newest first with each state and reason in words, and the tinted row alone', async () => {
    const { page } = waiter
    await open(page, 'flow', 'sent')
    await expect(page.getByTestId('tonight-sent')).toBeVisible()
    expect(await refs(page)).toEqual([
      'SO06',
      'K7F2',
      'AP42',
      'SO05',
      'WRD1',
      'SO04',
      'SO03',
      'SO02',
      'SO01',
    ])
    const row = (ref: string) => page.locator(`[data-testid="sent-row"][data-reference="${ref}"]`)
    await expect(row('SO06')).toContainText('Sending')
    await expect(row('K7F2')).toContainText('Check the bill')
    await expect(row('K7F2')).toContainText('Restro found it on the bill at')
    await expect(row('AP42')).toContainText('Approve it in the POS')
    await expect(row('SO05')).toContainText('Added')
    await expect(row('SO05')).toContainText('Found on the bill · Maria · via Telegram')
    await expect(row('SO04')).toContainText("Not sent · the POS didn't answer")
    await expect(row('SO03')).toContainText('Not sent · ordering was paused')
    await expect(row('SO02')).toContainText('Not sent · sold out')
    await expect(row('SO01')).toContainText('Added')
    // A code with no word shows "Not sent" alone, never the raw code.
    await expect(row('WRD1')).toContainText('Not sent')
    await expect(page.getByText('made_up_code')).toHaveCount(0)
    // The row shows the reference, the table, the item count and the total.
    await expect(row('SO01')).toContainText('Table 2')
    await expect(row('SO01')).toContainText('2 items')
    await expect(row('SO01')).toContainText('€18.00')
    // Only the Unconfirmed one is coloured.
    expect(
      await sentRows(page).evaluateAll((els) =>
        els
          .filter((el) => el.className.includes('bg-info'))
          .map((el) => el.getAttribute('data-reference')),
      ),
    ).toEqual(['K7F2'])
  })

  test('the search is the first control, focused on the tablet, and finds by reference or table in 2 taps + typing', async () => {
    const { page } = waiter
    await open(page, 'flow', 'actions')
    const taps = new Taps()
    await taps.tap(page.getByRole('tab', { name: 'Sent orders' }))
    const search = page.getByTestId('tonight-search')
    await expect(search).toBeFocused()
    await search.fill('k7')
    await expect.poll(() => refs(page)).toEqual(['K7F2'])
    // Two taps in all counting the focused field: the tab, then typing (the field needs no tap).
    expect(taps.count).toBe(1)
    await search.fill('')
    await search.fill('3')
    await expect.poll(() => refs(page)).toEqual(['WRD1', 'SO04', 'SO03'])
    await search.fill('zzzz')
    await expect(page.getByTestId('nothing-here')).toContainText(
      'No sent order matches "zzzz" tonight.',
    )
  })

  test('"Not added" keeps the two that never reached the bill, with the counts of the day', async () => {
    const { page } = waiter
    await open(page, 'flow', 'sent')
    await expect(page.getByTestId('filter-all')).toHaveText('All 9')
    await expect(page.getByTestId('filter-notAdded')).toHaveText('Not added 5')
    const taps = new Taps()
    await taps.tap(page.getByTestId('filter-notAdded'))
    await expect.poll(() => refs(page)).toEqual(['K7F2', 'WRD1', 'SO04', 'SO03', 'SO02'])
    expect(taps.count).toBe(1)
    await page.getByTestId('filter-notAdded').click()
  })

  test('one sent order has everything in a sheet, and an Unconfirmed one is answered from it in 2 taps', async () => {
    const { page } = waiter
    await open(page, 'flow', 'sent')
    const taps = new Taps()
    await taps.tap(page.locator('[data-testid="sent-row"][data-reference="K7F2"]'))
    const sheet = page.getByTestId('sent-sheet')
    await expect(sheet).toContainText('Sent order K7F2')
    await expect(sheet).toContainText('Table 1')
    await expect(sheet).toContainText('2 × Mojito (no mint)')
    await expect(sheet).toContainText('Note: no ice')
    await expect(sheet).toContainText('Total: €18.00')
    await expect(sheet).toContainText('Bill 1042 in the POS')
    await expect(sheet.getByTestId('sent-steps').getByRole('listitem')).toHaveCount(5)
    await expect(sheet).toContainText('Restro found it on the bill at')
    await expect(
      sheet.getByRole('button', { name: /Found on the bill|Not on the bill/ }),
    ).toHaveText(['Found on the bill', 'Not on the bill'])
    await taps.tap(sheet.getByRole('button', { name: 'Found on the bill' }))
    await expect(toast(page, 'Saved: found on the bill')).toBeVisible()
    expect(taps.count).toBe(2)
    await expect(sheet.getByTestId('sent-sheet-answers')).toHaveCount(0)
    await expect(sheet).toContainText('Found on the bill · Tonight Waiter')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    const row = page.locator('[data-testid="sent-row"][data-reference="K7F2"]')
    await expect(row).toContainText('Added')
    await expect(row).toContainText('Found on the bill · Tonight Waiter')
    await expect(row).not.toHaveClass(/bg-info/)
  })

  test("on the shared tablet the answer asks the person's own PIN and the list names them", async () => {
    const { page } = tablet
    await open(page, 'flow', 'sent')
    await page.locator('[data-testid="sent-row"][data-reference="K7F2"]').click()
    await page.getByTestId('sent-sheet').getByRole('button', { name: 'Not on the bill' }).click()
    await expect(page.getByTestId('pin-sheet')).toContainText(
      'The order counts as not sent and Table 1 can order again.',
    )
    await typePin(page, '1234')
    await expect(toast(page, 'Saved: not on the bill')).toBeVisible()
    await expect(page.getByTestId('sent-sheet')).toContainText('Not on the bill · Maria')
  })

  test('says so when nothing is sent yet, with one button to the first tab', async () => {
    const { page } = waiter
    await open(page, 'empty', 'sent')
    const empty = page.getByTestId('nothing-here')
    await expect(empty).toContainText('No orders sent tonight yet')
    await expect(empty).toContainText("Orders from phones show up here as soon as they're sent.")
    await empty.getByRole('button', { name: 'Go to Actions and tables' }).click()
    await expect(page.getByTestId('tonight')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Actions and tables' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('shows the newest 100 and "Show earlier" adds 100, while the search covers the whole night', async () => {
    const { page } = waiter
    await open(page, 'crowd', 'sent')
    await expect(page.getByTestId('filter-all')).toHaveText('All 230')
    await expect(sentRows(page)).toHaveCount(100)
    await page.getByTestId('show-earlier').click()
    await expect(sentRows(page)).toHaveCount(200)
    // Z229 is among the oldest: not loaded, yet the search finds it.
    await open(page, null, 'sent')
    await expect(sentRows(page)).toHaveCount(100)
    await page.getByTestId('tonight-search').fill('z229')
    await expect.poll(() => refs(page)).toEqual(['Z229'])
  })
})

test.describe('the Log', () => {
  test('is the day newest first, one sentence a line, who did it, and never a lease', async () => {
    const { page } = owner
    await open(page, 'flow', 'log')
    const lines = page.getByTestId('log-line')
    const kinds = await lines.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))
    expect(kinds).not.toContain('lease.taken_over')
    // Newest first by the Log's own order (the seed wrote the settings change last).
    expect(kinds[0]).toBe('settings.changed')
    await expect(page.getByTestId('log-list')).toContainText('Sent order K7F2 found on the bill')
    await expect(page.getByTestId('log-list')).toContainText('Sent order K7F2: Checking')
    await expect(page.getByTestId('log-list')).toContainText('Sent order SO05: Found on the bill')
    await expect(page.getByTestId('log-list')).toContainText('Maria · via Telegram')
    await expect(page.getByTestId('log-list')).toContainText('Ordering paused: All bars · by Maria')
    await expect(page.getByTestId('log-list')).toContainText('Ordering back on: All bars')
    await expect(page.getByTestId('log-list')).toContainText(
      'A guard stopped an order over the limit',
    )
    await expect(page.getByTestId('log-list')).toContainText('Settings changed: a payment table')
    await expect(page.getByTestId('log-list')).toContainText('Table 2 called a waiter')
    await expect(page.getByTestId('log-list')).toContainText("A guest's phone")
    await expect(page.getByTestId('log-list')).toContainText('Table 1 opened for phones')
    await expect(page.getByText('lease.taken_over')).toHaveCount(0)
    await expect(page.getByText(/Something happened/)).toHaveCount(0)
  })

  test("finds by reference or table, filters by kind, and opens a sent order's sheet", async () => {
    const { page } = owner
    await open(page, 'flow', 'actions')
    const taps = new Taps()
    await taps.tap(page.getByRole('tab', { name: 'Log' }))
    await expect(page.getByTestId('tonight-log')).toBeVisible()
    await page.getByTestId('tonight-search').fill('k7')
    await expect(page.getByTestId('log-line')).toHaveCount(5)
    for (const kind of await page
      .getByTestId('log-line')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')))) {
      expect(kind).toMatch(/^sent_order\./)
    }
    // The kind: the tab, the Kind menu, the kind (3 taps).
    await page.getByTestId('tonight-search').fill('')
    const kind = new Taps()
    await kind.tap(page.getByTestId('kind-button'))
    await kind.tap(page.getByTestId('kind-pauses'))
    expect(kind.count).toBe(2)
    await expect(page.getByTestId('kind-button')).toContainText('Kind: Pauses and alerts')
    await expect
      .poll(() =>
        page
          .getByTestId('log-line')
          .evaluateAll((els) => els.map((el) => el.getAttribute('data-kind'))),
      )
      .toEqual(['guard.tripped', 'pause.lifted', 'pause.started'])
    // A line about a sent order opens its sheet; the others do nothing.
    await page.getByTestId('kind-button').click()
    await page.getByTestId('kind-orders').click()
    await page.getByTestId('tonight-search').fill('SO05')
    await expect(page.getByTestId('log-line').first()).toBeVisible()
    await page.getByTestId('log-line').first().getByRole('button').click()
    await expect(page.getByTestId('sent-sheet')).toContainText('Sent order SO05')
    await page.keyboard.press('Escape')
    await page.getByTestId('tonight-search').fill('')
    await page.getByTestId('kind-button').click()
    await page.getByTestId('kind-pauses').click()
    await expect(page.getByTestId('log-line').first().getByRole('button')).toHaveCount(0)
  })

  test('reads an earlier night by its date, with the line about how long it is kept', async () => {
    const { page } = owner
    await open(page, 'flow', 'log')
    await expect(page.getByTestId('log-kept')).toHaveCount(0)
    const taps = new Taps()
    await taps.tap(page.getByTestId('day-button'))
    const earlier = page.locator(
      '[data-testid^="day-2"]:not([aria-disabled="true"]):not([data-disabled])',
    )
    // The list is newest first: tonight, then the earlier night that holds an entry.
    await taps.tap(earlier.nth(1))
    expect(taps.count).toBe(2)
    await expect(page.getByTestId('log-kept')).toContainText(
      'Night details are kept 31 days. Settings and staff changes are kept 18 months.',
    )
    await expect(page.getByTestId('log-line')).toHaveCount(1)
    await expect(page.getByTestId('log-list')).toContainText('Sent order OLD1: Not on the bill')
    await expect(page.getByTestId('day-button')).not.toContainText('Tonight')
  })

  test('says so when nothing was logged on a night', async () => {
    const { page } = owner
    await open(page, 'empty', 'log')
    await expect(page.getByTestId('nothing-here')).toContainText('Nothing logged on this night.')
  })
})

test.describe('the end of the night', () => {
  test('puts what to fix first, then the sent orders, then the totals', async () => {
    const { page } = owner
    await open(page, 'flow', 'actions')
    const taps = new Taps()
    await taps.tap(page.getByRole('tab', { name: 'End of night' }))
    await expect(page.getByTestId('night-day')).toContainText('Night of')
    await expect(page.getByTestId('night-state')).toHaveText(
      'So far tonight · the night ends at 07:00',
    )
    const order = await page
      .locator('[data-testid="tonight-night"] section')
      .evaluateAll((els) => els.map((el) => el.id))
    expect(order).toEqual(['night-fix', 'night-sent', 'night-totals'])
    expect(taps.count).toBe(1)
    await expect(page.getByTestId('night-fix-count')).toHaveText('1')
    await expect(page.getByTestId('night-fix-list').getByTestId('action-row')).toHaveCount(1)
    await expect(page.getByTestId('night-sent-summary')).toHaveText(
      '9 sent · 2 added · 4 not sent · 1 unconfirmed',
    )
    // The ones not added show first; "Show all 9" adds the rest in place.
    await expect(sentRows(page)).toHaveCount(5)
    await page.getByTestId('night-show-all').click()
    await expect(sentRows(page)).toHaveCount(9)
    const totals = page.getByTestId('night-totals-list')
    await expect(totals).toContainText('Tables opened for phones')
    await expect(
      totals.locator('div', { hasText: 'Tables opened for phones' }).first(),
    ).toContainText('6')
    await expect(totals.locator('div', { hasText: 'Amount added to bills' }).first()).toContainText(
      '€36.00',
    )
    // Nothing on the page is a filled button.
    expect(
      await page.getByTestId('tonight-night').locator('button[data-variant="default"]').count(),
    ).toBe(0)
  })

  test('fixes a problem from the page in 1 tap more, and then says there is nothing to fix', async () => {
    const { page } = owner
    await open(page, 'flow', 'night')
    const taps = new Taps()
    await taps.tap(
      page.getByTestId('night-fix-list').getByRole('button', { name: 'Not on the bill' }),
    )
    await expect(toast(page, 'Saved: not on the bill')).toBeVisible()
    await expect(page.getByTestId('night-fix-none')).toHaveText('Nothing to fix.')
    expect(taps.count).toBe(1)
    await expect(page.getByTestId('night-sent-summary')).toHaveText(
      '9 sent · 2 added · 5 not sent · 0 unconfirmed',
    )
  })

  test("gives the owner the CSV: UTF-8 with a BOM, the plan's columns, amounts as decimals, no ids", async () => {
    const { page } = owner
    await open(page, 'flow', 'night')
    const link = page.getByTestId('night-csv')
    await expect(link).toHaveText(/Download CSV/)
    const href = (await link.getAttribute('href')) as string
    const response = await page.request.get(href)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    expect(response.headers()['content-disposition']).toMatch(
      /filename="restro-tonight-club-\d{4}-\d{2}-\d{2}\.csv"/,
    )
    const bytes = await response.body()
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = bytes.toString('utf8').slice(1)
    const lines = text.split('\r\n')
    expect(lines[0]).toBe(
      'section,time,table,reference,what,state,reason,answer,who,amount,tip,detail',
    )
    expect(text).toContain('K7F2')
    expect(text).toMatch(/Sent orders,\d\d:\d\d,Table 2,SO01,Sent order,Added,,,,18\.00,,2 items/)
    expect(text).toMatch(/Totals,,,,Amount added to bills,,,,,36\.00,,/)
    // Our ids only, no POS bill id, no guest data.
    expect(text).not.toMatch(/\b(so|tb|st|al|nd)_[0-9A-Za-z]+/)
    expect(text).not.toContain('1042')
    expect(text).not.toContain('no ice')
    // The tip column is for payment rows (part 2) and stays empty here.
    for (const line of lines.slice(1)) {
      if (line === '') continue
      expect(line.split(',').length).toBeGreaterThanOrEqual(12)
    }
  })

  test('shows staff the first sections and part 1 totals, without the CSV or any tip', async () => {
    const { page } = waiter
    await open(page, 'flow', 'night')
    await expect(page.getByTestId('tonight-night')).toBeVisible()
    await expect(page.getByTestId('night-fix-list')).toBeVisible()
    await expect(page.getByTestId('night-totals-list')).toBeVisible()
    await expect(page.getByTestId('night-csv')).toHaveCount(0)
    await expect(page.getByTestId('tonight-night')).not.toContainText(/tip/i)
    // The file itself is refused to staff.
    const href = `/api/venues/${venueUrl(page).split('/venues/')[1]}/night`
    expect((await page.request.get(href)).status()).toBe(403)
  })

  test('reads an earlier night from its written totals, with the answered problem and who gave it', async () => {
    const { page } = owner
    await open(page, 'flow', 'night')
    const taps = new Taps()
    await taps.tap(page.getByTestId('day-button'))
    await taps.tap(
      page
        .locator('[data-testid^="day-2"]:not([aria-disabled="true"]):not([data-disabled])')
        .nth(1),
    )
    expect(taps.count).toBe(2)
    await expect(page.getByTestId('night-state')).toHaveText('Closed at 07:00')
    await expect(page.getByTestId('night-sent-summary')).toHaveText(
      '1 sent · 0 added · 1 not sent · 0 unconfirmed',
    )
    const totals = page.getByTestId('night-totals-list')
    await expect(
      totals.locator('div', { hasText: 'Tables opened for phones' }).first(),
    ).toContainText('12')
    await expect(totals.locator('div', { hasText: 'Amount added to bills' }).first()).toContainText(
      '€512.00',
    )
    await expect(page.getByTestId('night-fix-answered')).toContainText('OLD1')
    await expect(page.getByTestId('night-fix-answered')).toContainText('Not on the bill · Georgi')
  })

  test('says so when there was no service on a night', async () => {
    const { page } = owner
    await open(page, 'empty', 'night')
    await expect(page.getByTestId('nothing-here')).toContainText('No service on this night.')
    await expect(page.getByTestId('night-csv')).toHaveCount(0)
  })
})

test('all three screens hold at 390 px and at 1180 px, in both themes: no sideways scroll, 44 px targets', async () => {
  const { page, context } = owner
  for (const size of [PHONE, TABLET]) {
    await page.setViewportSize(size)
    for (const theme of ['light', 'dark']) {
      await context.addCookies([
        { name: 'restro_theme', value: theme, url: new URL(page.url()).origin },
      ])
      for (const view of ['sent', 'log', 'night']) {
        await open(page, 'flow', view)
        await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^((?!dark).)*$/)
        await expect(page.getByTestId(`tonight-${view}`)).toBeVisible()
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        )
        expect(sideways, `${view} ${size.width} ${theme}`).toBe(false)
        const small = await page
          .locator(
            `[data-testid="tonight-${view}"] button, [data-testid="tonight-${view}"] a[href]`,
          )
          .evaluateAll((els) =>
            els
              .map((el) => {
                const box = el.getBoundingClientRect()
                return { text: (el.textContent ?? '').trim().slice(0, 30), h: box.height }
              })
              .filter((box) => box.h > 0 && box.h < 44),
          )
        expect(small, `${view} ${size.width} ${theme}`).toEqual([])
        await page.screenshot({
          path: `test-results/tonight/${view}-${size.width}-${theme}.png`,
          fullPage: false,
        })
      }
    }
  }
  await page.setViewportSize(TABLET)
  // On a phone the jump links lead to each section.
  await page.setViewportSize(PHONE)
  await open(page, 'flow', 'night')
  await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toBeVisible()
  await page.setViewportSize(TABLET)
  await expect(page.getByRole('navigation', { name: 'Jump to a section' })).toBeHidden()
})
