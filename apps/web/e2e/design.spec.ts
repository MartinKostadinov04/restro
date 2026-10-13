import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { addressOfVenue } from './menu-path'
import { ADMIN_PASSWORD } from './support'

// The Design tab on a production build, with the REAL worker running beside it (briefs SH-05a and
// S7). The venue is the fixture of scripts/seed-design-e2e.ts: three drinks, no look, no template,
// nothing published. In English unless a step says otherwise. Since brief S6 (D92) it is the
// composer's Design subtab; since brief S7 it is brand-first: a collapsed template chooser, then
// the cards (logo and header name, guest features, font and screen, colours) beside a sticky phone
// preview. Steps:
//
//   Design is the composer's subtab, and Settings no longer holds the Appearance card
//   the template chooser is one line and opens a phone pop-up; the cards come in order; the phone
//     preview draws the open menu, stays in view while the form scrolls, and the admin page keeps
//     its scrollbar
//   a brand colour fills the page and the panels -> the preview shows them at once -> Save is on
//   the font is a dropdown, each name in its own font
//   an Advanced override that does not read turns Save off and names the pair (screenshot)
//   the header name saves apart from Save look
//   the menu layout is chosen in Structure (another page) -> it saves by itself
//   Save look -> reload -> the look is still the brand colour
//   Publish -> the guest page carries the page colour, the font and the chosen layout
//   the same tab at phone width (screenshot), and in Bulgarian
//
// The screenshots go to `E2E_SHOTS_DIR`, else to `.local/screenshots/sh/`.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const SHOTS =
  process.env.E2E_SHOTS_DIR ??
  fileURLToPath(new URL('../../../.local/screenshots/sh/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const shotPath = (name: string) => `${SHOTS}/sh-05a-${name}.png`

const OWNER_EMAIL = 'design-owner@demo-club.test'
const SLUG = 'design-club'
const WORKER_WAIT = { timeout: 45_000 }

/** The brand colour the steps type, and the page and panels it fills in (brand-first, D93). */
const BRAND = '#2563eb'
const BRAND_PAGE = '#e8eefd'
const BRAND_PAGE_RGB = 'rgb(232, 238, 253)'
const BRAND_PANELS = '#ffffff'

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

const designUrl = () => `/venues/${venueId}?tab=composer&sub=design`
const panel = () => page.getByTestId('design-panel')
const save = () => page.getByRole('button', { name: 'Save look' })
const toast = () => page.locator('[data-sonner-toast]')
const brandBox = (target: Page = page) => target.getByLabel('Your brand colour', { exact: true })
const pageBox = (target: Page = page) => target.getByLabel('Page', { exact: true })
const panelsBox = (target: Page = page) => target.getByLabel('Panels', { exact: true })
/** The template's root inside the live preview's phone frame (not the template pop-up's). */
const previewRoot = (target: Page = page) =>
  target
    .getByTestId('design-preview')
    .getByTestId('phone-frame')
    .locator('[data-face="editorial-market"]:not([data-testid])')

async function openDesign(target: Page = page) {
  await target.goto(designUrl())
  await expect(target.getByTestId('design-panel')).toBeVisible()
  await expect(previewRoot(target)).toBeVisible()
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

test('Design is the composer’s subtab, and Settings no longer holds the Appearance card', async () => {
  await page.goto(`/venues/${venueId}`)
  // No Publishing tab (D97): the Publish button heads every tab. No Design tab (D92): it is the
  // composer's second subtab.
  await expect(page.getByRole('tablist').first().getByRole('tab')).toHaveText([
    'Composer',
    'Tables & QR',
    'Settings',
  ])
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page).toHaveURL(/[?&]sub=design/)
  await expect(panel()).toBeVisible()
  // An old link to the Design tab lands on the subtab.
  await page.goto(`/venues/${venueId}?tab=design`)
  await expect(page).toHaveURL(/[?&]tab=composer&sub=design/)
  await expect(panel()).toBeVisible()

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByText('Europe/Sofia')).toBeVisible()
  await expect(page.getByTestId('appearance-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCount(0)
})

test('the template chooser is one line until opened, and each template has a phone pop-up', async () => {
  await openDesign()
  // One line: "Template: <name>" and "Change", no gallery.
  await expect(page.getByTestId('design-template-current')).toHaveText('Template: Editorial Market')
  await expect(page.getByTestId('design-gallery')).toHaveCount(0)
  await page.getByRole('button', { name: 'Change' }).click()

  // The gallery reads as a gallery: a card with a picture, a name, a description and "In use".
  const card = page.getByTestId('template-editorial-market')
  await expect(card.getByRole('heading', { name: 'Editorial Market' })).toBeVisible()
  await expect(card.getByTestId('template-in-use')).toBeVisible()
  await expect(card.getByRole('img')).toHaveAttribute('src', '/faces/editorial-market.png')

  // "Preview": the venue's menu in that template, in a phone, no table.
  await card.getByRole('button', { name: 'Preview the template Editorial Market' }).click()
  const dialog = page.getByTestId('template-preview-dialog')
  await expect(dialog.getByText('Preview: Editorial Market')).toBeVisible()
  await expect(
    dialog
      .getByTestId('phone-frame')
      .locator('[data-face="editorial-market"]:not([data-testid])')
      .getByText('Negroni'),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByTestId('design-gallery')).toHaveCount(0)
})

test('the cards come in order, and the preview draws the open menu and keeps its place', async () => {
  await openDesign()
  // The draft menu is in the phone frame.
  await expect(page.getByTestId('design-preview').getByText('Negroni')).toBeVisible()
  await expect(page.getByTestId('design-preview-menu')).toHaveText('Menu: Design Club Sofia')

  // The chooser, then the cards in Martin's order (D92), one under the other.
  const order = [
    'design-templates',
    'design-logo-section',
    'guest-features-panel',
    'design-style-section',
    'design-colours-section',
  ]
  let lastBottom = -1
  for (const id of order) {
    const box = await page.getByTestId(id).boundingBox()
    expect(box, id).not.toBeNull()
    expect(box?.y ?? 0, `${id} is below the card before it`).toBeGreaterThanOrEqual(lastBottom - 1)
    lastBottom = (box?.y ?? 0) + (box?.height ?? 0)
  }
  // Advanced is collapsed: the computed colours are not on the page until it is opened.
  await expect(page.getByTestId('design-roles')).toHaveCount(0)

  // The face used to style the page around it (no sideways scroll, no scrollbar); templates no
  // longer do (the lead's fix, 937dc75). With the preview open the admin page scrolls as usual.
  const rules = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement)
    const scroller = document.scrollingElement as HTMLElement
    window.scrollTo(0, 300)
    return {
      overflowX: html.overflowX,
      scrollbarWidth: html.scrollbarWidth,
      scrollable: scroller.scrollHeight > scroller.clientHeight,
      scrolled: window.scrollY,
    }
  })
  expect(rules.overflowX).not.toBe('hidden')
  expect(rules.scrollbarWidth).not.toBe('none')
  expect(rules.scrollable).toBe(true)
  expect(rules.scrolled).toBeGreaterThan(0)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: shotPath('desktop-light'), fullPage: false })

  // The preview is beside the form at all times (sticky): far down the form it is still in view,
  // at the top of the window and inside it.
  await page.evaluate(() => window.scrollTo(0, 1200))
  const aside = await page.getByTestId('design-preview-aside').boundingBox()
  const view = page.viewportSize()
  expect(aside).not.toBeNull()
  expect(aside?.y ?? 99).toBeGreaterThanOrEqual(0)
  expect(aside?.y ?? 99).toBeLessThan(40)
  expect((aside?.y ?? 0) + (aside?.height ?? 0)).toBeLessThanOrEqual(view?.height ?? 0)
  await expect(page.getByTestId('design-preview').getByTestId('phone-frame')).toBeInViewport()
  await page.screenshot({ path: shotPath('desktop-sticky-preview'), fullPage: false })
  await page.evaluate(() => window.scrollTo(0, 0))
})

