import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { type Browser, expect, type Page, test } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, VENUE_NAME } from './support'

// The owner's settings for ordering (#87; plans `docs/deliverables/2026-10-27-settings-*-plan.md`) on
// a production build, in Bulgarian (the longest words), as the demo owner:
//
//   Hours: a night is opened through its dialog and shows after a reload; a problem shows under its field
//   Ordering: the cap is changed in place; the venue's spot says it is unset
//   Staff and roles: a person is added and the PIN shows in the result
//   Alerts: "Link a Telegram group" says Telegram is not set up here (no bot in the test worker)
//   Tonight › Log › Export: two CSV files in the end-of-night CSV's format (BOM, same columns)
//   Every section at 390 px and desktop, light and dark: no sideways scroll
//
// With SCREENSHOT_DIR set, it saves the screenshots there.
test.describe.configure({ mode: 'serial' })
test.setTimeout(240_000)

let venueId = ''

async function signIn(page: Page) {
  // Better Auth allows a few sign-ins per 10 seconds, and other specs signed in just before.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/venues')
    await page.getByLabel('Имейл').fill(ADMIN_EMAIL)
    await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Вход' }).click()
    try {
      await expect(page).toHaveURL(/\/venues$/, { timeout: 8_000 })
      return
    } catch {
      await page.waitForTimeout(10_000)
    }
  }
  throw new Error('could not sign in')
}

async function open(
  browser: Browser,
  options: { width: number; height: number; colorScheme: 'light' | 'dark' },
) {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height },
    colorScheme: options.colorScheme,
  })
  const page = await context.newPage()
  await signIn(page)
  return { context, page }
}

const section = (name: string) => `/venues/${venueId}?tab=settings&section=${name}`

async function snapshot(page: Page, name: string) {
  const dir = process.env.SCREENSHOT_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: path.join(dir, name), fullPage: true })
}

test('finds the venue', async ({ browser }) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page
    .getByRole('link', { name: new RegExp(VENUE_NAME) })
    .first()
    .click()
  await expect(page).toHaveURL(/\/venues\/vn_[^/?]+/)
  venueId = new URL(page.url()).pathname.split('/')[2] ?? ''
  expect(venueId).toMatch(/^vn_/)
  await context.close()
})

test('Hours: opens a night through its dialog, refuses hours that do not fit, keeps what was saved', async ({
  browser,
}) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page.goto(section('hours'))
  await expect(page.getByRole('heading', { name: 'Работно време', level: 2 })).toBeVisible()
  // The page must be interactive before the click. A day that never had times asks for them when
  // switched on; one a reused database keeps open, or keeps the times of (switching off keeps them),
  // is changed from its row.
  await page.waitForLoadState('networkidle')
  const thursday = page.getByRole('switch', { name: 'Четвъртък' })
  const dialog = page.getByRole('dialog')
  const change = page.getByRole('button', { name: /^Четвъртък: / })
  if (!(await thursday.isChecked())) await thursday.click()
  await expect(dialog.or(change)).toBeVisible()
  if (!(await dialog.isVisible())) await change.click()
  await expect(dialog.getByLabel('Отваря')).toBeVisible()
  await dialog.getByLabel('Отваря').fill('23:00')
  await dialog.getByLabel('Последни поръчки').fill('06:50')
  await dialog.getByLabel('Затваря').fill('06:55')
  await dialog.getByRole('button', { name: 'Запази' }).click()
  await expect(
    dialog.getByText(
      'Последните поръчки трябва да са поне 15 минути преди края на вечерта (07:00).',
    ),
  ).toBeVisible()
  await dialog.getByLabel('Последни поръчки').fill('04:30')
  await dialog.getByLabel('Затваря').fill('05:00')
  await dialog.getByRole('button', { name: 'Запази' }).click()
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(
    page.getByTestId('hours-days').getByText(/23:00 – 05:00 .*последни поръчки 04:30/),
  ).toBeVisible()
  await expect(page.getByTestId('hours-none')).toBeHidden()
  await context.close()
})

test('Ordering: changes the cap in place and says the spot is not set', async ({ browser }) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page.goto(section('ordering'))
  await expect(page.getByRole('heading', { name: 'Поръчки', level: 2 })).toBeVisible()
  await expect(page.getByTestId('ord-spot-unset')).toBeVisible()
  await page.getByRole('button', { name: 'Промени най-голямата поръчка' }).click()
  const input = page.getByLabel('Най-голяма поръчка на сметка без предварително плащане')
  await input.fill('200')
  await input.press('Enter')
  await expect(page.getByTestId('ord-cap-value')).toContainText('200')
  await page.reload()
  await expect(page.getByTestId('ord-cap-value')).toContainText('200')
  await context.close()
})

test('Staff and roles: adds a person and shows the PIN in the result', async ({ browser }) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page.goto(section('staff'))
  await expect(page.getByRole('heading', { name: 'Персонал и роли', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: 'Добави човек' }).first().click()
  await page.getByLabel('Име').fill('Мила')
  await page.getByRole('button', { name: 'Добави', exact: true }).click()
  await expect(page.getByTestId('pin-result')).toContainText(/\d{4}/)
  await page.getByRole('button', { name: 'Готово' }).click()
  await expect(page.getByTestId('staff-people').getByText('Мила').first()).toBeVisible()
  await context.close()
})

test('Alerts: a Telegram that is not set up is said plainly', async ({ browser }) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page.goto(section('alerts'))
  await expect(page.getByRole('heading', { name: 'Известия', level: 2 })).toBeVisible()
  await page.getByRole('button', { name: 'Свържи група в Telegram' }).click()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: 'Telegram още не е настроен' }),
  ).toBeVisible()
  await context.close()
})

test('Tonight › Log › Export: two CSV files in the end-of-night CSV’s format', async ({
  browser,
}) => {
  const { context, page } = await open(browser, { width: 1280, height: 900, colorScheme: 'light' })
  await page.goto(`/venues/${venueId}?tab=tonight&view=log`)
  await page.getByTestId('log-export').click()
  for (const kind of ['sent', 'log'] as const) {
    const href = await page
      .getByTestId(kind === 'sent' ? 'export-sent' : 'export-log')
      .getAttribute('href')
    expect(href).toContain(`kind=${kind}`)
    const response = await page.request.get(href ?? '')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    expect(response.headers()['content-disposition']).toContain('.csv')
    const body = await response.text()
    expect(
      body.startsWith(
        '﻿section,time,table,reference,what,state,reason,answer,who,amount,tip,detail',
      ),
    ).toBe(true)
  }
  const bad = await page.request.get(
    `/api/venues/${venueId}/export?kind=log&from=2026-10-27&to=2026-10-01`,
  )
  expect(bad.status()).toBe(404)
  await context.close()
})

for (const scheme of ['light', 'dark'] as const) {
  for (const [label, size] of [
    ['mobile', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 900 }],
  ] as const) {
    test(`every section fits the screen: ${label}, ${scheme}`, async ({ browser }) => {
      const { context, page } = await open(browser, { ...size, colorScheme: scheme })
      for (const name of ['hours', 'ordering', 'staff', 'alerts']) {
        await page.goto(section(name))
        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible()
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow, `${name} at ${label}`).toBeLessThanOrEqual(1)
        await snapshot(page, `settings-${name}-bg-${scheme}-${label}.png`)
      }
      await context.close()
    })
  }
}
