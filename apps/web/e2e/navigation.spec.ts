import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD } from './support'

// The sidebar and the organisation's Settings (CF-09a, D74, D154) on a production build. Off a
// venue's page the sidebar lists the organisation's venues, "All venues", "New venue" (owners and
// admins only) and Settings. On a venue's page it is the venue's: its name (the venue switcher) and
// its screens grouped by module, each module with its own Settings (D156).
//
//   the list      three venues by name (a lower-case name is not put last), no screen links
//   open a venue  from the sidebar; the venue's screens by module, the open one lit
//   swap venues   from the switcher, on the same screen
//   Settings      /settings opens General; the breadcrumb reads "Settings > General"; Integrations
//                 is the next section
//   General       the owner renames the organisation (the sidebar follows); the address name is
//                 checked while typed and refused when another organisation has it (S3, D91)
//   collapsed     each venue shows its initial and, hovered, its name
//   New venue     from the sidebar; the new venue is in the list without a reload
//   a member      sees the venues and Settings, not "New venue"; General shows the values as text
//   a phone       the sidebar is a sheet that closes once a venue or a screen is chosen
//
// The organisation is the fixture of scripts/seed-navigation-e2e.ts. With SCREENSHOT_DIR set, the
// test saves the screenshots of the brief there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const OWNER_EMAIL = 'navigation-owner@demo-club.test'
const MEMBER_EMAIL = 'navigation-member@demo-club.test'
const CREATED_VENUE = 'Cabana Beach'
const SECOND_CREATED_VENUE = 'Delta Rooms'

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

/** A signed-in page of another person, in English, at the given size. */
async function otherPerson(
  browser: Browser,
  email: string,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({ viewport })
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

// The sidebar's parts.
const venueList = (target: Page) => target.getByTestId('venue-nav')
const venueItems = (target: Page) => target.getByTestId('venue-nav-item')
const venueItem = (target: Page, name: string) =>
  venueItems(target).filter({ hasText: name }).first()
const settingsItem = (target: Page) => target.getByTestId('nav-settings')
const newVenueItem = (target: Page) => target.getByTestId('venue-nav-new')
const trail = (target: Page) => target.getByRole('navigation', { name: 'Breadcrumb' })
const switcher = (target: Page) => target.getByTestId('venue-switcher')
const entry = (target: Page, key: string) => target.locator(`[data-nav="${key}"]`)

test.beforeAll(async ({ browser }) => {
  runScript('./scripts/seed-navigation-e2e.ts', 'seed')
  owner = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  page = await owner.newPage()
  await signIn(page, OWNER_EMAIL)
})

test.afterAll(async () => {
  await owner?.close()
})

test('the sidebar lists the venues by name, then All venues, New venue and Settings', async () => {
  // Bulgarian is the default language: the groups are «Заведения» and «Организация».
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText([
    'Заведения',
    'Организация',
  ])
  await expect(newVenueItem(page)).toHaveText('Ново заведение')
  await expect(settingsItem(page)).toHaveText('Настройки')
  await expect(page.getByTestId('venue-nav-all')).toHaveText('Всички заведения')

  // English from here on.
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  await page.reload()

  // By name, ignoring case: "zenith Lounge" is last because of its letter, not its case.
  await expect(venueItems(page)).toHaveText([/Aurora Bar$/, /Boulevard Club$/, /zenith Lounge$/])
  await expect(page.getByTestId('venue-nav-all')).toHaveText('All venues')
  await expect(newVenueItem(page)).toHaveText('New venue')
  await expect(settingsItem(page)).toHaveText('Settings')
  await expect(settingsItem(page)).toHaveAttribute('href', '/settings')
  // On the overview "All venues" is lit and no venue is.
  await expect(page.getByTestId('venue-nav-all')).toHaveAttribute('aria-current', 'page')
  await expect(venueList(page).locator('[aria-current="page"]')).toHaveCount(1)

  // Off a venue's page the sidebar lists none of a venue's screens.
  for (const section of ['Studio', 'Tables & QR', 'Design']) {
    await expect(page.locator('[data-sidebar="sidebar"]').getByText(section)).toHaveCount(0)
  }
  // One organisation: its name, nothing to switch; and no venue switcher in the footer.
  await expect(page.getByTestId('organization-name')).toHaveText(/Navigation Club/)
  await expect(page.getByTestId('organization-switcher')).toHaveCount(0)
  await expect(page.getByTestId('venue-switcher')).toHaveCount(0)
})

test('open a venue from the sidebar: its screens by module, then switch venue on the same screen', async () => {
  await venueItem(page, 'Boulevard Club').click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
  // On a venue's page the sidebar is the venue's (D154): its name on top, which switches venue,
  // and its screens grouped by module; the heading and the browser tab name the screen.
  await expect(switcher(page)).toContainText('Boulevard Club')
  await expect(page.getByRole('heading', { name: 'Studio', level: 1 })).toBeVisible()
  await expect(page).toHaveTitle(/Studio · Boulevard Club/)
  await expect(page.locator('[data-sidebar="group-label"]')).toHaveText([
    'Menu',
    'Ordering',
    'Reservations',
    'Venue',
    'Organisation',
  ])
  await expect(venueItems(page)).toHaveCount(0)
  await expect(entry(page, 'studio')).toHaveAttribute('aria-current', 'page')
  // No Publishing screen (D97): the Publish button heads every screen instead.
  await expect(page.getByTestId('publish-button')).toBeVisible()

  // Each module has its own Settings (D156); the venue's own are under Venue.
  await page.getByRole('link', { name: 'Venue settings' }).click()
  await expect(page).toHaveURL(/\?tab=settings&section=general$/)
  await expect(page.getByTestId('settings-general')).toBeVisible()
  await expect(entry(page, 'settings-venue')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: 'Venue settings', level: 1 })).toBeVisible()
  await expect(page.getByTestId('publish-button')).toBeVisible()
  await snapshot('cf-09a-venue-desktop.png')

  // The switcher lists the venues by name, the open one lit, each on the same screen.
  await switcher(page).click()
  await expect(venueItems(page)).toHaveText([/Aurora Bar$/, /Boulevard Club$/, /zenith Lounge$/])
  await expect(venueItem(page, 'Boulevard Club')).toHaveAttribute('aria-current', 'page')
  await expect(venueItem(page, 'Aurora Bar')).toHaveAttribute(
    'href',
    /\?tab=settings&section=general$/,
  )
  await venueItem(page, 'Aurora Bar').click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}\?tab=settings&section=general$/)
  await expect(switcher(page)).toContainText('Aurora Bar')
  await expect(entry(page, 'settings-venue')).toHaveAttribute('aria-current', 'page')

  // An old link to the Publishing tab opens the venue's own Settings, where its settings went (D97).
  await page.goto(`${new URL(page.url()).pathname}?tab=publishing`)
  await expect(page).toHaveURL(/\?tab=settings&section=(general|publish)$/)
  await expect(entry(page, 'settings-venue')).toHaveAttribute('aria-current', 'page')

  // "All venues", in the switcher, is the overview, with a card for each.
  await switcher(page).click()
  await page.getByTestId('venue-nav-all').click()
  await expect(page).toHaveURL(/\/venues$/)
  await expect(page.getByTestId('venue-card')).toHaveCount(3)
  // From the overview a venue opens on its first screen: there is no screen to carry.
  await expect(venueItem(page, 'Aurora Bar')).toHaveAttribute(
    'href',
    /\/venues\/vn_[0-9A-Za-z]{22}$/,
  )
})

