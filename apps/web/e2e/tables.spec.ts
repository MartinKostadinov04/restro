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
import { ADMIN_EMAIL, ADMIN_PASSWORD, GUEST_SLUG } from './support'

// The Tables & QR tab on a production build (brief S3-07, D61), in Bulgarian, against the demo
// venue with eight barsy tables (scripts/seed-tables-e2e.ts):
//
//   1. the tables by hall; "Create codes for all tables"; the code in a row IS the address
//      <base>/t/<token> (the SVG is compared with what the `qrcode` library makes for that text,
//      error correction M, margin 2, black on white);
//   2. nothing is public until the worker has run (the web app never writes the publish store):
//      before it, /t/<token> says "not active"; after it, it leads to the menu with "Маса 1";
//   3. a new name reaches the guest page; "New code" makes the old sticker say "not active";
//   4. the venue's own link: the pattern is checked while typed, previewed with a real table's
//      code, opened by the BROWSER in a new tab (the test answers that address itself, so nothing
//      leaves the machine), and the codes then carry it;
//   5. the print sheet has six cards on an A4 page (counted on the screen and in a real PDF);
//   6. downloads, the guide, turning a code off, and the picture in both languages and themes.
//
// The worker does not run here: `seed-tables-e2e.ts worker` takes the queued jobs and runs the
// worker's own `writeTableTokenFiles` for them. Screenshots go to `.local/screenshots/s3/`
// (E2E_SCREENSHOT_DIR elsewhere), as s3-07-*.png.
test.describe.configure({ mode: 'serial' })

const SHOTS = (
  process.env.E2E_SCREENSHOT_DIR ??
  fileURLToPath(new URL('../../../.local/screenshots/s3/', import.meta.url))
).replace(/[\\/]+$/, '')
mkdirSync(SHOTS, { recursive: true })
const shot = (name: string) => `${SHOTS}/s3-07-${name}.png`

/** Exactly how the app draws a code: error correction M, a quiet zone of 2, black on white. */
const QR_OPTIONS = {
  errorCorrectionLevel: 'M',
  margin: 2,
  color: { dark: '#000000', light: '#ffffff' },
} as const
const svgOf = (text: string, width?: number) =>
  QRCode.toString(text, { ...QR_OPTIONS, type: 'svg', ...(width === undefined ? {} : { width }) })

const OWN_PATTERN = 'https://menu.venue.invalid/t/{token}'
const TOKEN = /^[0-9A-Za-z]{22}$/

let context: BrowserContext
let page: Page
let tabUrl: string
let venueUrl: string
let origin: string

// --- helpers ---------------------------------------------------------------------------------
const rows = () => page.getByTestId('table-row')
const rowOf = (number: string): Locator =>
  rows().filter({
    has: page.getByTestId('table-number').filter({ hasText: new RegExp(`^номер в barsy: ${number}$`) }),
  })

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

/** The address in a row's code, read from the enlarged picture's dialog. */
async function addressOf(row: Locator): Promise<string> {
  await row.getByTestId('qr-thumb').click()
  const dialog = page.getByTestId('qr-dialog')
  await expect(dialog).toBeVisible()
  const address = (await dialog.getByTestId('qr-dialog-address').textContent()) ?? ''
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  return address
}
const tokenOf = async (row: Locator) => (await addressOf(row)).split('/').at(-1) ?? ''

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
  await context.close()
})

