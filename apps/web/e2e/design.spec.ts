import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { type BrowserContext, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { addressOfVenue } from './menu-path'
import { ADMIN_PASSWORD } from './support'

// The Design tab on a production build, with the REAL worker running beside it (brief SH-05a). The
// venue is the fixture of scripts/seed-design-e2e.ts: three drinks, no look, no template, nothing
// published. In English unless a step says otherwise. Steps:
//
//   the tab sits after Publishing, and Settings no longer holds the Appearance card
//   the phone preview draws the template from the draft, and the admin page keeps its scrollbar
//   Midnight is chosen -> the preview shows its colours at once -> Save is on
//   a colour set by hand that does not read -> Save is off, the pair is named (screenshot)
//   the layout option is chosen -> it saves by itself
//   Save look -> reload -> the look is still Midnight
//   Publishing -> Publish -> the guest page carries Midnight's page colour and the chosen layout
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

/** Midnight's page colour in the light set (the designer's value, docs/design/.../presets.json). */
const MIDNIGHT_PAGE = '#f5f1ea'
const MIDNIGHT_PAGE_RGB = 'rgb(245, 241, 234)'

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

const designUrl = () => `/venues/${venueId}?tab=design`
const panel = () => page.getByTestId('design-panel')
const save = () => page.getByRole('button', { name: 'Save look' })
const toast = () => page.locator('[data-sonner-toast]')
/** The template's root inside the preview's phone frame. */
const previewRoot = (target: Page = page) =>
  target.getByTestId('phone-frame').locator('[data-face="editorial-market"]:not([data-testid])')

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

test('the Design tab follows Publishing, and Settings no longer holds the Appearance card', async () => {
  await page.goto(`/venues/${venueId}`)
  await expect(page.getByRole('tab')).toHaveText([
    'Composer',
    'Tables & QR',
    'Publishing',
    'Design',
    'Settings',
  ])
  await page.getByRole('tab', { name: 'Design' }).click()
  await expect(page).toHaveURL(/tab=design/)
  await expect(panel()).toBeVisible()

  await page.getByRole('tab', { name: 'Settings' }).click()
  await expect(page.getByText('Europe/Sofia')).toBeVisible()
  await expect(page.getByTestId('appearance-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCount(0)
})

test('the preview draws the template from the draft, and the admin page keeps its scrollbar', async () => {
  await openDesign()
  // The gallery reads as a gallery: a card with a picture, a name, a description and "In use".
  const card = page.getByTestId('template-editorial-market')
  await expect(card.getByRole('heading', { name: 'Editorial Market' })).toBeVisible()
  await expect(card.getByTestId('template-in-use')).toBeVisible()
  await expect(card.getByRole('img')).toHaveAttribute('src', '/faces/editorial-market.png')
  // The draft menu is in the phone frame.
  await expect(page.getByTestId('phone-frame').getByText('Negroni')).toBeVisible()

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

  // The derived colours: the light and the dark screen side by side, one role per row.
  const light = await page.getByTestId('role-light-text').boundingBox()
  const dark = await page.getByTestId('role-dark-text').boundingBox()
  expect(light).not.toBeNull()
  expect(dark).not.toBeNull()
  expect(Math.abs((light?.y ?? 0) - (dark?.y ?? 99))).toBeLessThan(2)
  expect(dark?.x ?? 0).toBeGreaterThanOrEqual((light?.x ?? 0) + (light?.width ?? 0))
  await page.screenshot({ path: shotPath('desktop-light'), fullPage: false })
})

test('choosing Midnight shows its colours in the preview at once and turns Save on', async () => {
  await expect(save()).toBeDisabled()
  await page.getByRole('button', { name: 'Midnight' }).click()
  await expect(page.getByLabel('Primary', { exact: true })).toHaveValue(MIDNIGHT_PAGE)
  await expect(page.getByLabel('Tertiary', { exact: true })).toHaveValue('#e0a43a')
  // Sixteen roles, the designer's own, each with the contrast of its pairs.
  await expect(
    page
      .getByTestId('design-roles')
      .locator('div[data-testid^="role-light-"], div[data-testid^="role-dark-"]'),
  ).toHaveCount(16)
  await expect(previewRoot()).toHaveCSS('--rm-l-background', MIDNIGHT_PAGE)
  await expect(previewRoot()).toHaveCSS('--rm-d-background', '#0e0d0c')
  await expect(save()).toBeEnabled()
})

test('a colour set by hand that does not read turns Save off and names the pair', async () => {
  const text = page.getByTestId('role-light-text')
  await text.getByRole('button', { name: 'Adjust Text, Light screen' }).click()
  await text.getByLabel('Colour code for Text, Light screen').fill(MIDNIGHT_PAGE)
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
})

test('the template’s layout option saves by itself', async () => {
  await page.getByTestId('design-look-options').getByRole('button', { name: 'One column' }).click()
  await expect(toast()).toContainText('Saved. Guests see it after the next publish.')
  await expect(previewRoot()).toHaveAttribute('data-layout', 'one')
})

test('Save look keeps the whole look: it is still Midnight after a reload', async () => {
  await save().click()
  await expect(toast().first()).toContainText('Saved. Guests see it after the next publish.')
  await expect(page.getByTestId('design-status')).toContainText('Go to Publishing')
  await expect(save()).toBeDisabled()
  await page.reload()
  await expect(previewRoot()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Midnight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('Primary', { exact: true })).toHaveValue(MIDNIGHT_PAGE)
  await expect(
    page.getByTestId('design-look-options').getByRole('button', { name: 'One column' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(save()).toBeDisabled()
})

test('after Publish the guest page carries Midnight’s page colour and the chosen layout', async ({
  browser,
}) => {
  await page.goto(`/venues/${venueId}?tab=publishing`)
  await expect(page.getByTestId('publish-panel')).toBeVisible()
  await page.getByTestId('live-nothing').getByRole('button', { name: 'Publish' }).click()
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
    await expect(root).toHaveCSS('--rm-l-background', MIDNIGHT_PAGE)
    await expect(root).toHaveCSS('background-color', MIDNIGHT_PAGE_RGB)
    await expect(root).toHaveAttribute('data-layout', 'one')
    await expect(root).toHaveAttribute('data-scheme', 'auto')
    // And the corners the preset gave (Midnight: 6 px).
    await expect(root).toHaveCSS('--rm-radius', '6px')
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
    const form = await target.getByTestId('design-templates').boundingBox()
    const preview = await target.getByTestId('design-preview').boundingBox()
    expect(form).not.toBeNull()
    expect(preview).not.toBeNull()
    expect((preview?.y ?? 0) > (form?.y ?? 0) + (form?.height ?? 0)).toBe(true)
    // Narrow: the dark screen's colour sits under the light one's.
    const light = await target.getByTestId('role-light-text').boundingBox()
    const dark = await target.getByTestId('role-dark-text').boundingBox()
    expect((dark?.y ?? 0) >= (light?.y ?? 0) + (light?.height ?? 0)).toBe(true)
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
    await expect(target.getByRole('heading', { name: 'Шаблон', exact: true })).toBeVisible()
    await expect(target.getByTestId('template-in-use')).toHaveText('Използва се')
    await expect(target.getByRole('heading', { name: 'Цветове', exact: true })).toBeVisible()
    await expect(target.getByRole('button', { name: 'Полунощ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(target.getByRole('button', { name: 'Запази външния вид' })).toBeDisabled()
    await expect(target.getByTestId('design-roles')).toContainText('Текст върху акцента')
    await target.screenshot({ path: shotPath('desktop-bulgarian') })
  } finally {
    await bulgarian.close()
  }
})
