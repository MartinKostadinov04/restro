// Pay-first items (#113, #258), on a production build, against the simulated POS and the simulated
// card provider. The other half is the pay harness on the worker's side in its pay-first mode
// (apps/worker/src/e2e/pay-harness.ts, `PAY_HARNESS_MODE=pay-first`): a venue on a POS whose first
// items open a bill that names itself, a published menu of one item paid first, the payment jobs,
// and the guest at the card form.
//
// Two halves. The first drives the guest API directly, as the page does: a guest adds two of the
// pay-first item and taps Send: the Send's pay-first part is a payment, read by the handle in
// `X-Restro-Payment` until the card form. The guest pays at the form and comes back: the hold is
// taken, the round is entered on a free payment table (its first line naming the guest's table),
// checked against the hold, closed and captured. The table's state shows the line as paid first
// while it waits, and nothing of the payment's handle.
//
// The second half is the screen (#258): a browser is the guest, on the renderer in both Styles
// (guest-faces.ts). The order says the line is "Not ordered until paid" and the one button "Pay"; the
// guest taps it, leaves the card form with "Pay later" (the line is back on the order, not ordered),
// taps it again, finishes the sim card form and ends on "Paid" with the round on the table's sent
// orders as Added. The tip row and "Send and pay" (a bill line beside the pay-first one) need a till
// that records a tip and a table with both kinds of line: they are unit-tested on the face, because
// the harness's POS records no tip.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { devices, expect, test } from '@playwright/test'

import { faceRoot, ORDER_STYLES, showOrder, styleDesign } from './guest-faces'

test.use({ ...devices['Pixel 7'] })

/** Cloudflare's dummy token, which its test secret passes (playwright.config.ts). */
const HUMAN_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const SETTLED = { timeout: 60_000, intervals: [500, 1_000] }
/** The item's POS article and price (the simulator's Aperol Spritz). */
const ARTICLE = '2002'
const PRICE_MINOR = 1_100

/** Cloudflare's script, stubbed: every widget answers at once with Cloudflare's dummy token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(_container, options) { window.__turnstileOptions = options; return 'w1' },
  execute() { window.__turnstileOptions.callback('XXXX.DUMMY.TOKEN.XXXX') },
  remove() {},
}`

/** A running pay harness in its pay-first mode, and what it said. */
class Harness {
  readonly events: Record<string, unknown>[] = []
  private readonly process: ChildProcessWithoutNullStreams

  constructor(env: Record<string, string>) {
    const workerDir = fileURLToPath(new URL('../../worker/', import.meta.url))
    this.process = spawn(process.execPath, ['--import', 'tsx', 'src/e2e/pay-harness.ts'], {
      cwd: workerDir,
      env: { ...process.env, LOG_LEVEL: 'warn', PAY_HARNESS_MODE: 'pay-first', ...env },
    })
    let buffer = ''
    this.process.stdout.setEncoding('utf8')
    this.process.stdout.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim().startsWith('{'))
          this.events.push(JSON.parse(line) as Record<string, unknown>)
      }
    })
    let stderr = ''
    this.process.stderr.setEncoding('utf8')
    this.process.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000)
    })
    this.process.on('exit', (exitCode) => {
      if (exitCode !== 0) this.events.push({ event: 'pay_harness_failed', exitCode, stderr })
    })
  }

  /** Waits for the harness's JSON line with `event` (and `paymentId`, when given); the last one. */
  async said(event: string, paymentId?: string, after = 0, timeout = 120_000) {
    const find = () =>
      this.events
        .slice(after)
        .find(
          (line) =>
            line.event === 'pay_harness_failed' ||
            (line.event === event && (paymentId === undefined || line.paymentId === paymentId)),
        ) ?? null
    await expect.poll(find, { timeout }).not.toBeNull()
    const failed = this.events.find((line) => line.event === 'pay_harness_failed')
    if (failed) throw new Error(`the pay harness failed: ${JSON.stringify(failed)}`)
    return find() as Record<string, unknown>
  }

  /** The guest finishes the card form (the harness plays the provider's side). */
  async pay(paymentId: string): Promise<void> {
    this.process.stdin.write(`pay ${paymentId}\n`)
    await this.said('pay_harness_paid', paymentId)
  }

  /** The bills on the POS's payment tables, as the harness reads them from the simulator. */
  async paymentTableBills(): Promise<Bill[]> {
    const after = this.events.length
    this.process.stdin.write('bills\n')
    return (await this.said('pay_harness_bills', undefined, after)).bills as Bill[]
  }

  async stop(): Promise<void> {
    if (this.process.exitCode !== null) return
    const exited = new Promise((resolve) => this.process.once('exit', resolve))
    this.process.stdin.end()
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30_000))])
    if (this.process.exitCode === null) this.process.kill()
  }
}

