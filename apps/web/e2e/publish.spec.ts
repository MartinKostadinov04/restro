import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD, PUBLISH_MEMBER_EMAIL, PUBLISH_OWNER_EMAIL, PUBLISH_SLUG } from './support'

// The Publish tab on a production build with the REAL worker running beside it (brief S3-05). The
// venue is the fixture of scripts/seed-publish-e2e.ts: five drinks, nothing published, a barsy
// integration mapped to it. In English unless a step says otherwise. Steps:
//
//   nothing published -> Publish -> "Version 1 is live" -> the guest page shows the menu
//   a price changes behind the tab's back (core's writer) -> "1 change waiting" -> the preview
//   shows the new price in a phone frame, the guest page still the old one
//   Publish -> "Version 2 is live" -> return to version 1 -> the paused banner, the guest page is
//   back to the old price, a waiting automatic publish is skipped by the worker
//   Publish -> version 4, automatic publishing is back -> an automatic publish goes through
//   a held publish (V11): reject it; hold again, approve it
//   a plain member reads the tab and can change nothing
//
// The screenshots (BG and EN, light and dark, desktop and phone) go to `.local/screenshots/s3/`.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const SHOTS = fileURLToPath(new URL('../../../.local/screenshots/s3/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shotPath = (name: string) => `${SHOTS}s3-05-${name}.png`

const PRICE_BEFORE = '€12.50'
const PRICE_AFTER = '€14.50'
const WORKER_WAIT = { timeout: 45_000 }

let owner: BrowserContext
let page: Page
let venueId = ''
let db: pg.Pool
let tenantId = ''
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

const tabUrl = () => `/venues/${venueId}?tab=publishing`
const open = async (target: Page = page) => {
  await target.goto(tabUrl())
  await expect(target.getByTestId('publish-panel')).toBeVisible()
}

async function snapshotRows() {
  const { rows } = await db.query<{ version: number; status: string; reason: string }>(
    `select version, status, reason from restro.snapshots where tenant_id = $1 order by version`,
    [tenantId],
  )
  return rows
}
async function pauseFlag() {
  const { rows } = await db.query<{ paused: boolean }>(
    `select coalesce((config #>> '{publish,auto_paused}')::boolean, false) as paused
     from restro.integrations where tenant_id = $1`,
    [tenantId],
  )
  return rows[0]?.paused
}

/** The price a guest sees for a drink, on a fresh browser (no cached `current.json`). */
async function guestPrice(browser: Browser, name: string): Promise<string | null> {
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`/m/${PUBLISH_SLUG}?lang=en`)
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
    const card = guest
      .locator('[data-item]')
      .filter({ has: guest.getByRole('heading', { name, exact: true }) })
    if ((await card.count()) === 0) return null
    return ((await card.first().textContent()) ?? '').match(/€\d+\.\d\d/)?.[0] ?? null
  } finally {
    await context.close()
  }
}

/** A fresh page of the tab, in a language and colour scheme, for a picture. */
async function shoot(
  browser: Browser,
  name: string,
  options: {
    locale: 'en' | 'bg'
    scheme: 'light' | 'dark'
    phone?: boolean
    state?: typeof ownerState
    before?: (target: Page) => Promise<void>
  },
) {
  const context = await browser.newContext({
    storageState: options.state ?? ownerState,
    colorScheme: options.scheme,
    ...(options.phone
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1280, height: 1000 } }),
  })
  try {
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: options.locale, url: new URL(page.url()).origin },
    ])
    const target = await context.newPage()
    await open(target)
    await options.before?.(target)
    await target.screenshot({ path: shotPath(name), fullPage: true })
  } finally {
    await context.close()
  }
}

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 2 })
  owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  page = await owner.newPage()
  await signIn(page, PUBLISH_OWNER_EMAIL)
  await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(venueId).not.toBe('')
  const { rows } = await db.query<{ tenant_id: string }>(
    `select tenant_id from restro.venues where id = $1`,
    [venueId],
  )
  tenantId = rows[0]?.tenant_id ?? ''
  expect(tenantId).not.toBe('')
  // English from here on (the sign-in page was in Bulgarian, the default).
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  ownerState = await owner.storageState()

  // The plain member signs in once too, in a context of their own.
  const memberContext = await browser.newContext()
  const memberPage = await memberContext.newPage()
  await signIn(memberPage, PUBLISH_MEMBER_EMAIL)
  memberState = await memberContext.storageState()
  await memberContext.close()
})

test.afterAll(async () => {
  await owner?.close()
  await db?.end()
})

