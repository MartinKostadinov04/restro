import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import { addressOfVenue } from './menu-path'
import { ADMIN_PASSWORD } from './support'

// The Studio's Design page in Simple (D129, #175) on a production build, with the REAL worker running
// beside it. The venue is the fixture of scripts/seed-design-e2e.ts: three drinks, no design, nothing
// published. In English unless a step says otherwise. Steps:
//
//   the Studio's Design subtab opens a page of its own; Settings holds no Appearance card
//   the panel and the preview, with the phone, tablet and PC widths drawn in a frame of that width
//   the Style tiles draw the menu; a Style fills every option, and keeps the colours and body font
//   a colour shows in the preview at once; Undo takes the last step back
//   the fonts are dropdowns, each name in its font, and the preview follows
//   an Advanced role that does not read turns Done off and names the pair (screenshot)
//   Cancel throws away everything since the last save
//   leaving with unsaved edits asks first
//   Done appends one event and survives a reload
//   a save from a page that loaded before another save is refused, says so and shows the stored one
//   the layout for all menus is part of the draft
//   Publish -> the guest page carries the design
//   a member sees it read-only, with no Done and no Cancel
//   at phone width the preview sits under the panel, Done and Cancel in reach (screenshot)
//   My styles (#177): the draft saved under a name, Update, Delete with Undo
//   My styles at the other venue: its Styles, a name twice, this venue's design as a tile
//   in Bulgarian
//
// The screenshots go to `E2E_SHOTS_DIR`, else to `.local/screenshots/sh/`.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const SHOTS =
  process.env.E2E_SHOTS_DIR ??
  fileURLToPath(new URL('../../../.local/screenshots/sh/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shotPath = (name: string) => `${SHOTS}/design-${name}.png`

const OWNER_EMAIL = 'design-owner@demo-club.test'
const MEMBER_EMAIL = 'design-member@demo-club.test'
const SLUG = 'design-club'
const WORKER_WAIT = { timeout: 45_000 }

/** The brand colour the steps type, and the calm tints of it that fill the page and panels (D93). */
const BRAND = '#2563eb'
const BRAND_PAGE = '#ebf2ff'
const BRAND_PAGE_RGB = 'rgb(235, 242, 255)'
const BRAND_PANELS = '#d5e2f9'
const OTHER_BRAND = '#16a34a'

let owner: BrowserContext
let page: Page
let venueId = ''
let guestPath = ''
let ownerState: Awaited<ReturnType<BrowserContext['storageState']>>

async function signIn(target: Page, email: string) {
  // Better Auth allows a few sign-ins per 10 seconds, and the other specs signed in just before.
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

const designUrl = () => `/venues/${venueId}/design`
const done = (target: Page = page) => target.getByTestId('design-done')
const cancel = (target: Page = page) => target.getByTestId('design-cancel')
const undo = (target: Page = page) => target.getByTestId('design-undo')
const unsaved = (target: Page = page) => target.getByTestId('design-unsaved')
const toast = (target: Page = page) => target.locator('[data-sonner-toast]')
const brandBox = (target: Page = page) => target.getByLabel('Your brand colour', { exact: true })
const pageBox = (target: Page = page) => target.getByLabel('Page', { exact: true })
const panelsBox = (target: Page = page) => target.getByLabel('Panels', { exact: true })
const tile = (id: string, target: Page = page) =>
  target.locator(`[data-testid="design-style-tile"][data-style="${id}"]`)
/** A tile of My styles (D129): one of the organisation's saved Styles, or another venue's design. */
const myTile = (label: string, target: Page = page) =>
  target.getByTestId('design-my-style-tile').filter({ hasText: label })
/** The "…" menu of a saved Style's tile, which sits beside the tile, not inside its label. */
const myMenu = (label: string, target: Page = page) =>
  myTile(label, target).locator('..').getByTestId('design-my-style-menu')
/** One toast by its words: the My styles walk makes several, and an older one may still stand. */
const toastSaying = (words: string, target: Page = page) =>
  toast(target).filter({ hasText: words }).first()
const frame = (target: Page = page) => target.frameLocator('[data-testid="design-preview-frame"]')
/** The template's root inside the live preview's frame. */
const previewRoot = (target: Page = page) =>
  frame(target).locator('[data-face="editorial-market"]:not([data-testid])')

async function openDesign(target: Page = page) {
  await target.goto(designUrl())
  await expect(target.getByTestId('design-panel')).toBeVisible()
  await expect(previewRoot(target)).toBeVisible()
}

/** How many times the design was saved, from the events (append-only, rule 2). */
async function designEvents(): Promise<number> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } = await pool.query<{ count: string }>(
      `select count(*) from restro.events where scope = $1 and field_key = 'design'`,
      [`venue:${venueId}`],
    )
    return Number(rows[0]?.count ?? 0)
  } finally {
    await pool.end()
  }
}

