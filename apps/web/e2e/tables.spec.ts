import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type BrowserContext,
  devices,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'
import QRCode from 'qrcode'

import { svgFromDataUri } from '../src/tables/svg-uri'
import { runScript } from './global-setup'
import { addressOfVenue, type VenueAddress } from './menu-path'
import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_SLUG } from './support'

// The Tables & QR tab on a production build (briefs S3-07 and S5; D94, D95), in Bulgarian, against
// the demo venue with eight barsy tables (scripts/seed-tables-e2e.ts):
//
//   1. the areas as sections, their tables as cards; "Create codes for all tables"; the code in a
//      card IS the address <base>/t/<token> (the SVG is compared with what the `qrcode` library
//      makes for that text, error correction M, margin 2, black on white);
//   2. nothing is public until the worker has run (the web app never writes the publish store):
//      before it, /t/<token> says "not active"; after it, it leads to the menu with "Маса 1";
//   3. a new name reaches the guest page; an area is renamed and moved; a table is hidden (its file
//      goes), shown again and moved; "New code" makes the old sticker say "not active";
//   4. a menu chosen for a table, then for an area, reaches the table files after the job (the
//      most specific wins), and taking the choice away goes back to the venue's live menu;
//   5. the address card only says where the codes lead; its test link is opened by the browser;
//   6. the print sheet has six cards on an A4 page (counted on the screen and in a real PDF) and
//      leaves a hidden table out;
//   7. downloads, turning a code off, and the picture in both languages and themes.
//
// The worker does not run here: `seed-tables-e2e.ts worker` takes the queued jobs and runs the
// worker's own `writeTableTokenFiles` for them. Screenshots go to `.local/screenshots/s5/`
// (E2E_SCREENSHOT_DIR elsewhere), as s5-*.png.
test.describe.configure({ mode: 'serial' })

const SHOTS = (
  process.env.E2E_SCREENSHOT_DIR ??
  fileURLToPath(new URL('../../../.local/screenshots/s5/', import.meta.url))
).replace(/[\\/]+$/, '')
mkdirSync(SHOTS, { recursive: true })
const shot = (name: string) => `${SHOTS}/s5-${name}.png`

/** Exactly how the app draws a code: error correction M, a quiet zone of 2, black on white. */
const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
} as const
const svgOf = (text: string, width?: number) =>
  QRCode.toString(text, { ...QR_OPTIONS, type: 'svg', ...(width === undefined ? {} : { width }) })

const TOKEN = /^[0-9A-Za-z]{22}$/

let context: BrowserContext
let page: Page
let tabUrl: string
let venueUrl: string
let origin: string
/** The demo venue's address of before, `/m/<slug>-<code>` (D68); its files know the organisation. */
let venue: VenueAddress
/** The address a table's code leads to (D84): the demo organisation's slug and the venue's. */
const GUEST_PATH = `/m/demo-club/${GUEST_SLUG}`

// --- helpers ---------------------------------------------------------------------------------
const rows = () => page.getByTestId('table-card')
const rowOf = (number: string): Locator =>
  rows().filter({
    has: page.getByTestId('table-number').filter({ hasText: new RegExp(`^от barsy: ${number}$`) }),
  })
/** The area section a locator is in. */
const areaOfRow = (row: Locator): Locator => row.locator('xpath=ancestor::*[@data-testid="hall"]')
const hallNames = () =>
  page
    .getByTestId('hall-name')
    .evaluateAll((all) => all.map((element) => (element as HTMLInputElement).value))

/**
 * Does something in the tab that calls a server action, and waits until the action has answered
 * and the page has the fresh data, so that what the test reads next is what was saved.
 */
async function act(trigger: () => Promise<unknown>) {
  const answered = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.request().headers()['next-action'] !== undefined,
  )
  await trigger()
  await answered
  await page.waitForLoadState('networkidle')
}

/** Opens a card's (or an area's) "more" menu and does one of its actions. */
async function menuAction(owner: Locator, menuId: 'table-menu' | 'hall-menu', actionId: string) {
  await owner.getByTestId(menuId).first().click()
  await act(() => page.getByTestId(actionId).click())
}

