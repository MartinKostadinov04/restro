import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Locator, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import {
  ADMIN_PASSWORD,
  INTEGRATION_MEMBER_EMAIL,
  INTEGRATION_OWNER_EMAIL,
  INTEGRATION_VENUE_NAME,
} from './support'

// Settings -> Integrations, source-agnostic, and the venue's Menu source on a production build, in
// Bulgarian, with no worker running for barsy: the test plays the worker by running the fixtures
// script's `worker`, `link` and `history` steps, which write through core's writers what a
// connection check, the new-venue flow of a POS venue and a pull would leave behind (status
// connected, the installation's venues, a venue serving one of them, finished runs). The web
// servers hold a throwaway sealing public key (playwright.config.ts). Steps:
//
//   nothing chosen -> an empty list; the venue is made by hand, so its Menu source shows nothing
//   choose barsy in the systems picker -> a tab appears, with the form to add a connection
//   add "barsy – E2E" -> "Credentials saved", status "not checked yet", a check queued, no secret anywhere
//   the worker answers -> the page notices by itself (it polls while a job waits)
//   the system settings card (allergen characteristic, language of untagged text) is saved and shown back
//   the venue serves a venue of the system -> its Menu source: instance, venue, price shown, sync
//   "Sync this venue" and "Sync everything now" queue pulls; the history is one line, the list opens
//   removing the instance, and unselecting barsy, are refused while a venue uses it
//   a second connection is added, refused for a used address, and removed; it is gone after a reload
//   a plain member -> sees everything, can change nothing; an old ?tab=integration opens Settings
//
// With SCREENSHOT_DIR set, it saves the screenshots (BG and EN, light and dark, phone) there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

let page: Page
let db: pg.Pool
/** The organisation's venue, once the test has found it (it serves a till venue after `link`). */
let venueUrl = ''
let venueId = ''

const syncAll = (target: Page | Locator) =>
  target.getByRole('button', { name: 'Синхронизирай всичко сега' })
const syncVenue = (target: Page) =>
  target.getByRole('button', { name: 'Синхронизирай това заведение' })
/** One instance panel, found by the name the owner gave it. */
const instance = (target: Page, name: string) =>
  target.getByTestId('instance').filter({
    has: target.getByRole('heading', { name, level: 3, exact: true }),
  })
const systemsPicker = (target: Page) => target.getByTestId('systems-picker')
const barsyBox = (target: Page) => systemsPicker(target).getByRole('checkbox', { name: /barsy/ })

/** The queue rows of this venue's organisation, newest first (the web app's producer wrote them). */
async function jobs(name: string) {
  const result = await db.query<{ name: string; state: string; data: Record<string, string> }>(
    `select name, state, data from pgboss.job where name = $1 order by created_on desc limit 5`,
    [name],
  )
  return result.rows
}

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

async function openSettings(target: Page) {
  await target.goto('/settings/integrations')
  await expect(target.getByTestId('integration-panel')).toBeVisible()
}

async function snapshot(fileName: string, target: Page = page) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await target.screenshot({ path: path.join(dir, fileName), fullPage: true })
}

test.beforeAll(async ({ browser }) => {
  db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  await signIn(page, INTEGRATION_OWNER_EMAIL)
  await openSettings(page)
})

test.afterAll(async () => {
  await page.close()
  await db.end()
})

test('nothing chosen yet: the picker and an empty state, and a hand-made venue shows no Menu source', async () => {
  await expect(page.getByRole('heading', { name: 'Системи', level: 3 })).toBeVisible()
  await expect(barsyBox(page)).toHaveAttribute('aria-checked', 'false')
  await expect(systemsPicker(page).getByTestId('system-instances')).toHaveText('няма връзки')
  await expect(page.getByTestId('systems-empty')).toContainText('Още няма избрана система')
  await expect(page.getByTestId('instance')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.getByTestId('read-only')).toHaveCount(0)

  // The organisation's venue is made by hand: its Settings tab has no Menu source at all.
  await page.goto('/venues')
  await page
    .getByTestId('venue-card')
    .filter({ hasText: INTEGRATION_VENUE_NAME })
    .getByRole('link', { name: 'Отвори' })
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}/)
  venueUrl = new URL(page.url()).pathname
  venueId = venueUrl.split('/').pop() ?? ''
  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page.getByRole('heading', { name: INTEGRATION_VENUE_NAME, level: 1 })).toBeVisible()
  // The card is drawn after the tab's data is read: wait for the skeleton to go, then it is absent.
  await expect(page.getByTestId('menu-source-skeleton')).toHaveCount(0)
  await expect(page.getByTestId('menu-source')).toHaveCount(0)
  await openSettings(page)
  await snapshot('s1-integrations-empty-bg-light-desktop.png')
})

