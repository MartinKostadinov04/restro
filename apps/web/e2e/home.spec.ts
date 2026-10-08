import { expect, test } from '@playwright/test'

test('the home page leads a visitor to the sign-in page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Restro', { exact: true }).first()).toBeVisible()
})

test('health endpoint reports ok', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual({ status: 'ok' })
})