/** The address in a row's code, read from the enlarged picture's dialog. */
async function addressOf(row: Locator): Promise<string> {
  const dialog = page.getByTestId('qr-dialog')
  // A click that lands while the page is still settling (or while an earlier dialog is closing)
  // may not open it: try again until it opens.
  await expect(async () => {
    await row.getByTestId('qr-thumb').click()
    await expect(dialog).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  const address = (await dialog.getByTestId('qr-dialog-address').textContent()) ?? ''
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return address
}
const tokenOf = async (row: Locator) => (await addressOf(row)).split('/').at(-1) ?? ''
/** A code's published file and its tombstone are named after its SHA-256 (#70), never the code. */
const hashOf = (token: string) => createHash('sha256').update(token).digest('hex')

/** The SVG the row shows, from its `<img>`. */
async function pictureOf(row: Locator): Promise<string> {
  const src = (await row.getByTestId('qr-picture').first().getAttribute('src')) ?? ''
  const svg = svgFromDataUri(src)
  if (svg === null) throw new Error('the row’s code is not an SVG data picture')
  return svg
}

interface WorkerJob {
  retired: string[]
  result: { status: string; written?: number; removed?: number }
}

/** Runs the worker's job for what the tab queued; returns what each job was asked to do. */
function runWorker(): WorkerJob[] {
  return runScript('./scripts/seed-tables-e2e.ts', 'worker')
    .split('\n')
    .filter((line) => line.startsWith('{') && line.includes('"job"'))
    .map((line) => JSON.parse(line) as WorkerJob)
}

/** What the published file of a code says. */
async function fileOf(token: string) {
  const response = await page.request.get(`/cdn/t/${hashOf(token)}.json`)
  expect(response.status()).toBe(200)
  return (await response.json()) as { table_label: string; menu_id: string | null }
}

async function toast(text: string | RegExp) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible()
}

/** A guest's phone, in Bulgarian, in a context of its own. */
async function guestPhone(browserContext: BrowserContext): Promise<Page> {
  const browser = browserContext.browser()
  if (!browser) throw new Error('no browser')
  return (await browser.newContext({ ...devices['Pixel 7'], locale: 'bg-BG' })).newPage()
}

test.beforeAll(async ({ browser }) => {
  runScript('./scripts/seed-tables-e2e.ts', 'seed')
  venue = await addressOfVenue({ slug: GUEST_SLUG })
  context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, locale: 'bg-BG' })
  page = await context.newPage()
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
  origin = new URL(page.url()).origin
  venueUrl = page.url()
  tabUrl = `${venueUrl}?tab=tables`
  await page.goto(tabUrl)
  await expect(page.getByTestId('tables-tab')).toBeVisible()
})

test.afterAll(async () => {
  // The second menu belongs to this spec only: the other specs see the demo venue with one menu.
  runScript('./scripts/seed-tables-e2e.ts', 'second-menu-remove')
  await context.close()
})

