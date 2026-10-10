import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// Sold out tonight, end to end on a production build with the REAL worker running beside it (brief
// S3-08, D46, rule 5). The venue is the fixture of scripts/seed-sold-out-e2e.ts: three hand-made
// cocktails, a lager, and a Campari that barsy has OFF SALE, published to /m/sold-out-club. In
// Bulgarian, the admin's default. Steps:
//
//   a manager marks a drink in the row menu -> badge and the "Изчерпани (1)" chip; within 20 s the
//   guest page shows it sold out, with no new menu version (the pointer file is the same)
//   the chip's list puts it back on sale -> the guest page is back to normal
//   the Campari barsy has off sale: its own badge and NO control anywhere, in the row or the sheet
//   the item sheet marks and unmarks too
//   a plain member sees the marks and can change nothing
//   the service day ends (moved with the venue's setting): the real worker's tick remakes live.json
//   without the mark, and the composer shows the item on sale again
//
// The screenshots go to `.local/screenshots/s3/s3-08-*.png`.
test.describe.configure({ mode: 'serial' })
test.setTimeout(150_000)

const SHOTS = fileURLToPath(new URL('../../../.local/screenshots/s3/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shotPath = (name: string) => `${SHOTS}s3-08-${name}.png`

const OWNER_EMAIL = 'sold-out-owner@demo-club.test'
const MEMBER_EMAIL = 'sold-out-member@demo-club.test'
const SLUG = 'sold-out-club'
/** What the guest page waits for: the brief says 20 s; the worker needs one to three. */
const GUEST_WAIT = { timeout: 20_000, intervals: [1_000, 1_000, 2_000] }
const SOLD_OUT_WORD = 'Изчерпано'
/** The fixed node ids of scripts/seed-sold-out-e2e.ts. */
const NEGRONI = `nd_${'E2eSoNegroni'.padEnd(22, '0')}`
const CAMPARI = `nd_${'E2eSoCampari'.padEnd(22, '0')}`

let owner: BrowserContext
let page: Page
let venueId = ''
let menuId = ''
let tenantId = ''
let db: pg.Pool
let ownerState: Awaited<ReturnType<BrowserContext['storageState']>>
let memberState: Awaited<ReturnType<BrowserContext['storageState']>>

async function signIn(target: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.goto('/venues')
    await target.getByLabel('Имейл').fill(email)
    await target.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await target.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(target).toHaveURL(/\/venues$/, { timeout: 5_000 })
      return
    } catch {
      await target.waitForTimeout(10_000)
    }
  }
  throw new Error(`could not sign in as ${email}`)
}

const composerUrl = () => `/venues/${venueId}`
async function openComposer(target: Page = page) {
  await target.goto(composerUrl())
  await expect(target.getByTestId('composer')).toBeVisible()
  await expect(target.getByTestId('item-row').first()).toBeVisible()
}

const rowOf = (target: Page, name: string) =>
  target.getByTestId('item-row').filter({ has: target.getByRole('button', { name, exact: true }) })

async function markFromRowMenu(target: Page, name: string) {
  await rowOf(target, name).getByTestId('item-menu').click()
  await target.getByTestId('item-mark-sold-out').click()
}

/** What a guest sees of one drink, on a fresh browser (no cached `live.json`). */
async function guestState(browser: Browser, name: string) {
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`/m/${SLUG}?lang=bg`)
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
    const card = guest
      .locator('[data-item]')
      .filter({ has: guest.getByRole('heading', { name, exact: true }) })
      .first()
    return {
      state: await card.getAttribute('data-state'),
      soldOutWord: ((await card.textContent()) ?? '').includes(SOLD_OUT_WORD),
    }
  } finally {
    await context.close()
  }
}

async function snapshotRows() {
  const { rows } = await db.query<{ version: number; status: string }>(
    `select version, status from restro.snapshots where tenant_id = $1 order by version`,
    [tenantId],
  )
  return rows
}

/** A published file through the app's own `/cdn` route (the page the guests use). */
async function cdnJson(target: Page, file: string): Promise<unknown> {
  const response = await target.request.get(`/cdn/${file}`)
  expect(response.status(), file).toBe(200)
  return response.json()
}
const liveFile = () => `m/${menuId}/${venueId}/live.json`
const currentFile = () => `m/${menuId}/${venueId}/current.json`

