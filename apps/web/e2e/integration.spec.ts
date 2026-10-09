import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'
import pg from 'pg'

import { runScript } from './global-setup'
import { ADMIN_PASSWORD, INTEGRATION_MEMBER_EMAIL, INTEGRATION_OWNER_EMAIL } from './support'

// The Integration tab on a production build, in Bulgarian, with no worker running: the test plays
// the worker by running the fixtures script's `worker` and `history` steps, which write through
// core's writers what a connection check and a pull would leave behind (status connected, the
// installation's venues, the cached category tree, finished runs). The web servers hold a
// throwaway sealing public key (playwright.config.ts). Steps:
//
//   fill the form -> "Credentials saved", status "not checked yet", a check queued
//   the worker answers -> the page notices by itself (it polls while a job waits)
//   pick the barsy venue and the catalogue root -> "Sync now" opens
//   press it -> a `barsy-full-pull` job is in pg-boss's job table, the button closes
//   the worker finishes -> a run with its counters is in the history
//   a plain member -> sees status and history, can change nothing
//
// With SCREENSHOT_DIR set, it saves the screenshots of the brief (BG and EN, light and dark,
// phone) there.
test.describe.configure({ mode: 'serial' })

let page: Page
let venueId = ''
let db: pg.Pool

const tab = (target: Page) => target.getByRole('tab', { name: 'Интеграция' })
const syncButton = (target: Page) => target.getByRole('button', { name: 'Синхронизирай сега' })

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

async function openTab(target: Page) {
  await target.getByTestId('venue-card').first().getByRole('link', { name: 'Отвори' }).click()
  await expect(tab(target)).toBeVisible()
  await tab(target).click()
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
  await openTab(page)
  venueId = /\/venues\/(vn_[0-9A-Za-z]+)/.exec(page.url())?.[1] ?? ''
  expect(venueId).not.toBe('')
})

test.afterAll(async () => {
  await page.close()
  await db.end()
})

test('a venue nobody connected yet: nothing to sync, an empty history', async () => {
  await expect(page).toHaveURL(/tab=integration/)
  await expect(page.getByTestId('status-none')).toHaveText('Още не е свързано с barsy.')
  await expect(page.getByTestId('connect-form')).toBeVisible()
  await expect(syncButton(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Първо запазете данните за достъп до barsy.',
  )
  await expect(page.getByTestId('history-empty')).toContainText('Още няма синхронизация')
  await expect(page.getByTestId('read-only')).toHaveCount(0)
  await snapshot('s2-05-integration-empty-bg-light-desktop.png')
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
  await expect(syncButton(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Връзката се проверява. Изчакайте да приключи.',
  )
})

test('the worker answers: the page notices by itself and the venues appear', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'worker')
  // No reload: the tab polls about every 3 seconds while a job waits.
  await expect(page.getByTestId('status-badge')).toHaveAttribute('data-status', 'connected', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('status-badge')).toHaveText('Свързано')
  await expect(page.getByTestId('status-active')).toHaveCount(0)
  await expect(page.getByTestId('barsy-venue-option')).toHaveCount(2)
  await expect(page.getByTestId('run-row').first()).toContainText('Проверка на връзката')
  await expect(page.getByTestId('sync-blocked')).toHaveText('Първо изберете заведението от barsy.')
})

test('picking the barsy venue and the catalogue root opens "Sync now"', async () => {
  await expect(page.getByTestId('catalogue-need-venue')).toBeVisible()
  await page.getByRole('radio', { name: 'Main bar' }).click()
  await expect(page.getByRole('radio', { name: 'Main bar' })).toBeChecked()
  // The cached tree appears for the chosen barsy venue; the sync still needs a root.
  await expect(page.getByTestId('catalogue-tree')).toBeVisible()
  await expect(page.getByTestId('sync-blocked')).toHaveText('Първо изберете каталога на менюто.')

  const root = page.getByRole('radio', { name: /Публично меню/ })
  await root.click()
  await expect(root).toBeChecked()
  await expect(syncButton(page)).toBeEnabled()
  await expect(page.getByTestId('sync-blocked')).toHaveCount(0)

  // Chosen means stored: it survives a reload.
  await page.reload()
  await expect(page.getByRole('radio', { name: 'Main bar' })).toBeChecked()
  await expect(page.getByRole('radio', { name: /Публично меню/ })).toBeChecked()
  await expect(syncButton(page)).toBeEnabled()
  // Each category shows how many sub-categories it has, and no id.
  await expect(page.getByTestId('catalogue-tree')).toContainText('3 подкатегории')
  await expect(page.getByTestId('catalogue-tree')).not.toContainText('1171')
})

test('the mapping settings are saved and shown back', async () => {
  await expect(page.getByRole('radio', { name: /Базова цена/ })).toBeChecked()
  await expect(page.getByRole('combobox', { name: 'Характеристика за алергени' })).toContainText(
    'Автоматично откриване (Алергени)',
  )
  await page.getByRole('radio', { name: /Текуща цена/ }).click()
  await page.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    page.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
  await page.reload()
  await expect(page.getByRole('radio', { name: /Текуща цена/ })).toBeChecked()
  // Back to the default, so the test can run again.
  await page.getByRole('radio', { name: /Базова цена/ }).click()
  await page.getByRole('button', { name: 'Запази настройките' }).click()
  await expect(
    page.getByText('Настройките са запазени. Важат от следващата синхронизация.'),
  ).toBeVisible()
})