test('Settings opens General; the breadcrumb reads "Settings > General"', async () => {
  await settingsItem(page).click()
  await expect(page).toHaveURL(/\/settings\/general$/)
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'General', level: 2 })).toBeVisible()
  // The organisation's name and address name, each in a field (the owner edits).
  await expect(page.getByTestId('organization-general')).toBeVisible()
  await expect(page.getByTestId('general-name-input')).toHaveValue('Navigation Club')
  await expect(page.getByTestId('general-slug-input')).toHaveValue('navigation-club')
  await expect(page.getByTestId('general-slug-preview')).toHaveText('/m/navigation-club/your-venue')
  // The sub-navigation lights its section, with General first; the sidebar lights Settings and
  // no venue.
  await expect(page.getByTestId('settings-nav').getByRole('link')).toHaveText([
    'General',
    'Integrations',
    'Deleted venues',
  ])
  await expect(page.getByTestId('settings-nav-general')).toHaveAttribute('aria-current', 'page')
  await expect(settingsItem(page)).toHaveAttribute('aria-current', 'page')
  await expect(venueList(page).locator('[aria-current="page"]')).toHaveCount(0)
  // The breadcrumb: Settings (a link to /settings) then General (the page).
  await expect(trail(page).getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/settings',
  )
  await expect(trail(page).getByText('General')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle(/General/)
  await snapshot('cf-09a-settings-desktop.png')

  // /settings itself opens the first section.
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/general$/)

  // Integrations is the next section.
  await page.getByTestId('settings-nav-integrations').click()
  await expect(page).toHaveURL(/\/settings\/integrations$/)
  await expect(page.getByRole('heading', { name: 'Integrations', level: 2 })).toBeVisible()
  // The page holds the connection itself now (CF-09b): no note about a venue's Integration tab.
  await expect(page.getByTestId('integration-panel')).toBeVisible()
  await expect(page.getByTestId('settings-integrations-interim')).toHaveCount(0)
  await expect(page.getByTestId('settings-nav-integrations')).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(trail(page).getByText('Integrations')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle(/Integrations/)

  // And back to a venue from Settings: no screen to carry, the venue's Studio opens.
  await venueItem(page, 'Boulevard Club').click()
  await expect(switcher(page)).toContainText('Boulevard Club')
  await expect(entry(page, 'studio')).toHaveAttribute('aria-current', 'page')
  await expect(settingsItem(page)).not.toHaveAttribute('aria-current', 'page')
})

