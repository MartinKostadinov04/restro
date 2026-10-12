import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// Renaming, deleting and restoring a venue (CF-18, D76) on a production build, with the real
// worker beside it:
//
//   rename     an owner changes the name in the venue's Settings tab; the sidebar and the page follow
//   who        an admin renames and sees no way to delete; a member sees the name as text only
//   delete     the owner types the venue's name; it leaves the sidebar, its page is a 404
//   guests     the worker withdraws the guest files: the menu address says "not available" and the
//              table's QR address does not open
//   restore    Settings > Deleted venues lists it with the day it was deleted; Restore brings it back
//   publish    the restored venue's address stays off until it is published (the Publish tab says so
//              and keeps its button on); then the same address shows the menu again
//   no venues  with every venue deleted the sidebar and /venues show the way to add one
//
// The organisation is the fixture of scripts/seed-lifecycle-e2e.ts. With SCREENSHOT_DIR set, the
// test saves the two screenshots of the brief there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(180_000)

const OWNER_EMAIL = 'lifecycle-owner@demo-club.test'
const ADMIN_EMAIL = 'lifecycle-admin@demo-club.test'
const MEMBER_EMAIL = 'lifecycle-member@demo-club.test'
const BAR = 'Lifecycle Bar'
const RENAMED = 'Lifecycle Lounge'
const KEEPER = 'Lifecycle Keeper'
const ITEM = 'Lifecycle Negroni'
// The guest face writes item names in capitals: compare without case.
const hasItem = (text: string) => text.toLowerCase().includes(ITEM.toLowerCase())

interface Seed {
  readonly organizationId: string
  readonly barId: string
  readonly barSlug: string
  readonly barPublicId: string
  readonly keeperId: string
  readonly token: string
}

let seed: Seed
let owner: BrowserContext
let page: Page

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

/** A signed-in page of one person, in English. */
async function person(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const target = await context.newPage()
  await signIn(target, email)
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'en', url: new URL(target.url()).origin },
  ])
  await target.reload()
  return { context, target }
}

async function snapshot(fileName: string, target: Page = page) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await target.screenshot({ path: path.join(dir, fileName) })
}

const sidebarItem = (target: Page, name: string) =>
  target.getByTestId('venue-nav-item').filter({ hasText: name })
const settingsTab = (id: string) => `/venues/${id}?tab=settings`

/** What a guest sees at an address, in a browser that has never been there (no cached files). */
async function guestText(browser: Browser, address: string): Promise<string> {
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(address)
    // The page loads its files after it is up: wait for one of its two answers.
    await guest
      .getByText(/Lifecycle Negroni|This menu is not available/)
      .first()
      .waitFor({ timeout: 20_000 })
    return await guest.locator('body').innerText()
  } finally {
    await context.close()
  }
}

/** Deletes a venue through its Settings tab, as the owner. */
async function deleteVenue(target: Page, venueId: string, name: string) {
  await target.goto(settingsTab(venueId))
  await target.getByTestId('delete-venue-open').click()
  await target.getByTestId('delete-venue-confirm-input').fill(name)
  await target.getByTestId('delete-venue-confirm').click()
  await expect(target).toHaveURL(/\/venues$/)
}

test.beforeAll(async ({ browser }) => {
  const output = runScript('./scripts/seed-lifecycle-e2e.ts', 'seed')
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_lifecycle_e2e_done'))
  if (!line) throw new Error(`the seed printed no result:\n${output}`)
  seed = JSON.parse(line) as Seed
  const signedIn = await person(browser, OWNER_EMAIL)
  owner = signedIn.context
  page = signedIn.target
})

test.afterAll(async () => {
  await owner?.close()
})

test('an owner renames the venue; the sidebar and the page follow', async () => {
  await page.goto(settingsTab(seed.barId))
  await expect(sidebarItem(page, BAR)).toBeVisible()
  const input = page.getByTestId('venue-name-input')
  await expect(input).toHaveValue(BAR)
  await expect(page.getByTestId('venue-name-save')).toBeDisabled()

  await input.fill(RENAMED)
  await page.getByTestId('venue-name-save').click()
  await expect(
    page.getByText('Saved. Guests see the new name after the next publish.'),
  ).toBeVisible()
  await expect(sidebarItem(page, RENAMED)).toBeVisible()
  await expect(sidebarItem(page, BAR)).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: RENAMED })).toBeVisible()
  // The address did not change.
  await expect(page.getByTestId('venue-header-address')).toHaveText(
    `/m/${seed.barSlug}-${seed.barPublicId}`,
  )
})

