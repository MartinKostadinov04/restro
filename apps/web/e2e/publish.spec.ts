import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import { addressOfVenue } from './menu-path'
import { ADMIN_PASSWORD, PUBLISH_MEMBER_EMAIL, PUBLISH_OWNER_EMAIL, PUBLISH_SLUG } from './support'

// Publishing on a production build with the REAL worker running beside it (briefs S3-05, S4; D96,
// D97). The venue is the fixture of scripts/seed-publish-e2e.ts: five drinks, nothing published,
// a POS integration mapped to it. The Publish button heads every tab of the venue page; the
// warnings sit under the header; Settings has Publish (Automation) and Versioning. In English
// unless a step says otherwise. Steps:
//
//   nothing published -> Publish (the confirmation lists the whole menu) -> "Version 1 is live" ->
//   "Open the guest page" shows the menu
//   a price changes behind the page's back (core's writer) -> the bar counts 1 change, the
//   confirmation lists it, its Preview shows the new price in a phone frame; the guest page does not
//   Publish -> "Version 2 is live" -> Settings › Versioning: return to version 1 -> the paused
//   warning under the header, the guest page is back to the old price, a waiting automatic
//   publish is skipped by the worker
//   Publish -> version 4, automatic publishing is back -> an automatic publish goes through;
//   another return, then "Resume automatic publishing" lifts the pause without publishing
//   Settings › Publish: the Automation settings save the sync mode and "publish after a sync"
//   a held publish (V11) under the header: reject it; hold again, approve it
//   a plain member sees the page and can change nothing
//
// The screenshots (BG and EN, light and dark, desktop and phone) go to `.local/screenshots/s4/`.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const SHOTS = fileURLToPath(new URL('../../../.local/screenshots/s4/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shotPath = (name: string) => `${SHOTS}s4-publish-${name}.png`

const PRICE_BEFORE = '€12.50'
const PRICE_AFTER = '€14.50'
const WORKER_WAIT = { timeout: 45_000 }
const UP_TO_DATE = 'Up to date: guests see the latest version.'

let owner: BrowserContext
let page: Page
let venueId = ''
let db: pg.Pool
let tenantId = ''
/** The venue's guest address of before D84, `/m/<slug>-<code>`: it still opens the menu. */
let guestPath = ''
/** The guest address of D84, `/m/<organisation>/<venue>`, as the header and the bar show it. */
const GUEST_ADDRESS = `/m/publish-club/${PUBLISH_SLUG}`
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

/**
 * The page once everything streamed in is shown: React keeps streamed HTML in hidden containers
 * (`S:<n>`) until it reveals it, and for a moment a part can be there twice.
 */
const settled = (target: Page) => expect(target.locator('[hidden][id*="S:"]')).toHaveCount(0)

/** The venue page (a tab, a settings section), once its Publish bar is in. */
const open = async (target: Page = page, query = '') => {
  await target.goto(`/venues/${venueId}${query}`)
  await settled(target)
  await expect(target.getByTestId('publish-bar')).toBeVisible()
}
const VERSIONING = '?tab=settings&section=versioning'
const AUTOMATION = '?tab=settings&section=publish'

const bar = {
  button: (target: Page = page) => target.getByTestId('publish-button'),
  reason: (target: Page = page) => target.getByTestId('publish-block-reason'),
  count: (target: Page = page) => target.getByTestId('publish-count'),
}

/** Presses Publish and confirms it. */
async function publish(target: Page = page) {
  await bar.button(target).click()
  await expect(target.getByTestId('publish-confirm-dialog')).toBeVisible()
  await target.getByTestId('publish-confirm').click()
}

async function snapshotRows() {
  const { rows } = await db.query<{ version: number; status: string; reason: string }>(
    `select version, status, reason from restro.snapshots where tenant_id = $1 order by version`,
    [tenantId],
  )
  return rows
}
/** The rollback pause is the venue's own since ad/05 (T76, D82): `venues.settings.publish.auto_paused`. */
async function pauseFlag() {
  const { rows } = await db.query<{ paused: boolean }>(
    `select coalesce((settings #>> '{publish,auto_paused}')::boolean, false) as paused
     from restro.venues where id = $1`,
    [venueId],
  )
  return rows[0]?.paused
}