test('General: the owner renames the organisation; an address name another organisation has is refused', async () => {
  await page.goto('/settings/general')
  const nameInput = page.getByTestId('general-name-input')
  const nameSave = page.getByTestId('general-name-save')
  await expect(nameSave).toBeDisabled()

  // The name: saved, and the sidebar, which shows it, follows without a reload.
  await nameInput.fill('Navigation Club Group')
  await nameSave.click()
  await expect(page.getByText('Name saved.')).toBeVisible()
  await expect(page.getByTestId('organization-name')).toHaveText(/Navigation Club Group/)
  await expect(nameSave).toBeDisabled()
  // Put back, so the other tests (and the next run) find the organisation as it was.
  await nameInput.fill('Navigation Club')
  await nameSave.click()
  await expect(page.getByTestId('organization-name')).not.toHaveText(/Group/)
  await expect(page.getByTestId('organization-name')).toHaveText(/Navigation Club/)

  // The address name: a shape that cannot be one is stopped in the field.
  const slugInput = page.getByTestId('general-slug-input')
  const slugSave = page.getByTestId('general-slug-save')
  await slugInput.fill('Not a slug!')
  await expect(page.getByTestId('general-slug-invalid')).toBeVisible()
  await expect(slugSave).toBeDisabled()

  // A name another organisation has (the demo organisation's) is refused by the server.
  await slugInput.fill('demo-club')
  await expect(page.getByTestId('general-slug-preview')).toHaveText('/m/demo-club/your-venue')
  await slugSave.click()
  await expect(page.getByTestId('general-slug-error')).toHaveText(
    'Another organisation has this address name, or had it before. Choose another one.',
  )
  await snapshot('s3-general-desktop.png')
  // Nothing was changed.
  await page.reload()
  await expect(page.getByTestId('general-slug-input')).toHaveValue('navigation-club')
})

test('collapsed to icons, each venue shows its initial and, hovered, its name', async () => {
  await page.locator('[data-sidebar="trigger"]').click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed')
  // The initial of each venue is in view; the names are clipped away by the narrow button.
  const marks = venueItems(page).locator('span[aria-hidden="true"]')
  await expect(marks).toHaveText(['A', 'B', 'Z'])
  for (const mark of await marks.all()) await expect(mark).toBeVisible()

  await venueItem(page, 'Aurora Bar').hover()
  await expect(page.getByRole('tooltip')).toHaveText('Aurora Bar')
  if (process.env.SCREENSHOT_DIR) await page.waitForTimeout(400) // the tooltip fades in
  await snapshot('cf-09a-collapsed-desktop.png')

  // Keyboard focus shows the tooltip too. (Radix ignores a second hover that comes straight after
  // the first from far away, and the test's mouse jumps; the first tooltip may still be fading
  // out, so look for the one that names Settings.)
  await settingsItem(page).focus()
  await expect(page.getByRole('tooltip').filter({ hasText: 'Settings' })).toHaveText('Settings')

  // Open again for the tests that follow (the sidebar keeps its state in a cookie).
  await page.locator('[data-sidebar="trigger"]').click()
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'expanded')
})

test('New venue from the sidebar: the new venue opens and is in the list at once', async () => {
  await newVenueItem(page).click()
  const dialog = page.getByTestId('new-venue-dialog')
  await expect(dialog).toBeVisible()
  // Step 1 (D85): where the menu comes from; this organisation has no POS, so by hand.
  await dialog.getByTestId('new-venue-source-hand').click()
  await dialog.getByTestId('new-venue-next').click()
  await dialog.getByTestId('new-venue-name').fill(CREATED_VENUE)
  await dialog.getByTestId('new-venue-submit').click()

  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
  await expect(switcher(page)).toContainText(CREATED_VENUE)
  // In the switcher's list without a reload, in its place by name, and lit.
  await switcher(page).click()
  await expect(venueItems(page)).toHaveText([
    /Aurora Bar$/,
    /Boulevard Club$/,
    /Cabana Beach$/,
    /zenith Lounge$/,
  ])
  await expect(venueItem(page, CREATED_VENUE)).toHaveAttribute('aria-current', 'page')
})