test('before the first publish: nothing live, the whole menu waiting, Publish on the live card', async () => {
  await open()
  await expect(page.getByTestId('live-nothing')).toContainText('Nothing published yet')
  await expect(page.getByTestId('live-nothing')).toContainText('5 items are ready')
  await expect(page.getByTestId('changes-all-new')).toContainText('5 items will go live')
  await expect(page.getByTestId('history-empty')).toBeVisible()
  expect(await snapshotRows()).toEqual([])
  // The guest page has nothing to show yet.
  const guest = await page.context().newPage()
  await guest.goto(`/m/${PUBLISH_SLUG}?lang=en`)
  await expect(guest.getByText('Menu not found')).toBeVisible()
  await guest.close()
  await page.screenshot({ path: shotPath('en-light-desktop-empty'), fullPage: true })
})

test('Publish: "Version 1 is live", and the guest page shows the menu', async ({ browser }) => {
  await page.getByTestId('live-nothing').getByRole('button', { name: 'Publish' }).click()
  // The press only queues the job; the button says so while the worker works.
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 1 is live',
    WORKER_WAIT,
  )
  await expect(page.getByTestId('live-version-number')).toHaveText('Version 1')
  await expect(page.getByTestId('live-meta')).toContainText('Published by hand')
  await expect(page.getByTestId('live-meta')).toContainText('Publish Owner')
  await expect(page.getByTestId('changes-up-to-date')).toBeVisible()
  await expect(page.getByTestId('history-row')).toHaveCount(1)
  await expect(page.getByTestId('paused-banner')).toHaveCount(0)

  // "Open the guest page": a new tab with the published menu.
  const [guest] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByTestId('guest-link').click(),
  ])
  await guest.waitForLoadState()
  expect(new URL(guest.url()).pathname).toBe(`/m/${PUBLISH_SLUG}`)
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Publish Club')
  await expect(guest.locator('[data-slot="item.name"]')).toHaveText([
    'Negroni',
    'Mojito',
    'Spritz',
    'Lager',
    'Stout',
  ])
  await guest.close()
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_BEFORE)
  expect((await snapshotRows()).map((row) => [row.version, row.status, row.reason])).toEqual([
    [1, 'published', 'manual'],
  ])
})

test('a price changes behind the tab: "1 change waiting", the preview shows it, the guest page does not', async ({
  browser,
}) => {
  runScript('./scripts/seed-publish-e2e.ts', 'price', '1450')
  await page.reload()
  await expect(page.getByTestId('changes-count')).toHaveText('1 change waiting')
  await expect(page.getByTestId('change-summary')).toHaveText('1 with a new price')
  await page.getByRole('button', { name: 'Show the changes' }).click()
  await expect(page.getByTestId('change-list-prices')).toContainText(
    `Negroni: ${PRICE_BEFORE} → ${PRICE_AFTER}`,
  )
  await snapshotsOfChanges(browser)

  // The preview: a phone frame with the guest face, drawn from the draft.
  await page.getByRole('button', { name: 'Preview' }).click()
  const frame = page.getByTestId('phone-frame')
  await expect(frame).toBeVisible()
  await expect(frame.locator('[data-face="qr-phone"]')).toBeVisible()
  const negroni = frame.locator('[data-item]').filter({ hasText: 'Negroni' })
  await expect(negroni).toContainText(PRICE_AFTER)
  // A phone-sized screen inside the dialog, scrolling on its own.
  const screen = await page.getByTestId('phone-screen').boundingBox()
  expect(screen?.width).toBeGreaterThan(300)
  expect(screen?.width).toBeLessThan(400)
  await page.getByRole('dialog').screenshot({ path: shotPath('en-light-desktop-preview') })
  await page.getByRole('button', { name: 'Dark' }).click()
  await expect(frame.locator('.rq-root')).toHaveAttribute('data-scheme', 'dark')
  await page.getByRole('dialog').screenshot({ path: shotPath('en-dark-desktop-preview') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // Nothing was published by looking: the guest page keeps the old price, no new row.
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_BEFORE)
  expect(await snapshotRows()).toHaveLength(1)
})

/** The same state in the other languages, schemes and a phone (the first screenshots of the tab). */
async function snapshotsOfChanges(browser: Browser) {
  await shoot(browser, 'en-light-desktop-changes', {
    locale: 'en',
    scheme: 'light',
    before: async (target) => {
      await target.getByRole('button', { name: 'Show the changes' }).click()
    },
  })
  await shoot(browser, 'bg-dark-desktop-changes', {
    locale: 'bg',
    scheme: 'dark',
    before: async (target) => {
      await target.getByRole('button', { name: 'Покажи промените' }).click()
    },
  })
}

test('Publish again: "Version 2 is live", and the guest page has the new price', async ({
  browser,
}) => {
  await page.getByTestId('changes-count').waitFor()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 2 is live',
    WORKER_WAIT,
  )
  await expect(page.getByTestId('live-version-number')).toHaveText('Version 2')
  await expect(page.getByTestId('changes-up-to-date')).toBeVisible()
  await expect(page.getByTestId('history-row')).toHaveCount(2)
  await expect(page.getByTestId('history-row').first()).toContainText('1 with a new price')
  await expect(page.getByTestId('history-row').first()).toContainText('Live')
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_AFTER)
})

