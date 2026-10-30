// The table's shared order (#75), on a production build: two phones on one table see one order.
// Each phone is its own browser (its own storage), both opened on the table's code as a guest
// would from the QR. One adds an item, the other sees the line and raises it, the first sees the
// new quantity and removes it, and both see it gone with an Undo. The order lives on the server
// (the guest API); the phones only draw it. The table's code travels in a header, never in an
// address the API is called on. The fixture is scripts/seed-order-e2e.ts (run here: it gives the
// table a new code each time).
//
// It runs on the renderer in both Styles (guest-faces.ts): the order lives in the bag sheet and the
// location questions in a sheet of their own.
//
// The venue checks location (#76): a phone sees the order only once it holds a pass. The first
// phone gets one by adding (the consent screen, Allow, and the add goes through), the second by its
// own "Allow location"; a phone across town is told the check failed, and offered "Call a waiter"
// (the venue has the service on) and "Cancel". The position goes only in a command's body, never in
// an address.
import { type Browser, devices, expect, type Page, type Request, test } from '@playwright/test'
import { runScript } from './global-setup'
import { faceRoot, hideOrder, ORDER_STYLES, showOrder } from './guest-faces'
import { ORDER_SPOT } from './support'

test.use({ ...devices['Pixel 7'] })

type Seed = { readonly path: string; readonly code: string }

const AT_THE_VENUE = { latitude: ORDER_SPOT.lat, longitude: ORDER_SPOT.lng, accuracy: 20 }
// About 6 km away: well past the venue's 150 m.
const ACROSS_TOWN = {
  latitude: ORDER_SPOT.lat - 0.05,
  longitude: ORDER_SPOT.lng + 0.05,
  accuracy: 20,
}

const lines = (page: Page) => page.locator('[data-order-line]')
const prompt = (page: Page, which: string) => page.locator(`[data-location-prompt="${which}"]`)
// A phone on the menu polls every 10 s, one on the order every 2 s: wait past one menu poll.
const SEEN = { timeout: 20_000 }

for (const style of ORDER_STYLES) {
  test.describe(`in ${style}`, () => {
    let seed: Seed

    test.beforeAll(() => {
      const output = runScript('./scripts/seed-order-e2e.ts', 'seed', style)
      const line = output
        .split('\n')
        .reverse()
        .find((candidate) => candidate.includes('seed_order_e2e_done'))
      if (!line) throw new Error(`the seed printed no result:\n${output}`)
      seed = JSON.parse(line) as Seed
    })

    /** A phone of its own on the table, standing at `geolocation`, with every guest API request it makes. */
    async function phone(browser: Browser, geolocation = AT_THE_VENUE) {
      const context = await browser.newContext({
        ...devices['Pixel 7'],
        geolocation,
        permissions: ['geolocation'],
      })
      const page = await context.newPage()
      const calls: Request[] = []
      page.on('request', (request) => {
        if (request.url().includes('/api/guest/')) calls.push(request)
      })
      await page.goto(`${seed.path}?lang=en#t=${seed.code}`)
      await expect(faceRoot(page)).toBeVisible()
      await expect(page.locator('[data-slot="menu.bag"]')).toBeAttached()
      return { context, page, calls }
    }

    test('two phones on one table see one order', async ({ browser }) => {
      const first = await phone(browser)
      const second = await phone(browser)
      try {
        // No pass yet: the order is hidden, with the guest's own "Allow location".
        await showOrder(first.page)
        await expect(prompt(first.page, 'none')).toBeVisible(SEEN)
        await expect(lines(first.page)).toHaveCount(0)
        await hideOrder(first.page)

        // The first phone adds an item: the consent screen first, then the add goes through.
        const add = first.page.locator('[data-slot="item.add"]').first()
        await add.click()
        await expect(prompt(first.page, 'consent')).toBeVisible()
        await prompt(first.page, 'consent')
          .getByRole('button', { name: 'Allow', exact: true })
          .click()
        await showOrder(first.page)
        await expect(lines(first.page)).toHaveCount(1, SEEN)
        await expect(lines(first.page).first()).toHaveAttribute('data-qty', '1')
        await expect(lines(first.page).first()).not.toHaveAttribute('data-pending', '', SEEN)
        const lineId = await lines(first.page).first().getAttribute('data-order-line')
        expect(lineId).toMatch(/^ol_/)

        // The second phone allows location itself, then sees the same line and raises it.
        await showOrder(second.page)
        await second.page.getByRole('button', { name: 'Allow location' }).click()
        await prompt(second.page, 'consent')
          .getByRole('button', { name: 'Allow', exact: true })
          .click()
        await showOrder(second.page)
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

        // Every call carried the table's code in its header, and no address carried it or the
        // position; every command carried the phone's value, and the last calls the pass.
        const all = [...first.calls, ...second.calls]
        expect(all.length).toBeGreaterThan(2)
        for (const call of all) {
          expect(call.url()).not.toContain(seed.code)
          expect(call.url()).not.toContain(String(ORDER_SPOT.lat))
          expect(await call.headerValue('authorization')).toBe(`Table ${seed.code}`)
          if (call.method() === 'POST') {
            expect(await call.headerValue('x-restro-phone')).toMatch(/^[A-Za-z0-9_-]{22}$/)
          }
        }
        for (const calls of [first.calls, second.calls]) {
          expect(await calls.at(-1)?.headerValue('x-restro-pass')).toBeTruthy()
        }
      } finally {
        await first.context.close()
        await second.context.close()
      }
    })

    test('a phone across town is told the check failed, and offered a waiter call and Cancel', async ({
      browser,
    }) => {
      const far = await phone(browser, ACROSS_TOWN)
      try {
        await far.page.locator('[data-slot="item.add"]').first().click()
        await prompt(far.page, 'consent')
          .getByRole('button', { name: 'Allow', exact: true })
          .click()
        const failed = prompt(far.page, 'failed')
        await expect(failed).toBeVisible(SEEN)
        // The venue takes waiter calls and the renderer draws them: a button, never the still card.
        await expect(failed.getByRole('button', { name: 'Call a waiter' })).toBeVisible()
        await expect(failed.getByText('Please order from your waiter')).toHaveCount(0)
        await failed.getByRole('button', { name: 'Cancel' }).click()
        await expect(failed).toHaveCount(0)
        await showOrder(far.page)
        await expect(lines(far.page)).toHaveCount(0)
        await expect(prompt(far.page, 'none')).toBeVisible()
      } finally {
        await far.context.close()
      }
    })
  })
}