test('a venue made with the button on the overview is in the sidebar too', async () => {
  // The switcher's list is still open from the test before.
  await page.getByTestId('venue-nav-all').click()
  await expect(page).toHaveURL(/\/venues$/)
  await page.getByTestId('new-venue').click()
  const dialog = page.getByTestId('new-venue-dialog')
  await dialog.getByTestId('new-venue-source-hand').click()
  await dialog.getByTestId('new-venue-next').click()
  await dialog.getByTestId('new-venue-name').fill(SECOND_CREATED_VENUE)
  await dialog.getByTestId('new-venue-submit').click()

  await expect(switcher(page)).toContainText(SECOND_CREATED_VENUE)
  await switcher(page).click()
  await expect(venueItems(page)).toHaveText([
    /Aurora Bar$/,
    /Boulevard Club$/,
    /Cabana Beach$/,
    /Delta Rooms$/,
    /zenith Lounge$/,
  ])
  await expect(venueItem(page, SECOND_CREATED_VENUE)).toHaveAttribute('aria-current', 'page')
  await page.keyboard.press('Escape')
})

test('a plain member sees the venues and Settings, but is not offered New venue', async ({
  browser,
}) => {
  const { context, target } = await otherPerson(browser, MEMBER_EMAIL, {
    width: 1280,
    height: 900,
  })
  try {
    await expect(venueItems(target)).toHaveCount(5)
    await expect(target.getByTestId('venue-nav-all')).toBeVisible()
    await expect(newVenueItem(target)).toHaveCount(0)
    await expect(target.getByRole('button', { name: 'New venue' })).toHaveCount(0)

    // Everyone in the organisation may open Settings. It opens General, where a member sees the
    // values as text: only an owner changes them.
    await settingsItem(target).click()
    await expect(target).toHaveURL(/\/settings\/general$/)
    await expect(target.getByRole('heading', { name: 'General', level: 2 })).toBeVisible()
    await expect(target.getByTestId('general-name-text')).toHaveText('Navigation Club')
    await expect(target.getByTestId('general-slug-text')).toHaveText('navigation-club')
    await expect(target.getByTestId('general-name-input')).toHaveCount(0)
    await expect(target.getByTestId('general-slug-input')).toHaveCount(0)
    await expect(target.getByTestId('general-name-save')).toHaveCount(0)
    await expect(target.getByTestId('general-slug-save')).toHaveCount(0)
    // Integrations is one click away, and Deleted venues is not offered.
    await expect(target.getByTestId('settings-nav-deleted-venues')).toHaveCount(0)
    await target.getByTestId('settings-nav-integrations').click()
    await expect(target).toHaveURL(/\/settings\/integrations$/)
    await expect(target.getByRole('heading', { name: 'Integrations', level: 2 })).toBeVisible()
  } finally {
    await context.close()
  }
})

test('on a phone the sidebar is a sheet that closes once a venue or a screen is chosen', async ({
  browser,
}) => {
  const { context, target } = await otherPerson(browser, OWNER_EMAIL, { width: 390, height: 844 })
  try {
    const sheet = target.locator('[data-mobile="true"]')
    await expect(sheet).toHaveCount(0)
    await target.locator('[data-sidebar="trigger"]').click()
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('venue-nav-item')).toHaveCount(5)
    if (process.env.SCREENSHOT_DIR) await target.waitForTimeout(500) // the sheet slides in
    await snapshot('cf-09a-phone-sheet.png', target)

    await sheet.getByTestId('venue-nav-item').filter({ hasText: 'Aurora Bar' }).click()
    await expect(target).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
    await expect(target.getByRole('heading', { name: 'Studio', level: 1 })).toBeVisible()
    await expect(sheet).toHaveCount(0)

    // On the venue's page the sheet holds its screens; one tap opens the screen and closes it (C5).
    await target.locator('[data-sidebar="trigger"]').click()
    await expect(sheet.getByTestId('venue-switcher')).toContainText('Aurora Bar')
    if (process.env.SCREENSHOT_DIR) await target.waitForTimeout(500) // the sheet slides in
    await snapshot('d154-phone-venue-sheet.png', target)
    await sheet.locator('[data-nav="tonight"]').click()
    await expect(target).toHaveURL(/\?tab=tonight$/)
    await expect(target.getByRole('heading', { name: 'Tonight', level: 1 })).toBeVisible()
    await expect(sheet).toHaveCount(0)
  } finally {
    await context.close()
  }
})