test('lists the barsy areas as sections and their tables as cards, and creates a code for every one', async () => {
  await expect(page.getByTestId('hall-name')).toHaveCount(4)
  const names = await hallNames()
  // Tables the till puts in no hall land in an area called "Tables", last (D95).
  expect(names.at(-1)).toBe('Tables')
  expect([...names].sort()).toEqual(['VIP зона', 'Tables', 'Главна зала', 'Тераса'].sort())
  await expect(rows()).toHaveCount(8)
  await expect(page.getByTestId('code-status').filter({ hasText: 'Няма код' })).toHaveCount(8)
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 0 с код')
  // The name field says it is the name guests see, with the till's number beside it.
  await expect(rowOf('5').getByLabel('Име, което виждат гостите')).toBeVisible()
  // The hidden table is marked, and the print sheet waits for a code.
  await expect(rowOf('4').getByTestId('table-hidden')).toHaveText('Скрита')
  await expect(page.getByTestId('print-sheet-link')).toBeDisabled()
  // Each area and table says which menu its code opens: the venue's live one, nobody chose another.
  await expect(page.getByTestId('venue-menu')).toContainText('Менюто на заведението на живо')
  await expect(rowOf('5').getByTestId('route-select')).toContainText('На заведението')
  await expect(page.getByTestId('menu-overrides')).toHaveCount(0)

  // The address card only says where the codes lead: this installation's address. Nothing to type.
  const card = page.getByTestId('qr-address-card')
  await expect(page.getByTestId('qr-address')).toHaveText(`${origin}/t/<code>`)
  await expect(card.locator('input')).toHaveCount(0)
  await expect(page.getByTestId('qr-address-warning')).toContainText(
    'Вече отпечатаните стикери запазват адреса',
  )
  await expect(page.getByTestId('open-test-link')).toBeDisabled()

  // The hidden table (4) gets no code (D95): seven of the eight.
  await act(() => page.getByTestId('create-all').click())
  await toast('Създадени са 7 кода.')
  await expect(page.getByTestId('code-status').filter({ hasText: 'Кодът е активен' })).toHaveCount(
    7,
  )
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 7 с код')
  await expect(page.getByTestId('print-sheet-link')).toHaveAttribute(
    'href',
    `${new URL(venueUrl).pathname}/tables/print`,
  )
  await page.screenshot({ path: shot('tables-bg-light'), fullPage: true })
})

test('the code in each card encodes <base>/t/<token>, black on white, error correction M, margin 2', async () => {
  const count = await rows().count()
  const seen = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const row = rows().nth(index)
    // The hidden table has no code (D95).
    if ((await row.getByTestId('code-status').textContent()) === 'Няма код') continue
    const address = await addressOf(row)
    const token = address.split('/').at(-1) ?? ''
    expect(address).toBe(`${origin}/t/${token}`)
    expect(token).toMatch(TOKEN)
    expect(seen.has(token)).toBe(false)
    seen.add(token)

    // The picture is what the library makes for exactly that address.
    const svg = await pictureOf(row)
    expect(svg).toBe(await svgOf(address))
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('stroke="#000000"')
    const modules = QRCode.create(address, { errorCorrectionLevel: 'M' }).modules.size
    expect(svg).toContain(`viewBox="0 0 ${modules + 4} ${modules + 4}"`)
  }
  expect(seen.size).toBe(7)

  // A token holds nothing of the barsy place ids (9001 … 9008).
  for (const token of seen) expect(token).not.toMatch(/900[1-8]/)

  await rows().first().getByTestId('qr-thumb').click()
  await expect(page.getByTestId('qr-dialog')).toBeVisible()
  await page.screenshot({ path: shot('qr-enlarged-bg') })
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('qr-dialog')).toBeHidden()
})

test('the worker publishes the codes; then /t/<token> leads to the menu with the table’s name', async () => {
  const token = await tokenOf(rowOf('1'))
  // The web app only queues the job (it never writes the publish store); the real worker that runs
  // beside the e2e servers writes the files.
  const jobs = runWorker()
  // The real worker may take quick edits as one job or several: check what the last one left.
  expect(jobs.length).toBeGreaterThanOrEqual(1)
  expect(jobs.at(-1)?.result.status).toBe('done')
  expect(jobs.at(-1)?.result.written).toBe(7)

  const redirect = await page.request.get(`/t/${token}`, { maxRedirects: 0 })
  expect(redirect.status()).toBe(302)
  expect(redirect.headers().location).toBe(`${GUEST_PATH}#t=${token}`)
  const file = await page.request.get(`/cdn/t/${hashOf(token)}.json`)
  // The file also says which menu the code opens (D95): the venue's live menu, published.
  expect(await file.json()).toEqual({
    venue_public_id: venue.publicId,
    venue_slug: GUEST_SLUG,
    organization_slug: 'demo-club',
    table_label: '1',
    menu_id: expect.stringMatching(/^nd_[0-9A-Za-z]{22}$/),
  })

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${token}`)
  await guest.waitForURL(`**${GUEST_PATH}#t=${token}`)
  await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(guest.getByText('Маса 1', { exact: true })).toBeVisible()
  await guest.screenshot({ path: shot('guest-table-1-bg') })
  await guest.context().close()
})