test('a brand colour fills the page and the panels, and the preview shows them at once', async () => {
  await expect(save()).toBeDisabled()
  // No presets, no swatches, no starting point: one set of three pickers.
  await expect(page.getByRole('button', { name: 'Midnight' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Custom' })).toHaveCount(0)
  await expect(page.getByTestId('design-three-colours').locator('[data-colour]')).toHaveCount(3)

  await brandBox().fill(BRAND)
  await expect(pageBox()).toHaveValue(BRAND_PAGE)
  await expect(panelsBox()).toHaveValue(BRAND_PANELS)
  await expect(previewRoot()).toHaveCSS('--rm-l-background', BRAND_PAGE)
  await expect(previewRoot()).toHaveCSS('--rm-l-accent', BRAND)
  await expect(save()).toBeEnabled()
  await expect(page.getByTestId('design-saturation-warning')).toHaveCount(0)

  // A page the person sets stays theirs; a strongly saturated one is warned about.
  await pageBox().fill('#ffcc00')
  await expect(page.getByTestId('design-saturation-warning')).toBeVisible()
  await brandBox().fill('#16a34a')
  await expect(pageBox()).toHaveValue('#ffcc00')
  await page.getByRole('button', { name: 'Use tints of my brand colour again' }).click()
  await expect(page.getByTestId('design-saturation-warning')).toHaveCount(0)
  await brandBox().fill(BRAND)
  await expect(pageBox()).toHaveValue(BRAND_PAGE)
})

test('the font is a dropdown, each name in its own font, and the preview follows', async () => {
  await expect(page.getByTestId('design-font-select')).toHaveText('Inter')
  await page.getByRole('combobox', { name: 'Font' }).click()
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
  await options.nth(4).click()
  await expect(page.getByTestId('design-font-select')).toHaveText('Lora')
  await expect(previewRoot()).toHaveCSS('--rm-font', /Lora/)
})

test('an Advanced override that does not read turns Save off and names the pair', async () => {
  await page.getByRole('button', { name: 'Advanced' }).click()
  const text = page.getByTestId('role-light-text')
  await text.getByRole('button', { name: 'Adjust Text, Light screen' }).click()
  await text.getByLabel('Colour code for Text, Light screen').fill(BRAND_PAGE)
  await expect(text).toHaveAttribute('data-failing', 'true')
  await expect(save()).toBeDisabled()
  const alert = page.getByTestId('design-unreadable')
  await expect(alert).toContainText('Light screen: Text on Page')
  await expect(alert).toContainText('needs 4.5:1')
  await expect(page.getByTestId('design-status')).toContainText('hard to read')
  await text.scrollIntoViewIfNeeded()
  await page.screenshot({ path: shotPath('desktop-failing-override') })

  await text
    .getByRole('button', { name: 'Reset Text, Light screen, to the derived colour' })
    .click()
  await expect(alert).toHaveCount(0)
  await expect(save()).toBeEnabled()
  // The ten roles of D93 are listed with their contrast; none can be adjusted by hand yet.
  await expect(page.getByTestId('design-more-roles').getByTestId('design-role-focus')).toBeVisible()
  await expect(
    page.getByTestId('design-more-roles').getByRole('button', { name: /^Adjust/ }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Advanced' }).click()
  await expect(page.getByTestId('design-roles')).toHaveCount(0)
})

test('the header name saves apart from Save look', async () => {
  const name = page.getByLabel('Name at the top of the menu')
  await expect(name).toHaveValue('')
  await expect(name).toHaveAttribute('placeholder', 'Design Club Sofia')
  await name.fill('Main bar')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(toast().first()).toContainText('Name saved')
  await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled()
  // The look is not saved by it: Save look still waits for the colours of the steps above.
  await expect(save()).toBeEnabled()

  // It is the menu's name: another page of the same person finds it.
  const other = await owner.newPage()
  try {
    await other.goto(designUrl())
    await expect(other.getByLabel('Name at the top of the menu')).toHaveValue('Main bar')
    await expect(other.getByTestId('design-preview-menu')).toHaveText('Menu: Main bar')
    // Back to the venue's name, so the fixture is as it was.
    await other.getByLabel('Name at the top of the menu').fill('')
    await other.getByRole('button', { name: 'Save name' }).click()
    await expect(other.locator('[data-sonner-toast]').first()).toContainText('Name saved')
  } finally {
    await other.close()
  }
})

test('the menu layout is chosen in the composer’s Structure, and saves by itself (D92)', async () => {
  // Another page of the same person: this one keeps the unsaved look of the steps above.
  const structure = await owner.newPage()
  try {
    await structure.goto(`/venues/${venueId}?tab=composer&sub=structure`)
    const layout = structure.getByTestId('menu-layout')
    await layout.getByRole('button', { name: 'One column' }).click()
    await expect(structure.locator('[data-sonner-toast]').first()).toContainText(
      'Saved. Guests see it after the next publish',
    )
    await expect(layout.getByRole('button', { name: 'One column' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // The Design tab draws no layout option: the template declares none.
    await expect(page.getByTestId('design-look-options')).toHaveCount(0)
  } finally {
    await structure.close()
  }
})

test('Save look keeps the whole look: it is still the brand colour after a reload', async () => {
  await save().click()
  await expect(toast().first()).toContainText('Saved. Guests see it after the next publish.')
  await expect(page.getByTestId('design-status')).toContainText('Saved.')
  await expect(save()).toBeDisabled()
  await page.reload()
  await expect(previewRoot()).toBeVisible()
  await expect(brandBox()).toHaveValue(BRAND)
  await expect(pageBox()).toHaveValue(BRAND_PAGE)
  await expect(panelsBox()).toHaveValue(BRAND_PANELS)
  await expect(page.getByTestId('design-font-select')).toHaveText('Lora')
  // The draft carries the menu layout chosen in Structure (D92).
  await expect(previewRoot()).toHaveAttribute('data-layout', 'one')
  await expect(save()).toBeDisabled()
})

test('after Publish the guest page carries the page colour, the font and the chosen layout', async ({
  browser,
}) => {
  // The Publish button heads every tab (D96); it asks first.
  await page.goto(`/venues/${venueId}?tab=design`)
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
    await expect(root).toHaveAttribute('data-layout', 'one')
    await expect(root).toHaveAttribute('data-scheme', 'auto')
  } finally {
    await guestContext.close()
  }
})

test('at phone width the tab stacks, with the preview below the form and no sideways scroll', async ({
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
    const form = await target.getByTestId('design-colours-section').boundingBox()
    const preview = await target.getByTestId('design-preview').boundingBox()
    expect(form).not.toBeNull()
    expect(preview).not.toBeNull()
    expect((preview?.y ?? 0) > (form?.y ?? 0) + (form?.height ?? 0)).toBe(true)
    // Narrow: the dark screen's colour sits under the light one's.
    await target.getByRole('button', { name: 'Advanced' }).click()
    const light = await target.getByTestId('role-light-text').boundingBox()
    const dark = await target.getByTestId('role-dark-text').boundingBox()
    expect((dark?.y ?? 0) >= (light?.y ?? 0) + (light?.height ?? 0)).toBe(true)
    const open = await target.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }))
    expect(open.page).toBeLessThanOrEqual(open.view)
    // The whole page (very tall: the form, then the preview), and the screen a person sees on
    // the colours.
    await target.screenshot({ path: shotPath('phone-full-page'), fullPage: true })
    await target.getByTestId('design-role-text').scrollIntoViewIfNeeded()
    await target.screenshot({ path: shotPath('phone') })
  } finally {
    await phone.close()
  }
})

test('in Bulgarian', async ({ browser }) => {
  const bulgarian = await browser.newContext({
    storageState: ownerState,
    viewport: { width: 1280, height: 1000 },
  })
  try {
    await bulgarian.addCookies([
      { name: 'NEXT_LOCALE', value: 'bg', url: new URL(page.url()).origin },
    ])
    const target = await bulgarian.newPage()
    await target.goto(designUrl())
    await expect(target.getByRole('tab', { name: 'Дизайн' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(target.getByTestId('design-template-current')).toHaveText(
      'Шаблон: Редакционен пазар',
    )
    await expect(target.getByRole('button', { name: 'Смени' })).toBeVisible()
    await expect(target.getByRole('heading', { name: 'Цветове', exact: true })).toBeVisible()
    await expect(target.getByRole('heading', { name: 'Лого и име', exact: true })).toBeVisible()
    await expect(target.getByLabel('Цветът на вашата марка', { exact: true })).toHaveValue(BRAND)
    await expect(target.getByLabel('Име най-горе в менюто')).toBeVisible()
    await expect(target.getByRole('button', { name: 'Запази външния вид' })).toBeDisabled()
    await target.getByRole('button', { name: 'Разширени' }).click()
    await expect(target.getByTestId('design-roles')).toContainText('Текст върху акцента')
    await target.screenshot({ path: shotPath('desktop-bulgarian') })
  } finally {
    await bulgarian.close()
  }
})