async function clearMarks() {
  await db.query(
    `delete from restro.field_values where tenant_id = $1 and layer like 'edition:%'`,
    [tenantId],
  )
}

async function shoot(
  browser: Browser,
  name: string,
  options: {
    scheme?: 'light' | 'dark'
    phone?: boolean
    state?: typeof ownerState
    before?: (target: Page) => Promise<void>
    open?: (target: Page) => Promise<void>
  } = {},
) {
  const context = await browser.newContext({
    storageState: options.state ?? ownerState,
    colorScheme: options.scheme ?? 'light',
    ...(options.phone
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1280, height: 900 } }),
  })
  try {
    const target = await context.newPage()
    await (options.open ?? openComposer)(target)
    await options.before?.(target)
    await target.screenshot({ path: shotPath(name), fullPage: false })
  } finally {
    await context.close()
  }
}

test.beforeAll(async ({ browser }) => {
  runScript('./scripts/seed-sold-out-e2e.ts', 'seed')
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 2 })
  owner = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await owner.newPage()
  await signIn(page, OWNER_EMAIL)
  await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(venueId).not.toBe('')
  const { rows } = await db.query<{ tenant_id: string; menu_id: string }>(
    `select v.tenant_id, m.id as menu_id from restro.venues v
       join restro.menus m on m.venue_id = v.id where v.id = $1`,
    [venueId],
  )
  tenantId = rows[0]?.tenant_id ?? ''
  menuId = rows[0]?.menu_id ?? ''
  expect(tenantId).not.toBe('')
  ownerState = await owner.storageState()

  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await signIn(memberPage, MEMBER_EMAIL)
  memberState = await memberContext.storageState()
  await memberContext.close()
})

test.afterAll(async () => {
  // Leave the venue as the seed does: a normal service day and no marks.
  if (venueId) {
    runScript('./scripts/seed-sold-out-e2e.ts', 'day-ends', '07:00')
    await clearMarks()
  }
  await owner?.close()
  await db?.end()
})

test('a manager marks a drink: badge and chip at once, guests within 20 s, no new menu version', async ({
  browser,
}) => {
  await openComposer()
  expect(await snapshotRows()).toMatchObject([{ version: 1, status: 'published' }])
  const pointer = await cdnJson(page, currentFile())
  expect(await guestState(browser, 'Негрони')).toEqual({ state: 'available', soldOutWord: false })
  await expect(page.getByTestId('sold-out-chip')).toHaveCount(0)

  await markFromRowMenu(page, 'Негрони')
  await expect(rowOf(page, 'Негрони').getByTestId('sold-out-badge')).toHaveText(
    'Изчерпано тази вечер',
  )
  await expect(page.getByTestId('sold-out-chip')).toHaveText('Изчерпани (1)')
  await page.screenshot({ path: shotPath('bg-light-desktop-marked') })

  // Within 20 s the guest page says sold out: the worker rewrote live.json, nothing else.
  await expect
    .poll(async () => (await guestState(browser, 'Негрони')).state, GUEST_WAIT)
    .toBe('sold_out')
  expect(await guestState(browser, 'Негрони')).toEqual({ state: 'sold_out', soldOutWord: true })
  expect(await guestState(browser, 'Мохито')).toEqual({ state: 'available', soldOutWord: false })
  // live.json lists the marked drink and the Campari (barsy has it off sale), and is for version 1.
  const live = (await cdnJson(page, liveFile())) as { version: number; items: object }
  expect(live.version).toBe(1)
  expect(Object.keys(live.items).sort()).toEqual([NEGRONI, CAMPARI].sort())
  // No new snapshot, the pointer file is the same one.
  expect(await snapshotRows()).toMatchObject([{ version: 1, status: 'published' }])
  expect(await cdnJson(page, currentFile())).toEqual(pointer)

  // A fresh load of the admin shows the mark from the database, not from memory.
  await page.reload()
  await expect(rowOf(page, 'Негрони').getByTestId('sold-out-badge')).toBeVisible()
  const guest = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  try {
    const phone = await guest.newPage()
    await phone.goto(`/m/${SLUG}?lang=bg`)
    await expect(phone.getByRole('heading', { level: 1 })).toBeVisible()
    await phone.screenshot({ path: shotPath('bg-light-phone-guest-sold-out') })
  } finally {
    await guest.close()
  }
})

