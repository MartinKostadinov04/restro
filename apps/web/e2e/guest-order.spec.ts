// The table's shared order (#75), on a production build: two phones on one table see one order.
// Each phone is its own browser (its own storage), both opened on the table's code as a guest
// would from the QR. One adds an item, the other sees the line and raises it, the first sees the
// new quantity and removes it, and both see it gone with an Undo. The order lives on the server
// (the guest API); the phones only draw it. The table's code travels in a header, never in an
// address the API is called on. The fixture is scripts/seed-order-e2e.ts (run here: it gives the
// table a new code each time).
import { type Browser, devices, expect, type Page, type Request, test } from '@playwright/test'

import { runScript } from './global-setup'

test.use({ ...devices['Pixel 7'] })

type Seed = { readonly path: string; readonly code: string }
let seed: Seed

test.beforeAll(() => {
  const output = runScript('./scripts/seed-order-e2e.ts', 'seed')
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_order_e2e_done'))
  if (!line) throw new Error(`the seed printed no result:\n${output}`)
  seed = JSON.parse(line) as Seed
})

/** A phone of its own on the table, with every guest API request it makes. */
async function phone(browser: Browser) {
  const context = await browser.newContext({ ...devices['Pixel 7'] })
  const page = await context.newPage()
  const calls: Request[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/guest/')) calls.push(request)
  })
  await page.goto(`${seed.path}?lang=en#t=${seed.code}`)
  await expect(page.locator('[data-face="qr-phone"]').first()).toBeVisible()
  await expect(page.locator('[data-slot="menu.bag"]')).toBeVisible()
  return { context, page, calls }
}

const lines = (page: Page) => page.locator('[data-order-line]')
// A phone on the menu polls every 10 s, one on the order every 2 s: wait past one menu poll.
const SEEN = { timeout: 20_000 }

test('two phones on one table see one order', async ({ browser }) => {
  const first = await phone(browser)
  const second = await phone(browser)
  try {
    // The first phone adds an item: drawn at once, then confirmed by the server.
    const add = first.page.locator('[data-slot="item.add"]').first()
    await add.click()
    await expect(lines(first.page)).toHaveCount(1)
    await expect(lines(first.page).first()).toHaveAttribute('data-qty', '1')
    await expect(lines(first.page).first()).not.toHaveAttribute('data-pending', '', SEEN)
    const lineId = await lines(first.page).first().getAttribute('data-order-line')
    expect(lineId).toMatch(/^ol_/)

    // The second phone sees the same line, and raises it.
    const shared = second.page.locator(`[data-order-line="${lineId}"]`)
    await expect(shared).toHaveAttribute('data-qty', '1', SEEN)
    await shared.getByRole('button', { name: 'One more' }).click()
    await expect(shared).toHaveAttribute('data-qty', '2')

    // The first phone sees the new quantity, and removes the line.
    const mine = first.page.locator(`[data-order-line="${lineId}"]`)
    await expect(mine).toHaveAttribute('data-qty', '2', SEEN)
    await mine.getByRole('button', { name: 'Remove' }).click()
    await expect(lines(first.page)).toHaveCount(0)
    await expect(first.page.locator(`[data-removed-line="${lineId}"]`)).toBeVisible()

    // Gone on the second phone too, within the Undo's 10 s or not at all.
    await expect(lines(second.page)).toHaveCount(0, SEEN)

    // Every call carried the table's code in its header, and no address carried it.
    const all = [...first.calls, ...second.calls]
    expect(all.length).toBeGreaterThan(2)
    for (const call of all) {
      expect(call.url()).not.toContain(seed.code)
      expect(await call.headerValue('authorization')).toBe(`Table ${seed.code}`)
    }
  } finally {
    await first.context.close()
    await second.context.close()
  }
})
