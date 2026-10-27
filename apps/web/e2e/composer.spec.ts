import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { expect, type Locator, type Page, type Response, test } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD } from './support'

// The composer on a production build, in Bulgarian, against the demo menu that `pnpm db:seed:dev`
// builds (four sections, 20 items, one hidden by barsy, two unsorted). One sign-in, one page, the
// tests in order. Every change a test makes is undone before it ends (moves go back, switches
// flip back, the menu layout goes back to two columns with the switch, the section a test creates
// is deleted again).
// Brief S6 (D92): the composer has two subtabs, Structure and Design (`?sub=`), and works on the
// menu its URL names (`?menu=`). With SCREENSHOT_DIR set, the last tests save the screenshots of
// the brief (BG light, EN dark, mobile) there.
test.describe.configure({ mode: 'serial' })

let page: Page

const SECTIONS = ['Коктейли', 'Бира', 'Безалкохолни', 'Храна']

test.beforeAll(async ({ browser }) => {
  // Tall enough that a whole section of the demo menu is on screen, under the subtabs and the menu
  // bar (S6): a mouse drag can only start on a handle that is inside the viewport.
  page = await browser.newPage({ viewport: { width: 1280, height: 1300 } })
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
  // A keyboard reorder that failed mid-way (T75) leaves "Храна" moved; put it back, best effort,
  // so the guest page's seed, which runs after this file, publishes the demo order.
  try {
    if ((await topSections())[2] === 'Храна') await keyboardDrag('Плъзни Храна', 'ArrowDown', 1)
  } catch {
    // The page may be gone after a timeout; the next run's seed starts clean anyway.
  }
  await page.close()
})

// --- helpers ---------------------------------------------------------------------------------
const treeRow = (name: string): Locator =>
  page.getByTestId('section-row').filter({ has: page.getByRole('button', { name, exact: true }) })
const itemRow = (name: string): Locator =>
  page.getByTestId('item-row').filter({ has: page.getByRole('button', { name, exact: true }) })

async function openSection(name: string) {
  await page.getByTestId('section-select').getByText(name, { exact: true }).click()
  await expect(page.getByTestId('pane-title')).toHaveText(name)
}

async function openUnsorted() {
  await page.getByTestId('unsorted-select').click()
  await expect(page.getByTestId('pane-title')).toHaveText('Неподредени')
}

/** The names of the items in the open list, in order. */
const itemNames = () => page.getByTestId('item-open').allTextContents()

/** The top-level sections of the tree, in order. */
const topSections = () =>
  page
    .locator('nav[data-testid=section-tree] > ul > li > [data-testid=section-row]')
    .getByTestId('section-select')
    .allTextContents()

/** True for a Next.js server action call (a POST carrying the `Next-Action` header). */
function isServerAction(response: Response): boolean {
  const request = response.request()
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined
}

/** Waits until the pending server action has answered, so that a reload shows what was saved. */
async function settle() {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
}

/** Lifts a row by its handle with the keyboard (the library's own, accessible way) and moves it. */
async function keyboardDrag(handleName: string, key: 'ArrowUp' | 'ArrowDown', times: number) {
  const handle = page.getByRole('button', { name: handleName, exact: true })
  await handle.focus()
  await page.keyboard.press('Space')
  await page.waitForTimeout(250)
  for (let i = 0; i < times; i += 1) {
    await page.keyboard.press(key)
    await page.waitForTimeout(250)
  }
  // Every keyboard drag here moves something, so a save follows the drop; wait for its answer
  // (network-idle alone can pass before the drop animation starts the save). When the save landed
  // before the drop was seen (T75: it happens under load), go on: the reload that follows every
  // drag checks what was kept.
  const saved = page.waitForResponse(isServerAction, { timeout: 10_000 }).catch(() => null)
  await page.keyboard.press('Space')
  await saved
  await settle()
}

/** Drags an item by its handle with the mouse onto the row of a section in the tree. */
async function mouseDragItemToSection(itemName: string, sectionName: string) {
  const handle = page.getByRole('button', { name: `Плъзни ${itemName}`, exact: true })
  await handle.scrollIntoViewIfNeeded()
  const from = await handle.boundingBox()
  const to = await treeRow(sectionName).boundingBox()
  if (!from || !to) throw new Error('nothing to drag')
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 12, startY + 12, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 30 })
  await page.waitForTimeout(400)
  // The drop animation runs before the save starts, so network-idle alone can come too early:
  // wait for the server action's own answer before anyone reloads.
  const saved = page.waitForResponse(isServerAction)
  await page.mouse.up()
  await saved
  await settle()
}