test('Return to version 1: the paused banner, the old price is back, and a waiting automatic publish is skipped', async ({
  browser,
}) => {
  // Something differs from version 1 now, so an automatic publish WOULD publish.
  expect(await pauseFlag()).toBe(false)
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'Version 1' })
    .getByRole('button', { name: 'Return to this version' })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Return to version 1?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Return to version 1' }).click()

  await expect(page.getByTestId('publish-outcome-title')).toHaveText('Returned to version 1.', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('paused-banner')).toContainText(
    'Automatic publishing is paused because you returned to an older version. Publish to resume.',
  )
  await expect(page.getByTestId('live-version-number')).toHaveText('Version 1')
  await expect(page.getByTestId('live-returned')).toContainText('Returned to this version')
  await expect(page.getByTestId('history-row')).toHaveCount(3)
  await expect(page.getByTestId('history-row').first()).toContainText('Returned to version 1')
  expect(await pauseFlag()).toBe(true)
  expect((await snapshotRows()).map((row) => [row.version, row.reason])).toEqual([
    [1, 'manual'],
    [2, 'manual'],
    [3, 'rollback'],
  ])
  // The files follow the pointer: the guest page is back to the old price.
  await expect.poll(() => guestPrice(browser, 'Negroni'), { timeout: 30_000 }).toBe(PRICE_BEFORE)

  // The worker skips an automatic publish while paused (the document differs from version 1).
  runScript('./scripts/seed-publish-e2e.ts', 'auto')
  await expect
    .poll(
      async () =>
        (
          await db.query<{ state: string }>(
            `select state::text as state from pgboss.job
             where name = 'publish-menu' and data ->> 'tenantId' = $1 and data ->> 'reason' = 'auto_sync'
             order by created_on desc limit 1`,
            [tenantId],
          )
        ).rows[0]?.state,
      { timeout: 30_000 },
    )
    .toBe('completed')
  expect(await snapshotRows()).toHaveLength(3)
  expect(await pauseFlag()).toBe(true)

  await page.screenshot({ path: shotPath('en-light-desktop-paused'), fullPage: true })
  await shoot(browser, 'bg-light-desktop-paused', { locale: 'bg', scheme: 'light' })
  await shoot(browser, 'en-dark-desktop-paused', { locale: 'en', scheme: 'dark' })
  await shoot(browser, 'bg-light-phone-paused', { locale: 'bg', scheme: 'light', phone: true })
  await shoot(browser, 'en-dark-phone-paused', { locale: 'en', scheme: 'dark', phone: true })
})

test('Publish resumes automatic publishing', async ({ browser }) => {
  await page.reload()
  await expect(page.getByTestId('paused-banner')).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  // Version 3 was the return; the menu as it is now (the new price) is version 4.
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 4 is live',
    WORKER_WAIT,
  )
  await expect(page.getByTestId('paused-banner')).toHaveCount(0)
  await expect(page.getByTestId('live-version-number')).toHaveText('Version 4')
  expect(await pauseFlag()).toBe(false)
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_AFTER)

  // An automatic publish goes through again.
  runScript('./scripts/seed-publish-e2e.ts', 'price', '1500')
  runScript('./scripts/seed-publish-e2e.ts', 'auto')
  await expect
    .poll(async () => (await snapshotRows()).at(-1)?.reason, { timeout: 30_000 })
    .toBe('auto_sync')
  expect((await snapshotRows()).at(-1)?.version).toBe(5)
  await page.reload()
  await expect(page.getByTestId('live-version-number')).toHaveText('Version 5')
  await expect(page.getByTestId('live-meta')).toContainText('Published automatically after a sync')
})