test('the guest page and the table code work before the venue is deleted', async ({
  browser,
  request,
}) => {
  const text = await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)
  expect(hasItem(text)).toBe(true)
  const code = await request.get(`/t/${seed.token}`, { maxRedirects: 0 })
  expect(code.status()).toBe(302)
  expect(code.headers().location).toContain(
    `/m/${seed.barSlug}-${seed.barPublicId}?t=${seed.token}`,
  )
})

const venueCard = (target: Page, name: string) =>
  target.getByTestId('venue-card').filter({ hasText: name })

test('the cards show each venue’s state, its guest address and where its menu comes from (D86)', async () => {
  await page.goto('/venues')
  // A live venue whose menu comes from a till venue: the instance and the venue in it are named.
  const bar = venueCard(page, RENAMED)
  await expect(bar.getByTestId('venue-card-state')).toHaveText('Live')
  await expect(bar.getByTestId('venue-card-address')).toHaveText(
    `/m/lifecycle-club/${seed.barSlug}`,
  )
  await expect(bar.getByTestId('venue-card-source')).toContainText('lifecycle.barsyonline.com')
  await expect(bar.getByTestId('venue-card-till-venue')).toHaveText('Lifecycle till')
  const preview = bar.getByRole('link', { name: 'Preview menu' })
  await expect(preview).toHaveAttribute('href', `/m/lifecycle-club/${seed.barSlug}`)
  await expect(preview).toHaveAttribute('target', '_blank')
  await expect(bar.getByTestId('unpublish-venue-open')).toBeVisible()

  // A venue made by hand that was never published: a Draft, with no preview to open.
  const keeper = venueCard(page, KEEPER)
  await expect(keeper.getByTestId('venue-card-state')).toHaveText('Draft')
  await expect(keeper.getByTestId('venue-card-source')).toHaveText('By hand')
  await expect(keeper.getByTestId('venue-card-preview')).toBeDisabled()
  await expect(keeper.getByTestId('venue-card-preview-hint')).toBeVisible()
  await expect(keeper.getByTestId('unpublish-venue-open')).toHaveCount(0)
  await snapshot('venue-cards.png')
})

test('an owner unpublishes the venue from its card: guests lose the menu; publishing brings it back', async ({
  browser,
  request,
}) => {
  await page.goto('/venues')
  const bar = venueCard(page, RENAMED)
  await bar.getByTestId('unpublish-venue-open').click()
  const dialog = page.getByTestId('unpublish-venue-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('unpublish-venue-effects')).toContainText(
    'guests see that the menu is not available',
  )
  await expect(page.getByTestId('unpublish-venue-effects')).toContainText('Nothing is deleted')
  // The dialog fades in: take the picture once it has settled.
  await page.waitForTimeout(600)
  await snapshot('unpublish-dialog.png')
  await dialog.getByTestId('unpublish-venue-confirm').click()

  // The card turns into a Draft at once; there is nothing to preview or to unpublish any more.
  await expect(page.getByText(`${RENAMED} was unpublished.`)).toBeVisible()
  await expect(bar.getByTestId('venue-card-state')).toHaveText('Draft')
  await expect(bar.getByTestId('venue-card-preview')).toBeDisabled()
  await expect(bar.getByTestId('unpublish-venue-open')).toHaveCount(0)

  // The worker takes the venue's files out a moment later: its address says the menu is not
  // available. The table's QR code still leads to that address, so it says the same.
  await expect
    .poll(
      async () =>
        (await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)).includes(
          'This menu is not available',
        ),
      { timeout: 60_000, intervals: [1_000, 2_000] },
    )
    .toBe(true)
  const code = await request.get(`/t/${seed.token}`, { maxRedirects: 0 })
  expect(code.status()).toBe(302)
  const qrAddress = code.headers().location ?? ''
  expect(await guestText(browser, qrAddress)).toContain('This menu is not available')

  // Publishing is the word to serve the venue again, even with nothing new in the menu.
  await page.goto(`/venues/${seed.barId}?tab=publishing`)
  await expect(page.getByTestId('address-off-banner')).toBeVisible()
  const publish = page.getByTestId('publish-button').first()
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect(page.getByTestId('publish-outcome-title')).toContainText('Nothing new to publish', {
    timeout: 60_000,
  })
  await expect
    .poll(async () => hasItem(await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)), {
      timeout: 60_000,
      intervals: [1_000, 2_000],
    })
    .toBe(true)
  expect(hasItem(await guestText(browser, qrAddress))).toBe(true)
  await page.goto('/venues')
  await expect(venueCard(page, RENAMED).getByTestId('venue-card-state')).toHaveText('Live')
})