async function snapshot(fileName: string, target: Page = page) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await target.screenshot({ path: path.join(dir, fileName), fullPage: true })
}

/** The path of the venue's page (the demo venue). */
const venuePath = () => new URL(page.url()).pathname

/** A toast of the composer. */
const toast = () => page.locator('[data-sonner-toast]')

// --- tests -----------------------------------------------------------------------------------
test('opens on the Composer tab with the demo menu: sections, items, badges', async () => {
  // D92: the composer opens on its Structure subtab, on the venue's live menu.
  await expect(page.getByRole('tab', { name: 'Структура' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('menu-switcher')).toContainText('Demo Club Sofia')
  expect((await topSections()).slice(0, 4)).toEqual(SECTIONS)
  await expect(page.getByTestId('pane-title')).toHaveText('Коктейли')
  expect((await itemNames()).slice(0, 2)).toEqual(['Негрони', 'Аперол Шприц'])
  await expect(page.getByTestId('item-row')).toHaveCount(7)
  await expect(itemRow('Негрони').getByTestId('origin-badge')).toHaveText('От barsy')
  // Items without allergens or an English name carry an issues badge.
  await expect(itemRow('Мохито').getByTestId('issues-badge')).toBeVisible()
  await expect(itemRow('Негрони').getByTestId('issues-badge')).toHaveCount(0)
  // The open section is in the URL.
  await expect(page.getByTestId('section-row').first()).toHaveAttribute('data-selected', 'true')
  await snapshot('composer-bg-light-desktop.png')
})

test('the Design subtab holds the Design tab and the guest features; an old Design link lands there', async () => {
  // The tab bar has no Design tab any more (D92): Design is the composer's second subtab.
  await expect(page.getByRole('tablist').first().getByRole('tab')).toHaveText([
    'Композитор',
    'Маси и QR',
    'Тази вечер',
    'Настройки',
  ])
  await page.getByRole('tab', { name: 'Дизайн' }).click()
  await expect(page).toHaveURL(/[?&]sub=design/)
  await expect(page.getByTestId('design-panel')).toBeVisible()
  await expect(page.getByTestId('guest-features-panel')).toBeVisible()
  // Structure no longer opens the Guest features panel.
  await page.goto(`${venuePath()}?tab=design`)
  await expect(page).toHaveURL(/[?&]tab=composer&sub=design/)
  await expect(page.getByTestId('design-panel')).toBeVisible()
  await page.getByRole('tab', { name: 'Структура' }).click()
  await expect(page).toHaveURL(/[?&]sub=structure/)
  await expect(page.getByTestId('composer')).toBeVisible()
  await expect(page.getByTestId('open-guest-features')).toHaveCount(0)
})

test('a menu’s ">" in Settings opens it in the composer, named in the URL', async () => {
  await page.goto(`${venuePath()}?tab=settings&section=general`)
  const open = page.locator('a[href*="tab=composer&menu=nd_"]').first()
  const href = (await open.getAttribute('href')) ?? ''
  const menuId = /menu=(nd_[0-9A-Za-z]{22})/.exec(href)?.[1]
  expect(menuId).toBeTruthy()
  await open.click()
  await expect(page).toHaveURL(new RegExp(`[?&]menu=${menuId}`))
  await expect(page.getByTestId('composer')).toBeVisible()
  // The switcher lists the venue's menus, the live one marked.
  await page.getByTestId('menu-switcher').click()
  const options = page.getByTestId('menu-option')
  await expect(options.first()).toContainText('Demo Club Sofia')
  await expect(page.getByRole('listbox').getByTestId('menu-live')).toHaveCount(1)
  await page.keyboard.press('Escape')
  expect((await topSections()).slice(0, 4)).toEqual(SECTIONS)
})

test('the item barsy hides cannot be shown from the composer', async () => {
  await openSection('Бира')
  const row = itemRow('Гинес 440 мл')
  await expect(row).toHaveAttribute('data-hidden-by', 'till')
  await expect(row.getByTestId('hidden-badge')).toHaveText('Скрито от barsy')
  await expect(row.getByTestId('item-visible')).toBeDisabled()
  await expect(row).toContainText('Скрито в barsy. Показвайте го там.')
  await row.getByTestId('item-visible').click({ force: true })
  await settle()
  await page.reload()
  await openSection('Бира')
  await expect(itemRow('Гинес 440 мл')).toHaveAttribute('data-hidden-by', 'till')
})

test('hides an item and shows it again; the choice survives a reload', async () => {
  await openSection('Коктейли')
  const row = itemRow('Космополитан')
  await expect(row).not.toHaveAttribute('data-hidden-by', /.+/)
  await row.getByTestId('item-visible').click()
  await expect(row).toHaveAttribute('data-hidden-by', 'builder')
  await expect(row.getByTestId('hidden-badge')).toHaveText('Скрито')
  await settle()

  await page.reload()
  await expect(itemRow('Космополитан')).toHaveAttribute('data-hidden-by', 'builder')

  await itemRow('Космополитан').getByTestId('item-visible').click()
  await expect(itemRow('Космополитан')).not.toHaveAttribute('data-hidden-by', /.+/)
  await settle()
  await page.reload()
  await expect(itemRow('Космополитан')).not.toHaveAttribute('data-hidden-by', /.+/)
})

test('reorders an item with the keyboard; the order survives a reload', async () => {
  await openSection('Бира')
  const before = await itemNames()
  expect(before.length).toBeGreaterThanOrEqual(2)
  const last = before[before.length - 1] as string
  const swapped = [...before.slice(0, -2), last, before[before.length - 2] as string]

  await keyboardDrag(`Плъзни ${last}`, 'ArrowUp', 1)
  expect(await itemNames()).toEqual(swapped)

  await page.reload()
  await openSection('Бира')
  expect(await itemNames()).toEqual(swapped)

  // And back.
  await keyboardDrag(`Плъзни ${last}`, 'ArrowDown', 1)
  expect(await itemNames()).toEqual(before)
  await page.reload()
  await openSection('Бира')
  expect(await itemNames()).toEqual(before)
})

test('moves an item to another section by dragging it onto the section; the move survives a reload', async () => {
  await openSection('Коктейли')
  const names = await itemNames()
  const moved = names[names.length - 1] as string
  const beerBefore = await (async () => {
    await openSection('Бира')
    const list = await itemNames()
    await openSection('Коктейли')
    return list
  })()

  await mouseDragItemToSection(moved, 'Бира')
  await expect(itemRow(moved)).toHaveCount(0)
  expect(await itemNames()).toEqual(names.slice(0, -1))
  await openSection('Бира')
  expect(await itemNames()).toEqual([...beerBefore, moved])

  await page.reload()
  await openSection('Бира')
  expect(await itemNames()).toEqual([...beerBefore, moved])
  await openSection('Коктейли')
  expect(await itemNames()).toEqual(names.slice(0, -1))

  // Back with the "Move to" menu: it goes to the end of the section, where it was.
  await openSection('Бира')
  await itemRow(moved).getByTestId('item-menu').click()
  await page.getByRole('menuitem', { name: 'Премести в…' }).click()
  await page
    .getByTestId('move-target')
    .filter({ hasText: /^Коктейли$/ })
    .click()
  await settle()
  await openSection('Коктейли')
  expect(await itemNames()).toEqual(names)
  await page.reload()
  await openSection('Коктейли')
  expect(await itemNames()).toEqual(names)
})

test('Unsorted holds the items in no section, one of them made here', async () => {
  await openUnsorted()
  const names = await itemNames()
  expect(names).toEqual(expect.arrayContaining(['Лимонада на къщата', 'Текила шот']))
  await expect(itemRow('Лимонада на къщата').getByTestId('origin-badge')).toHaveText(
    'Създадено тук',
  )
  await expect(itemRow('Текила шот').getByTestId('origin-badge')).toHaveText('От barsy')

  // Drop one into a section, then take it out again.
  await mouseDragItemToSection('Текила шот', 'Безалкохолни')
  await expect(itemRow('Текила шот')).toHaveCount(0)
  await openSection('Безалкохолни')
  expect(await itemNames()).toContain('Текила шот')
  await itemRow('Текила шот').getByTestId('item-menu').click()
  await page.getByRole('menuitem', { name: 'Премести в „Неподредени“' }).click()
  await settle()
  await openUnsorted()
  expect(await itemNames()).toEqual(names)
})

test('reorders a section among its siblings with the keyboard', async () => {
  // An earlier attempt that timed out mid-way (T75) leaves the section moved: put it back first,
  // so a retry, and the guest page's seed after this file, see the demo order.
  if ((await topSections())[2] === 'Храна') {
    await keyboardDrag('Плъзни Храна', 'ArrowDown', 1)
    await page.reload()
  }
  const before = (await topSections()).slice(0, 4)
  expect(before).toEqual(SECTIONS)
  await keyboardDrag('Плъзни Храна', 'ArrowUp', 1)
  expect((await topSections()).slice(0, 4)).toEqual(['Коктейли', 'Бира', 'Храна', 'Безалкохолни'])
  await page.reload()
  await settle()
  expect((await topSections()).slice(0, 4)).toEqual(['Коктейли', 'Бира', 'Храна', 'Безалкохолни'])
  // Settled: a drag right after the reload, before the tree is interactive, moves nothing (T75).
  await keyboardDrag('Плъзни Храна', 'ArrowDown', 1)
  await page.reload()
  await settle()
  expect((await topSections()).slice(0, 4)).toEqual(SECTIONS)
})

test('lays a section out as a horizontal row (D92); the choice survives a reload', async () => {
  await openSection('Безалкохолни')
  const toggle = page.getByTestId('section-layout')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(treeRow('Безалкохолни').getByTestId('section-horizontal')).toBeVisible()
  await settle()
  await page.reload()
  await openSection('Безалкохолни')
  await expect(page.getByTestId('section-layout')).toHaveAttribute('aria-checked', 'true')

  // And back.
  await page.getByTestId('section-layout').click()
  await expect(treeRow('Безалкохолни').getByTestId('section-horizontal')).toHaveCount(0)
  await settle()
  await page.reload()
  await openSection('Безалкохолни')
  await expect(page.getByTestId('section-layout')).toHaveAttribute('aria-checked', 'false')
})

test('sets the menu layout and whether guests may switch it (D92); it survives a reload', async () => {
  const layout = () => page.getByTestId('menu-layout')
  const guestSwitch = () => page.getByTestId('menu-layout-switch')
  await layout().getByRole('button', { name: 'Една колона' }).click()
  await expect(toast().first()).toContainText('Запазено')
  await expect(layout().getByRole('button', { name: 'Една колона' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(guestSwitch()).toBeEnabled()
  if ((await guestSwitch().getAttribute('aria-checked')) !== 'false') await guestSwitch().click()
  await expect(guestSwitch()).toHaveAttribute('aria-checked', 'false')
  await settle()
  await page.reload()
  await expect(layout().getByRole('button', { name: 'Една колона' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(guestSwitch()).toHaveAttribute('aria-checked', 'false')

  // Back to two columns with the switch: the look of a menu that set none.
  await layout().getByRole('button', { name: 'Две колони' }).click()
  await expect(layout().getByRole('button', { name: 'Две колони' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(guestSwitch()).toBeEnabled()
  await guestSwitch().click()
  await expect(guestSwitch()).toHaveAttribute('aria-checked', 'true')
  await settle()
  await page.reload()
  await expect(layout().getByRole('button', { name: 'Две колони' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(guestSwitch()).toHaveAttribute('aria-checked', 'true')
})

test('a section or item of the till is never deleted here; an item made here can be', async () => {
  await openSection('Бира')
  await page.getByTestId('item-pane').getByTestId('section-menu').click()
  await expect(page.getByTestId('section-rename')).toBeVisible()
  await expect(page.getByTestId('section-delete')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await itemRow('Гинес 440 мл').getByTestId('item-menu').click()
  await expect(page.getByRole('menuitem', { name: /^Отвори/ })).toBeVisible()
  await expect(page.getByTestId('item-rename')).toHaveCount(0)
  await expect(page.getByTestId('item-delete')).toHaveCount(0)
  await page.keyboard.press('Escape')

  await openUnsorted()
  await itemRow('Лимонада на къщата').getByTestId('item-menu').click()
  await expect(page.getByTestId('item-rename')).toBeVisible()
  await expect(page.getByTestId('item-delete')).toBeVisible()
  await page.keyboard.press('Escape')
})

const newSectionName = `Тест ${Date.now()}`

test('creates a section of our own, nests it under another and hides it', async () => {
  await page.getByTestId('new-section').click()
  await page.getByTestId('new-section-name-bg_BG').fill(newSectionName)
  await page.getByTestId('new-section-name-en_US').fill('E2E section')
  await page.getByTestId('new-section-submit').click()

  await expect(page.getByTestId('pane-title')).toHaveText(newSectionName)
  await expect(page.getByTestId('origin-badge')).toHaveText('Създадено тук')
  await expect(page.getByTestId('item-list-empty')).toContainText('В тази секция няма артикули')
  await settle()
  await page.reload()
  await expect(page.getByTestId('pane-title')).toHaveText(newSectionName)
  expect(await topSections()).toContain(newSectionName)

  // Under "Коктейли" with its menu, then back to the top level.
  await treeRow(newSectionName).getByTestId('section-menu').click()
  await page.getByRole('menuitem', { name: 'Премести в…' }).click()
  await page
    .getByTestId('move-target')
    .filter({ hasText: /^Коктейли$/ })
    .click()
  await settle()
  await expect(
    page
      .getByTestId('section-node')
      .filter({ has: page.getByRole('button', { name: 'Коктейли', exact: true }) })
      .first()
      .getByTestId('section-row')
      .filter({ hasText: newSectionName }),
  ).toHaveCount(1)
  expect(await topSections()).not.toContain(newSectionName)

  await treeRow(newSectionName).getByTestId('section-menu').click()
  await page.getByRole('menuitem', { name: 'Премести в…' }).click()
  await page
    .getByTestId('move-target')
    .filter({ hasText: /^Най-горно ниво$/ })
    .click()
  await settle()
  await page.reload()
  expect(await topSections()).toContain(newSectionName)

  // Hide it: guests would not see it, and it has no items anyway.
  await openSection(newSectionName)
  await page.getByTestId('section-visible').click()
  await expect(page.getByTestId('hidden-badge')).toHaveText('Скрито')
  await settle()
  await page.reload()
  await expect(page.getByTestId('hidden-badge')).toHaveText('Скрито')

  // Rename it in place.
  const renamed = `${newSectionName} нов`
  await page.getByTestId('section-rename-start').click()
  const field = page.getByTestId('section-rename-field-input')
  await field.fill(renamed)
  await field.press('Enter')
  await expect(page.getByTestId('pane-title')).toHaveText(renamed)
  await settle()
  await page.reload()
  await openSection(renamed)

  // And delete it again (D92: a section of the venue's own can be deleted, after a question).
  await page.getByTestId('item-pane').getByTestId('section-menu').click()
  await page.getByTestId('section-delete').click()
  await expect(page.getByTestId('delete-dialog')).toContainText(renamed)
  await page.getByTestId('delete-confirm').click()
  await expect(treeRow(renamed)).toHaveCount(0)
  await settle()
  await page.reload()
  expect(await topSections()).not.toContain(renamed)
})

test('saves the screenshots of the brief when SCREENSHOT_DIR is set', async ({ browser }) => {
  test.skip(!process.env.SCREENSHOT_DIR, 'SCREENSHOT_DIR is not set')
  const state = await page.context().storageState()
  const base = new URL(page.url())

  // English, dark, desktop.
  const dark = await browser.newContext({
    storageState: state,
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  })
  await dark.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: base.origin }])
  const darkPage = await dark.newPage()
  await darkPage.goto(base.pathname)
  await expect(darkPage.getByTestId('composer')).toBeVisible()
  await expect(darkPage.getByTestId('pane-title')).toHaveText('Cocktails')
  await snapshot('composer-en-dark-desktop.png', darkPage)
  await dark.close()

  // Bulgarian, light, phone.
  const phone = await browser.newContext({
    storageState: state,
    colorScheme: 'light',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const phonePage = await phone.newPage()
  await phonePage.goto(base.pathname)
  await expect(phonePage.getByTestId('composer')).toBeVisible()
  // The picker fills in as the page hydrates.
  await expect(phonePage.getByTestId('section-picker')).toContainText('Коктейли')
  await snapshot('composer-bg-light-mobile.png', phonePage)
  await phone.close()

  // Bulgarian, light, desktop, Unsorted and the open item sheet stub.
  await openUnsorted()
  await snapshot('composer-bg-light-unsorted.png')
})