/** The price a guest sees for a drink, on a fresh browser (no cached `current.json`). */
async function guestPrice(browser: Browser, name: string): Promise<string | null> {
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`${guestPath}?lang=en`)
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

/** A fresh page of the venue, in a language and colour scheme, for a picture. */
async function shoot(
  browser: Browser,
  name: string,
  options: {
    locale: 'en' | 'bg'
    scheme: 'light' | 'dark'
    phone?: boolean
    state?: typeof ownerState
    query?: string
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
    await open(target, options.query ?? '')
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
  const address = await addressOfVenue({ venueId })
  expect(address.slug).toBe(PUBLISH_SLUG)
  guestPath = address.path
  // The venue's page names its guest address under its name (D84).
  await expect(page.getByTestId('venue-header-address')).toHaveText(GUEST_ADDRESS)
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

test('before the first publish: the bar counts the whole menu; no versions; the guest page is off', async () => {
  await open()
  // No Publishing tab (D97): the bar heads the page.
  await expect(page.getByRole('tab', { name: 'Publishing' })).toHaveCount(0)
  await expect(bar.button()).toBeEnabled()
  await expect(bar.count()).toHaveText('5')
  await expect(bar.reason()).toHaveText('Not published yet: guests see nothing until you publish.')
  await expect(page.getByTestId('guest-link')).toBeDisabled()
  await expect(page.getByTestId('guest-link-hint')).toHaveText('Nothing is published yet.')
  expect(await snapshotRows()).toEqual([])
  // The guest page has nothing to show yet.
  const guest = await page.context().newPage()
  await guest.goto(`${guestPath}?lang=en`)
  await expect(guest.getByText('This menu is not available')).toBeVisible()
  await guest.close()
  await page.screenshot({ path: shotPath('en-light-desktop-empty'), fullPage: true })

  await open(page, VERSIONING)
  await expect(page.getByTestId('history-empty')).toBeVisible()
  await expect(page.getByTestId('versioning-purge')).toContainText('erased 30 days after')
})

test('Publish: the confirmation lists the whole menu, then "Version 1 is live" and the guest page shows it', async ({
  browser,
}) => {
  await bar.button().click()
  await expect(page.getByTestId('changes-all-new')).toHaveText(
    'Everything is new: 5 items will go live with the first publish.',
  )
  await page.getByTestId('publish-confirm').click()
  // The press only queues the job; the button says so while the worker works.
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 1 is live',
    WORKER_WAIT,
  )
  await expect(bar.button()).toBeDisabled()
  await expect(bar.reason()).toHaveText(UP_TO_DATE)
  await expect(page.getByTestId('paused-banner')).toHaveCount(0)
  // Settings › Versioning (still open): version 1, live, by hand, by the owner.
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Live')
  await expect(rows.first()).toContainText('Published by hand')
  await expect(rows.first()).toContainText('Publish Owner')

  // "Open the guest page": a new tab with the published menu, at the address of D84.
  const [guest] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByTestId('guest-link').click(),
  ])
  await guest.waitForLoadState()
  expect(new URL(guest.url()).pathname).toBe(GUEST_ADDRESS)
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

test('a price changes behind the page: the bar counts 1 change, the confirmation lists it, the preview shows it, the guest page does not', async ({
  browser,
}) => {
  runScript('./scripts/seed-publish-e2e.ts', 'price', '1450')
  await open()
  await expect(bar.count()).toHaveText('1')
  await expect(bar.reason()).toHaveText('1 change waiting')
  await bar.button().click()
  const dialog = page.getByTestId('publish-confirm-dialog')
  await expect(dialog.getByTestId('changes-count')).toHaveText('1 change waiting')
  await expect(dialog.getByTestId('change-summary')).toHaveText('1 with a new price')
  await expect(dialog.getByTestId('change-list-prices')).toContainText(
    `Negroni: ${PRICE_BEFORE} → ${PRICE_AFTER}`,
  )
  await dialog.screenshot({ path: shotPath('en-light-desktop-confirm') })
  await snapshotsOfChanges(browser)

  // The preview: a phone frame with the guest face, drawn from the draft. The draft names no
  // template, so it is the registry's default, the Editorial Market (SH-04).
  await dialog.getByTestId('publish-confirm-preview').click()
  const preview = page.getByTestId('preview-dialog')
  const frame = preview.getByTestId('phone-frame')
  await expect(frame).toBeVisible()
  await expect(frame.locator('[data-face="editorial-market"]:not([data-testid])')).toBeVisible()
  const negroni = frame.locator('[data-item]').filter({ hasText: 'Negroni' })
  await expect(negroni).toContainText(PRICE_AFTER)
  // A phone-sized screen inside the dialog, scrolling on its own.
  const screen = await page.getByTestId('phone-screen').boundingBox()
  expect(screen?.width).toBeGreaterThan(300)
  expect(screen?.width).toBeLessThan(400)
  await preview.screenshot({ path: shotPath('en-light-desktop-preview') })
  await preview.getByRole('button', { name: 'Dark' }).click()
  await expect(frame.locator('[data-face]:not([data-testid])')).toHaveAttribute(
    'data-scheme',
    'dark',
  )
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)

  // Nothing was published by looking: the guest page keeps the old price, no new row.
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_BEFORE)
  expect(await snapshotRows()).toHaveLength(1)
})