test('lists the barsy tables by hall and creates a code for every one', async () => {
  const halls = page.getByTestId('hall-name')
  await expect(halls).toHaveCount(4)
  const names = await halls.allTextContents()
  expect(names.at(-1)).toBe('Без салон')
  expect([...names].sort()).toEqual(['VIP зона', 'Без салон', 'Главна зала', 'Тераса'].sort())
  await expect(rows()).toHaveCount(8)
  await expect(page.getByTestId('code-status').filter({ hasText: 'Няма код' })).toHaveCount(8)
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 0 с код')
  // The hidden table is marked, and the print sheet waits for a code.
  await expect(rowOf('4').getByText('Скрита')).toBeVisible()
  await expect(page.getByTestId('print-sheet-link')).toBeDisabled()

  // The base address the codes carry: this app's own address, typed in the card.
  await page.getByTestId('base-url').fill(origin)
  await expect(page.getByTestId('qr-preview')).toHaveText(`${origin}/t/${'x'.repeat(22)}`)
  await act(() => page.getByRole('button', { name: 'Запиши адреса' }).click())
  await expect(page.getByTestId('address-unsaved')).toBeHidden()

  await act(() => page.getByTestId('create-all').click())
  await toast('Създадени са 8 кода.')
  await expect(page.getByTestId('code-status').filter({ hasText: 'Кодът е активен' })).toHaveCount(
    8,
  )
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 8 с код')
  await expect(page.getByTestId('print-sheet-link')).toHaveAttribute(
    'href',
    `${new URL(venueUrl).pathname}/tables/print`,
  )
  // The preview now uses a real table's code.
  await expect(page.getByTestId('qr-preview')).toContainText(`${origin}/t/`)
  await page.screenshot({ path: shot('tables-bg-light'), fullPage: true })
})

test('the code in each row encodes <base>/t/<token>, black on white, error correction M, margin 2', async () => {
  const count = await rows().count()
  const seen = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const row = rows().nth(index)
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
  expect(seen.size).toBe(8)

  // A token holds nothing of the barsy place ids (9001 … 9008).
  for (const token of seen) expect(token).not.toMatch(/900[1-8]/)

  await rows().first().getByTestId('qr-thumb').click()
  await expect(page.getByTestId('qr-dialog')).toBeVisible()
  await page.screenshot({ path: shot('qr-enlarged-bg') })
  await page.keyboard.press('Escape')
})

test('nothing is public until the worker has run; then /t/<token> leads to the menu with the table’s name', async () => {
  const token = await tokenOf(rowOf('1'))
  // The web app only queued the job: it never writes the publish store.
  expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(404)

  const jobs = runWorker()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.result.status).toBe('done')
  expect(jobs[0]?.result.written).toBe(8)

  const redirect = await page.request.get(`/t/${token}`, { maxRedirects: 0 })
  expect(redirect.status()).toBe(302)
  expect(redirect.headers().location).toBe(`/m/${GUEST_SLUG}?t=${token}`)
  const file = await page.request.get(`/cdn/t/${token}.json`)
  expect(await file.json()).toEqual({ venue_slug: GUEST_SLUG, table_label: '1' })

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${token}`)
  await guest.waitForURL(`**/m/${GUEST_SLUG}?t=${token}`)
  await expect(guest.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(guest.getByRole('status').filter({ hasText: 'Маса 1' })).toBeVisible()
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
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.retired).toEqual([])
  const file = await page.request.get(`/cdn/t/${token}.json`)
  expect(await file.json()).toEqual({ venue_slug: GUEST_SLUG, table_label: 'Тераса Е5' })

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${token}`)
  await expect(guest.getByRole('status').filter({ hasText: 'Тераса Е5' })).toBeVisible()
  await guest.context().close()

  // An empty name goes back to barsy's number.
  await input.fill('')
  await act(() => input.press('Enter'))
  runWorker()
  expect(await (await page.request.get(`/cdn/t/${token}.json`)).json()).toMatchObject({
    table_label: '5',
  })
})

test('"New code" asks first, and the old sticker then says the code is not active', async () => {
  const row = rowOf('2')
  const oldToken = await tokenOf(row)
  runWorker()
  expect((await page.request.get(`/t/${oldToken}`, { maxRedirects: 0 })).status()).toBe(302)

  await row.getByTestId('new-code').click()
  const dialog = page.getByTestId('confirm-new-code')
  await expect(dialog).toContainText('Нов код за маса 2?')
  await expect(dialog).toContainText('Стикерите, вече отпечатани със стария код, спират да работят')
  await page.screenshot({ path: shot('new-code-confirm-bg') })
  // Cancel changes nothing.
  await dialog.getByRole('button', { name: 'Отказ' }).click()
  await expect(dialog).toBeHidden()
  expect(await tokenOf(row)).toBe(oldToken)

  await row.getByTestId('new-code').click()
  await act(() =>
    page.getByTestId('confirm-new-code').getByRole('button', { name: 'Направи нов код' }).click(),
  )
  await toast('Новият код е готов. Старият вече не работи.')
  const newToken = await tokenOf(row)
  expect(newToken).toMatch(TOKEN)
  expect(newToken).not.toBe(oldToken)

  // The job the tab queued names the old token: the worker takes its file out.
  const jobs = runWorker()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.retired).toEqual([oldToken])
  expect(jobs[0]?.result.removed).toBe(1)
  expect((await page.request.get(`/cdn/t/${oldToken}.json`)).status()).toBe(404)
  expect((await page.request.get(`/t/${oldToken}`, { maxRedirects: 0 })).status()).toBe(404)
  expect((await page.request.get(`/t/${newToken}`, { maxRedirects: 0 })).status()).toBe(302)

  const guest = await guestPhone(context)
  await guest.goto(`${origin}/t/${oldToken}`)
  await expect(guest.getByText('Този код за маса не е активен.')).toBeVisible()
  await expect(guest.getByText('This table code is not active.')).toBeVisible()
  await guest.screenshot({ path: shot('old-code-not-active') })
  await guest.context().close()
})

