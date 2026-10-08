import { expect, test } from '@playwright/test'

test('home page shows Restro', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Restro' })).toBeVisible()
})

test('health endpoint reports ok', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual({ status: 'ok' })
})