test.beforeAll(async ({ browser }) => {
  runScript('./scripts/seed-design-e2e.ts', 'seed')
  owner = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  page = await owner.newPage()
  await signIn(page, OWNER_EMAIL)
  await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(venueId).not.toBe('')
  const address = await addressOfVenue({ venueId })
  expect(address.slug).toBe(SLUG)
  guestPath = address.path
  // English from here on (the sign-in page was in Bulgarian, the default).
  await owner.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: new URL(page.url()).origin }])
  ownerState = await owner.storageState()
})

test.afterAll(async () => {
  await owner?.close()
})

test('the Studio’s Design subtab opens a page of its own; Settings holds no Appearance card', async () => {
  await page.goto(`/venues/${venueId}`)
  await expect(page.getByRole('tablist').first().getByRole('tab')).toHaveText([
    'Studio',
    'Tables & QR',
    'Tonight',
    'Settings',
  ])
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/design`))
  await expect(page.getByTestId('design-panel')).toBeVisible()
  await page.getByTestId('design-back').click()
  await expect(page).toHaveURL(/[?&]tab=studio/)

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByText('Europe/Sofia')).toBeVisible()
  await expect(page.getByTestId('appearance-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCount(0)
})

test('the panel is beside the preview, drawn in a frame of the width the switcher says', async () => {
  await openDesign()
  await expect(previewRoot().getByText('Negroni')).toBeVisible()
  // Nothing to save yet.
  await expect(done()).toBeDisabled()
  await expect(cancel()).toBeDisabled()
  await expect(undo()).toBeDisabled()
  await expect(unsaved()).toHaveCount(0)

  const panel = await page.getByTestId('design-panel').boundingBox()
  const preview = await page.getByTestId('design-preview').boundingBox()
  expect((preview?.x ?? 0) >= (panel?.x ?? 0) + (panel?.width ?? 0)).toBe(true)
  await page.screenshot({ path: shotPath('desktop') })

  // The frame's own window: the renderer's media queries and fixed sheets read it (RR-87).
  const switcher = page.getByTestId('design-preview')
  const well = page.getByTestId('design-preview-well')
  for (const [name, width] of [
    ['PC', 1280],
    ['Tablet', 820],
    ['Phone', 390],
  ] as const) {
    await switcher.getByRole('button', { name, exact: true }).click()
    await expect
      .poll(() =>
        frame()
          .locator('html')
          .evaluate(() => window.innerWidth),
      )
      .toBe(width)
    // Scaled to fit: the frame stays inside its well.
    const box = await page.getByTestId('design-preview-frame').boundingBox()
    const wellBox = await well.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (wellBox?.x ?? 0) + (wellBox?.width ?? 0) + 1,
    )
    if (name === 'PC') await page.screenshot({ path: shotPath('desktop-pc-width') })
  }
  // A sheet opened in the preview stays in the frame, as on a phone.
  await previewRoot().locator('[data-slot="item.open"]').first().click()
  const sheet = frame().locator('[role="dialog"]').last()
  await expect(sheet).toBeVisible()
  const sheetWidth = await sheet.evaluate((element) => element.getBoundingClientRect().width)
  expect(sheetWidth).toBeLessThanOrEqual(390)
  await page.keyboard.press('Escape')
  await expect(frame().locator('[role="dialog"]')).toHaveCount(0)
})

test('a colour shows in the preview at once, and Undo takes the last step back', async () => {
  // One set of three pickers, no presets.
  await expect(page.getByTestId('design-three-colours').locator('[data-colour]')).toHaveCount(3)
  await brandBox().fill(BRAND)
  await expect(pageBox()).toHaveValue(BRAND_PAGE)
  await expect(panelsBox()).toHaveValue(BRAND_PANELS)
  await expect(previewRoot()).toHaveCSS('--rm-l-background', BRAND_PAGE)
  await expect(previewRoot()).toHaveCSS('--rm-l-accent', BRAND)
  await expect(done()).toBeEnabled()
  await expect(unsaved()).toHaveText('Unsaved')

  // After a pause, a new step.
  await page.waitForTimeout(1000)
  await brandBox().fill(OTHER_BRAND)
  await expect(previewRoot()).toHaveCSS('--rm-l-accent', OTHER_BRAND)
  await undo().click()
  await expect(brandBox()).toHaveValue(BRAND)
  await expect(previewRoot()).toHaveCSS('--rm-l-accent', BRAND)
})

test('a Style tile draws the menu; picking it fills every option and keeps the colours and body font', async () => {
  // A tile per Style with a file: all five of the contract's since #178, in the contract's order.
  const tiles = page.getByTestId('design-style-tile')
  await expect(tiles).toHaveCount(5)
  expect(
    await tiles.evaluateAll((found) => found.map((one) => one.getAttribute('data-style'))),
  ).toEqual(['basic', 'editorial', 'soft', 'classic', 'club'])
  await expect(tile('basic').getByRole('radio')).toBeChecked()
  // The renderer itself, drawing the top of this menu in the draft's colours.
  const specimen = page.frameLocator(
    '[data-style="editorial"] [data-testid="design-style-specimen"]',
  )
  const root = specimen.locator('[data-face="editorial-market"]:not([data-testid])')
  await expect(root.getByText('Negroni')).toBeVisible()
  await expect(root).toHaveAttribute('data-buttons', 'ink')
  await expect(root).toHaveCSS('--rm-l-accent', BRAND)

  await expect(previewRoot()).toHaveAttribute('data-buttons', 'accent')
  await page.getByTestId('design-body-font').click()
  await page.getByRole('option', { name: 'Lora' }).click()
  await expect(page.getByTestId('design-body-font')).toHaveText('Lora')

  await tile('editorial').click()
  await expect(tile('editorial').getByRole('radio')).toBeChecked()
  await expect(previewRoot()).toHaveAttribute('data-buttons', 'ink')
  await expect(previewRoot()).toHaveAttribute('data-header-band', 'ink')
  await expect(previewRoot()).toHaveAttribute('data-layout', 'two')
  await expect(brandBox()).toHaveValue(BRAND)
  await expect(previewRoot()).toHaveCSS('--rm-l-accent', BRAND)
  await expect(page.getByTestId('design-body-font')).toHaveText('Lora')
  await expect(previewRoot()).toHaveCSS('--rm-font', /Lora/)
  // Undo takes the Style back as one step.
  await undo().click()
  await expect(tile('basic').getByRole('radio')).toBeChecked()
  await expect(previewRoot()).toHaveAttribute('data-buttons', 'accent')
  await tile('editorial').click()
  await expect(previewRoot()).toHaveAttribute('data-buttons', 'ink')
})

test('the fonts are dropdowns, each name in its own font', async () => {
  await page.getByTestId('design-body-font').click()
  const options = page.getByRole('option')
  await expect(options).toHaveText([
    'Inter',
    'Manrope',
    'Montserrat',
    'Playfair Display',
    'Lora',
    'Unbounded',
  ])
  await expect(options.nth(4)).toHaveCSS('font-family', /Lora/)
  await page.screenshot({ path: shotPath('desktop-font-dropdown') })
  await page.keyboard.press('Escape')
  await page.getByTestId('design-heading-font').click()
  await expect(options).toHaveCount(7)
  await page.getByRole('option', { name: 'Playfair Display' }).click()
  await expect(page.getByTestId('design-heading-font')).toHaveText('Playfair Display')
  await expect(previewRoot()).toHaveAttribute('data-heading-font', 'playfair-display')
})

test('an Advanced role that does not read turns Done off and names the pair', async () => {
  await page.getByTestId('design-advanced-toggle').click()
  const text = page.getByTestId('role-light-text')
  await text.getByRole('button', { name: 'Adjust Text, Light screen' }).click()
  await text.getByLabel('Colour code for Text, Light screen').fill(BRAND_PAGE)
  await expect(text).toHaveAttribute('data-failing', 'true')
  await expect(done()).toBeDisabled()
  const alert = page.getByTestId('design-unreadable')
  await expect(alert).toContainText('Light screen: Text on Page')
  await expect(alert).toContainText('needs 4.5:1')
  await expect(page.getByTestId('design-status')).toContainText('hard to read')
  await text.scrollIntoViewIfNeeded()
  await page.screenshot({ path: shotPath('desktop-failing-role') })

  await text
    .getByRole('button', { name: 'Reset Text, Light screen, to the derived colour' })
    .click()
  await expect(alert).toHaveCount(0)
  await expect(done()).toBeEnabled()
  await page.getByTestId('design-advanced-toggle').click()
  await expect(page.getByTestId('design-roles')).toHaveCount(0)
})

test('leaving with unsaved edits asks first', async () => {
  await page.getByTestId('design-back').click()
  const dialog = page.getByTestId('design-leave')
  await expect(dialog.getByText('Leave without saving?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep editing' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(new RegExp(`/venues/${venueId}/design`))
  await expect(brandBox()).toHaveValue(BRAND)
})

test('Cancel throws away everything since the page opened, and leaves the saved design', async () => {
  const before = await designEvents()
  await cancel().click()
  await expect(tile('basic').getByRole('radio')).toBeChecked()
  await expect(previewRoot()).toHaveAttribute('data-buttons', 'accent')
  await expect(page.getByTestId('design-body-font')).toHaveText('Inter')
  await expect(previewRoot()).not.toHaveCSS('--rm-l-accent', BRAND)
  await expect(done()).toBeDisabled()
  await expect(undo()).toBeDisabled()
  await expect(unsaved()).toHaveCount(0)
  expect(await designEvents()).toBe(before)
  await page.reload()
  await expect(previewRoot()).toHaveAttribute('data-buttons', 'accent')
})

test('Done appends one event, says when guests see it, and survives a reload', async () => {
  const before = await designEvents()
  await brandBox().fill(BRAND)
  await tile('editorial').click()
  await page.getByTestId('design-body-font').click()
  await page.getByRole('option', { name: 'Lora' }).click()
  await done().click()
  await expect(toast().first()).toContainText('Design saved. Guests see it on the next publish.')
  await expect(done()).toBeDisabled()
  await expect(unsaved()).toHaveCount(0)
  expect(await designEvents()).toBe(before + 1)

  // Nothing to undo after a save; Cancel has nothing to throw away.
  await expect(undo()).toBeDisabled()
  await expect(cancel()).toBeDisabled()

  await page.reload()
  await expect(previewRoot()).toBeVisible()
  await expect(brandBox()).toHaveValue(BRAND)
  await expect(pageBox()).toHaveValue(BRAND_PAGE)
  await expect(panelsBox()).toHaveValue(BRAND_PANELS)
  await expect(tile('editorial').getByRole('radio')).toBeChecked()
  await expect(page.getByTestId('design-body-font')).toHaveText('Lora')
  await expect(done()).toBeDisabled()
})

test('a save from a page that loaded before another save is refused, says so and shows the stored one', async ({
  browser,
}) => {
  // Two sessions on the same revision.
  const secondContext = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 1280, height: 1000 },
  })
  try {
    const second = await secondContext.newPage()
    await openDesign(second)
    await openDesign(page)

    // This page changes something and has not saved it.
    await page.getByTestId('design-heading-font').click()
    await page.getByRole('option', { name: 'Montserrat' }).click()
    await expect(unsaved()).toBeVisible()

    // The other one saves first.
    await second.getByTestId('design-heading-font').click()
    await second.getByRole('option', { name: 'Unbounded' }).click()
    await done(second).click()
    await expect(toast(second).first()).toContainText('Design saved.')

    const before = await designEvents()
    await done().click()
    const refused = toast().filter({
      hasText: 'Someone else saved this design. Showing their version.',
    })
    await expect(refused).toBeVisible()
    // The page shows what is stored, with nothing to save.
    await expect(page.getByTestId('design-heading-font')).toHaveText('Unbounded')
    await expect(previewRoot()).toHaveAttribute('data-heading-font', 'unbounded')
    await expect(done()).toBeDisabled()
    await expect(unsaved()).toHaveCount(0)
    expect(await designEvents()).toBe(before)
    // It stays until it is read.
    await page.waitForTimeout(9_000)
    await expect(refused).toBeVisible()

    // And the next save, from the revision it now holds, goes through.
    await page.getByTestId('design-heading-font').click()
    await page.getByRole('option', { name: 'Same as body font' }).click()
    await done().click()
    await expect(toast().filter({ hasText: 'Design saved.' }).first()).toBeVisible()
  } finally {
    await secondContext.close()
  }
})

test('the layout for all menus is part of the draft, and the guest switch with it', async () => {
  await openDesign()
  const layout = page.getByTestId('design-layout')
  await layout.getByRole('button', { name: 'One column' }).click()
  await expect(previewRoot()).toHaveAttribute('data-layout', 'one')
  const guestSwitch = page.getByTestId('design-layout-switch')
  await guestSwitch.click()
  await expect(guestSwitch).toHaveAttribute('aria-checked', 'false')
  await done().click()
  await expect(toast().filter({ hasText: 'Design saved.' }).first()).toBeVisible()
  await page.reload()
  await expect(layout.getByRole('button', { name: 'One column' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(guestSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(previewRoot()).toHaveAttribute('data-layout', 'one')
})

const levelSwitch = (target: Page = page) => target.getByRole('group', { name: 'Level of detail' })
const pageChip = (id: string, target: Page = page) => target.getByTestId(`design-page-${id}`)
/** The tile of one value of one option on one page of Advanced. */
const optionTile = (pageId: string, option: string, value: string, target: Page = page) =>
  target.locator(
    `[data-testid="design-option"][data-page="${pageId}"][data-option="${option}"] [data-testid="design-tile"][data-value="${value}"]`,
  )

test('Advanced lists General and the thirteen pages; a tile draws the part with its value and one tap picks it', async () => {
  await openDesign()
  await levelSwitch().getByRole('button', { name: 'Advanced' }).click()
  await expect(page.getByTestId('design-pages').getByRole('button')).toHaveCount(14)
  await expect(pageChip('general')).toHaveAttribute('aria-current', 'page')

  await pageChip('items').click()
  await expect(page.getByTestId('design-advanced-title')).toHaveText('Items')
  const cards = optionTile('items', 'frame', 'cards')
  // The tile's picture is the renderer, drawing the part with that value in the draft's colours.
  const picture = cards
    .frameLocator('[data-testid="design-tile-specimen"]')
    .locator('[data-face="editorial-market"]:not([data-testid])')
  await expect(picture).toHaveAttribute('data-items-frame', 'cards', WORKER_WAIT)
  await expect(picture.locator('[data-design-part="item"]').first()).toBeVisible()
  // The frame is scrolled to the part the option styles, not left at the top of the menu.
  await expect
    .poll(() =>
      cards
        .frameLocator('[data-testid="design-tile-specimen"]')
        .locator('html')
        .evaluate(() => window.scrollY),
    )
    .toBeGreaterThan(0)
  await page.screenshot({ path: shotPath('advanced-items') })

  // One tap: the preview follows at once, and it is one Undo step.
  await cards.getByRole('radio').click()
  await expect(previewRoot()).toHaveAttribute('data-items-frame', 'cards')
  await expect(unsaved()).toBeVisible()
  await undo().click()
  await expect(previewRoot()).not.toHaveAttribute('data-items-frame', 'cards')
  await expect(undo()).toBeDisabled()

  // A pick survives the switch to Simple and back.
  await cards.getByRole('radio').click()
  await levelSwitch().getByRole('button', { name: 'Simple' }).click()
  await expect(page.getByTestId('design-style-section')).toBeVisible()
  await expect(previewRoot()).toHaveAttribute('data-items-frame', 'cards')
  await levelSwitch().getByRole('button', { name: 'Advanced' }).click()
  await expect(optionTile('items', 'frame', 'cards').getByRole('radio')).toBeChecked()
  await cancel().click()
  await expect(previewRoot()).not.toHaveAttribute('data-items-frame', 'cards')
})

test('a tap on a part of the preview opens its page; in Simple it says the part is styled in Advanced', async () => {
  await openDesign()
  // Simple: the note and the switch, nothing else moves.
  await previewRoot().locator('[data-design-part="section.title"]').first().click()
  const note = page.getByTestId('design-styled-in-advanced')
  await expect(note).toContainText('Styled in Advanced')
  await expect(page.getByTestId('design-style-section')).toBeVisible()
  await note.getByRole('button', { name: 'Show Advanced' }).click()
  await expect(pageChip('sections')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('design-advanced-title')).toBeFocused()

  // Advanced: a tap on a part opens the page that owns it, whatever page was open.
  for (const [part, pageId, title] of [
    ['header.title', 'header', 'Header'],
    ['section.title', 'sections', 'Sections'],
  ] as const) {
    await pageChip('general').click()
    await previewRoot().locator(`[data-design-part="${part}"]`).first().click()
    await expect(pageChip(pageId)).toHaveAttribute('aria-current', 'page')
    await expect(page.getByTestId('design-advanced-title')).toHaveText(title)
  }
  // A dish's name opens the dish as it does for a guest, and its page; a tap in the open dish opens
  // the Dish page.
  await pageChip('general').click()
  await previewRoot().locator('[data-design-part="item.name"]').first().click()
  await expect(pageChip('items')).toHaveAttribute('aria-current', 'page')
  await expect(frame().locator('[data-design-part="dish"]').first()).toBeVisible()
  await frame()
    .locator('[data-design-part="dish"]')
    .first()
    .click({ position: { x: 4, y: 4 } })
  await expect(pageChip('dish')).toHaveAttribute('aria-current', 'page')
})

test('Photo corners are off while the Frame is edge to edge, with the hint', async () => {
  await openDesign()
  await levelSwitch().getByRole('button', { name: 'Advanced' }).click()
  await pageChip('photos').click()
  await optionTile('photos', 'frame', 'bleed').getByRole('radio').click()
  const corners = page.locator(
    '[data-testid="design-option"][data-page="photos"][data-option="corners"]',
  )
  await expect(corners.getByTestId('design-option-note')).toHaveText(
    'Edge-to-edge photos have no corners of their own',
  )
  await expect(corners).toHaveAttribute('disabled', '')
  await expect(corners.getByRole('radio').first()).toBeDisabled()
  await optionTile('photos', 'frame', 'inset').getByRole('radio').click()
  await expect(corners).not.toHaveAttribute('disabled', '')
  await expect(corners.getByRole('radio').first()).toBeEnabled()
  if (await cancel().isEnabled()) await cancel().click()
})

test('after Publish the guest page carries the design', async ({ browser }) => {
  // The Publish button heads every tab (D96); it asks first.
  await page.goto(`/venues/${venueId}?tab=studio`)
  await expect(page.locator('[hidden][id*="S:"]')).toHaveCount(0)
  await page.getByTestId('publish-button').click()
  await page.getByTestId('publish-confirm').click()
  await expect(page.getByTestId('publish-outcome-title')).toHaveText(
    'Version 1 is live',
    WORKER_WAIT,
  )

  // A guest on a light phone, with no cache.
  const guestContext = await browser.newContext({ colorScheme: 'light' })
  try {
    const guest = await guestContext.newPage()
    await guest.goto(`${guestPath}?lang=en`)
    const root = guest.locator('[data-face="editorial-market"]:not([data-testid])')
    await expect(root).toBeVisible()
    await expect(root).toHaveCSS('--rm-l-background', BRAND_PAGE)
    await expect(root).toHaveCSS('background-color', BRAND_PAGE_RGB)
    await expect(root).toHaveCSS('--rm-l-accent', BRAND)
    await expect(root).toHaveCSS('--rm-font', /Lora/)
    await expect(root).toHaveAttribute('data-buttons', 'ink')
    await expect(root).toHaveAttribute('data-layout', 'one')
    await expect(root).toHaveAttribute('data-scheme', 'auto')
  } finally {
    await guestContext.close()
  }
})

test('a member whose role forbids it sees the page read-only, with no Done and no Cancel', async ({
  browser,
}) => {
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  try {
    const member = await memberContext.newPage()
    await signIn(member, MEMBER_EMAIL)
    await memberContext.addCookies([
      { name: 'NEXT_LOCALE', value: 'en', url: new URL(member.url()).origin },
    ])
    await openDesign(member)
    await expect(member.getByTestId('design-read-only')).toBeVisible()
    await expect(member.getByTestId('design-bar')).toHaveCount(0)
    await expect(done(member)).toHaveCount(0)
    await expect(cancel(member)).toHaveCount(0)
    await expect(tile('basic', member).getByRole('radio')).toBeDisabled()
    await expect(brandBox(member)).toBeDisabled()
    await expect(member.getByTestId('design-body-font')).toBeDisabled()
    // The saved design is what the preview draws.
    await expect(previewRoot(member)).toHaveCSS('--rm-l-accent', BRAND)
    // Leaving asks nothing: nothing can have changed.
    await member.getByTestId('design-back').click()
    await expect(member).toHaveURL(/[?&]tab=studio/)
  } finally {
    await memberContext.close()
  }
})

test('at phone width the preview sits under the panel, scrolls inside, and Done and Cancel stay in reach', async ({
  browser,
}) => {
  const phone = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  try {
    const target = await phone.newPage()
    await openDesign(target)
    const widths = await target.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }))
    expect(widths.page).toBeLessThanOrEqual(widths.view)
    const form = await target.getByTestId('design-panel').boundingBox()
    const preview = await target.getByTestId('design-preview').boundingBox()
    expect((preview?.y ?? 0) >= (form?.y ?? 0) + (form?.height ?? 0)).toBe(true)
    await target.screenshot({ path: shotPath('phone') })

    // Done and Cancel are on the screen wherever the page is scrolled to.
    await expect(done(target)).toBeInViewport()
    await expect(cancel(target)).toBeInViewport()
    await target.getByTestId('design-preview').scrollIntoViewIfNeeded()
    await expect(done(target)).toBeInViewport()
    await expect(cancel(target)).toBeInViewport()
    await target.screenshot({ path: shotPath('phone-preview') })

    // The frame is a phone's width, scaled to the screen, and scrolls inside itself.
    await expect(
      target
        .frameLocator('[data-testid="design-preview-frame"]')
        .locator('html')
        .evaluate(() => window.innerWidth),
    ).resolves.toBe(390)
    const scrolled = await frame(target)
      .locator('html')
      .evaluate(() => {
        window.scrollTo(0, 200)
        return document.documentElement.scrollHeight >= window.innerHeight
      })
    expect(scrolled).toBe(true)

    // Narrow: the dark screen's colour sits under the light one's.
    await target.getByTestId('design-advanced-toggle').click()
    const light = await target.getByTestId('role-light-text').boundingBox()
    const dark = await target.getByTestId('role-dark-text').boundingBox()
    expect((dark?.y ?? 0) >= (light?.y ?? 0) + (light?.height ?? 0)).toBe(true)
    const open = await target.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }))
    expect(open.page).toBeLessThanOrEqual(open.view)
    await target.screenshot({ path: shotPath('phone-full-page'), fullPage: true })
  } finally {
    await phone.close()
  }
})

test('My styles: the draft saved under a name, Update, Delete with Undo', async () => {
  await openDesign()
  await expect(page.getByRole('heading', { name: 'Restro styles' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'My styles' })).toBeVisible()
  // A venue's own design is not a tile of its own page; the organisation's other venue's is.
  await expect(myTile('In use at Design Club Varna')).toHaveCount(1)
  await expect(myTile('In use at Design Club Sofia')).toHaveCount(0)
  const brand = await brandBox().inputValue()

  // Three taps and the name: Design is open, "Save as a style…", the name, Save.
  await tile('classic').getByRole('radio').click()
  await page.getByTestId('design-save-style').click()
  await page.getByTestId('design-save-style-name').fill('Our classic')
  await page.getByTestId('design-save-style-confirm').click()
  await expect(toastSaying('Style saved')).toBeVisible()
  await expect(myTile('Our classic')).toHaveCount(1)

  // Two taps to update it with the design the panel holds now.
  await tile('soft').getByRole('radio').click()
  await myMenu('Our classic').click()
  await page.getByTestId('design-my-style-update').click()
  await expect(toastSaying('Our classic now holds this design')).toBeVisible()

  // Picking it fills the options in, ticks it instead of the Restro tile, and keeps the colours.
  await page.reload()
  await expect(page.getByTestId('design-panel')).toBeVisible()
  await myTile('Our classic').getByRole('radio').click()
  await expect(unsaved()).toBeVisible()
  await expect(myTile('Our classic').getByRole('radio')).toBeChecked()
  await expect(tile('basic').getByRole('radio')).not.toBeChecked()
  await expect(brandBox()).toHaveValue(brand)
  await done().click()
  await expect(toastSaying('Design saved')).toBeVisible()

  // Two taps to delete it, and Undo in the toast brings it back.
  await myMenu('Our classic').click()
  await page.getByTestId('design-my-style-delete').click()
  await expect(toastSaying('Style deleted')).toBeVisible()
  await expect(myTile('Our classic')).toHaveCount(0)
  await toastSaying('Style deleted').getByRole('button', { name: 'Undo' }).click()
  await expect(myTile('Our classic')).toHaveCount(1)
})

test('My styles at the organisation’s other venue: its Styles, and this venue’s design', async () => {
  await page.goto('/venues')
  await page
    .getByTestId('venue-card')
    .filter({ hasText: 'Design Club Varna' })
    .getByRole('link')
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  const otherVenueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(otherVenueId).not.toBe(venueId)
  await page.goto(`/venues/${otherVenueId}/design`)
  await expect(page.getByTestId('design-panel')).toBeVisible()
  // The organisation's saved Style is here too, and so is the first venue's design.
  await expect(myTile('Our classic')).toHaveCount(1)
  await expect(myTile('In use at Design Club Sofia')).toHaveCount(1)
  await expect(myTile('In use at Design Club Varna')).toHaveCount(0)
  // The same name again, in any case, is refused in words that say what to do, and the box stays.
  const dialog = page.getByTestId('design-save-style-dialog')
  await page.getByTestId('design-save-style').click()
  await expect(dialog).toBeVisible()
  await page.getByTestId('design-save-style-name').fill('our CLASSIC')
  await page.getByTestId('design-save-style-confirm').click()
  await expect(toastSaying('A style with this name exists')).toBeVisible()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  // Copying the other venue's design: one tap, then Done. This venue's own brand is untouched.
  const brand = await brandBox().inputValue()
  await myTile('In use at Design Club Sofia').getByRole('radio').click()
  await expect(unsaved()).toBeVisible()
  await expect(brandBox()).toHaveValue(brand)
  await done().click()
  await expect(toastSaying('Design saved')).toBeVisible()
})

test('in Bulgarian, the long names fit a tile at 390 px', async ({ browser }) => {
  const bulgarian = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    await bulgarian.addCookies([
      { name: 'NEXT_LOCALE', value: 'bg', url: new URL(page.url()).origin },
    ])
    const target = await bulgarian.newPage()
    await openDesign(target)
    await expect(target.getByTestId('design-back')).toHaveText('Към студиото')
    await expect(target.getByRole('heading', { name: 'Стил', exact: true })).toBeVisible()
    await expect(target.getByRole('heading', { name: 'Цветове', exact: true })).toBeVisible()
    await expect(target.getByRole('heading', { name: 'Шрифтове', exact: true })).toBeVisible()
    await expect(target.getByLabel('Цветът на вашата марка', { exact: true })).toHaveValue(BRAND)
    await expect(done(target)).toHaveText('Готово')
    await expect(cancel(target)).toHaveText('Отказ')
    await expect(undo(target)).toHaveText('Отмени')
    await expect(
      target.getByTestId('design-preview').getByRole('button', { name: 'Компютър', exact: true }),
    ).toBeVisible()
    // The label of a tile stays inside the tile.
    for (const item of await target.getByTestId('design-style-tile').all()) {
      const overflow = await item.evaluate((element) => element.scrollWidth > element.clientWidth)
      expect(overflow).toBe(false)
    }
    await target.screenshot({ path: shotPath('phone-bulgarian') })
  } finally {
    await bulgarian.close()
  }
})

test('Advanced at 390 px in Bulgarian: the longest labels fit their tile, targets are 44 px', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const bulgarian = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    await bulgarian.addCookies([
      { name: 'NEXT_LOCALE', value: 'bg', url: new URL(page.url()).origin },
    ])
    const target = await bulgarian.newPage()
    await openDesign(target)
    await target
      .getByRole('group', { name: 'Ниво на детайлност' })
      .getByRole('button', { name: 'Разширено' })
      .click()
    await target.getByTestId('design-page-items').click()
    const portion = target.locator(
      '[data-testid="design-option"][data-page="items"][data-option="portion_place"]',
    )
    await portion.scrollIntoViewIfNeeded()
    await expect(portion.getByText('Място на порцията')).toBeVisible()
    for (const item of await portion.getByTestId('design-tile').all()) {
      const sizes = await item.evaluate((element) => ({
        wide: element.scrollWidth > element.clientWidth,
        height: element.getBoundingClientRect().height,
      }))
      expect(sizes.wide).toBe(false)
      expect(sizes.height).toBeGreaterThanOrEqual(44)
    }
    const sideways = await target.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    )
    expect(sideways).toBe(true)
  } finally {
    await bulgarian.close()
  }
})