test('the venue’s own link: checked while typed, previewed, opened by the browser, and the codes carry it', async () => {
  await page.goto(tabUrl)
  const firstToken = await tokenOf(rows().first())

  await page.getByTestId('mode-own').check()
  const field = page.getByTestId('own-pattern')
  await expect(page.getByRole('button', { name: 'Запиши адреса' })).toBeDisabled()

  // Checked as it is typed.
  await field.fill('https://menu.venue.invalid/t/')
  await expect(page.getByTestId('pattern-help')).toContainText('Шаблонът трябва да съдържа {token}')
  await field.fill('http://menu.venue.invalid/t/{token}')
  await expect(page.getByTestId('pattern-help')).toContainText('Използвайте https://')
  await expect(page.getByRole('button', { name: 'Запиши адреса' })).toBeDisabled()
  await field.fill(OWN_PATTERN)

  // The preview uses the first table's real code; the test link is that address.
  const expected = OWN_PATTERN.replace('{token}', firstToken)
  await expect(page.getByTestId('qr-preview')).toHaveText(expected)
  const link = page.getByTestId('open-test-link')
  await expect(link).toHaveAttribute('href', expected)
  await expect(link).toHaveAttribute('target', '_blank')
  await page.screenshot({ path: shot('own-link-bg') })

  // The BROWSER opens it, in a new tab. The test answers for that address, so nothing leaves the
  // machine, and the page the person lands on is the venue's own.
  const requested: string[] = []
  await context.route('https://menu.venue.invalid/**', async (route) => {
    requested.push(route.request().url())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>forwarded</h1>' })
  })
  const [popup] = await Promise.all([context.waitForEvent('page'), link.click()])
  await popup.waitForLoadState()
  expect(popup.url()).toBe(expected)
  await expect(popup.getByRole('heading', { name: 'forwarded' })).toBeVisible()
  expect(requested).toEqual([expected])
  await popup.close()

  // Saved: the codes in the rows now carry the venue's own address.
  await act(() => page.getByRole('button', { name: 'Запиши адреса' }).click())
  const row = rows().first()
  const address = await addressOf(row)
  expect(address).toBe(expected)
  expect(await pictureOf(row)).toBe(await svgOf(expected))
  // Nothing but the browser asked for that address: the server never opened it.
  expect(requested).toEqual([expected])
  await page.reload()
  await expect(page.getByTestId('mode-own')).toBeChecked()
  await expect(page.getByTestId('own-pattern')).toHaveValue(OWN_PATTERN)
})

test('the guide explains both kinds of link and leads back to the tab', async () => {
  await page.getByTestId('guide-link').click()
  await expect(page).toHaveURL(/\/guides\/qr-links\?venue=vn_/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'QR кодове за масите: нашият линк или собствен линк на заведението',
  )
  await expect(page.getByTestId('guide-body')).toContainText('Cloudflare')
  await expect(page.getByTestId('guide-body')).toContainText('Redirect Rules')
  await expect(page.getByTestId('guide-body').locator('pre').first()).toContainText('RedirectMatch')
  await page.screenshot({ path: shot('guide-bg'), fullPage: true })
  await page.getByTestId('guide-back').click()
  await expect(page).toHaveURL(/\?tab=tables$/)
  await expect(page.getByTestId('tables-tab')).toBeVisible()

  // Back to our own link for the rest.
  await page.getByTestId('mode-ours').check()
  await act(() => page.getByRole('button', { name: 'Запиши адреса' }).click())
  expect(await addressOf(rows().first())).toMatch(new RegExp(`^${origin}/t/`))
})

