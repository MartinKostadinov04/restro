import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD, PUBLISH_OWNER_EMAIL } from './support'

// A venue with no till (CF-01, D64, D66) on a production build with the REAL worker beside it:
// an owner makes a venue from the list, makes its menu by hand (a section, an item with a price),
// fills in the allergens in the item sheet, publishes, and the guest page shows the item and its
// price. Then the other side of D66: a venue that HAS a till (the publish fixture has a barsy
// venue mapped to it) offers no "New item"; and a plain member is not offered "New venue".
// The organisation is the fixture of scripts/seed-no-till-e2e.ts (no venue to start with); each
// run makes a venue under an address of its own.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const OWNER_EMAIL = 'no-till-owner@demo-club.test'
const MEMBER_EMAIL = 'no-till-member@demo-club.test'
const RUN = Date.now().toString(36)
const VENUE_NAME = `Till Free ${RUN}`
const SLUG = `till-free-${RUN}`
const WORKER_WAIT = { timeout: 45_000 }

let owner: BrowserContext
let page: Page
let venueUrl = ''

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

/** A signed-in page in English for another person. */
async function otherPerson(browser: Browser, email: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const target = await context.newPage()
  await signIn(target, email)
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'en', url: new URL(target.url()).origin },
  ])
  await target.reload()
  return { context, target }
}

test.beforeAll(async ({ browser }) => {
  runScript('./scripts/seed-no-till-e2e.ts', 'seed')
  owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  page = await owner.newPage()
  await signIn(page, OWNER_EMAIL)
  // English from here on (the sign-in page was in Bulgarian, the default).
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
})

test.afterAll(async () => {
  await owner?.close()
})

test('venue with no till: create the venue from the list', async () => {
  await page.goto('/venues')
  await expect(page.getByRole('heading', { name: 'Venues', level: 1 })).toBeVisible()
  // The organisation has no venue yet: the empty state points at the button, and has one itself.
  await expect(page.getByTestId('venues-empty')).toContainText(
    'Create your first venue with the New venue button.',
  )
  await expect(page.getByTestId('new-venue')).toBeVisible()
  await page.getByTestId('new-venue-empty').click()
  const dialog = page.getByTestId('new-venue-dialog')
  await expect(dialog).toBeVisible()

  // The address follows the name; the line under it says what it is.
  await dialog.getByTestId('new-venue-name').fill(VENUE_NAME)
  await expect(dialog.getByTestId('new-venue-slug')).toHaveValue(SLUG)
  await expect(dialog.getByTestId('new-venue-address')).toHaveText(
    'The readable part of the menu’s web address. A short unique code is added to it automatically.',
  )
  await expect(dialog.getByTestId('new-venue-defaults')).toHaveText(
    'Time zone: Europe/Sofia · Currency: EUR',
  )
  await dialog.getByTestId('new-venue-submit').click()

  // The new venue opens, with its menu already made: nothing to set up, and no sections yet.
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
  venueUrl = new URL(page.url()).pathname
  await expect(page.getByRole('heading', { name: VENUE_NAME, level: 1 })).toBeVisible()
  await expect(page.getByTestId('composer')).toBeVisible()
  await expect(page.getByTestId('no-menu')).toHaveCount(0)
  await expect(page.getByTestId('pane-no-sections')).toContainText(
    'Create a section, or connect a till in the Integration tab.',
  )

  // The list has it, and its address is taken now.
  await page.goto('/venues')
  await expect(page.getByTestId('venue-card').filter({ hasText: VENUE_NAME })).toBeVisible()
  await page.getByTestId('new-venue').click()
  await page.getByTestId('new-venue-name').fill('Same address again')
  await page.getByTestId('new-venue-slug').fill(SLUG)
  await page.getByTestId('new-venue-submit').click()
  await expect(page.getByTestId('new-venue-slug-error')).toHaveText(
    'This address is already taken. Choose another one.',
  )
  await page.keyboard.press('Escape')
})

