// The Send and "did it land" (#77, D115, D116), on a production build, against the simulated POS
// (never a real one): a guest on Demo Bar's table 1 adds a Negroni and taps Send; the real worker
// adds the round to the simulator as a waiter would. Two of the simulator's faults:
//
//   - the round lands but the answer never comes: the worker reads the bill back, finds the round,
//     and the phone shows Added; the POS bill holds the Negroni once (never sent twice);
//   - the same, while a waiter puts the very same round on: reading back cannot tell the two
//     apart, so the Send ends Unconfirmed and the phone says to show its reference to a waiter.
//
// Both run on each template that draws the shared order (guest-faces.ts, #239).
//
// Table 1 is open with a waiter's Mojito in both (on the pilot's profile only a waiter opens a POS
// bill). The fixture is scripts/seed-send-e2e.ts (run here before each test: a new code, a fresh
// sitting, no pause). Cloudflare's Turnstile script is stubbed in the page; the server checks its
// token with Cloudflare's published test secret (playwright.config.ts).
import { devices, expect, type Page, test } from '@playwright/test'

import { runScript } from './global-setup'
import { faceRoot, ORDER_FACES, type OrderFace, showOrder } from './guest-faces'

test.use({ ...devices['Pixel 7'] })

const PORT = Number(process.env.E2E_PORT ?? 3100)
const SIM = `127.0.0.1:${PORT + 3}`
/** The simulator's table 1 and the Negroni (Demo Bar's first item). */
const POS_TABLE = '30001'
const NEGRONI = '2001'

// The worker waits 10 s for a write's answer, then reads the bill back every 5 s.
const SETTLED = { timeout: 60_000 }

/** Loads one of the simulator's scenarios: its bills and its faults, from a fresh engine. */
async function loadScenario(name: string): Promise<void> {
  const response = await fetch(`http://${SIM}/control/api/scenario`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(response.ok).toBe(true)
}

/** The articles on table 1's open POS bills, one per row. */
async function articlesOnTable(): Promise<string[]> {
  const response = await fetch(`http://${SIM}/control/api/state`)
  const state = (await response.json()) as {
    tables: { id: string; bills: { rows: { article: string }[] }[] }[]
  }
  const table = state.tables.find((one) => one.id === POS_TABLE)
  return (table?.bills ?? []).flatMap((bill) => bill.rows.map((row) => row.article))
}

function seed(face: OrderFace): { path: string; code: string } {
  const output = runScript('./scripts/seed-send-e2e.ts', 'seed', SIM, face)
  const line = output
    .split('\n')
    .reverse()
    .find((candidate) => candidate.includes('seed_send_e2e_done'))
  if (!line) throw new Error(`the seed printed no result:\n${output}`)
  return JSON.parse(line) as { path: string; code: string }
}

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

/** A phone on table 1 with a Negroni in the table's order, ready to Send. */
async function phoneWithANegroni(page: Page, face: OrderFace): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
  const { path, code } = seed(face)
  await page.goto(`${path}?lang=en#t=${code}`)
  await expect(faceRoot(page, face)).toBeVisible()
  await page.locator('[data-slot="item.add"]').first().click()
  // The order is on screen: inline on the reference template, in the bag sheet on Editorial Market.
  await showOrder(page, face)
  const line = page.locator('[data-order-line]')
  await expect(line).toHaveCount(1, { timeout: 20_000 })
  await expect(line.first()).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

const sentOrder = (page: Page) => page.locator('[data-sent-order]')

for (const face of ORDER_FACES) {
  test.describe(`on ${face}`, () => {
    test('a round that lands but whose answer never comes is found on the bill: Added', async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await loadScenario('send-lands-then-hangs')
      await phoneWithANegroni(page, face)

      await page.locator('[data-send]').click()
      await expect(sentOrder(page)).toHaveCount(1)
      await expect(page.locator('[data-order-line]')).toHaveCount(0)
      await expect(sentOrder(page)).toHaveAttribute('data-sent-state', 'added', SETTLED)
      await expect(sentOrder(page)).toContainText('Added to your bill')

      // On the POS bill once, after the waiter's Mojito: never sent twice.
      expect(await articlesOnTable()).toEqual(['2003', NEGRONI])
    })

    test('a round a waiter doubles while the answer never comes ends Unconfirmed', async ({
      page,
    }) => {
      test.setTimeout(120_000)
      await loadScenario('send-unconfirmed')
      await phoneWithANegroni(page, face)

      await page.locator('[data-send]').click()
      await expect(sentOrder(page)).toHaveAttribute('data-sent-state', 'unconfirmed', SETTLED)
      await expect(sentOrder(page)).toContainText(
        /Not confirmed: show [A-Z0-9]{3,4} to your waiter/,
      )

      // "Show this to your waiter": the reference in large type.
      await sentOrder(page).getByRole('button', { name: 'Show this to your waiter' }).click()
      await expect(page.locator('[data-show-waiter] [class*="waiter-ref"]')).toHaveText(
        /^[A-Z0-9]{3,4}$/,
      )

      // The POS bill holds both Negronis, the waiter's and Restro's, with nothing to tell them apart.
      expect((await articlesOnTable()).sort()).toEqual([NEGRONI, NEGRONI, '2003'])
    })
  })
}