test('a name given in the tab reaches the guest page, shown as it is', async () => {
  const row = rowOf('5')
  const input = row.getByTestId('table-name')
  await expect(input).toHaveAttribute('placeholder', '5')
  await input.fill('Тераса Е5')
  await act(() => input.press('Enter'))
  await expect(input).toHaveValue('Тераса Е5')
  const token = await tokenOf(row)

  const jobs = runWorker()
  expect(jobs.length).toBeGreaterThanOrEqual(1)
  expect(jobs.every((job) => job.retired.length === 0)).toBe(true)
  const file = await page.request.get(`/cdn/t/${hashOf(token)}.json`)
  expect(await file.json()).toEqual({
    venue_public_id: venue.publicId,
    venue_slug: GUEST_SLUG,
    organization_slug: 'demo-club',
    table_label: 'Тераса Е5',
    menu_id: expect.stringMatching(/^nd_[0-9A-Za-z]{22}$/),
  })

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${token}`)
  await expect(guest.getByText('Тераса Е5', { exact: true })).toBeVisible()
  await guest.context().close()

  // An empty name goes back to the till's number.
  await input.fill('')
  await act(() => input.press('Enter'))
  runWorker()
  expect(await (await page.request.get(`/cdn/t/${hashOf(token)}.json`)).json()).toMatchObject({
    table_label: '5',
  })
})

test('an area is renamed and moved; a table is hidden (its file goes), shown again and moved', async () => {
  await page.goto(tabUrl)
  const terrace = areaOfRow(rowOf('6'))
  const original = await terrace.getByTestId('hall-name').inputValue()
  expect(original).toBe('Тераса')
  try {
    // The area's name is ours over the till's, saved when the box is left.
    const name = terrace.getByTestId('hall-name')
    await name.fill('Покрив')
    await act(() => name.press('Enter'))
    await toast('Името на зоната е записано.')
    await page.reload()
    expect(await hallNames()).toContain('Покрив')
    expect(await hallNames()).not.toContain('Тераса')
    await page.screenshot({ path: shot('area-renamed-bg') })

    // The area moves up one place and back; the order is the area's own.
    const before = await hallNames()
    const roof = areaOfRow(rowOf('6'))
    const place = before.indexOf('Покрив')
    expect(place).toBeGreaterThan(0)
    await menuAction(roof, 'hall-menu', 'move-hall-up')
    await expect.poll(async () => (await hallNames()).indexOf('Покрив')).toBe(place - 1)
    await menuAction(areaOfRow(rowOf('6')), 'hall-menu', 'move-hall-down')
    await expect.poll(hallNames).toEqual(before)

    // A table is hidden: its card says so, its picture goes, and the job takes its file away.
    const six = rowOf('6')
    const token = await tokenOf(six)
    runWorker()
    expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(302)
    await menuAction(six, 'table-menu', 'toggle-hidden')
    await toast('Масата е скрита. Кодът ѝ е спрян.')
    await expect(six.getByTestId('table-hidden')).toHaveText('Скрита')
    await expect(six.getByTestId('code-status')).toHaveText('Кодът е спрян')
    await expect(six.getByTestId('qr-thumb')).toHaveCount(0)
    await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 6 с код')
    const hiding = runWorker().find((job) => job.retired.includes(hashOf(token)))
    expect(hiding?.retired).toEqual([hashOf(token)])
    expect(hiding?.result.removed).toBe(1)
    expect((await page.request.get(`/cdn/t/${hashOf(token)}.json`)).status()).toBe(404)
    expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(404)

    // The print sheet leaves a hidden table out (and its code is not drawn there).
    const sheetPage = await context.newPage()
    await sheetPage.goto(`${venueUrl}/tables/print`)
    await expect(sheetPage.getByTestId('print-card')).toHaveCount(6)
    await sheetPage.close()

    // Shown again: the same code comes back with the next job.
    await menuAction(six, 'table-menu', 'toggle-hidden')
    await toast('Масата е показана.')
    await expect(six.getByTestId('code-status')).toHaveText('Кодът е активен')
    await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 7 с код')
    runWorker()
    expect(await tokenOf(six)).toBe(token)
    expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(302)
    expect(await fileOf(token)).toMatchObject({ table_label: '6' })

    // Within its area a table moves up and down by one place.
    const order = () => areaOfRow(rowOf('6')).getByTestId('table-number').allTextContents()
    const numbers = await order()
    expect(numbers).toEqual(['от barsy: 5', 'от barsy: 6'])
    await menuAction(rowOf('6'), 'table-menu', 'move-up')
    await expect.poll(order).toEqual(['от barsy: 6', 'от barsy: 5'])
    await menuAction(rowOf('6'), 'table-menu', 'move-down')
    await expect.poll(order).toEqual(numbers)
  } finally {
    // Leave the demo venue as it was, whatever happened above.
    await page.goto(tabUrl)
    const roof = areaOfRow(rowOf('6'))
    const field = roof.getByTestId('hall-name')
    if ((await field.inputValue()) !== original) {
      await field.fill(original)
      await act(() => field.press('Enter'))
    }
  }
})

test('a menu chosen for an area or a table reaches the files of the codes after the job', async () => {
  const created = runScript('./scripts/seed-tables-e2e.ts', 'second-menu')
    .split('\n')
    .map((line) => (line.startsWith('{') ? (JSON.parse(line) as { menuId?: string }) : {}))
    .find((line) => line.menuId !== undefined)
  const late = created?.menuId ?? ''
  expect(late).toMatch(/^nd_[0-9A-Za-z]{22}$/)

  await page.goto(tabUrl)
  const three = rowOf('3')
  const one = rowOf('1')
  const hall = areaOfRow(three)
  const tokens = { one: await tokenOf(one), three: await tokenOf(three) }
  runWorker()
  const live = (await fileOf(tokens.three)).menu_id
  expect(live).toMatch(/^nd_/)
  expect(live).not.toBe(late)

  // The venue's menus are offered by name, the live one marked; the others by their own name.
  await three.getByTestId('route-select').click()
  const offered = await page.getByRole('option').allTextContents()
  expect(offered[0]).toBe('Като на зоната')
  expect(offered).toContain('Late night')
  expect(offered.some((text) => text.endsWith('(на живо)'))).toBe(true)
  await page.keyboard.press('Escape')

  // A table's own choice: the card says it overrides, and only its file changes.
  await three.getByTestId('route-select').click()
  await act(() => page.getByRole('option', { name: 'Late night' }).click())
  await toast('Менюто е записано.')
  await expect(three.getByTestId('menu-overrides')).toHaveText('Заменя')
  await expect(three.getByTestId('route-select')).toContainText('Late night')
  runWorker()
  expect((await fileOf(tokens.three)).menu_id).toBe(late)
  expect((await fileOf(tokens.one)).menu_id).toBe(live)
  await page.screenshot({ path: shot('menu-route-table-bg') })

  // An area's choice: its other tables follow it, and the table that chose for itself keeps its own.
  await hall.getByTestId('route-select').first().click()
  await act(() => page.getByRole('option', { name: 'Late night' }).click())
  await expect(hall.getByTestId('menu-overrides').first()).toHaveText('Заменя')
  runWorker()
  expect((await fileOf(tokens.one)).menu_id).toBe(late)
  expect((await fileOf(tokens.three)).menu_id).toBe(late)
  // The table's choice beats the area's: back to the venue's live menu for table 3 alone.
  await three.getByTestId('route-select').click()
  await act(() => page.getByRole('option', { name: /\(на живо\)$/ }).click())
  runWorker()
  expect((await fileOf(tokens.three)).menu_id).toBe(live)
  expect((await fileOf(tokens.one)).menu_id).toBe(late)
  await page.screenshot({ path: shot('menu-route-area-bg') })

  // Taking the choices away: every code goes back to the venue's live menu.
  await three.getByTestId('route-select').click()
  await act(() => page.getByRole('option', { name: 'Като на зоната' }).click())
  await hall.getByTestId('route-select').first().click()
  await act(() => page.getByRole('option', { name: 'Като на заведението' }).click())
  await expect(page.getByTestId('menu-overrides')).toHaveCount(0)
  runWorker()
  expect((await fileOf(tokens.one)).menu_id).toBe(live)
  expect((await fileOf(tokens.three)).menu_id).toBe(live)
})

test('"New code" asks first, and the old sticker then says the code is not active', async () => {
  const row = rowOf('2')
  const oldToken = await tokenOf(row)
  runWorker()
  expect((await page.request.get(`/t/${oldToken}`, { maxRedirects: 0 })).status()).toBe(302)

  await row.getByTestId('table-menu').click()
  await page.getByTestId('new-code').click()
  const dialog = page.getByTestId('confirm-new-code')
  await expect(dialog).toContainText('Нов код за маса 2?')
  await expect(dialog).toContainText('Стикерите, вече отпечатани със стария код, спират да работят')
  await page.screenshot({ path: shot('new-code-confirm-bg') })
  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Отказ' }).click()
  await expect(dialog).toBeHidden()
  expect(await tokenOf(row)).toBe(oldToken)

  await row.getByTestId('table-menu').click()
  await page.getByTestId('new-code').click()
  await act(() =>
    page.getByTestId('confirm-new-code').getByRole('button', { name: 'Направи нов код' }).click(),
  )
  await toast('Новият код е готов. Старият вече не работи.')
  // The page brings the new code a moment after the action answers.
  await expect.poll(() => tokenOf(row)).not.toBe(oldToken)
  const newToken = await tokenOf(row)
  expect(newToken).toMatch(TOKEN)

  // The job the tab queued names the old token: the worker takes its file out.
  const jobs = runWorker()
  const retiring = jobs.find((job) => job.retired.includes(hashOf(oldToken)))
  expect(retiring?.retired).toEqual([hashOf(oldToken)])
  expect(retiring?.result.removed).toBe(1)
  expect((await page.request.get(`/cdn/t/${hashOf(oldToken)}.json`)).status()).toBe(404)
  expect((await page.request.get(`/t/${oldToken}`, { maxRedirects: 0 })).status()).toBe(404)
  expect((await page.request.get(`/t/${newToken}`, { maxRedirects: 0 })).status()).toBe(302)

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${oldToken}`)
  await expect(guest.getByText('Този код за маса не е активен.')).toBeVisible()
  await expect(guest.getByText('This table code is not active.')).toBeVisible()
  await guest.screenshot({ path: shot('old-code-not-active') })
  await guest.context().close()
})