test('choosing barsy gives it a tab with the form to add a connection, and the choice is saved', async () => {
  const save = page.getByRole('button', { name: 'Запази системите' })
  await expect(save).toBeDisabled()
  await barsyBox(page).click()
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText('Системите са запазени.')).toBeVisible()

  await expect(page.getByRole('tab', { name: 'barsy' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('add-instance-form')).toBeVisible()
  await expect(page.getByTestId('systems-empty')).toHaveCount(0)

  // Stored, so it survives a reload; the open tab is in the address.
  await page.reload()
  await expect(barsyBox(page)).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('tab', { name: 'barsy' })).toBeVisible()
})

test('adding a connection: "Credentials saved", status "not checked yet", a check queued, no secret anywhere', async () => {
  const password = 'e2e-password-that-must-not-leak'
  const form = page.getByTestId('add-instance-form')
  await form.getByLabel('Име').fill('barsy – E2E')
  await form.getByLabel('Адрес на barsy').fill('https://e2e-club.barsyonline.com')
  await form.getByLabel('API потребител').fill('e2e-api-user')
  await form.getByLabel('Парола').fill(password)
  await form.getByRole('button', { name: 'Запази и провери' }).click()

  const e2e = instance(page, 'barsy – E2E')
  await expect(e2e).toBeVisible()
  await expect(e2e.getByTestId('credentials-saved')).toContainText('Данните за достъп са запазени')
  await expect(e2e.getByTestId('status-badge')).toHaveAttribute('data-status', 'new')
  await expect(e2e.getByTestId('status-badge')).toHaveText('Още не е проверено')
  await expect(e2e.getByTestId('status-details')).toContainText('e2e-club.barsyonline.com')
  await expect(page.getByTestId('add-instance-form')).toHaveCount(0)
  // Neither the password nor the user name is anywhere on the page, then or after a reload.
  for (const secret of [password, 'e2e-api-user']) {
    expect(await page.content()).not.toContain(secret)
  }
  await page.reload()
  await expect(e2e.getByTestId('credentials-saved')).toBeVisible()
  expect(await page.content()).not.toContain(password)

  // The check is in the queue (pg-boss's job table), for this instance and no secret in it.
  const queued = await jobs('barsy-connect')
  expect(queued[0]).toMatchObject({ name: 'barsy-connect', state: 'created' })
  expect(Object.keys(queued[0]?.data ?? {}).sort()).toEqual(['integrationId', 'tenantId'])
  expect(JSON.stringify(queued)).not.toContain(password)

  // While the job waits the page says so.
  await expect(e2e.getByTestId('status-active')).toHaveText('Проверка на връзката…')
  await expect(syncAll(e2e)).toBeDisabled()
  await expect(e2e.getByTestId('sync-blocked')).toHaveText(
    'Връзката се проверява. Изчакайте да приключи.',
  )
  await expect(systemsPicker(page).getByTestId('system-instances')).toHaveText('1 връзка')
})

test('the worker answers: the page notices by itself; no venue uses the connection yet', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'worker')
  const e2e = instance(page, 'barsy – E2E')
  // No reload: the page polls about every 3 seconds while a job waits.
  await expect(e2e.getByTestId('status-badge')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  })
  await expect(e2e.getByTestId('status-badge')).toHaveText('Свързано')
  await expect(e2e.getByTestId('status-active')).toHaveCount(0)
  await expect(e2e.getByTestId('instance-venues')).toHaveText(
    'Още няма заведение, което ползва тази връзка.',
  )
  // The history is one line: the last run, and the list stays closed.
  await expect(e2e.getByTestId('history-last')).toContainText('Проверка на връзката')
  await expect(e2e.getByTestId('run-row')).toHaveCount(0)
  await expect(e2e.getByTestId('sync-blocked')).toHaveText(
    'Още няма заведение, което ползва тази връзка.',
  )
})

