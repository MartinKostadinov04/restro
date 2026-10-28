// Paying by card on the guest page with Stripe's test cards, against Stripe's SANDBOX (#114
// acceptance; the same sandbox as #117's checks). A phone ticks the bill, taps Pay, and the real card
// form (Stripe's Payment Element in the form slot) takes a test card:
//
//   - a 3-D Secure card (4000 0027 6000 3184) completes inside the page: the bank's check opens in a
//     frame, nothing redirects, the address never carries a Stripe value, and the page ends on "Paid"
//     with the payment number;
//   - a declined card (4000 0000 0000 0002) shows Stripe's own text in the form and the page does not
//     say "Paid".
//
// It runs only where the sandbox is set up, and is skipped everywhere else (CI included), because it
// needs Martin's keys and a connected sandbox account (D125: a test account, never a live one):
//
//   STRIPE_SANDBOX_E2E=1
//   STRIPE_SECRET_KEY            the platform's restricted sandbox key (the worker pays through it)
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY   its publishable key, set before `next build` (inlined)
//   STRIPE_E2E_ACCOUNT           a connected sandbox account (acct_…) that takes card payments
//   PAYMENTS_ENV=test
//
// The other half is the pay harness in its Stripe mode (apps/worker/src/e2e/pay-harness.ts,
// PAY_HARNESS_PROVIDER=stripe, PAY_HARNESS_PAGE=1): a venue on the simulated POS with a waiter's round
// on table 1 and a qr-phone menu, connected to that account. Cloudflare's Turnstile script is stubbed
// in the page, as in the Send specs. No key is read or printed here: the spec only passes the
// environment on.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { devices, expect, type Page, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'] })

const SANDBOX =
  process.env.STRIPE_SANDBOX_E2E === '1' &&
  !!process.env.STRIPE_SECRET_KEY &&
  !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY &&
  !!process.env.STRIPE_E2E_ACCOUNT

test.skip(!SANDBOX, 'the Stripe sandbox is not set up (STRIPE_SANDBOX_E2E and the sandbox keys)')

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

let harness: ChildProcessWithoutNullStreams
let path = ''
let code = ''
const events: Record<string, unknown>[] = []

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const workerDir = fileURLToPath(new URL('../../worker/', import.meta.url))
  harness = spawn(process.execPath, ['--import', 'tsx', 'src/e2e/pay-harness.ts'], {
    cwd: workerDir,
    env: {
      ...process.env,
      LOG_LEVEL: 'warn',
      PAY_HARNESS_PROVIDER: 'stripe',
      PAY_HARNESS_PAGE: '1',
      PAYMENTS_ENV: 'test',
    },
  })
  let buffer = ''
  harness.stdout.setEncoding('utf8')
  harness.stdout.on('data', (chunk: string) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim().startsWith('{')) events.push(JSON.parse(line) as Record<string, unknown>)
    }
  })
  harness.on('exit', (exitCode) => {
    if (exitCode !== 0) events.push({ event: 'pay_harness_failed', exitCode })
  })
  await expect
    .poll(
      () =>
        events.find(
          (line) => line.event === 'pay_harness_ready' || line.event === 'pay_harness_failed',
        ),
      { timeout: 120_000 },
    )
    .toBeTruthy()
  const ready = events.find((line) => line.event === 'pay_harness_ready')
  if (ready === undefined) throw new Error('the pay harness did not start (see its stderr)')
  path = String(ready.path)
  code = String(ready.code)
})

test.afterAll(async () => {
  if (harness === undefined || harness.exitCode !== null) return
  harness.stdin.end()
  await new Promise((resolve) => setTimeout(resolve, 2_000))
  if (harness.exitCode === null) harness.kill()
})

/** Opens the page on table 1 and starts paying for the whole bill. */
async function startPaying(page: Page): Promise<void> {
  await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
  )
  await page.goto(`${path}?lang=en#t=${code}`)
  await expect(page.locator('[data-face="qr-phone"]').first()).toBeVisible()
  await expect(page.locator('[data-slot="menu.bill"]')).toBeVisible({ timeout: 30_000 })
  await page.locator('[data-slot="pay.whole"]').click()
  await page.locator('[data-slot="pay.start"]').click()
  // The card form is Stripe's, in the slot the face placed.
  await expect(page.locator('[data-slot="pay.form"] iframe').first()).toBeVisible({
    timeout: 60_000,
  })
}

/** Types a card into Stripe's Payment Element (its fields sit in one frame). */
async function typeCard(page: Page, number: string): Promise<void> {
  const frame = page.frameLocator('[data-slot="pay.form"] iframe').first()
  await frame.getByPlaceholder(/1234 1234 1234 1234/).fill(number)
  await frame.getByPlaceholder(/MM \/ YY/).fill('12 / 34')
  await frame.getByPlaceholder(/CVC/).fill('123')
  const postal = frame.getByPlaceholder(/ZIP|Postal/i)
  if (await postal.count()) await postal.first().fill('12345')
}

test('a 3-D Secure card completes inside the page, with no redirect and no Stripe value in the address', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const navigations: string[] = []
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url())
  })
  await startPaying(page)
  const addressBefore = page.url()
  await typeCard(page, '4000 0027 6000 3184')
  await page.locator('[data-slot="pay.form.submit"]').click()

  // The bank's check (Stripe's test page) opens in a frame of this page; it is completed there.
  const challenge = page.frameLocator('iframe[src*="stripe.com"]').last()
  await challenge.getByRole('button', { name: /complete/i }).click({ timeout: 60_000 })

  await expect(page.locator('[data-pay-screen="paid"]')).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('[data-slot="pay.number"]')).toHaveText(/^[A-Z0-9]{5}$/)

  // No redirect: the page never left its address, and nothing of Stripe's is in it.
  expect(page.url()).toBe(addressBefore)
  expect(navigations.filter((url) => url.includes('payment_intent'))).toEqual([])
  expect(page.url()).not.toMatch(/payment_intent|client_secret|redirect_status/)
})

test('a declined card shows Stripe’s own text and the page does not say Paid', async ({ page }) => {
  test.setTimeout(180_000)
  await startPaying(page)
  await typeCard(page, '4000 0000 0000 0002')
  await page.locator('[data-slot="pay.form.submit"]').click()
  await expect(page.locator('[data-slot="pay.form"] [role="alert"]')).toContainText(/declined/i, {
    timeout: 60_000,
  })
  await expect(page.locator('[data-pay-screen="paid"]')).toHaveCount(0)
})
