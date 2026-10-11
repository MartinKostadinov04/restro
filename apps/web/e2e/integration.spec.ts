import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import {
  ADMIN_PASSWORD,
  INTEGRATION_MEMBER_EMAIL,
  INTEGRATION_OWNER_EMAIL,
  INTEGRATION_VENUE_NAME,
} from './support'

// Settings -> Integrations and the venue's Menu source on a production build, in Bulgarian, with no
// worker running for barsy: the test plays the worker by running the fixtures script's `worker`
// and `history` steps, which write through core's writers what a connection check and a pull would
// leave behind (status connected, the installation's venues, the cached category tree, finished
// runs). The web servers hold a throwaway sealing public key (playwright.config.ts). Steps:
//
//   the page is empty -> fill the form -> "Credentials saved", status "not checked yet", a check queued
//   the worker answers -> the page notices by itself (it polls while a job waits), the venues appear
//   "Not used" hides a venue from the to-do count, "Use again" brings it back
//   Add as venue -> a new venue, and the person is sent to its Menu source card
//   choose the menu category there -> "Sync this venue" opens; press it -> a `barsy-full-pull` job
//   the worker finishes -> a run with its counters and the venue's name is in the history
//   Link to an existing venue -> after the warning, the venue is linked, and it is no longer offered
//   how the data is read, the schedule ("Sofia time"), "Sync everything now"
//   the venue's price and its Rules (publishing) card are its own
//   a plain member -> sees everything, can change nothing; an old ?tab=integration opens Settings
//
// With SCREENSHOT_DIR set, it saves the screenshots of the brief (BG and EN, light and dark,
// phone) there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

let page: Page
let db: pg.Pool
/** The venue "Add as venue" makes, once it has. */
let addedVenueUrl = ''

const syncAll = (target: Page) => target.getByRole('button', { name: 'Синхронизирай всичко сега' })
const syncVenue = (target: Page) =>
  target.getByRole('button', { name: 'Синхронизирай това заведение' })
const tillVenue = (target: Page, name: string) =>
  target
    .getByTestId('till-venue')
    .filter({ has: target.getByTestId('till-venue-name').getByText(name, { exact: true }) })

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