test('the address card is read-only, and its test link is opened by the browser', async () => {
  await page.goto(tabUrl)
  const card = page.getByTestId('qr-address-card')
  await expect(page.getByTestId('qr-address')).toHaveText(`${origin}/t/<code>`)
  // Nothing to type, choose or save in it; a domain of your own is announced for later.
  await expect(card.locator('input, select, textarea')).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Запиши адреса' })).toHaveCount(0)
  await expect(page.getByTestId('qr-address-domain')).toHaveText(
    'Собствен домейн за кодовете ще има по-късно.',
  )

  // The test link is the address of the first table with a code, opened in a new tab.
  const firstCoded = rows().filter({ hasText: 'Кодът е активен' }).first()
  const token = await tokenOf(firstCoded)
  const expected = `${origin}/t/${token}`
  const link = page.getByTestId('open-test-link')
  await expect(link).toHaveAttribute('href', expected)
  await expect(link).toHaveAttribute('target', '_blank')
  await page.screenshot({ path: shot('address-card-bg') })
  runWorker()
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()])
  await popup.waitForURL(`**${GUEST_PATH}#t=${token}`)
  await popup.close()
})

test('the print sheet has six cards on an A4 page, in a real PDF too, and stays white in a dark theme', async () => {
  const sheetPage = await context.newPage()
  await sheetPage.setViewportSize({ width: 1100, height: 1300 })
  await sheetPage.goto(`${venueUrl}/tables/print`)
  await expect(sheetPage.getByTestId('print-page')).toBeVisible()

  const sheets = sheetPage.getByTestId('print-sheet')
  await expect(sheets).toHaveCount(2)
  const cards = sheetPage.getByTestId('print-card')
  await expect(cards).toHaveCount(7)
  expect(await sheets.evaluateAll((all) => all.map((sheet) => sheet.dataset.cards))).toEqual([
    '6',
    '1',
  ])
  await expect(sheetPage.getByTestId('print-pages')).toHaveText('7 кода на 2 страници')

  // The cards go area by area, in the areas' order: the areas on the cards read as runs.
  const areas = await sheetPage.getByTestId('print-area').allTextContents()
  expect(areas).toHaveLength(7)
  const runs = areas.filter((area, index) => index === 0 || area !== areas[index - 1])
  expect(new Set(runs).size).toBe(runs.length)

  // Every card: the venue, "Маса / Table", the table, the code, the address as text, the scan line.
  const host = origin.replace(/^https?:\/\//, '')
  for (let index = 0; index < 7; index += 1) {
    const card = cards.nth(index)
    // The card shows the venue's logo, with its name as the text alternative, or the name itself
    // when the venue has no logo (the demo venue has none unless a test has given it one).
    const logo = card.getByRole('img', { name: 'Demo Club Sofia' })
    await expect(logo.or(card.getByText('Demo Club Sofia', { exact: true }))).toBeVisible()
    if ((await logo.count()) > 0) {
      expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(
        0,
      )
    }
    await expect(card).toContainText('Маса / Table')
    await expect(card).toContainText('Сканирайте за менюто / Scan for the menu')
    const text = (await card.getByTestId('print-address').textContent()) ?? ''
    expect(text).toMatch(new RegExp(`^${host}/t/[0-9A-Za-z]{22}$`))
    // The code on the card is the code of that very address.
    const svg = svgFromDataUri((await card.getByTestId('print-qr').getAttribute('src')) ?? '')
    expect(svg).toBe(await svgOf(`${origin.split('//')[0]}//${text}`))
  }
  const firstSvg = (await cards.first().getByTestId('print-qr').getAttribute('src')) ?? ''

  // On the screen a sheet is an A4 page (210 × 296 mm at 96 dpi), laid out two across, three down.
  const box = await sheets.first().boundingBox()
  expect(Math.round(box?.width ?? 0)).toBe(Math.round((210 / 25.4) * 96))
  expect(Math.round(box?.height ?? 0)).toBe(Math.round((296 / 25.4) * 96))
  const positions = await cards.evaluateAll((all) =>
    all.slice(0, 6).map((card) => {
      const rect = card.getBoundingClientRect()
      return [Math.round(rect.x), Math.round(rect.y)]
    }),
  )
  expect(new Set(positions.map(([x]) => x)).size).toBe(2)
  expect(new Set(positions.map(([, y]) => y)).size).toBe(3)
  await sheetPage.screenshot({ path: shot('print-sheet-bg'), fullPage: true })

  // A real PDF, as the browser's "Save as PDF" makes it: two A4 pages.
  await sheetPage.emulateMedia({ media: 'print' })
  const pdf = await sheetPage.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true })
  expect(pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).toHaveLength(2)
  writeFileSync(`${SHOTS}/s5-print-sheet.pdf`, pdf)
  // The toolbar is for the screen only.
  await expect(sheetPage.locator('.pc-toolbar')).toBeHidden()
  await sheetPage.emulateMedia({ media: null })

  // The same sheet on a dark screen is still black on white: a code must scan whatever the theme is.
  await sheetPage.emulateMedia({ colorScheme: 'dark' })
  await sheetPage.reload()
  await expect(sheetPage.getByTestId('print-page')).toBeVisible()
  expect(
    await sheetPage.evaluate(
      () => getComputedStyle(document.querySelector('.pc-root') as Element).backgroundColor,
    ),
  ).toBe('rgb(255, 255, 255)')
  expect(await cards.first().getByTestId('print-qr').getAttribute('src')).toBe(firstSvg)
  await sheetPage.screenshot({ path: shot('print-sheet-dark') })
  await sheetPage.close()
})