test('the chip opens the list, and "Върни в продажба" puts the drink back; guests follow', async ({
  browser,
}) => {
  await openComposer()
  await page.getByTestId('sold-out-chip').click()
  const list = page.getByTestId('sold-out-list')
  await expect(list.getByTestId('sold-out-entry')).toHaveCount(1)
  await expect(list.getByTestId('sold-out-entry')).toContainText('Негрони')
  await page.waitForTimeout(400)
  await page.screenshot({ path: shotPath('bg-light-desktop-list') })

  await list.getByTestId('sold-out-entry-unmark').click()
  // The list empties and closes with its last entry; the row loses its badge.
  await expect(page.getByTestId('sold-out-chip')).toHaveCount(0)
  await expect(rowOf(page, 'Негрони').getByTestId('sold-out-badge')).toHaveCount(0)
  await expect
    .poll(async () => (await guestState(browser, 'Негрони')).state, GUEST_WAIT)
    .toBe('available')
  expect(Object.keys(((await cdnJson(page, liveFile())) as { items: object }).items)).toHaveLength(
    1,
  )
  expect(await snapshotRows()).toMatchObject([{ version: 1, status: 'published' }])
})

test('an item barsy has off sale says so and has no control, in the row and in the sheet (rule 5)', async ({
  browser,
}) => {
  await openComposer()
  const campari = rowOf(page, 'Кампари')
  await expect(campari.getByTestId('off-sale-badge')).toHaveText('Не се продава в barsy')
  await expect(campari.getByTestId('sold-out-badge')).toHaveCount(0)
  await campari.getByTestId('item-menu').click()
  await expect(page.getByRole('menuitem', { name: /Отвори/ })).toBeVisible()
  await expect(page.getByTestId('item-mark-sold-out')).toHaveCount(0)
  await expect(page.getByTestId('item-unmark-sold-out')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The guests see it sold out all the time: it is in the snapshot, whatever the managers do.
  expect(await guestState(browser, 'Кампари')).toEqual({ state: 'sold_out', soldOutWord: true })

  await campari.getByTestId('item-open').click()
  const card = page.getByTestId('item-sheet-sale')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-state', 'off_barsy')
  await expect(card.getByTestId('sale-state')).toHaveText('Не се продава в barsy')
  await expect(card.getByRole('button')).toHaveCount(0)
  await expect(page.getByText('Върни в продажба')).toHaveCount(0)
  await page.waitForTimeout(600)
  await page.screenshot({ path: shotPath('bg-light-desktop-sheet-barsy-off') })
  await page.keyboard.press('Escape')
})

test('the item sheet marks and unmarks too', async ({ browser }) => {
  await openComposer()
  await rowOf(page, 'Мохито').getByTestId('item-open').click()
  const card = page.getByTestId('item-sheet-sale')
  await expect(card).toHaveAttribute('data-state', 'on')
  await expect(card.getByTestId('sale-state')).toHaveText('В продажба')
  await card.getByTestId('sale-mark').click()
  await expect(card).toHaveAttribute('data-state', 'tonight')
  await expect(card.getByTestId('sale-state')).toHaveText('Изчерпано тази вечер')
  await expect(card.getByTestId('sale-mark')).toHaveCount(0)
  await page.waitForTimeout(600)
  await page.screenshot({ path: shotPath('bg-light-desktop-sheet-marked') })
  await expect
    .poll(async () => (await guestState(browser, 'Мохито')).state, GUEST_WAIT)
    .toBe('sold_out')

  await card.getByTestId('sale-unmark').click()
  await expect(card).toHaveAttribute('data-state', 'on')
  await expect
    .poll(async () => (await guestState(browser, 'Мохито')).state, GUEST_WAIT)
    .toBe('available')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('item-sheet')).toHaveCount(0)
  await expect(rowOf(page, 'Мохито').getByTestId('sold-out-badge')).toHaveCount(0)
})