test('an organisation nobody connected yet: nothing to sync, an empty list and history', async () => {
  await expect(page.getByTestId('status-none')).toHaveText('Още не е свързано с barsy.')
  await expect(page.getByTestId('connect-form')).toBeVisible()
  await expect(syncAll(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Първо запазете данните за достъп до barsy.',
  )
  await expect(page.getByTestId('till-venues-empty')).toContainText('Още няма заведения от barsy')
  await expect(page.getByTestId('history-empty')).toContainText('Още няма синхронизация')
  await expect(page.getByTestId('read-only')).toHaveCount(0)
  // The venue has no Integration tab, and its Menu source says there is nothing connected.
  await page.getByTestId('venue-nav-item').first().click()
  await expect(page.getByRole('tab', { name: 'Интеграция' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page.getByTestId('menu-source-none')).toContainText(
    'Тази организация още не е свързана с каса',
  )
  await expect(page.getByRole('link', { name: 'Отвори Настройки → Интеграции' })).toHaveAttribute(
    'href',
    '/settings/integrations',
  )
  await openSettings(page)
  await snapshot('cf-09b-settings-integrations-empty-bg-light-desktop.png')
})

test('saving the credentials: "Credentials saved", status "not checked yet", a check queued', async () => {
  const password = 'e2e-password-that-must-not-leak'
  await page.getByLabel('Адрес на barsy').fill('https://e2e-club.barsyonline.com')
  await page.getByLabel('API потребител').fill('e2e-api-user')
  await page.getByLabel('Парола').fill(password)
  await page.getByRole('button', { name: 'Запази и провери' }).click()

  await expect(page.getByTestId('credentials-saved')).toContainText('Данните за достъп са запазени')
  await expect(page.getByTestId('status-badge')).toHaveAttribute('data-status', 'new')
  await expect(page.getByTestId('status-badge')).toHaveText('Още не е проверено')
  await expect(page.getByTestId('status-details')).toContainText('e2e-club.barsyonline.com')
  // Neither the password nor the user name is anywhere on the page, then or after a reload.
  for (const secret of [password, 'e2e-api-user']) {
    expect(await page.content()).not.toContain(secret)
  }
  await page.reload()
  await expect(page.getByTestId('credentials-saved')).toBeVisible()
  expect(await page.content()).not.toContain(password)

  // The check is in the queue (pg-boss's job table), for this integration and no secret in it.
  const queued = await jobs('barsy-connect')
  expect(queued[0]).toMatchObject({ name: 'barsy-connect', state: 'created' })
  expect(Object.keys(queued[0]?.data ?? {}).sort()).toEqual(['integrationId', 'tenantId'])
  expect(JSON.stringify(queued)).not.toContain(password)

  // While the job waits the page says so.
  await expect(page.getByTestId('status-active')).toHaveText('Проверка на връзката…')
  await expect(syncAll(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Връзката се проверява. Изчакайте да приключи.',
  )
})

test('the worker answers: the page notices by itself and the venues of the till appear', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'worker')
  // No reload: the page polls about every 3 seconds while a job waits.
  await expect(page.getByTestId('status-badge')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('status-badge')).toHaveText('Свързано')
  await expect(page.getByTestId('status-active')).toHaveCount(0)
  await expect(page.getByTestId('till-venue')).toHaveCount(2)
  await expect(page.getByTestId('till-venue').first()).toHaveAttribute('data-state', 'unlinked')
  await expect(page.getByTestId('till-venues-todo')).toHaveText('2 заведения за настройване')
  await expect(page.getByTestId('run-row').first()).toContainText('Проверка на връзката')
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Първо свържете заведение от barsy със заведение.',
  )
})

test('"Not used" sets a venue aside, "Use again" brings it back', async () => {
  const roof = tillVenue(page, 'Roof terrace')
  await roof.getByRole('button', { name: 'Не се използва' }).click()
  await expect(roof).toHaveAttribute('data-state', 'not_used')
  await expect(roof.getByTestId('till-venue-not-used')).toHaveText('Не се използва')
  await expect(page.getByTestId('till-venues-todo')).toHaveText('1 заведение за настройване')
  // Stored, so it survives a reload.
  await page.reload()
  await expect(tillVenue(page, 'Roof terrace')).toHaveAttribute('data-state', 'not_used')
  await tillVenue(page, 'Roof terrace').getByRole('button', { name: 'Използвай отново' }).click()
  await expect(tillVenue(page, 'Roof terrace')).toHaveAttribute('data-state', 'unlinked')
  await expect(page.getByTestId('till-venues-todo')).toHaveText('2 заведения за настройване')
})

test('"Add as venue": a new venue, and the person lands on its Menu source card', async () => {
  const before = await page.getByTestId('venue-nav-item').count()
  await tillVenue(page, 'Main bar').getByRole('button', { name: 'Добави като заведение' }).click()

  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}\?tab=settings/, { timeout: 15_000 })
  addedVenueUrl = new URL(page.url()).pathname
  await expect(page.getByRole('heading', { name: 'Main bar', level: 1 })).toBeVisible()
  // The new venue is in the sidebar, and its Menu source card shows the venue it was made for.
  await expect(page.getByTestId('venue-nav-item')).toHaveCount(before + 1)
  await expect(page.getByTestId('menu-source')).toBeVisible()
  await expect(page.getByTestId('menu-source-venue')).toHaveText('Main bar')
  // No menu category yet: the card says what to do, and "Sync this venue" is shut.
  await expect(syncVenue(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText('Първо изберете категорията на менюто.')
  await expect(page.getByRole('radio', { name: /Базова цена/ })).toBeChecked()

  // Back on the Settings page the list says it is linked, and what is still to do.
  await openSettings(page)
  const main = tillVenue(page, 'Main bar')
  await expect(main).toHaveAttribute('data-state', 'linked')
  await expect(main.getByTestId('till-venue-linked')).toHaveText('Свързано със „Main bar“')
  await expect(main.getByTestId('till-venue-needs-category')).toBeVisible()
  await expect(page.getByTestId('till-venues-todo')).toHaveText('1 заведение за настройване')
})

test('the venue chooses its menu category and its price; "Sync this venue" queues one pull', async () => {
  await page.goto(addedVenueUrl)
  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page.getByTestId('menu-source')).toBeVisible()
  // The venue's own settings are above the card.
  await expect(page.getByText('Europe/Sofia')).toBeVisible()

  const root = page.getByRole('radio', { name: /Публично меню/ })
  await root.click()
  await expect(root).toBeChecked()
  await expect(syncVenue(page)).toBeEnabled()
  await expect(page.getByTestId('sync-blocked')).toHaveCount(0)
  // Each category shows how many sub-categories it has, and no id.
  await expect(page.getByTestId('catalogue-tree')).toContainText('3 подкатегории')
  await expect(page.getByTestId('catalogue-tree')).not.toContainText('1171')

  // The price is the venue's own, and the help says what the current price is.
  await expect(page.getByTestId('price-form')).toContainText(
    'Текущата цена следва ценовите правила на barsy за това заведение.',
  )
  await page.getByRole('radio', { name: /Текуща цена/ }).click()
  await page.getByRole('button', { name: 'Запази цената' }).click()
  await expect(page.getByText('Запазено. Важи от следващата синхронизация.')).toBeVisible()

  // Chosen means stored: it survives a reload.
  await page.reload()
  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page.getByRole('radio', { name: /Публично меню/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: /Текуща цена/ })).toBeChecked()
  await snapshot('cf-09b-menu-source-card-bg-light-desktop.png')

  await syncVenue(page).click()
  await expect(page.getByTestId('integration-notice').filter({ hasText: 'опашка' })).toBeVisible()
  const queued = await jobs('barsy-full-pull')
  expect(queued[0]).toMatchObject({ name: 'barsy-full-pull', state: 'created' })
  expect(queued[0]?.data.venueId).toBe(addedVenueUrl.split('/').pop())
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

test('the worker finishes: the run is in the history with its counters and its venue', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'history')
  await openSettings(page)
  const row = page.getByTestId('run-row').filter({ hasText: 'Пълна синхронизация' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByTestId('run-status')).toHaveText('Завършено')
  // The history is the whole installation's: the run names the venue it was for.
  await expect(row.getByTestId('run-venue')).toHaveText('Main bar')
  await expect(
    page
      .getByTestId('run-row')
      .filter({ hasText: 'Проверка на връзката' })
      .getByTestId('run-venue'),
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
  expect(await page.getByTestId('run-history').innerText()).not.toMatch(
    /\b(jb|nd|in)_[0-9A-Za-z]{10,}/,
  )
})

test('"Link to an existing venue": after the warning, the venue is linked and no longer offered', async () => {
  const roof = tillVenue(page, 'Roof terrace')
  await roof.getByRole('button', { name: 'Свържи със съществуващо заведение' }).click()
  const dialog = page.getByTestId('link-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('link-warning')).toContainText(
    'следващата пълна синхронизация решава кои от тях още съществуват',
  )
  // Only the venue that has no link yet is offered (the added one has one).
  await expect(dialog.getByRole('radio')).toHaveCount(1)
  await dialog.getByRole('radio', { name: INTEGRATION_VENUE_NAME }).check()
  await snapshot('cf-09b-link-dialog-bg-light-desktop.png')
  await dialog.getByRole('button', { name: 'Свържи', exact: true }).click()

  await expect(dialog).toHaveCount(0)
  await expect(tillVenue(page, 'Roof terrace')).toHaveAttribute('data-state', 'linked')
  await expect(tillVenue(page, 'Roof terrace').getByTestId('till-venue-linked')).toHaveText(
    `Свързано със „${INTEGRATION_VENUE_NAME}“`,
  )
  await expect(page.getByTestId('till-venues-todo')).toHaveText('Няма какво още да се настройва.')
  // Both venues are linked, so there is nothing more to offer a venue.
  await expect(page.getByRole('button', { name: 'Добави като заведение' })).toHaveCount(0)
})

test('how the data is read is saved and shown back (no price: it is each venue’s)', async () => {
  await expect(page.getByRole('radio', { name: /Базова цена/ })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Характеристика за алергени' })).toContainText(
    'Автоматично откриване (Алергени)',
  )
  await page.getByRole('combobox', { name: 'Език по подразбиране' }).click()
  await page.getByRole('option', { name: /английски/i }).click()
  await page.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    page.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Език по подразбиране' })).toContainText(
    /английски/i,
  )
  // Back to the default, so the test can run again.
  await page.getByRole('combobox', { name: 'Език по подразбиране' }).click()
  await page.getByRole('option', { name: /български/i }).click()
  await page.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    page.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
})