type Bill = { state: string; rows: { article: string; note: string | null }[] }

test.describe('the guest API', () => {
  let harness: Harness
  let code: string
  let itemId: string

  test.beforeAll(async () => {
    test.setTimeout(180_000)
    harness = new Harness({})
    const ready = await harness.said('pay_harness_ready')
    code = String(ready.code)
    itemId = String(ready.itemId)
  })

  test.afterAll(async () => {
    await harness?.stop()
  })

  test('a pay-first item is paid at Send: entered on a payment table, then closed', async ({
    request,
  }) => {
    test.setTimeout(150_000)
    const phone = randomBytes(16).toString('base64url')
    let handle: string | null = null
    const seen: string[] = []
    const headers = () => ({
      Authorization: `Table ${code}`,
      'X-Restro-Phone': phone,
      ...(handle === null ? {} : { 'X-Restro-Payment': handle }),
    })
    const act = async (command: Record<string, unknown>, check?: Record<string, unknown>) => {
      const response = await request.post('/api/guest/actions', {
        headers: headers(),
        data: { command, ageMs: 50, ...(check === undefined ? {} : { check }) },
      })
      expect(response.status()).toBe(200)
      const text = await response.text()
      seen.push(text)
      const answer = JSON.parse(text) as {
        result: { status: string; code: string | null; subjectId: string | null }
        state: {
          ordering: { payFirst: string } | null
          order: { lines: { mode: string; qty: number }[] } | null
        } | null
        handle: string | null
      }
      if (answer.handle !== null) handle = answer.handle
      return answer
    }
    const payment = async () => {
      const response = await request.get('/api/guest/payment', { headers: headers() })
      expect(response.status()).toBe(200)
      return (await response.json()) as {
        id: string
        state: string
        amountMinor: number | null
        form: { provider: string; values: Record<string, string> } | null
      }
    }

    // The guest adds two: the table offers pay-first, and the line is one to pay first.
    const added = await act({
      kind: 'order.add',
      actionId: randomUUID(),
      itemId,
      optionIds: [],
      qty: 2,
      note: '',
    })
    expect(added.result.status).toBe('accepted')
    expect(added.state?.ordering?.payFirst).toBe('on')
    expect(added.state?.order?.lines).toEqual([
      expect.objectContaining({ qty: 2, mode: 'pay_first' }),
    ])

    // The Send: nothing on the bill, the two paid first.
    const line = { itemId, optionIds: [], qty: 2, note: '' }
    const sent = await act(
      {
        kind: 'order.send',
        actionId: randomUUID(),
        lines: [],
        payFirst: { lines: [line], tipMinor: null, tipPercent: null },
      },
      { humanToken: HUMAN_TOKEN },
    )
    expect(sent.result).toMatchObject({ status: 'accepted', code: null })
    expect(handle).toMatch(/^[A-Za-z0-9_-]{22}$/)

    // The phone reads its payment until the card form: priced at Send, before the POS has it.
    await expect.poll(async () => (await payment()).state, SETTLED).toBe('awaiting_guest')
    const atForm = await payment()
    expect(atForm.amountMinor).toBe(2 * PRICE_MINOR)
    expect(atForm.form?.provider).toBe('sim-pay')
    const formValues = Object.values(atForm.form?.values ?? {})
    expect(formValues.length).toBeGreaterThan(0)
    // Nothing is on a payment table before the guest has paid.
    expect(await harness.paymentTableBills()).toEqual([])

    // The guest pays and comes back: entered on a payment table, checked, closed, captured.
    await harness.pay(atForm.id)
    const returned = await act({ kind: 'pay.returned', actionId: randomUUID() })
    expect(returned.result.status).toBe('accepted')
    await expect.poll(async () => (await payment()).state, SETTLED).toBe('captured')
    const paid = await payment()
    expect(paid.amountMinor).toBe(2 * PRICE_MINOR)
    expect(paid.form).toBeNull()

    // The round is on one payment table, as one bill of its own, closed; its line names table 1.
    const bills = await harness.paymentTableBills()
    expect(bills).toHaveLength(1)
    expect(bills[0]?.state).toBe('closed')
    expect(bills[0]?.rows.map((row) => row.article)).toEqual([ARTICLE])
    expect(bills[0]?.rows[0]?.note).toMatch(/1$/)

    // No table state carries the handle or the form's values. (`handle` is set in `act`.)
    const given = String(handle)
    for (const text of seen.filter((one) => !one.includes('"handle":"'))) {
      expect(text).not.toContain(given)
      for (const value of formValues) expect(text).not.toContain(value)
    }
  })
})