test('the system settings card holds the allergen characteristic and the language, saved and shown back', async () => {
  const e2e = instance(page, 'barsy – E2E')
  await expect(
    e2e.getByRole('heading', { name: 'Как се четат данните от barsy', level: 3 }),
  ).toBeVisible()
  // Nothing else is set on the connection: no price, no schedule, no category (they are each venue's).
  await expect(e2e.getByRole('radio')).toHaveCount(0)
  await expect(e2e.getByRole('switch')).toHaveCount(0)
  await expect(e2e.getByRole('combobox', { name: 'Характеристика за алергени' })).toContainText(
    'Автоматично откриване (Алергени)',
  )
  await e2e.getByRole('combobox', { name: 'Език на текста без етикет' }).click()
  await page.getByRole('option', { name: /английски/i }).click()
  await e2e.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    e2e.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
  await page.reload()
  await expect(
    instance(page, 'barsy – E2E').getByRole('combobox', { name: 'Език на текста без етикет' }),
  ).toContainText(/английски/i)
  // Back to the default, so the test can run again.
  await page
    .getByTestId('instance')
    .getByRole('combobox', { name: 'Език на текста без етикет' })
    .click()
  await page.getByRole('option', { name: /български/i }).click()
  await page.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    page.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
})

test('a venue that serves a venue of the system shows its Menu source: instance, venue, price, sync', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'link')
  await openSettings(page)
  await expect(instance(page, 'barsy – E2E').getByTestId('instance-venues')).toHaveText(
    `Ползва се от 1 заведение: ${INTEGRATION_VENUE_NAME}.`,
  )

  await page.goto(`${venueUrl}?tab=settings`)
  await expect(page.getByTestId('menu-source')).toBeVisible()
  // The common part: where the menu comes from, read-only (a venue's source never changes).
  await expect(page.getByTestId('menu-source-instance')).toHaveText('barsy – E2E')
  await expect(page.getByTestId('menu-source-venue')).toHaveText('Main bar')
  await expect(
    page.getByTestId('menu-source').getByRole('button', { name: /Смени|Свържи/ }),
  ).toHaveCount(0)
  await expect(page.getByTestId('catalogue-tree')).toHaveCount(0)
  await expect(syncVenue(page)).toBeEnabled()
  await expect(page.getByTestId('sync-blocked')).toHaveCount(0)
  await expect(page.getByTestId('sync-last')).toHaveText('Още не е синхронизирано.')

  // The connector's part: the price shown, Base by default; Current carries the warning.
  await expect(page.getByRole('radio', { name: /Базова цена/ })).toBeChecked()
  await expect(page.getByTestId('price-warning')).toHaveCount(0)
  await page.getByRole('radio', { name: /Текуща цена/ }).click()
  await expect(page.getByTestId('price-warning')).toContainText(
    'Правилата по часове, например щастлив час, могат да се покажат в менюто със закъснение',
  )
  await page.getByRole('button', { name: 'Запази цената' }).click()
  await expect(page.getByText('Запазено. Важи от следващата синхронизация.')).toBeVisible()

  // Chosen means stored: it survives a reload.
  await page.reload()
  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page.getByRole('radio', { name: /Текуща цена/ })).toBeChecked()
  await snapshot('s1-menu-source-card-bg-light-desktop.png')

  // "Sync this venue" queues one pull of this venue.
  await syncVenue(page).click()
  await expect(page.getByTestId('integration-notice').filter({ hasText: 'опашка' })).toBeVisible()
  const queued = await jobs('barsy-full-pull')
  expect(queued[0]).toMatchObject({ name: 'barsy-full-pull', state: 'created' })
  expect(queued[0]?.data.venueId).toBe(venueId)
  expect(Object.keys(queued[0]?.data ?? {}).sort()).toEqual([
    'integrationId',
    'tenantId',
    'venueId',
  ])
  // One pull of this venue at a time: the button is off, with the reason.
  await expect(syncVenue(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Вече има синхронизация на опашка или в ход.',
  )
  expect(await jobs('barsy-full-pull')).toHaveLength(1)
})

