import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, type Page, test } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_BRAND } from './support'

// The Appearance card of the Settings tab on a production build, in Bulgarian: the saved colour,
// the live preview, saving, and the upload of a logo. The card is put back as it found it. With the
// guest page's pictures, the card's screenshot goes to `.local/screenshots/s3/`.
test.describe.configure({ mode: 'serial' })

const SHOTS = fileURLToPath(new URL('../../../.local/screenshots/s3/', import.meta.url))
mkdirSync(SHOTS, { recursive: true })

/** A 1 x 1 PNG: enough for the upload checks (type by magic bytes, size in pixels). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  // Better Auth allows a few sign-ins per 10 seconds, and the other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(ADMIN_EMAIL)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues$/, { timeout: 5_000 })
      break
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  await page.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
  await page.goto(`${page.url()}?tab=settings`)
})

test.afterAll(async () => {
  await page.close()
})

const card = () => page.getByTestId('appearance-card')
const brand = () => page.getByLabel('Основен цвят', { exact: true })
const save = () => page.getByRole('button', { name: 'Запази външния вид' })

test('shows the saved look with a light and a dark preview of readable pairs', async () => {
  await expect(page.getByRole('heading', { name: 'Външен вид' })).toBeVisible()
  await expect(brand()).toHaveValue(GUEST_BRAND)
  await expect(save()).toBeDisabled()
  const schemes = card().getByTestId('appearance-scheme')
  await expect(schemes).toHaveCount(2)
  // Four named pairs on each screen, each with its contrast ratio of at least 4.5.
  const ratios = await schemes.locator('[data-pair] .font-mono').allTextContents()
  expect(ratios).toHaveLength(8)
  for (const ratio of ratios) expect(Number.parseFloat(ratio)).toBeGreaterThanOrEqual(4.5)
  await card().scrollIntoViewIfNeeded()
  await card().screenshot({ path: `${SHOTS}s3-03-appearance-card.png` })
})

test('previews a new colour at once, refuses a bad one, and keeps a saved one', async () => {
  await brand().fill('blue')
  await expect(card().getByRole('alert')).toHaveText('Въведете цвят като #3366cc.')
  await expect(save()).toBeDisabled()

  await card().getByRole('button', { name: '#7c3aed' }).click()
  await expect(brand()).toHaveValue('#7c3aed')
  const accent = card().getByTestId('appearance-scheme').first().getByText('Избрано')
  // The accent is step 500 of the palette: the brand's hue and saturation at 50% lightness.
  await expect(accent).toHaveCSS('background-color', 'rgb(100, 21, 234)')

  await save().click()
  await expect(page.getByText('Външният вид е запазен.')).toBeVisible()
  await page.reload()
  await expect(brand()).toHaveValue('#7c3aed')
})

test('uploads a logo, shows it in the preview and keeps it after saving', async () => {
  await card()
    .getByTestId('appearance-logo-input')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await expect(card().getByTestId('appearance-logo')).toBeVisible()
  await save().click()
  await expect(page.getByText('Външният вид е запазен.')).toBeVisible()
  await page.reload()
  // The saved logo comes back as a signed link to the stored original.
  await expect(card().getByTestId('appearance-logo')).toBeVisible()
  await expect(card().getByTestId('appearance-logo')).toHaveAttribute(
    'src',
    /\/api\/assets\/file\//,
  )
})

test('refuses a file that is not a picture before sending it', async () => {
  await card()
    .getByTestId('appearance-logo-input')
    .setInputFiles({ name: 'logo.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
  await expect(card().getByTestId('appearance-error')).toBeVisible()
})

test('puts the card back as it found it', async () => {
  await brand().fill(GUEST_BRAND)
  await card().getByRole('button', { name: 'Премахни логото' }).click()
  await save().click()
  await expect(page.getByText('Външният вид е запазен.')).toBeVisible()
  await page.reload()
  await expect(brand()).toHaveValue(GUEST_BRAND)
  await expect(card().getByTestId('appearance-logo')).toHaveCount(0)
})