/** The confirmation in the other languages and schemes. */
async function snapshotsOfChanges(browser: Browser) {
  for (const [name, locale, scheme] of [
    ['en-dark-desktop-confirm', 'en', 'dark'],
    ['bg-light-desktop-confirm', 'bg', 'light'],
  ] as const) {
    await shoot(browser, name, {
      locale,
      scheme,
      before: async (target) => {
        await target.getByTestId('publish-button').click()
        await expect(target.getByTestId('publish-confirm-dialog')).toBeVisible()
      },
    })
  }
}

test('Publish again: "Version 2 is live", and the guest page has the new price', async ({
  browser,
}) => {
  await open(page, VERSIONING)
  await publish()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 2 is live',
    WORKER_WAIT,
  )
  await expect(bar.reason()).toHaveText(UP_TO_DATE)
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('1 with a new price')
  await expect(rows.first()).toContainText('Live')
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_AFTER)
})

test('Return to version 1 in Settings › Versioning: the pause warning, the old price is back, a waiting automatic publish is skipped', async ({
  browser,
}) => {
  // Something differs from version 1 now, so an automatic publish WOULD publish.
  expect(await pauseFlag()).toBe(false)
  await open(page, VERSIONING)
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
  // The warning under the header, on every tab (D97).
  await expect(page.getByTestId('paused-banner')).toContainText(
    'Automatic publishing is paused because you returned to an older version.',
  )
  // Versioning keeps the live version and the ones to return to; the return itself is said on the
  // live row.
  const rows = page.getByTestId('history-row')
  await expect(rows).toHaveCount(2)
  const live = rows.filter({ hasText: 'Version 1' })
  await expect(live).toContainText('Live')
  await expect(live.getByTestId('live-returned')).toContainText('Returned to this version')
  await expect(rows.filter({ hasText: 'Version 2' }).getByRole('button')).toHaveText(
    'Return to this version',
  )
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

  // The warning heads every tab.
  await open(page, '?tab=studio')
  await expect(page.getByTestId('paused-banner')).toBeVisible()
  await page.screenshot({ path: shotPath('en-light-desktop-paused'), fullPage: true })
  await shoot(browser, 'bg-light-desktop-paused', { locale: 'bg', scheme: 'light' })
  await shoot(browser, 'en-dark-desktop-paused', { locale: 'en', scheme: 'dark' })
  await shoot(browser, 'bg-light-phone-paused', { locale: 'bg', scheme: 'light', phone: true })
  await shoot(browser, 'en-dark-phone-paused', { locale: 'en', scheme: 'dark', phone: true })
})

