import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, type Locator, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support'

// Tags in the composer (brief S3-06, D60) on a production build, in Bulgarian, against the demo
// menu: create a tag in the Tags panel, tick five items and add the tag to all of them with the
// bar at the bottom, filter the list by it, add a second tag from the item sheet while naming it
// there, publish the menu the real way and read the snapshot file back from /cdn, then archive and
// restore. Every tag it makes is archived again and taken off the items before the last test ends
// (a tag cannot be deleted, only archived), under names that are new on each run.
//
// Screenshots (BG and EN, light and dark, desktop and phone) go to E:\Restro\.local\screenshots\s3\
// on Windows (E2E_SCREENSHOT_DIR elsewhere), as s3-06-*.png.
test.describe.configure({ mode: 'serial' })

const SCREENSHOT_DIR =
  process.env.E2E_SCREENSHOT_DIR ??
  (process.platform === 'win32' ? 'E:\\Restro\\.local\\screenshots\\s3' : undefined)

const stamp = Date.now().toString(36)
const TAG_BG = `Фирмено ${stamp}`
const TAG_EN = `Signature ${stamp}`
const SECOND_BG = `Местно ${stamp}`
const SECOND_EN = `Local ${stamp}`

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
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
  await expect(page.getByTestId('composer')).toBeVisible()
})

test.afterAll(async () => {
  await page.close()
})

// --- helpers ---------------------------------------------------------------------------------
const itemRow = (name: string): Locator =>
  page.getByTestId('item-row').filter({ has: page.getByRole('button', { name, exact: true }) })
const itemNames = (target: Page = page) => target.getByTestId('item-open').allTextContents()

/** Waits until the pending server action has answered, so that a reload shows what was saved. */
async function settle(target: Page = page) {
  await target.waitForLoadState('networkidle')
  await target.waitForTimeout(300)
}

async function openSection(name: string, target: Page = page) {
  await target.getByTestId('section-select').getByText(name, { exact: true }).click()
  await expect(target.getByTestId('pane-title')).toHaveText(name)
}

async function shot(target: Page, name: string) {
  if (!SCREENSHOT_DIR) return
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  await target.screenshot({
    path: path.join(SCREENSHOT_DIR, `s3-06-${name}.png`),
    animations: 'disabled',
  })
}

const panel = (target: Page = page) => target.getByTestId('tags-panel')
const tagRow = (name: string, target: Page = page) =>
  target.getByTestId('tag-row').filter({ hasText: name })

async function openPanel(target: Page = page) {
  await target.getByTestId('open-tags').click()
  await expect(panel(target)).toBeVisible()
}

async function closePanel(target: Page = page) {
  await target.keyboard.press('Escape')
  await expect(panel(target)).toBeHidden()
}

/** Makes a tag in the open Tags panel. */
async function createTagInPanel(bg: string, en: string, color: string, target: Page = page) {
  await target.getByTestId('tag-new').click()
  await target.getByTestId('tag-name-bg_BG').fill(bg)
  await target.getByTestId('tag-name-en_US').fill(en)
  await target.getByTestId(`tag-color-${color}`).check({ force: true })
  await target.getByTestId('tag-form-save').click()
  await expect(tagRow(bg, target)).toBeVisible()
  await settle(target)
}

/** The first `count` item names of the open list. */
async function firstItems(count: number) {
  return (await itemNames()).slice(0, count)
}

async function tick(names: readonly string[], target: Page = page) {
  for (const name of names) {
    await target
      .getByTestId('item-row')
      .filter({ has: target.getByRole('button', { name, exact: true }) })
      .getByTestId('item-select')
      .check()
  }
}