test('the print sheet has six cards on an A4 page, in a real PDF too, and stays white in a dark theme', async () => {
  const sheetPage = await context.newPage()
  await sheetPage.setViewportSize({ width: 1100, height: 1300 })
  await sheetPage.goto(`${venueUrl}/tables/print`)
  await expect(sheetPage.getByTestId('print-page')).toBeVisible()

  const sheets = sheetPage.getByTestId('print-sheet')
  await expect(sheets).toHaveCount(2)
  const cards = sheetPage.getByTestId('print-card')
  await expect(cards).toHaveCount(8)
  expect(await sheets.evaluateAll((all) => all.map((sheet) => sheet.dataset.cards))).toEqual([
    '6',
    '2',
  ])
  await expect(sheetPage.getByTestId('print-pages')).toHaveText('8 кода на 2 страници')

  // Every card: the venue, "Маса / Table", the table, the code, the address as text, the scan line.
  const host = origin.replace(/^https?:\/\//, '')
  for (let index = 0; index < 8; index += 1) {
    const card = cards.nth(index)
    // The demo venue has a logo (the guest page's test gives it one): the card shows it, with the
    // venue's name as its text alternative; a venue without a logo shows the name itself.
    const logo = card.getByRole('img', { name: 'Demo Club Sofia' })
    await expect(logo).toBeVisible()
    expect(await logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
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
  writeFileSync(`${SHOTS}/s3-07-print-sheet.pdf`, pdf)
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
  const address = await addressOf(row)

  const [png] = await Promise.all([
    page.waitForEvent('download'),
    row.getByTestId('download-png').click(),
  ])
  expect(png.suggestedFilename()).toBe('restro-table-3.png')
  const pngBytes = readFileSync((await png.path()) as string)
  expect([...pngBytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // 1024 pixels wide: the width is in the PNG header.
  expect(pngBytes.readUInt32BE(16)).toBe(1024)

  const [svg] = await Promise.all([
    page.waitForEvent('download'),
    row.getByTestId('download-svg').click(),
  ])
  expect(svg.suggestedFilename()).toBe('restro-table-3.svg')
  const text = readFileSync((await svg.path()) as string, 'utf8')
  expect(text).toBe(await svgOf(address, 1024))

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
  const row = rowOf('6')
  const token = await tokenOf(row)
  runWorker()
  expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(302)

  await row.getByTestId('turn-off-code').click()
  await expect(page.getByTestId('confirm-turn-off-code')).toContainText(
    'Да изключа ли кода на маса 6?',
  )
  await act(() =>
    page.getByTestId('confirm-turn-off-code').getByRole('button', { name: 'Изключи' }).click(),
  )
  await expect(row.getByTestId('code-status')).toHaveText('Няма код')
  await expect(row.getByTestId('create-code')).toBeVisible()
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 7 с код')

  const jobs = runWorker()
  expect(jobs).toHaveLength(1)
  expect(jobs[0]?.retired).toEqual([token])
  expect((await page.request.get(`/t/${token}`, { maxRedirects: 0 })).status()).toBe(404)

  // And a code can be made again, a different one.
  await act(() => row.getByTestId('create-code').click())
  await expect(row.getByTestId('code-status')).toHaveText('Кодът е активен')
  runWorker()
  const again = await tokenOf(row)
  expect(again).not.toBe(token)
  expect((await page.request.get(`/t/${again}`, { maxRedirects: 0 })).status()).toBe(302)
})

test('screenshots: English, dark, and a phone', async () => {
  await context.addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: origin }])
  await page.goto(tabUrl)
  await expect(page.getByTestId('tables-summary')).toHaveText('8 tables, 8 with a code')
  await expect(page.getByText('Address in the codes')).toBeVisible()
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
  await expect(page.getByTestId('tables-summary')).toHaveText('8 маси, 8 с код')
})