test('the worker finishes: the run is in the history, one line first, the list under a button', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'history')
  await openSettings(page)
  const e2e = instance(page, 'barsy – E2E')
  // Collapsed: one line with the last run, no list.
  await expect(e2e.getByTestId('history-last')).toContainText('Пълна синхронизация', {
    timeout: 15_000,
  })
  await expect(e2e.getByTestId('history-last')).toContainText('Завършено')
  await expect(e2e.getByTestId('run-row')).toHaveCount(0)
  await e2e.getByTestId('history-toggle').click()

  const row = e2e.getByTestId('run-row').filter({ hasText: 'Пълна синхронизация' })
  await expect(row).toBeVisible()
  await expect(row.getByTestId('run-status')).toHaveText('Завършено')
  // The instance's history is every venue's: the run names the venue it was for.
  await expect(row.getByTestId('run-venue')).toHaveText(INTEGRATION_VENUE_NAME)
  await expect(
    e2e.getByTestId('run-row').filter({ hasText: 'Проверка на връзката' }).getByTestId('run-venue'),
  ).toHaveText('—')
  const counters = row.getByTestId('run-counters')
  await expect(counters).toContainText('Прочетени артикули')
  await expect(
    counters.getByText('Прочетени артикули').locator('xpath=following-sibling::dd'),
  ).toHaveText('58')
  await expect(counters.getByText('Създадени').locator('xpath=following-sibling::dd')).toHaveText(
    '52',
  )
  await expect(
    counters.getByText('Неуспешни страници').locator('xpath=following-sibling::dd'),
  ).toHaveText('1')
  await expect(
    counters.getByText('Отказани записи').locator('xpath=following-sibling::dd'),
  ).toHaveText('2')
  await expect(row.getByTestId('run-deletion-skipped')).toHaveText(
    'Проверката за изтрити е пропусната',
  )

  // The row opens to the notes and the refused writes: the field and the reason.
  await row.getByRole('button', { name: /Покажи подробностите/ }).click()
  const details = row.getByTestId('run-details')
  await expect(details).toContainText('deletion check skipped: 1 of 3 pages failed')
  await expect(details.getByTestId('refused-write')).toHaveCount(2)
  await expect(details.getByTestId('refused-write').first()).toContainText('for_sale')
  await expect(details.getByTestId('refused-write').first()).toContainText(
    'Би направило менюто по-малко предпазливо от касата',
  )
  // No id of ours or of the till anywhere in the history.
  expect(await e2e.getByTestId('run-history').innerText()).not.toMatch(
    /\b(jb|nd|in)_[0-9A-Za-z]{10,}/,
  )

  // The venue's own history is the same run, one line, without the venue column.
  await page.goto(`${venueUrl}?tab=settings`)
  await expect(page.getByTestId('history-last')).toContainText('Пълна синхронизация')
  await page.getByTestId('history-toggle').click()
  await expect(page.getByTestId('run-row')).toHaveCount(1)
  await expect(page.getByTestId('run-venue')).toHaveCount(0)
})

test('"Sync everything now" queues a pull for every venue that uses the connection', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'drop')
  await openSettings(page)
  const e2e = instance(page, 'barsy – E2E')
  await expect(syncAll(e2e)).toBeEnabled()
  await syncAll(e2e).click()
  await expect(e2e.getByTestId('integration-notice').filter({ hasText: 'опашка' })).toBeVisible()

  // One venue uses the connection: one pull, with that venue's id.
  const queued = await jobs('barsy-full-pull')
  expect(queued).toHaveLength(1)
  expect(queued[0]?.data.venueId).toBe(venueId)

  // One pull at a time: the button is off, with the reason, and the page keeps watching.
  await expect(syncAll(e2e)).toBeDisabled()
  await expect(e2e.getByTestId('sync-blocked')).toHaveText(
    'Вече има синхронизация на опашка или в ход.',
  )
  await expect(e2e.getByTestId('status-active')).toHaveText(
    'Синхронизацията е на опашка или върви…',
  )
  runScript('./scripts/seed-integration-e2e.ts', 'drop')
  await expect(syncAll(e2e)).toBeEnabled({ timeout: 15_000 })
})

