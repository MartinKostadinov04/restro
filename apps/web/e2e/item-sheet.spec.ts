import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, type Page, test } from '@playwright/test'

import { makePng } from '../src/server/assets/test-images'
import { ADMIN_EMAIL, ADMIN_PASSWORD, ITEM_SHEET_ITEM } from './support'

// The item sheet on the development harness (/dev/item-sheet, which exists under `next dev`
// only; playwright.config.ts starts one beside the production build): open an item that comes
// from barsy, see that its price is locked, edit its description (the badge becomes "Owned
// here"), add an English name in Translations, upload a photo (the local asset store) and find
// the changes in History. Screenshots go to E:\Restro\.local\screenshots\s2\ on Windows
// (E2E_SCREENSHOT_DIR elsewhere; none if neither applies).
test.describe.configure({ mode: 'serial' })

const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ??
  (process.platform === 'win32' ? 'E:\\Restro\\.local\\screenshots\\s2' : undefined)

async function shot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `s2-06b-${name}.png`),
    animations: 'disabled',
  })
}

async function setPreferences(page: Page, language: 'bg' | 'en', theme: 'light' | 'dark') {
  const url = new URL(page.url())
  await page.context().addCookies([
    { name: 'NEXT_LOCALE', value: language, url: url.origin },
    { name: 'restro_theme', value: theme, url: url.origin },
  ])
}