test('a plain member sees the marks and the chip, and can change nothing', async ({ browser }) => {
  await openComposer()
  await markFromRowMenu(page, 'Шприц')
  await expect(page.getByTestId('sold-out-chip')).toHaveText('Изчерпани (1)')

  const context = await browser.newContext({ storageState: memberState })
  try {
    const member = await context.newPage()
    await openComposer(member)
    await expect(rowOf(member, 'Шприц').getByTestId('sold-out-badge')).toBeVisible()
    await member.getByTestId('sold-out-chip').click()
    await expect(member.getByTestId('sold-out-entry')).toHaveCount(1)
    await expect(member.getByTestId('sold-out-entry-unmark')).toHaveCount(0)
    await member.keyboard.press('Escape')
    await rowOf(member, 'Мохито').getByTestId('item-menu').click()
    await expect(member.getByRole('menuitem', { name: /Отвори/ })).toBeVisible()
    await expect(member.getByTestId('item-mark-sold-out')).toHaveCount(0)
    await member.keyboard.press('Escape')
    await rowOf(member, 'Мохито').getByTestId('item-open').click()
    await expect(member.getByTestId('item-sheet-sale').getByRole('button')).toHaveCount(0)
    await expect(member.getByTestId('sale-note')).toContainText('собственик или администратор')
    await member.waitForTimeout(600)
    await member.screenshot({ path: shotPath('bg-light-desktop-member-sheet') })
  } finally {
    await context.close()
  }
  await page.reload()
  await page.getByTestId('sold-out-chip').click()
  await page.getByTestId('sold-out-entry-unmark').click()
  await expect(page.getByTestId('sold-out-chip')).toHaveCount(0)
})

test('on a phone: the row menu marks, the chip and its list fit the screen', async ({
  browser,
}) => {
  await shoot(browser, 'bg-light-phone-composer', {
    phone: true,
    before: async (target) => {
      await markFromRowMenu(target, 'Негрони')
      await expect(target.getByTestId('sold-out-chip')).toBeVisible()
      await target.getByTestId('sold-out-chip').click()
      await expect(target.getByTestId('sold-out-list')).toBeVisible()
      // The dialog fades in: shoot it once it is there.
      await target.waitForTimeout(600)
    },
  })
  await shoot(browser, 'bg-dark-desktop-marked', { scheme: 'dark' })
  // Back to a clean evening for the next test.
  await openComposer()
  await page.getByTestId('sold-out-chip').click()
  await page.getByTestId('sold-out-entry-unmark').click()
  await expect(page.getByTestId('sold-out-chip')).toHaveCount(0)
})

test("the mark lapses with the service day: the real worker's tick remakes live.json without it", async ({
  browser,
}) => {
  // Moving the end of the service day to 23:59 puts "now" in the PREVIOUS service day, which is
  // what 07:00 does to last night. (From 23:00 on that would not be true; skip then.)
  const localHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Sofia',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  )
  test.skip(localHour >= 23, 'the service day cannot be moved forward this late in the evening')

  await openComposer()
  await markFromRowMenu(page, 'Негрони')
  await expect
    .poll(async () => (await guestState(browser, 'Негрони')).state, GUEST_WAIT)
    .toBe('sold_out')

  runScript('./scripts/seed-sold-out-e2e.ts', 'day-ends', '23:59')
  // The worker's tick runs every minute: within about 90 s live.json no longer lists the drink.
  await expect
    .poll(
      async () =>
        Object.keys(((await cdnJson(page, liveFile())) as { items: object }).items).length,
      { timeout: 100_000, intervals: [3_000] },
    )
    .toBe(1) // only the Campari, which barsy has off sale
  await expect
    .poll(async () => (await guestState(browser, 'Негрони')).state, GUEST_WAIT)
    .toBe('available')
  // The composer reads the same clock: yesterday's mark is out of context, the drink is on sale.
  await page.reload()
  await expect(rowOf(page, 'Негрони').getByTestId('sold-out-badge')).toHaveCount(0)
  await expect(page.getByTestId('sold-out-chip')).toHaveCount(0)
  // And no snapshot was made on the way.
  expect(await snapshotRows()).toMatchObject([{ version: 1, status: 'published' }])
})