test('removing the connection, and unselecting barsy, are refused while a venue uses it', async () => {
  await openSettings(page)
  const e2e = instance(page, 'barsy – E2E')
  await e2e.getByRole('button', { name: 'Премахни' }).click()
  const dialog = page.getByTestId('remove-dialog')
  await expect(dialog).toContainText('Данните ѝ за достъп и историята се пазят')
  await dialog.getByRole('button', { name: 'Премахни връзката' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(
    'Заведения още ползват тази връзка. Първо изтрийте тези заведения, после премахнете връзката.',
  )
  await dialog.getByRole('button', { name: 'Отказ' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(e2e).toBeVisible()

  // The system cannot be left out while it has a connection.
  await barsyBox(page).click()
  await expect(page.getByTestId('systems-blocking')).toHaveText(
    'barsy още има връзки. Премахнете ги, преди да я махнете от избора.',
  )
  await page.getByRole('button', { name: 'Запази системите' }).click()
  await expect(systemsPicker(page).locator('xpath=..').getByRole('alert')).toHaveText(
    'barsy още има връзки. Премахнете ги, преди да я махнете от избора.',
  )
  await page.reload()
  await expect(barsyBox(page)).toHaveAttribute('aria-checked', 'true')
})

test('a second connection is added, refused for a used address, and removed for good', async () => {
  await openSettings(page)
  await page.getByRole('button', { name: 'Добави barsy' }).click()
  const form = page.getByTestId('add-instance-form')
  await form.getByLabel('Име').fill('barsy – Втори')
  // The first connection's address is taken.
  await form.getByLabel('Адрес на barsy').fill('https://e2e-club.barsyonline.com')
  await form.getByLabel('API потребител').fill('e2e-api-user')
  await form.getByLabel('Парола').fill('e2e-second-password')
  await form.getByRole('button', { name: 'Запази и провери' }).click()
  await expect(form.getByRole('alert')).toHaveText(
    'Друга връзка с barsy на тази организация вече ползва този адрес.',
  )
  await expect(form.getByLabel('Парола')).toHaveValue('')

  await form.getByLabel('Адрес на barsy').fill('https://second.barsyonline.com')
  await form.getByLabel('API потребител').fill('e2e-api-user')
  await form.getByLabel('Парола').fill('e2e-second-password')
  await form.getByRole('button', { name: 'Запази и провери' }).click()
  const second = instance(page, 'barsy – Втори')
  await expect(second).toBeVisible()
  await expect(page.getByTestId('instance')).toHaveCount(2)
  await expect(second.getByTestId('instance-venues')).toHaveText(
    'Още няма заведение, което ползва тази връзка.',
  )
  await expect(systemsPicker(page).getByTestId('system-instances')).toHaveText('2 връзки')

  // Nothing uses it: it can be removed, and it is gone for good.
  await second.getByRole('button', { name: 'Премахни' }).click()
  await page.getByTestId('remove-dialog').getByRole('button', { name: 'Премахни връзката' }).click()
  await expect(page.getByTestId('instance')).toHaveCount(1)
  await page.reload()
  await expect(page.getByTestId('instance')).toHaveCount(1)
  await expect(instance(page, 'barsy – Втори')).toHaveCount(0)
  await expect(systemsPicker(page).getByTestId('system-instances')).toHaveText('1 връзка')
  // Removed, not erased: the row and its credentials are still there (the owner reads past RLS).
  expect(process.env.DATABASE_URL_OWNER).toBeTruthy()
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const rows = await owner.query<{ removed: boolean; sealed: boolean }>(
      `select removed_at is not null as removed, credentials_sealed is not null as sealed
       from restro.integrations where name = $1`,
      ['barsy – Втори'],
    )
    expect(rows.rows).toEqual([{ removed: true, sealed: true }])
  } finally {
    await owner.end()
  }
})

test('an old ?tab=integration link opens the venue’s Settings tab', async () => {
  await page.goto(`${venueUrl}?tab=integration`)
  await expect(page.getByRole('tab', { name: 'Настройки' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('menu-source')).toBeVisible()
  await expect(page.getByTestId('menu-source-venue')).toHaveText('Main bar')
})

test('a plain member sees the connection, the history and the Menu source, and can change nothing', async ({
  browser,
}) => {
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const member = await memberContext.newPage()
  try {
    await signIn(member, INTEGRATION_MEMBER_EMAIL)
    await openSettings(member)
    await expect(member.getByTestId('read-only')).toContainText(
      'Само собствениците и администраторите',
    )
    const e2e = instance(member, 'barsy – E2E')
    await expect(e2e.getByTestId('status-badge')).toHaveText('Свързано')
    await expect(e2e.getByTestId('history-last')).toBeVisible()
    await expect(member.getByRole('button', { name: 'Запази системите' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Добави barsy' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Премахни' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Преименувай' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Смени данните за достъп' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Провери отново' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Запази настройките' })).toHaveCount(0)
    await expect(syncAll(e2e)).toBeDisabled()
    await expect(e2e.getByTestId('sync-blocked')).toHaveText(
      'Само собствениците и администраторите могат да стартират синхронизация.',
    )
    await snapshot('s1-integrations-member-bg-light-desktop.png', member)

    // The venue's card: what is set, nothing to press.
    await member.goto(`${venueUrl}?tab=settings`)
    await expect(member.getByTestId('menu-source')).toBeVisible()
    await expect(member.getByTestId('read-only')).toBeVisible()
    await expect(member.getByTestId('menu-source-venue')).toHaveText('Main bar')
    await expect(member.getByRole('button', { name: 'Запази цената' })).toHaveCount(0)
    await expect(syncVenue(member)).toBeDisabled()
  } finally {
    await memberContext.close()
  }
})

async function openAs(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
  locale: 'bg' | 'en',
  url: string,
) {
  const state = await page.context().storageState()
  const context = await browser.newContext({ ...options, storageState: state })
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: locale, url: new URL(page.url()).origin },
  ])
  const target = await context.newPage()
  await target.goto(url)
  return { context, target }
}

test('saves the screenshots when SCREENSHOT_DIR is set', async ({ browser }) => {
  test.skip(!process.env.SCREENSHOT_DIR, 'SCREENSHOT_DIR is not set')
  await openSettings(page)
  await snapshot('s1-integrations-bg-light-desktop.png')

  // English, dark, desktop: the page, then the venue's Menu source card.
  const dark = await openAs(
    browser,
    { colorScheme: 'dark', viewport: { width: 1440, height: 900 } },
    'en',
    '/settings/integrations',
  )
  await expect(dark.target.getByRole('heading', { name: 'Systems', level: 3 })).toBeVisible()
  await dark.target.getByTestId('history-toggle').click()
  await snapshot('s1-integrations-en-dark-desktop.png', dark.target)
  await dark.target.goto(`${venueUrl}?tab=settings`)
  await expect(dark.target.getByTestId('menu-source')).toBeVisible()
  await snapshot('s1-menu-source-card-en-dark-desktop.png', dark.target)
  await dark.context.close()

  // English, light, desktop: the page.
  const light = await openAs(
    browser,
    { colorScheme: 'light', viewport: { width: 1440, height: 900 } },
    'en',
    '/settings/integrations',
  )
  await expect(light.target.getByRole('heading', { name: 'Sync history' })).toBeVisible()
  await snapshot('s1-integrations-en-light-desktop.png', light.target)
  await light.context.close()

  // Bulgarian, light, phone.
  const phone = await openAs(
    browser,
    {
      colorScheme: 'light',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
    'bg',
    '/settings/integrations',
  )
  await expect(
    phone.target.getByRole('heading', { name: 'История на синхронизациите' }),
  ).toBeVisible()
  await snapshot('s1-integrations-bg-light-mobile.png', phone.target)
  // No sideways scroll on the phone, with the connector's settings card on the page (#59: its
  // select triggers sit in grid cells that need min-w-0), and no scrollbar on the tab strip when
  // its tabs fit (trial finding 2.2).
  await expect(phone.target.getByTestId('settings-form').first()).toBeVisible()
  const strip = await phone.target
    .getByRole('tablist')
    .first()
    .evaluate((list) => ({
      vertical: list.scrollHeight - list.clientHeight,
      horizontal: list.scrollWidth - list.clientWidth,
    }))
  expect(strip.vertical).toBeLessThanOrEqual(1)
  expect(strip.horizontal).toBeLessThanOrEqual(1)
  const overflow = await phone.target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await phone.context.close()
})