test('the schedule is saved in Sofia time, kept after a reload, and put back to the defaults', async () => {
  const saveButton = page.getByRole('button', { name: 'Запази автоматичната синхронизация' })
  const incremental = page.getByRole('switch', { name: 'Проверявай за промени автоматично' })
  const fullPull = page.getByRole('switch', { name: 'Чети целия каталог веднъж дневно' })
  const interval = page.getByRole('combobox', { name: 'Проверявай на всеки' })
  const time = page.getByLabel('Час от деня')
  const saved = page.getByText('Запазено. Важи от следващата минута.')

  // What runs today is what the card starts with, and the clock is named.
  await expect(incremental).toBeChecked()
  await expect(fullPull).toBeChecked()
  await expect(interval).toHaveText('5 минути')
  await expect(time).toHaveValue('12:00')
  await expect(page.getByText('Брои се по софийско време.')).toBeVisible()
  // The publishing rules are not here: they are each venue's own.
  await expect(page.getByRole('radio', { name: /Публикувай автоматично/ })).toHaveCount(0)
  await expect(saveButton).toBeDisabled()
  // The next runs are named in the integration's clock (linked venues have their category).
  await expect(page.getByTestId('sync-next')).toContainText('Следваща проверка за промени около')
  await snapshot('cf-09b-sync-settings-bg-light-desktop.png')

  await interval.click()
  await page.getByRole('option', { name: '15 минути' }).click()
  await time.fill('04:30')
  await expect(saveButton).toBeEnabled()
  await saveButton.click()
  await expect(saved).toBeVisible()

  await page.reload()
  await expect(interval).toHaveText('15 минути')
  await expect(time).toHaveValue('04:30')
  await expect(saveButton).toBeDisabled()
  await expect(page.getByTestId('sync-next')).toContainText('Следващо пълно четене')

  // Both loops off: the card says so.
  await incremental.click()
  await fullPull.click()
  await expect(interval).toBeDisabled()
  await expect(time).toBeDisabled()
  await saveButton.click()
  await expect(saved).toBeVisible()
  await page.reload()
  await expect(incremental).not.toBeChecked()
  await expect(fullPull).not.toBeChecked()
  await expect(page.getByTestId('sync-next')).toHaveText('Автоматичната синхронизация е изключена.')

  // Back to the defaults, so the test can run again.
  await incremental.click()
  await fullPull.click()
  await interval.click()
  await page.getByRole('option', { name: '5 минути', exact: true }).click()
  await time.fill('12:00')
  await saveButton.click()
  await expect(saved).toBeVisible()
  await page.reload()
  await expect(interval).toHaveText('5 минути')
  await expect(time).toHaveValue('12:00')
})