test('an admin renames but cannot delete; a member sees the name as text only', async ({
  browser,
}) => {
  const admin = await person(browser, ADMIN_EMAIL)
  try {
    await admin.target.goto(settingsTab(seed.barId))
    await expect(admin.target.getByTestId('venue-name-input')).toBeVisible()
    await expect(admin.target.getByTestId('venue-danger-zone')).toHaveCount(0)
    await expect(admin.target.getByTestId('delete-venue-open')).toHaveCount(0)
    // Settings has no "Deleted venues" for an admin, and the page is not there.
    await admin.target.goto('/settings')
    await expect(admin.target.getByTestId('settings-nav-integrations')).toBeVisible()
    await expect(admin.target.getByTestId('settings-nav-deleted-venues')).toHaveCount(0)
    const response = await admin.target.goto('/settings/deleted-venues')
    expect(response?.status()).toBe(404)
  } finally {
    await admin.context.close()
  }

  const member = await person(browser, MEMBER_EMAIL)
  try {
    await member.target.goto(settingsTab(seed.barId))
    await expect(member.target.getByTestId('venue-name')).toHaveText(RENAMED)
    await expect(member.target.getByTestId('venue-name-input')).toHaveCount(0)
    await expect(member.target.getByTestId('venue-danger-zone')).toHaveCount(0)
  } finally {
    await member.context.close()
  }
})

test('the owner deletes the venue: it leaves the admin and its page is a 404', async () => {
  await page.goto(settingsTab(seed.barId))
  await expect(page.getByTestId('venue-danger-zone')).toBeVisible()
  await page.getByTestId('delete-venue-open').click()

  const dialog = page.getByTestId('delete-venue-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('delete-venue-effects')).toContainText('not available')
  await expect(page.getByTestId('delete-venue-effects')).toContainText('Settings › Deleted venues')
  const confirm = page.getByTestId('delete-venue-confirm')
  const typed = page.getByTestId('delete-venue-confirm-input')
  await expect(confirm).toBeDisabled()
  await typed.fill(BAR) // the old name: not the venue's name any more
  await expect(confirm).toBeDisabled()
  await typed.fill(RENAMED)
  await expect(confirm).toBeEnabled()
  // The dialog fades in: take the picture once it has settled.
  await page.waitForTimeout(600)
  await snapshot('delete-dialog.png')
  await confirm.click()

  await expect(page).toHaveURL(/\/venues$/)
  await expect(page.getByText(`${RENAMED} was deleted.`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deleted venues' })).toBeVisible()
  await expect(sidebarItem(page, RENAMED)).toHaveCount(0)
  await expect(sidebarItem(page, KEEPER)).toBeVisible()
  await expect(page.getByTestId('venue-card').filter({ hasText: RENAMED })).toHaveCount(0)

  const gone = await page.goto(`/venues/${seed.barId}`)
  expect(gone?.status()).toBe(404)
  const goneSettings = await page.goto(settingsTab(seed.barId))
  expect(goneSettings?.status()).toBe(404)
})

test('guests see that the menu is not available, and the table code does not open', async ({
  browser,
  request,
}) => {
  // The worker takes the files out a moment after the delete.
  await expect
    .poll(
      async () =>
        (await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)).includes(
          'This menu is not available',
        ),
      {
        timeout: 60_000,
        intervals: [1_000, 2_000],
      },
    )
    .toBe(true)
  const text = await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)
  expect(hasItem(text)).toBe(false)
  await expect
    .poll(async () => (await request.get(`/t/${seed.token}`, { maxRedirects: 0 })).status(), {
      timeout: 60_000,
      intervals: [1_000, 2_000],
    })
    .toBe(404)
  const code = await request.get(`/t/${seed.token}`, { maxRedirects: 0 })
  expect(await code.text()).toContain('This table code is not active.')
})

test('Settings > Deleted venues lists it with the day it was deleted, and Restore brings it back', async () => {
  await page.goto('/settings')
  await page.getByTestId('settings-nav-deleted-venues').click()
  await expect(page).toHaveURL(/\/settings\/deleted-venues$/)
  const row = page.getByTestId('deleted-venue').filter({ hasText: RENAMED })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('deleted-venue-date')).toContainText('Deleted on')
  await snapshot('deleted-venues.png')

  await row.getByTestId('restore-venue').click()
  await expect(page.getByText(`${RENAMED} is back.`)).toBeVisible()
  await expect(
    page.getByText('link it again in Settings › Integrations', { exact: false }),
  ).toBeVisible()
  await expect(page.getByTestId('deleted-venue')).toHaveCount(0)
  await expect(page.getByTestId('deleted-venues-empty')).toBeVisible()
  await expect(sidebarItem(page, RENAMED)).toBeVisible()

  const back = await page.goto(settingsTab(seed.barId))
  expect(back?.status()).toBe(200)
  await expect(page.getByTestId('venue-name-input')).toHaveValue(RENAMED)
})