test('Publish resumes automatic publishing; an automatic publish then goes through', async ({
  browser,
}) => {
  await open(page, VERSIONING)
  await expect(page.getByTestId('paused-banner')).toBeVisible()
  await publish()
  // Version 3 was the return; the menu as it is now (the new price) is version 4.
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 4 is live',
    WORKER_WAIT,
  )
  await expect(page.getByTestId('paused-banner')).toHaveCount(0)
  expect(await pauseFlag()).toBe(false)
  expect(await guestPrice(browser, 'Negroni')).toBe(PRICE_AFTER)

  // An automatic publish goes through again.
  runScript('./scripts/seed-publish-e2e.ts', 'price', '1500')
  runScript('./scripts/seed-publish-e2e.ts', 'auto')
  await expect
    .poll(async () => (await snapshotRows()).at(-1)?.reason, { timeout: 30_000 })
    .toBe('auto_sync')
  expect((await snapshotRows()).at(-1)?.version).toBe(5)
  await open(page, VERSIONING)
  const live = page.getByTestId('history-row').first()
  await expect(live).toContainText('Version 5')
  await expect(live).toContainText('Published automatically after a sync')
})

test('"Resume automatic publishing" lifts the pause after a return without publishing', async () => {
  await open(page, VERSIONING)
  await page
    .getByTestId('history-row')
    .filter({ hasText: 'Version 4' })
    .getByRole('button', { name: 'Return to this version' })
    .click()
  await page.getByRole('dialog').getByRole('button', { name: 'Return to version 4' }).click()
  await expect(page.getByTestId('paused-banner')).toBeVisible({ timeout: 30_000 })
  expect(await pauseFlag()).toBe(true)
  const before = (await snapshotRows()).length

  await page.getByTestId('paused-resume').click()
  await expect(page.getByTestId('paused-banner')).toHaveCount(0, { timeout: 30_000 })
  expect(await pauseFlag()).toBe(false)
  // Nothing was published by the resume.
  expect(await snapshotRows()).toHaveLength(before)
  // The draft (version 5's price) still differs from version 4: Publish is on.
  await expect(bar.button()).toBeEnabled()
})

test('Settings › Publish: the Automation settings save the sync mode and "publish after a sync"', async ({
  browser,
}) => {
  await open(page, AUTOMATION)
  const form = page.getByTestId('automation-form')
  await expect(form).toContainText('Reading the menu from barsy')
  // D96: the "new items from the till" rule is gone.
  await expect(form).not.toContainText('New items')
  await expect(page.getByTestId('automation-zone')).toHaveText('Europe/Sofia')
  await expect(page.getByTestId('automation-sync-auto')).toBeChecked()
  await expect(page.getByTestId('automation-after-auto')).toBeChecked()
  await shoot(browser, 'en-light-desktop-automation', {
    locale: 'en',
    scheme: 'light',
    query: AUTOMATION,
  })
  await shoot(browser, 'bg-dark-phone-automation', {
    locale: 'bg',
    scheme: 'dark',
    phone: true,
    query: AUTOMATION,
  })

  await page.getByTestId('automation-sync-manual').check()
  await page.getByTestId('automation-after-manual').check()
  await page.getByTestId('automation-save').click()
  await expect(page.getByTestId('automation-saved')).toBeVisible()
  const settings = async () =>
    (
      await db.query<{ sync: { mode: string }; after: string }>(
        `select settings -> 'sync' as sync, settings #>> '{publish,after_sync}' as after
         from restro.venues where id = $1`,
        [venueId],
      )
    ).rows[0]
  expect(await settings()).toMatchObject({ sync: { mode: 'manual' }, after: 'manual' })
  await open(page, AUTOMATION)
  await expect(page.getByTestId('automation-sync-manual')).toBeChecked()
  await expect(page.getByTestId('automation-after-manual')).toBeChecked()
  await expect(page.getByTestId('automation-inherited')).toHaveCount(0)

  // Back as they were, for the steps below and the next run.
  await page.getByTestId('automation-sync-auto').check()
  await page.getByTestId('automation-after-auto').check()
  await page.getByTestId('automation-save').click()
  await expect(page.getByTestId('automation-saved')).toBeVisible()
  expect(await settings()).toMatchObject({ sync: { mode: 'auto' }, after: 'auto' })
})