test('"Sync now" queues a full pull of this venue, and closes while it waits', async () => {
  await syncButton(page).click()
  await expect(page.getByTestId('integration-notice').filter({ hasText: 'опашка' })).toBeVisible()

  const queued = await jobs('barsy-full-pull')
  expect(queued[0]).toMatchObject({ name: 'barsy-full-pull', state: 'created' })
  expect(queued[0]?.data.venueId).toBe(venueId)
  expect(Object.keys(queued[0]?.data ?? {}).sort()).toEqual([
    'integrationId',
    'tenantId',
    'venueId',
  ])

  // One pull at a time: the button is off, with the reason, and the page keeps watching.
  await expect(syncButton(page)).toBeDisabled()
  await expect(page.getByTestId('sync-blocked')).toHaveText(
    'Вече има синхронизация на опашка или в ход.',
  )
  await expect(page.getByTestId('status-active')).toHaveText(
    'Синхронизацията е на опашка или върви…',
  )
  expect(await jobs('barsy-full-pull')).toHaveLength(1)
})

test('the worker finishes: the run is in the history with its counters', async () => {
  runScript('./scripts/seed-integration-e2e.ts', 'history')
  const row = page.getByTestId('run-row').filter({ hasText: 'Пълна синхронизация' })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row.getByTestId('run-status')).toHaveText('Завършено')
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
  // No id of ours or barsy's anywhere in the history.
  expect(await page.getByTestId('run-history').innerText()).not.toMatch(
    /\b(jb|nd|in)_[0-9A-Za-z]{10,}/,
  )

  // The pull is gone from the queue, so the button is back.
  await expect(syncButton(page)).toBeEnabled({ timeout: 15_000 })
  await expect(page.getByTestId('status-active')).toHaveCount(0)
})

test('a plain member sees the status and the history and can change nothing', async ({
  browser,
}) => {
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const member = await memberContext.newPage()
  try {
    await signIn(member, INTEGRATION_MEMBER_EMAIL)
    await openTab(member)
    await expect(member.getByTestId('read-only')).toContainText(
      'Само собствениците и администраторите',
    )
    await expect(member.getByTestId('status-badge')).toHaveText('Свързано')
    await expect(member.getByTestId('run-row').first()).toBeVisible()
    await expect(member.getByRole('button', { name: 'Смени данните за достъп' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Провери отново' })).toHaveCount(0)
    await expect(member.getByRole('button', { name: 'Запази настройките' })).toHaveCount(0)
    await expect(member.getByRole('radio', { name: 'Roof terrace' })).toBeDisabled()
    await expect(syncButton(member)).toBeDisabled()
    await expect(member.getByTestId('sync-blocked')).toHaveText(
      'Само собствениците и администраторите могат да стартират синхронизация.',
    )
    await snapshot('s2-05-integration-member-bg-light-desktop.png', member)
  } finally {
    await memberContext.close()
  }
})

async function openAs(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
  locale: 'bg' | 'en',
) {
  const state = await page.context().storageState()
  const context = await browser.newContext({ ...options, storageState: state })
  await context.addCookies([
    { name: 'NEXT_LOCALE', value: locale, url: new URL(page.url()).origin },
  ])
  const target = await context.newPage()
  const url = new URL(page.url())
  await target.goto(url.pathname + url.search)
  await expect(target.getByTestId('integration-panel')).toBeVisible()
  return { context, target }
}

test('saves the screenshots of the brief when SCREENSHOT_DIR is set', async ({ browser }) => {
  test.skip(!process.env.SCREENSHOT_DIR, 'SCREENSHOT_DIR is not set')
  await expect(page.getByTestId('integration-panel')).toBeVisible()
  await snapshot('s2-05-integration-bg-light-desktop.png')

  // English, dark, desktop.
  const dark = await openAs(
    browser,
    { colorScheme: 'dark', viewport: { width: 1440, height: 900 } },
    'en',
  )
  await expect(dark.target.getByRole('heading', { name: 'Sync history' })).toBeVisible()
  await snapshot('s2-05-integration-en-dark-desktop.png', dark.target)
  await dark.context.close()

  // English, light, desktop.
  const light = await openAs(
    browser,
    { colorScheme: 'light', viewport: { width: 1440, height: 900 } },
    'en',
  )
  await expect(light.target.getByRole('heading', { name: 'Sync history' })).toBeVisible()
  await snapshot('s2-05-integration-en-light-desktop.png', light.target)
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
  )
  await expect(
    phone.target.getByRole('heading', { name: 'История на синхронизациите' }),
  ).toBeVisible()
  await snapshot('s2-05-integration-bg-light-mobile.png', phone.target)
  // No sideways scroll on the phone.
  const overflow = await phone.target.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
  await phone.context.close()
})