test('the restored venue stays off for guests until it is published, then the same address works', async ({
  browser,
  request,
}) => {
  await page.goto(`/venues/${seed.barId}?tab=publishing`)
  await expect(page.getByTestId('address-off-banner')).toBeVisible()
  // The menu is the same as the live one, yet Publish is on: that is how the address comes back.
  const publish = page.getByTestId('publish-button').first()
  await expect(publish).toBeEnabled()
  // Still not available to guests.
  expect(await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)).toContain(
    'This menu is not available',
  )

  await publish.click()
  await expect(page.getByTestId('publish-outcome-title')).toContainText('Nothing new to publish', {
    timeout: 60_000,
  })
  await expect
    .poll(async () => hasItem(await guestText(browser, `/m/${seed.barSlug}-${seed.barPublicId}`)), {
      timeout: 60_000,
      intervals: [1_000, 2_000],
    })
    .toBe(true)
  // The page of the tab is up to date again.
  await page.reload()
  await expect(page.getByTestId('address-off-banner')).toHaveCount(0)
  await expect(page.getByTestId('publish-button').first()).toBeDisabled()

  // Its till was released with the delete and is not linked again: no table file, so the QR
  // address stays closed until the till is linked and the menu published again.
  expect((await request.get(`/t/${seed.token}`, { maxRedirects: 0 })).status()).toBe(404)
})

test('with every venue deleted the sidebar and the list show the way to add one', async () => {
  await deleteVenue(page, seed.barId, RENAMED)
  await deleteVenue(page, seed.keeperId, KEEPER)

  await expect(page.getByTestId('venue-nav-item')).toHaveCount(0)
  await expect(page.getByTestId('venue-nav-new')).toBeVisible()
  await expect(page.getByTestId('venues-empty')).toBeVisible()
  await expect(page.getByTestId('new-venue-empty')).toBeVisible()

  // Both are there to restore.
  await page.goto('/settings/deleted-venues')
  await expect(page.getByTestId('deleted-venue')).toHaveCount(2)
  for (let left = 2; left > 0; left -= 1) {
    await page.getByTestId('restore-venue').first().click()
    await expect(page.getByTestId('deleted-venue')).toHaveCount(left - 1)
  }
  await expect(sidebarItem(page, RENAMED)).toBeVisible()
  await expect(sidebarItem(page, KEEPER)).toBeVisible()
})