test('downloads the code as PNG and SVG, and gives nothing to a stranger', async () => {
  await page.goto(tabUrl)
  const row = rowOf('3')
  // The downloads are in the enlarged picture's dialog.
  await row.getByTestId('qr-thumb').click()
  const dialog = page.getByTestId('qr-dialog')
  await expect(dialog).toBeVisible()
  const address = (await dialog.getByTestId('qr-dialog-address').textContent()) ?? ''

  const [png] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByTestId('download-png').click(),
  ])
  expect(png.suggestedFilename()).toBe('restro-table-3.png')
  const pngBytes = readFileSync((await png.path()) as string)
  expect([...pngBytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // 1024 pixels wide: the width is in the PNG header.
  expect(pngBytes.readUInt32BE(16)).toBe(1024)

  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByTestId('download-svg').click(),
  ])
  expect(svg.suggestedFilename()).toBe('restro-table-3.svg')
  const text = readFileSync((await svg.path()) as string, 'utf8')
  expect(text).toBe(await svgOf(address, 1024))
  await page.keyboard.press('Escape')

  expect((await page.request.get('/api/tables/tb_nope/qr?format=png')).status()).toBe(404)
  const tableId = (await row.getAttribute('data-table-id')) ?? ''
  const stranger = await (await context.browser()?.newContext())?.newPage()
  if (!stranger) throw new Error('no page')
  expect(
    (await stranger.request.get(`${origin}/api/tables/${tableId}/qr?format=png`)).status(),
  ).toBe(401)
  await stranger.context().close()
})