// --- tests -----------------------------------------------------------------------------------
test('the Tags panel creates a tag with a name in each language and a colour', async () => {
  await openPanel()
  const before = await page.getByTestId('tag-row').count()
  await createTagInPanel(TAG_BG, TAG_EN, 'accent')
  await expect(page.getByTestId('tag-row')).toHaveCount(before + 1)
  // The new tag is last, in its colour token.
  await expect(page.getByTestId('tag-row').last().getByTestId('tag-chip')).toHaveAttribute(
    'data-color',
    'accent',
  )
  await shot(page, 'tags-panel-bg-light-desktop')

  // A name needs the venue's main language.
  await page.getByTestId('tag-new').click()
  await page.getByTestId('tag-name-en_US').fill('Only English')
  await page.getByTestId('tag-form-save').click()
  await expect(page.getByRole('alert')).toContainText('Въведете име')
  await panel().getByRole('button', { name: 'Отказ', exact: true }).click()

  // It is saved: a reload finds it.
  await closePanel()
  await page.reload()
  await openPanel()
  await expect(tagRow(TAG_BG)).toBeVisible()
  await closePanel()
})

test('ticks five items and adds the tag to all of them; the filter then shows exactly those', async () => {
  await openSection('Коктейли')
  await expect(page.getByTestId('item-row')).toHaveCount(7)
  const all = await itemNames()
  const five = all.slice(0, 5)

  // Nothing is selected, so there is no bar. Ticking shows it.
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)
  await tick(five)
  await expect(page.getByTestId('selection-count')).toHaveText('Избрани са 5 артикула')

  await page.getByTestId('add-tag').click()
  await page.getByTestId('add-tag-option').filter({ hasText: TAG_BG }).click()
  await settle()
  for (const name of five) {
    await expect(itemRow(name).getByTestId('item-chips')).toContainText(TAG_BG)
  }
  for (const name of all.slice(5)) {
    await expect(itemRow(name).locator('[data-testid=tag-chip]', { hasText: TAG_BG })).toHaveCount(
      0,
    )
  }
  await shot(page, 'composer-bg-light-desktop')

  // The change is saved, not only shown.
  await page.reload()
  await openSection('Коктейли')
  for (const name of five) {
    await expect(itemRow(name).getByTestId('item-chips')).toContainText(TAG_BG)
  }

  // Filter by the tag: exactly the five, in the list's order.
  await page.getByTestId('tag-filter').click()
  await page.getByTestId('tag-filter-option').filter({ hasText: TAG_BG }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('item-row')).toHaveCount(5)
  expect(await itemNames()).toEqual(five)
  await expect(page.getByTestId('filter-count')).toHaveText('Показани 5 от 7')
  await shot(page, 'filter-bg-light-desktop')

  // Reordering is off while filtered; clearing the filter brings every item back.
  await page.getByRole('button', { name: `Спри филтъра по ${TAG_BG}` }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(7)
  expect(await itemNames()).toEqual(all)
})

test('select all in the section, then take the tag off two items; "Clear selection" empties the bar', async () => {
  await openSection('Коктейли')
  await page.getByTestId('select-all').check()
  await expect(page.getByTestId('selection-count')).toHaveText('Избрани са 7 артикула')
  await page.getByTestId('clear-selection').click()
  await expect(page.getByTestId('selection-bar')).toHaveCount(0)

  const two = await firstItems(2)
  await tick(two)
  await page.getByTestId('remove-tag').click()
  await expect(page.getByTestId('remove-tag-option').filter({ hasText: TAG_BG })).toContainText(
    '2/2',
  )
  await page.getByTestId('remove-tag-option').filter({ hasText: TAG_BG }).click()
  await settle()
  for (const name of two) {
    await expect(itemRow(name).locator('[data-testid=tag-chip]', { hasText: TAG_BG })).toHaveCount(
      0,
    )
  }
  // Put it back for the next tests.
  await page.getByTestId('add-tag').click()
  await page.getByTestId('add-tag-option').filter({ hasText: TAG_BG }).click()
  await settle()
  await page.getByTestId('clear-selection').click()
  for (const name of two) {
    await expect(itemRow(name).getByTestId('item-chips')).toContainText(TAG_BG)
  }
})