test('venue with no till: a section, an item with a price, allergens in the item sheet', async () => {
  await page.goto(venueUrl)
  await page.getByTestId('new-section-empty').click()
  await page.getByTestId('new-section-name-bg_BG').fill('Коктейли')
  await page.getByTestId('new-section-submit').click()
  await expect(page.getByTestId('pane-title')).toHaveText('Коктейли')

  // An empty section of a venue with no till points at New item.
  await expect(page.getByTestId('item-list-empty')).toContainText('Create an item with New item')
  await page.getByTestId('new-item').click()
  const dialog = page.getByTestId('new-item-dialog')
  await expect(dialog).toContainText('It is added to “Коктейли”')
  await dialog.getByTestId('new-item-name-bg_BG').fill('Мохито')
  await dialog.getByTestId('new-item-name-en_US').fill('Mojito')
  await dialog.getByTestId('new-item-price').fill('4,50')
  await dialog.getByTestId('new-item-submit').click()

  // The row is there at once, and the item sheet opens for the new item.
  const row = page.getByTestId('item-row').filter({ hasText: 'Mojito' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('€4.50')
  const sheet = page.getByTestId('item-sheet')
  // The sheet is titled in the venue's main language.
  await expect(sheet.getByTestId('item-sheet-title')).toHaveText('Мохито', { timeout: 30_000 })
  await expect(sheet.getByTestId('item-sheet-details')).toBeVisible()
  const price = sheet.locator('[data-field-key="price"]')
  await expect(price).toContainText('4.50')
  await expect(price).toContainText('Owned here')

  // Allergens are required: set them to "none" (toggle one on and off, then save).
  const allergens = sheet.locator('[data-field-key="allergens"]')
  await expect(allergens).toContainText('No value set')
  await allergens.getByRole('button', { name: 'Set Allergens' }).click()
  const editor = page.getByTestId('field-editor-sheet')
  await editor.getByRole('button', { name: 'Milk' }).click()
  await editor.getByRole('button', { name: 'Milk' }).click()
  await expect(editor).toContainText('None selected')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(allergens).toContainText('None')
  await expect(allergens).not.toContainText('No value set')

  // Closing the sheet refreshes the list: the item is still there, no longer missing allergens.
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
  await expect(page.getByTestId('item-row').filter({ hasText: 'Mojito' })).toBeVisible()
})

test('venue with no till: publish, and the guest page shows the item and its price', async ({
  browser,
}) => {
  await page.goto(`${venueUrl}?tab=publishing`)
  await expect(page.getByTestId('publish-panel')).toBeVisible()
  await page.getByTestId('live-nothing').getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 1 is live',
    WORKER_WAIT,
  )

  // A guest on a fresh browser: the menu at /m/<address> with the item and its euro price.
  const context = await browser.newContext()
  try {
    const guest = await context.newPage()
    await guest.goto(`/m/${SLUG}?lang=en`)
    await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
    const card = guest.locator('[data-item]').filter({ hasText: 'Mojito' })
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('€4.50')
  } finally {
    await context.close()
  }
})

test('a venue with a till offers no New item: its items come from the till (D66)', async ({
  browser,
}) => {
  // The publish fixture's venue has a barsy venue mapped to it.
  const { context, target } = await otherPerson(browser, PUBLISH_OWNER_EMAIL)
  try {
    await target.getByTestId('venue-card').first().getByRole('link', { name: 'Open' }).click()
    await expect(target.getByTestId('composer')).toBeVisible()
    await expect(target.getByTestId('item-pane')).toBeVisible()
    // Sections are layout, so they can still be made; items cannot.
    await expect(target.getByTestId('new-section')).toBeVisible()
    await expect(target.getByTestId('new-item')).toHaveCount(0)
    await expect(target.getByTestId('new-item-empty')).toHaveCount(0)
    await target.getByTestId('unsorted-select').click()
    await expect(target.getByTestId('pane-title')).toHaveText('Unsorted')
    await expect(target.getByTestId('new-item')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('a plain member is not offered New venue', async ({ browser }) => {
  const { context, target } = await otherPerson(browser, MEMBER_EMAIL)
  try {
    await target.goto('/venues')
    await expect(target.getByRole('heading', { name: 'Venues', level: 1 })).toBeVisible()
    await expect(target.getByTestId('venue-card').first()).toBeVisible()
    await expect(target.getByTestId('new-venue')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