test('"Sync everything now" queues a pull for every linked venue with a menu category', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'drop')
  await page.reload()
  await expect(syncAll(page)).toBeEnabled()
  await syncAll(page).click()
  await expect(page.getByTestId('integration-notice').filter({ hasText: 'опашка' })).toBeVisible()

  // One venue has its category (the one added above): one pull, with that venue's id.
  const queued = await jobs('barsy-full-pull')
  expect(queued).toHaveLength(1)
  expect(queued[0]?.data.venueId).toBe(addedVenueUrl.split('/').pop())

  // One pull at a time: the button is off, with the reason, and the page keeps watching.
  await expect(syncAll(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Вече има синхронизация на опашка или в ход.',
  )
  await expect(page.getByTestId('status-active')).toHaveText(
    'Синхронизацията е на опашка или върви…',
  )
  runScript('./scripts/seed-integration-e2e.ts', 'drop')
  await expect(syncAll(page)).toBeEnabled({ timeout: 15_000 })
})

test('the venue’s publishing Rules are its own, and survive a reload', async () => {
  await page.goto(addedVenueUrl)
  await page.getByRole('tab', { name: 'Публикуване' }).click()
  const rules = page.getByTestId('rules-form')
  await expect(rules).toBeVisible()
  // Nothing was saved yet: the venue follows the connection's old setting, which was the default.
  await expect(rules.getByRole('radio', { name: /Публикувай автоматично/ })).toBeChecked()
  await expect(rules.getByRole('radio', { name: /Показвай ги в менюто/ })).toBeChecked()
  await expect(page.getByTestId('rules-inherited')).toBeVisible()

  await rules.getByRole('radio', { name: /Изчакай да натисна/ }).click()
  await rules.getByRole('radio', { name: /Дръж ги скрити/ }).click()
  await snapshot('cf-09b-publishing-rules-card-bg-light-desktop.png')
  await rules.getByRole('button', { name: 'Запази правилата' }).click()
  await expect(page.getByTestId('rules-saved')).toBeVisible()

  await page.reload()
  await page.getByRole('tab', { name: 'Публикуване' }).click()
  await expect(
    page.getByTestId('rules-form').getByRole('radio', { name: /Изчакай да натисна/ }),
  ).toBeChecked()
  await expect(
    page.getByTestId('rules-form').getByRole('radio', { name: /Дръж ги скрити/ }),
  ).toBeChecked()
  await expect(page.getByTestId('rules-inherited')).toHaveCount(0)

  // The other venue's rules are not these: it still follows the old setting.
  await page.goto('/venues')
  await page
    .getByTestId('venue-card')
    .filter({ hasText: INTEGRATION_VENUE_NAME })
    .getByRole('link', { name: 'Отвори' })
    .click()
  await page.getByRole('tab', { name: 'Публикуване' }).click()
  await expect(
    page.getByTestId('rules-form').getByRole('radio', { name: /Публикувай автоматично/ }),
  ).toBeChecked()
  await expect(page.getByTestId('rules-inherited')).toBeVisible()
})