test('the item sheet picks tags as chips and makes a new one on the spot', async () => {
  await openSection('Коктейли')
  const names = await itemNames()
  const sixth = names[5] as string
  await itemRow(sixth).getByTestId('item-open').click()
  const sheet = page.getByTestId('item-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('item-sheet-title')).toHaveText(sixth)

  await sheet.getByRole('button', { name: /^(Редактирай|Задай) Тагове$/ }).click()
  const editor = page.getByTestId('tags-editor')
  await expect(editor).toBeVisible()
  // The first tag is in the list but off on this item; switch it on.
  const first = editor.getByTestId('tag-toggle').filter({ hasText: TAG_BG })
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')

  // A new tag, named in both languages, saved first and then switched on.
  await editor.getByTestId('tag-create-inline').click()
  await editor.getByTestId('tag-name-bg_BG').fill(SECOND_BG)
  await editor.getByTestId('tag-name-en_US').fill(SECOND_EN)
  await editor.getByTestId('tag-color-muted').check({ force: true })
  await shot(page, 'item-sheet-tags-bg-light-desktop')
  await editor.getByTestId('tag-form-save').click()
  await expect(editor.getByTestId('tag-toggle').filter({ hasText: SECOND_BG })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await page.getByRole('button', { name: 'Запази', exact: true }).click()
  await expect(sheet.getByTestId('tags-value')).toContainText(TAG_BG)
  await expect(sheet.getByTestId('tags-value')).toContainText(SECOND_BG)
  await settle()

  // Closing the sheet refreshes the list: the item now shows both chips.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await settle()
  await expect(itemRow(sixth).getByTestId('item-chips')).toContainText(TAG_BG)
  await expect(itemRow(sixth).getByTestId('item-chips')).toContainText(SECOND_BG)
})

test('publishing puts the tags in the snapshot file: the vocabulary and the ids on the items', async ({
  request,
}) => {
  const printed = runScript('./scripts/publish-e2e.ts')
  const line = printed
    .split('\n')
    .reverse()
    .find((candidate) => candidate.startsWith('{"status"'))
  if (!line) throw new Error(`publish-e2e printed no result:\n${printed}`)
  const published = JSON.parse(line) as { status: string; snapshotId: string }
  expect(published.status).toBe('published')

  const response = await request.get(`/cdn/snap/${published.snapshotId}.json`)
  expect(response.ok()).toBe(true)
  const snapshot = (await response.json()) as {
    tags: Record<string, { label: Record<string, string>; color?: string }>
    items: Record<string, { name: Record<string, string>; tags: string[] }>
  }
  const entries = Object.entries(snapshot.tags)
  const first = entries.find(([, tag]) => tag.label.bg_BG === TAG_BG)
  const second = entries.find(([, tag]) => tag.label.bg_BG === SECOND_BG)
  expect(first?.[1]).toEqual({ label: { bg_BG: TAG_BG, en_US: TAG_EN }, color: 'accent' })
  expect(second?.[1]).toEqual({ label: { bg_BG: SECOND_BG, en_US: SECOND_EN }, color: 'muted' })

  // The first tag is on exactly the six items it was given; the second on one; no id is made up.
  const tagged = (id: string | undefined) =>
    Object.values(snapshot.items).filter((item) => id !== undefined && item.tags.includes(id))
  expect(tagged(first?.[0])).toHaveLength(6)
  expect(tagged(second?.[0])).toHaveLength(1)
  for (const item of Object.values(snapshot.items)) {
    for (const id of item.tags) expect(Object.keys(snapshot.tags)).toContain(id)
  }
})

test('an archived tag leaves the pickers and the next snapshot; restoring brings it and its items back', async () => {
  await openSection('Коктейли')
  await openPanel()
  await tagRow(SECOND_BG).getByTestId('tag-archive').click()
  await settle()
  await expect(tagRow(SECOND_BG)).toHaveCount(0)
  await expect(page.getByTestId('tag-archived-row').filter({ hasText: SECOND_BG })).toBeVisible()
  await closePanel()

  // No chip for it on the item, and it is not offered when ticking.
  const sixth = (await itemNames())[5] as string
  await expect(itemRow(sixth).getByTestId('item-chips')).not.toContainText(SECOND_BG)
  await tick([sixth])
  await page.getByTestId('add-tag').click()
  await expect(page.getByTestId('add-tag-option').filter({ hasText: SECOND_BG })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByTestId('clear-selection').click()

  // Restore: the item has it again without being touched.
  await openPanel()
  await page
    .getByTestId('tag-archived-row')
    .filter({ hasText: SECOND_BG })
    .getByTestId('tag-restore')
    .click()
  await settle()
  await expect(tagRow(SECOND_BG)).toBeVisible()
  await closePanel()
  await expect(itemRow(sixth).getByTestId('item-chips')).toContainText(SECOND_BG)
})

test('saves the screenshots of the brief: English dark, Bulgarian phone', async ({ browser }) => {
  test.skip(!SCREENSHOT_DIR, 'no screenshot folder')
  const state = await page.context().storageState()
  const base = new URL(page.url())
  const cookies = (language: 'bg' | 'en', theme: 'light' | 'dark') => [
    { name: 'NEXT_LOCALE', value: language, url: base.origin },
    { name: 'restro_theme', value: theme, url: base.origin },
  ]

  // English, dark, desktop: the list with chips and the bar for three ticked items; then the panel.
  const dark = await browser.newContext({
    storageState: state,
    colorScheme: 'dark',
    viewport: { width: 1440, height: 1000 },
  })
  await dark.addCookies(cookies('en', 'dark'))
  const darkPage = await dark.newPage()
  await darkPage.goto(base.pathname)
  await expect(darkPage.getByTestId('composer')).toBeVisible()
  await expect(darkPage.getByTestId('pane-title')).toHaveText('Cocktails')
  await tick((await itemNames(darkPage)).slice(0, 3), darkPage)
  await expect(darkPage.getByTestId('selection-bar')).toBeVisible()
  await shot(darkPage, 'composer-en-dark-desktop')
  await darkPage.getByTestId('clear-selection').click()
  await darkPage.getByTestId('tag-filter').click()
  await darkPage.getByTestId('tag-filter-option').filter({ hasText: TAG_EN }).click()
  await darkPage.keyboard.press('Escape')
  await shot(darkPage, 'filter-en-dark-desktop')
  await openPanel(darkPage)
  await shot(darkPage, 'tags-panel-en-dark-desktop')
  await dark.close()

  // Bulgarian, light, phone: the list with the checkboxes on, and the bar.
  const phone = await browser.newContext({
    storageState: state,
    colorScheme: 'light',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await phone.addCookies(cookies('bg', 'light'))
  const phonePage = await phone.newPage()
  await phonePage.goto(base.pathname)
  await expect(phonePage.getByTestId('composer')).toBeVisible()
  await expect(phonePage.getByTestId('section-picker')).toContainText('Коктейли')
  await shot(phonePage, 'composer-bg-light-mobile')
  await tick((await itemNames(phonePage)).slice(0, 2), phonePage)
  await expect(phonePage.getByTestId('selection-bar')).toBeVisible()
  await shot(phonePage, 'composer-selection-bg-light-mobile')
  await phone.close()
})

test('cleans up: takes the tags off the items and archives them', async () => {
  await openSection('Коктейли')
  for (const tagName of [TAG_BG, SECOND_BG]) {
    // Every item that holds the tag, ticked in one go.
    const holders = await page
      .getByTestId('item-row')
      .filter({ has: page.locator('[data-testid=tag-chip]', { hasText: tagName }) })
      .getByTestId('item-open')
      .allTextContents()
    expect(holders.length).toBeGreaterThan(0)
    await tick(holders)
    await page.getByTestId('remove-tag').click()
    await page.getByTestId('remove-tag-option').filter({ hasText: tagName }).click()
    await settle()
    await page.getByTestId('clear-selection').click()
    await expect(page.locator('[data-testid=tag-chip]', { hasText: tagName })).toHaveCount(0)
  }
  await openPanel()
  for (const tagName of [TAG_BG, SECOND_BG]) {
    await tagRow(tagName).getByTestId('tag-archive').click()
    await expect(tagRow(tagName)).toHaveCount(0)
    await settle()
  }
  await closePanel()
  await page.reload()
  await openPanel()
  await expect(page.getByTestId('tag-archived-row').filter({ hasText: TAG_BG })).toBeVisible()
})