test('a held publish (V11): the banner names what it would hide, and Reject turns it down', async ({
  browser,
}) => {
  runScript('./scripts/seed-publish-e2e.ts', 'hold')
  await page.reload()
  const banner = page.getByTestId('held-banner')
  await expect(banner).toContainText(
    'An automatic publish was held: it would hide 3 of 5 items (60%)',
  )
  await expect(banner.getByTestId('held-items')).toContainText('Mojito, Negroni, Spritz')
  // Streamed HTML is in the page before it is shown: wait until the tab has really replaced its skeleton.
  await expect(banner).toBeVisible()
  await expect(page.getByTestId('publish-skeleton')).toHaveCount(0)
  await page.screenshot({ path: shotPath('en-light-desktop-held'), fullPage: true })
  await shoot(browser, 'bg-dark-desktop-held', { locale: 'bg', scheme: 'dark' })

  await banner.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByTestId('held-banner')).toHaveCount(0, { timeout: 30_000 })
  await expect(
    page.getByTestId('history-row').filter({ hasText: 'Rejected' }).first(),
  ).toBeVisible()
  expect((await snapshotRows()).at(-1)).toMatchObject({ status: 'rejected' })
  // Nothing went live: the guest page still has every drink.
  expect(await guestPrice(browser, 'Mojito')).not.toBeNull()
})

test('a held publish the menu has moved on from cannot be approved; it can be rejected', async () => {
  runScript('./scripts/seed-publish-e2e.ts', 'hold')
  // The document changes after the hold (a drink that is still shown, the lager): approving would
  // be refused, so the banner says so.
  runScript('./scripts/seed-publish-e2e.ts', 'price', '475', '3')
  await page.reload()
  const banner = page.getByTestId('held-banner')
  await expect(banner).toContainText('The menu has changed since this publish was held')
  await expect(banner.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0)
  await banner.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByTestId('held-banner')).toHaveCount(0, { timeout: 30_000 })
})

test('Approve publishes the held menu through the worker; the hidden drinks leave the guest page', async ({
  browser,
}) => {
  // The document is still the held state (three drinks hidden, the lager at 4.75): hold it once more.
  runScript('./scripts/seed-publish-e2e.ts', 'hold')
  await page.reload()
  await expect(page.getByTestId('held-banner')).toContainText('would hide 3 of 5 items')
  await page.getByTestId('held-approve').click()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    /^Version \d+ is live$/,
    WORKER_WAIT,
  )
  await expect(page.getByTestId('held-banner')).toHaveCount(0)
  expect((await snapshotRows()).at(-1)).toMatchObject({ status: 'published', reason: 'auto_sync' })
  expect(await guestPrice(browser, 'Mojito')).toBeNull()
  expect(await guestPrice(browser, 'Lager')).not.toBeNull()

  // Put the menu back: show the drinks, publish by hand.
  runScript('./scripts/seed-publish-e2e.ts', 'unhide')
  await page.reload()
  await expect(page.getByTestId('changes-count')).toContainText('changes waiting')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByTestId('changes-up-to-date')).toBeVisible(WORKER_WAIT)
  expect(await guestPrice(browser, 'Mojito')).not.toBeNull()
})

test('a plain member reads the tab and can change nothing', async ({ browser }) => {
  const context = await browser.newContext({ storageState: memberState })
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  const member = await context.newPage()
  await open(member)
  await expect(member.getByTestId('read-only')).toBeVisible()
  await expect(member.getByTestId('live-version-number')).toBeVisible()
  await expect(member.getByTestId('publish-button')).toBeDisabled()
  await expect(member.getByRole('button', { name: 'Return to this version' })).toHaveCount(0)
  // Looking is allowed: the preview opens.
  await member.getByRole('button', { name: 'Preview' }).click()
  await expect(member.getByTestId('phone-frame')).toBeVisible()
  await context.close()
})

test('saves the screenshots of the brief (BG and EN, light and dark, phone)', async ({
  browser,
}) => {
  await shoot(browser, 'bg-light-desktop-live', { locale: 'bg', scheme: 'light' })
  await shoot(browser, 'en-dark-desktop-live', { locale: 'en', scheme: 'dark' })
  await shoot(browser, 'bg-dark-phone-live', { locale: 'bg', scheme: 'dark', phone: true })
  await shoot(browser, 'en-light-phone-live', { locale: 'en', scheme: 'light', phone: true })
  await shoot(browser, 'bg-light-desktop-preview', {
    locale: 'bg',
    scheme: 'light',
    before: async (target) => {
      await target.getByRole('button', { name: 'Преглед' }).click()
      await expect(target.getByTestId('phone-frame')).toBeVisible()
    },
  })
})