test('a held publish (V11) under the header: it names what it would hide, and Reject turns it down', async ({
  browser,
}) => {
  runScript('./scripts/seed-publish-e2e.ts', 'hold')
  await open(page, VERSIONING)
  const banner = page.getByTestId('held-banner')
  await expect(banner).toContainText(
    'An automatic publish was held: it would hide 3 of 5 items (60%)',
  )
  await expect(banner.getByTestId('held-items')).toContainText('Mojito, Negroni, Spritz')
  await expect(page.getByTestId('history-row').filter({ hasText: 'Held' })).toHaveCount(1)
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
  await open()
  const banner = page.getByTestId('held-banner')
  await expect(banner).toContainText('The menu has changed since this publish was held')
  await expect(banner.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0)
  await expect(banner.getByTestId('held-publish-now')).toBeVisible()
  await banner.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByTestId('held-banner')).toHaveCount(0, { timeout: 30_000 })
})

test('Approve publishes the held menu through the worker; the hidden drinks leave the guest page', async ({
  browser,
}) => {
  // The document is still the held state (three drinks hidden, the lager at 4.75): hold it once more.
  runScript('./scripts/seed-publish-e2e.ts', 'hold')
  await open()
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
  await open()
  await expect(bar.reason()).toContainText('changes waiting')
  await publish()
  await expect(bar.reason()).toHaveText(UP_TO_DATE, WORKER_WAIT)
  expect(await guestPrice(browser, 'Mojito')).not.toBeNull()
})

test('a plain member sees the page and can change nothing', async ({ browser }) => {
  const context = await browser.newContext({ storageState: memberState })
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  const member = await context.newPage()
  await open(member)
  await expect(member.getByTestId('publish-button')).toBeDisabled()
  await expect(member.getByTestId('publish-block-reason')).toHaveText(
    'Only an owner or admin can publish.',
  )
  // The guest page is anyone's to open.
  await expect(member.getByTestId('guest-link')).toHaveAttribute('href', GUEST_ADDRESS)
  await open(member, VERSIONING)
  await expect(member.getByTestId('read-only')).toBeVisible()
  await expect(member.getByTestId('history-row').first()).toBeVisible()
  await expect(member.getByRole('button', { name: 'Return to this version' })).toHaveCount(0)
  await open(member, AUTOMATION)
  await expect(member.getByTestId('automation-form')).toBeVisible()
  await expect(member.getByTestId('automation-save')).toHaveCount(0)
  await context.close()
})

test('saves the screenshots of the brief (BG and EN, light and dark, phone)', async ({
  browser,
}) => {
  await shoot(browser, 'bg-light-desktop-live', { locale: 'bg', scheme: 'light' })
  await shoot(browser, 'en-dark-desktop-live', { locale: 'en', scheme: 'dark' })
  await shoot(browser, 'bg-dark-phone-live', { locale: 'bg', scheme: 'dark', phone: true })
  await shoot(browser, 'en-light-phone-live', { locale: 'en', scheme: 'light', phone: true })
  await shoot(browser, 'en-light-desktop-versioning', {
    locale: 'en',
    scheme: 'light',
    query: VERSIONING,
  })
  await shoot(browser, 'bg-dark-desktop-versioning', {
    locale: 'bg',
    scheme: 'dark',
    query: VERSIONING,
  })
})