test('"Turn off code" asks first, and the sticker then says the code is not active', async () => {
  await page.goto(tabUrl)
  const row = rowOf('6')
  const token = await tokenOf(row)
  runWorker()
  expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(302)

  await row.getByTestId('table-menu').click()
  await page.getByTestId('turn-off-code').click()
  await expect(page.getByTestId('confirm-turn-off-code')).toContainText(
    'Да изключа ли кода на маса 6?',
  )
  await act(() =>
    page.getByTestId('confirm-turn-off-code').getByRole('button', { name: 'Изключи' }).click(),
  )
  await expect(row.getByTestId('code-status')).toHaveText('Няма код')
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 6 с код')

  const jobs = runWorker()
  expect(jobs.find((job) => job.retired.includes(hashOf(token)))?.retired).toEqual([hashOf(token)])
  expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(404)

  // And a code can be made again, a different one.
  await row.getByTestId('table-menu').click()
  await act(() => page.getByTestId('create-code').click())
  await expect(row.getByTestId('code-status')).toHaveText('Кодът е активен')
  runWorker()
  await expect.poll(() => tokenOf(row)).not.toBe(token)
  const again = await tokenOf(row)
  expect((await page.request.get(`/t/${again}`, { maxRedirects: 0 })).status()).toBe(302)
})

test('screenshots: English, dark, and a phone', async () => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: origin }])
  await page.goto(tabUrl)
  await expect(page.getByTestId('tables-summary')).toHaveText('8 tables, 7 with a code')
  await expect(page.getByText('Address in the codes')).toBeVisible()
  await expect(page.getByTestId('table-number').filter({ hasText: 'from barsy: 5' })).toBeVisible()
  await page.screenshot({ path: shot('tables-en-light'), fullPage: true })

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.reload()
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  await page.screenshot({ path: shot('tables-en-dark'), fullPage: true })
  // A code is black on white in a dark theme too: its picture carries its own white.
  expect(await pictureOf(rows().first())).toContain('fill="#ffffff"')

  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByTestId('tables-tab')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.screenshot({ path: shot('tables-en-phone'), fullPage: true })

  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'bg', url: origin }])
  await page.setViewportSize({ width: 1280, height: 1100 })
  await page.reload()
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 7 с код')
})
