import { expect, test } from '@playwright/test'

import { ADMIN_EMAIL, ADMIN_PASSWORD, VENUE_NAME } from './support'

// The whole admin frame on a production build, in Bulgarian (the default language) and English:
// sign in, venue grid, venue workspace with its URL-mirrored tabs, language switch, sign out.
// The tests share one demo owner, so they run in order.
test.describe.configure({ mode: 'serial' })

test('an unauthenticated visitor is sent to the sign-in page, which offers no sign-up', async ({
  page,
}) => {
  await page.goto('/venues')
  await expect(page).toHaveURL(/\/login\?next=%2Fvenues$/)
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible()
  // No sign-up: the page offers no registration, only a note that access is by invitation.
  await expect(page.getByText('Достъпът е само с покана.')).toBeVisible()
  await expect(page.getByRole('link', { name: /регистр|sign up/i })).toHaveCount(0)
})

test('a wrong password is refused with a message and stays on the sign-in page', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByLabel('Имейл').fill(ADMIN_EMAIL)
  await page.getByLabel('Парола').fill(`${ADMIN_PASSWORD}-wrong`)
  await page.getByRole('button', { name: 'Вход' }).click()
  await expect(page.getByTestId('login-error')).toHaveText('Имейлът или паролата не са верни.')
  await expect(page).toHaveURL(/\/login/)
})

test('sign in, open a venue, switch tabs (the URL follows), switch language, sign out', async ({
  page,
}) => {
  // --- sign in ----------------------------------------------------------------------------
  await page.goto('/venues')
  await page.getByLabel('Имейл').fill(ADMIN_EMAIL)
  await page.getByLabel('Парола').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Вход' }).click()
  await expect(page).toHaveURL(/\/venues$/)

  // --- venue grid: only this organisation's venue -------------------------------------------
  await expect(page.getByRole('heading', { name: 'Заведения', level: 1 })).toBeVisible()
  const cards = page.getByTestId('venue-card')
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(VENUE_NAME)
  // The card names the guest address (the organisation's and the venue's address names, D84), the
  // venue's state (the global setup publishes the demo menu), where its menu comes from (this
  // venue has no till) and a Preview menu that opens the guest address in a new tab (D86).
  await expect(cards.first().getByTestId('venue-card-address')).toHaveText('/m/demo-club/demo-club')
  await expect(cards.first().getByTestId('venue-card-state')).toHaveText('На живо')
  await expect(cards.first().getByTestId('venue-card-source')).toHaveText('На ръка')
  const preview = cards.first().getByRole('link', { name: 'Преглед на менюто' })
  await expect(preview).toHaveAttribute('href', '/m/demo-club/demo-club')
  await expect(preview).toHaveAttribute('target', '_blank')

  // --- open the venue ------------------------------------------------------------------------
  await cards.first().getByRole('link', { name: 'Отвори' }).click()
  await expect(page).toHaveURL(/\/venues\/vn_[0-9A-Za-z]{22}$/)
  await expect(page.getByRole('heading', { name: VENUE_NAME, level: 1 })).toBeVisible()
  // The first tab is open by default and shows the composer (its own spec tests it in depth).
  await expect(page.getByRole('tab', { name: 'Композитор' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByTestId('composer')).toBeVisible()

  // --- tabs live in the URL ------------------------------------------------------------------
  await page.getByRole('tab', { name: 'Публикуване' }).click()
  await expect(page).toHaveURL(/\?tab=publishing$/)
  // The Publish tab is real (its own spec tests it in depth): it reads the venue's versions.
  await expect(page.getByTestId('publish-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Версии' })).toBeVisible()

  await page.getByRole('tab', { name: 'Настройки' }).click()
  await expect(page).toHaveURL(/\?tab=settings$/)
  await expect(page.getByText('Europe/Sofia')).toBeVisible()
  await expect(page.getByText('07:00')).toBeVisible()

  // A reload keeps the tab.
  await page.reload()
  await expect(page).toHaveURL(/\?tab=settings$/)
  await expect(page.getByRole('tab', { name: 'Настройки' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByText('Europe/Sofia')).toBeVisible()

  // --- language: the user menu switches it, the cookie keeps it -------------------------------
  await page.getByTestId('user-menu').click()
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.getByRole('tab', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/\?tab=settings$/)

  // --- sign out ------------------------------------------------------------------------------
  await page.getByTestId('user-menu').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  // The session is gone: the admin is closed again.
  await page.goto('/venues')
  await expect(page).toHaveURL(/\/login\?next=%2Fvenues$/)
})

test('the development-only field preview does not exist in a production build', async ({
  request,
}) => {
  const response = await request.get('/dev/fields')
  expect(response.status()).toBe(404)
})