test('open an item from barsy, edit it, translate it, give it a photo, read its history', async ({
  page,
  context,
  baseURL,
}) => {
  // The first request to each page compiles it in development.
  test.setTimeout(240_000)
  const origin = new URL(baseURL ?? 'http://127.0.0.1:3101').origin
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: 'en', url: origin },
    { name: 'restro_theme', value: 'light', url: origin },
  ])
  const stamp = Date.now().toString(36)
  const description = `Bitter and fresh ${stamp}`
  const englishName = `Negroni ${stamp}`

  // --- sign in, open the item -----------------------------------------------------------------
  await page.goto('/dev/item-sheet')
  // The harness checks the session itself (the proxy lets /dev through), so nobody is signed in.
  await expect(page).toHaveURL(/\/login/)
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/venues/, { timeout: 120_000 })
  await page.goto('/dev/item-sheet')
  await page.getByRole('link', { name: `Open ${ITEM_SHEET_ITEM}` }).click()
  const sheet = page.getByTestId('item-sheet')
  await expect(sheet.getByTestId('item-sheet-title')).toHaveText(ITEM_SHEET_ITEM, {
    timeout: 120_000,
  })
  await expect(sheet.getByTestId('item-sheet-details')).toBeVisible()
  await expect(sheet.getByText('From barsy').first()).toBeVisible()

  // --- the name comes from barsy; the price is locked -------------------------------------------
  const name = sheet.locator('[data-field-key="name"]')
  await expect(name).toContainText('From barsy')
  const price = sheet.locator('[data-field-key="price"]')
  await expect(price).toContainText('Locked')
  await expect(price).toContainText('Change this in barsy.')
  await expect(price).toContainText('12.50')
  await expect(price.getByRole('button', { name: /^(edit|set) price/i })).toHaveCount(0)

  // --- edit the description: the badge becomes "Owned here" --------------------------------------
  const descriptionRow = sheet.locator('[data-field-key="description"]')
  await expect(descriptionRow).toContainText('No value set')
  await descriptionRow.getByRole('button', { name: 'Set Description' }).click()
  const editor = page.getByTestId('field-editor-sheet')
  await expect(editor).toContainText('saved to the menu at once')
  await editor.getByRole('textbox').first().fill(description)
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(descriptionRow).toContainText(description)
  await expect(descriptionRow.locator('[data-provenance="owned"]')).toHaveText('Owned here')
  await expect(editor).toHaveCount(0)
  await shot(page, 'details-en-light')

  // --- an override of a barsy value can be reverted --------------------------------------------
  const allergens = sheet.locator('[data-field-key="allergens"]')
  await allergens.getByRole('button', { name: 'Edit Allergens' }).click()
  await page.getByTestId('field-editor-sheet').getByRole('button', { name: 'Milk' }).click()
  await page.getByTestId('field-editor-sheet').getByRole('button', { name: 'Save' }).click()
  await expect(allergens.locator('[data-provenance="overridden"]')).toHaveText('Overridden')
  await expect(allergens.getByTestId('barsy-value')).toContainText('Sulphites')
  await allergens.getByRole('button', { name: /^Revert Allergens/ }).click()
  await expect(allergens.locator('[data-provenance="barsy"]')).toHaveText('From barsy')
  await expect(allergens.getByRole('button', { name: /^Revert Allergens/ })).toHaveCount(0)

  // --- Translations: barsy's Bulgarian is read-only, add the English name ----------------------
  await sheet.getByRole('tab', { name: 'Translations' }).click()
  await expect(sheet.getByTestId('item-sheet-translations')).toBeVisible()
  await expect(sheet.getByTestId('item-sheet-details')).toBeHidden()
  const bg = sheet.locator(
    '[data-testid="translation-cell"][data-field="name"][data-locale="bg_BG"]',
  )
  await expect(bg).toHaveAttribute('data-editable', 'false')
  await expect(bg).toContainText('Held by barsy')
  const en = sheet.locator(
    '[data-testid="translation-cell"][data-field="name"][data-locale="en_US"]',
  )
  await expect(en).toHaveAttribute('data-missing', 'true')
  await shot(page, 'translations-en-light')
  await en.getByRole('textbox').fill(englishName)
  await en.getByRole('button', { name: 'Save' }).click()
  await expect(en).toHaveAttribute('data-missing', 'false')
  await expect(en).toContainText('Owned here')
  await expect(en.getByRole('textbox')).toHaveValue(englishName)

  // --- Media: upload a photo (the local store), it is shown through the signed route -----------
  await sheet.getByRole('tab', { name: 'Media' }).click()
  await expect(sheet.getByTestId('item-sheet-translations')).toBeHidden()
  await expect(sheet.getByTestId('item-sheet-media')).toContainText('No photo yet')
  await sheet.getByTestId('photo-input').setInputFiles({
    name: 'negroni.png',
    mimeType: 'image/png',
    buffer: Buffer.from(makePng(320, 240)),
  })
  const image = sheet.getByTestId('item-image')
  await expect(image).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)))
    .toBe(320)
  await expect(sheet.getByTestId('image-dimensions')).toHaveText('320 × 240')
  await expect(sheet.getByTestId('item-sheet-media')).toContainText('Owned here')
  // Alt text per language.
  await sheet.getByLabel(/^Alt text, English/).fill('A glass of Negroni')
  await sheet.getByTestId('image-details').getByRole('button', { name: 'Save' }).click()
  await expect(sheet.getByTestId('item-image')).toHaveAttribute('alt', /.+/)
  await image.scrollIntoViewIfNeeded()
  await shot(page, 'media-en-light')

  // --- the image row in Details now shows the photo ---------------------------------------------
  await sheet.getByRole('tab', { name: 'Details' }).click()
  await expect(sheet.getByTestId('item-sheet-media')).toBeHidden()
  await expect(sheet.locator('[data-field-key="image"] img')).toBeVisible()

  // --- History shows the changes, newest first, with who made them -----------------------------
  await sheet.getByRole('tab', { name: 'History' }).click()
  const history = sheet.getByTestId('item-sheet-history')
  const entries = history.getByTestId('history-entry')
  await expect(entries.first()).toBeVisible()
  const mine = history.getByTestId('history-entry').filter({ hasText: 'Demo Owner' })
  const byField = (field: string) => mine.and(page.locator(`[data-field="${field}"]`))
  // The photo and then its alt text.
  await expect(byField('image')).toHaveCount(2)
  await expect(byField('name')).toContainText(englishName)
  await expect(byField('description')).toContainText(description)
  // The allergens override and its revert are both there; so is the seed's barsy sync line.
  await expect(byField('allergens')).toHaveCount(2)
  await expect(
    history.getByTestId('history-entry').filter({ hasText: 'The barsy sync' }).first(),
  ).toBeVisible()
  const order = await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-field')))
  expect(order.indexOf('image')).toBeLessThan(order.indexOf('description'))
  await shot(page, 'history-en-light')

  // --- the same sheet in Bulgarian, in the dark, and on a phone ----------------------------------
  await setPreferences(page, 'bg', 'light')
  await page.reload()
  await expect(page.getByTestId('item-sheet').getByRole('tab', { name: 'Детайли' })).toBeVisible({
    timeout: 120_000,
  })
  await expect(page.locator('[data-field-key="price"]')).toContainText('Заключено')
  await expect(page.locator('[data-field-key="price"]')).toContainText('Променете това в barsy.')
  await shot(page, 'details-bg-light')

  await setPreferences(page, 'en', 'dark')
  await page.reload()
  await expect(page.getByTestId('item-sheet').getByRole('tab', { name: 'Details' })).toBeVisible({
    timeout: 120_000,
  })
  await expect(page.locator('html')).toHaveClass(/dark/)
  await shot(page, 'details-en-dark')
  await page.getByTestId('item-sheet').getByRole('tab', { name: 'Media' }).click()
  await expect(page.getByTestId('item-image')).toBeVisible()
  await shot(page, 'media-en-dark')

  await page.setViewportSize({ width: 390, height: 844 })
  await setPreferences(page, 'en', 'light')
  await page.reload()
  await expect(page.getByTestId('item-sheet').getByRole('tab', { name: 'Details' })).toBeVisible({
    timeout: 120_000,
  })
  await shot(page, 'details-mobile')
  await page.getByTestId('item-sheet').getByRole('tab', { name: 'Translations' }).click()
  await shot(page, 'translations-mobile')
  await page.getByTestId('item-sheet').getByRole('tab', { name: 'Media' }).click()
  await expect(page.getByTestId('item-image')).toBeVisible()
  await shot(page, 'media-mobile')
})