for (const style of ORDER_STYLES) {
  test.describe(`the screen, in ${style}`, () => {
    let harness: Harness
    let path: string
    let code: string

    test.beforeAll(async () => {
      test.setTimeout(180_000)
      harness = new Harness({
        PAY_HARNESS_PAGE: '1',
        PAY_HARNESS_DESIGN: JSON.stringify(styleDesign(style)),
      })
      const ready = await harness.said('pay_harness_ready')
      code = String(ready.code)
      path = String(ready.path)
    })

    test.afterAll(async () => {
      await harness?.stop()
    })

    test('the order says "Not ordered until paid" and "Pay"; Pay later keeps the line; Pay ends on Paid', async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000)
      await page.route('https://challenges.cloudflare.com/turnstile/**', (route) =>
        route.fulfill({ contentType: 'text/javascript', body: TURNSTILE_STUB }),
      )
      const seen: string[] = []
      page.on('console', (message) => seen.push(`console ${message.type()}: ${message.text()}`))
      page.on('pageerror', (error) => seen.push(`page error: ${error.message}`))
      page.on('response', (response) => {
        if (response.status() >= 400) seen.push(`${response.status()} ${response.url()}`)
      })
      await page.goto(`${path}?lang=en#t=${code}`)
      try {
        await expect(faceRoot(page)).toBeVisible({ timeout: 20_000 })
      } catch (error) {
        // CI keeps no trace of a failed page: say what the guest saw.
        console.log(`the page did not draw (${path}):\n${seen.join('\n')}`)
        console.log((await page.locator('body').innerText()).slice(0, 600))
        throw error
      }

      // The guest puts the one pay-first item on the order: the line says it is not ordered yet.
      await page.locator('[data-slot="item.add"]').first().click()
      await showOrder(page)
      const orderLine = page.locator('[data-order-line]')
      await expect(orderLine).toHaveCount(1)
      await expect(orderLine.locator('[data-pay-first-line]')).toHaveText('Not ordered until paid')
      // Pay-first lines alone: the one button is "Pay", with the item's price (no bill line to send).
      const send = page.locator('[data-send]')
      await expect(send).toHaveText(/^Pay .*11\.00/)

      // Send: the card form opens in the sheet, with "Pay later".
      await send.click()
      await expect(page.locator('[data-pay-screen="card"]')).toBeVisible(SETTLED)
      await expect(page.locator('[data-slot="pay.form.submit"]')).toBeVisible()

      // Pay later: before the hold the guest may leave; the line is back on the order, still not ordered.
      await page.locator('[data-slot="pay.later"]').click()
      await expect(page.locator('[data-pay-screen]')).toHaveCount(0, SETTLED)
      await expect(orderLine).toHaveCount(1, SETTLED)
      await expect(orderLine.locator('[data-pay-first-line]')).toHaveText(
        'Not ordered until paid',
        SETTLED,
      )
      await expect(page.locator('[data-send]')).toHaveText(/^Pay .*11\.00/, SETTLED)
      // Nothing reached the POS, and nothing was shown as sent.
      expect(await harness.paymentTableBills()).toEqual([])
      await expect(page.locator('[data-sent-order]')).toHaveCount(0)

      // Pay again: the card form, then the guest "pays" in the simulator and comes back.
      await page.locator('[data-send]').click()
      await expect(page.locator('[data-slot="pay.form.submit"]')).toBeVisible(SETTLED)
      // The payment's id is the harness's to name: read it with the handle the page keeps.
      const handle = await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i += 1) {
          const value = localStorage.getItem(localStorage.key(i) ?? '') ?? ''
          const found = /^([A-Za-z0-9_-]{22})\|/.exec(value)
          if (found) return found[1] ?? null
        }
        return null
      })
      expect(handle).not.toBeNull()
      const read = await request.get('/api/guest/payment', {
        headers: {
          Authorization: `Table ${code}`,
          'X-Restro-Phone': randomBytes(16).toString('base64url'),
          'X-Restro-Payment': String(handle),
        },
      })
      expect(read.status()).toBe(200)
      const paymentId = ((await read.json()) as { id: string }).id
      await harness.pay(paymentId)
      await page.locator('[data-slot="pay.form.submit"]').click()

      // Only the host's captured makes "Paid"; then the number, and the round shows as Added.
      await expect(page.locator('[data-pay-screen="paid"]')).toBeVisible({ timeout: 120_000 })
      await expect(page.locator('[data-slot="pay.number"]')).toHaveText(/^[A-Z0-9]{5}$/)
      await page.locator('[data-slot="pay.back"]').click()
      await expect(page.locator('[data-pay-screen]')).toHaveCount(0)
      await expect(page.locator('[data-sent-state="added"]')).toBeVisible(SETTLED)
      const bills = await harness.paymentTableBills()
      expect(bills).toHaveLength(1)
      expect(bills[0]?.state).toBe('closed')
    })
  })
}