test('an old ?tab=integration link opens the venue’s Settings tab', async () => {
  await page.goto(`${addedVenueUrl}?tab=integration`)
  await expect(page.getByRole('tab', { name: 'Настройки' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('menu-source')).toBeVisible()
  await expect(page.getByTestId('menu-source-venue')).toHaveText('Main bar')
})

test('"Change…" warns, and moves only after a confirmation', async () => {
  await page.goto(`${addedVenueUrl}?tab=settings`)
  await page.getByRole('button', { name: 'Смени…' }).click()
  const dialog = page.getByTestId('change-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('change-warning')).toContainText(
    'следващата пълна синхронизация решава кои от тях още съществуват',
  )
  // The venue it serves is not offered; the one the other venue serves is shown, not offered.
  await expect(dialog.getByTestId('till-venue-option')).toHaveCount(1)
  await expect(dialog.getByRole('radio', { name: /Roof terrace/ })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Отказ' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('menu-source-venue')).toHaveText('Main bar')
})

test('a plain member sees the list, the history and the Menu source, and can change nothing', async ({
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
    await expect(member.getByTestId('status-badge')).toHaveText('Свързано')
    await expect(member.getByTestId('till-venue')).toHaveCount(2)
    await expect(member.getByTestId('run-row').first()).toBeVisible()
    await expect(member.getByRole('button', { name: 'Смени данните за достъп' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Провери отново' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Запази настройките' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Добави като заведение' })).toHaveCount(0)
    await expect(
      member.getByRole('button', { name: 'Свържи със съществуващо заведение' }),
    ).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Не се използва' })).toHaveCount(0)
    // The schedule is shown, and cannot be changed.
    await expect(
      member.getByRole('button', { name: 'Запази автоматичната синхронизация' }),
    ).toHaveCount(0)
    await expect(
      member.getByRole('switch', { name: 'Проверявай за промени автоматично' }),
    ).toBeDisabled()
    await expect(syncAll(member)).toBeDisabled()
    await expect(member.getByTestId('sync-blocked')).toHaveText(
      'Само собствениците и администраторите могат да стартират синхронизация.',
    )
    await snapshot('cf-09b-settings-integrations-member-bg-light-desktop.png', member)

    // The venue's card: what is set, nothing to press.
    await member.goto(`${addedVenueUrl}?tab=settings`)
    await expect(member.getByTestId('menu-source')).toBeVisible()
    await expect(member.getByTestId('read-only')).toBeVisible()
    await expect(member.getByTestId('menu-source-venue')).toHaveText('Main bar')
    await expect(member.getByRole('button', { name: 'Смени…' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Запази цената' })).toHaveCount(0)
    await expect(syncVenue(member)).toBeDisabled()
    // And the rules: shown, not editable.
    await member.getByRole('tab', { name: 'Публикуване' }).click()
    await expect(member.getByRole('button', { name: 'Запази правилата' })).toHaveCount(0)
    await expect(
      member.getByTestId('rules-form').getByRole('radio', { name: /Изчакай да натисна/ }),
    ).toBeDisabled()
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

test('saves the screenshots of the brief when SCREENSHOT_DIR is set', async ({ browser }) => {
  test.skip(!process.env.SCREENSHOT_DIR, 'SCREENSHOT_DIR is not set')
  await openSettings(page)
  await snapshot('cf-09b-settings-integrations-bg-light-desktop.png')

  // English, dark, desktop: the page, then the venue's Menu source card.
  const dark = await openAs(
    browser,
    { colorScheme: 'dark', viewport: { width: 1440, height: 900 } },
    'en',
    '/settings/integrations',
  )
  await expect(dark.target.getByRole('heading', { name: 'Sync history' })).toBeVisible()
  await snapshot('cf-09b-settings-integrations-en-dark-desktop.png', dark.target)
  await dark.target.goto(`${addedVenueUrl}?tab=settings`)
  await expect(dark.target.getByTestId('menu-source')).toBeVisible()
  await snapshot('cf-09b-menu-source-card-en-dark-desktop.png', dark.target)
  await dark.context.close()

  // English, light, desktop: the barsy venues list alone.
  const light = await openAs(
    browser,
    { colorScheme: 'light', viewport: { width: 1440, height: 900 } },
    'en',
    '/settings/integrations',
  )
  await expect(light.target.getByRole('heading', { name: 'Venues in barsy' })).toBeVisible()
  await light.target
    .getByTestId('till-venues')
    .screenshot({
      path: path.join(
        process.env.SCREENSHOT_DIR as string,
        'cf-09b-barsy-venues-list-en-light.png',
      ),
    })
  await snapshot('cf-09b-settings-integrations-en-light-desktop.png', light.target)
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
  await snapshot('cf-09b-settings-integrations-bg-light-mobile.png', phone.target)
  // No sideways scroll on the phone.
  const overflow = await phone.target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await phone.context.close()
})
