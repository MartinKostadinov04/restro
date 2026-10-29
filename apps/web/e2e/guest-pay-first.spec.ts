// Pay-first items (#113), on a production build, against the simulated POS and the simulated card
// provider. No template draws paying yet, so the phone is the guest API's own caller, as the page
// will be. The other half is the pay harness on the worker's side in its pay-first mode
// (apps/worker/src/e2e/pay-harness.ts, `PAY_HARNESS_MODE=pay-first`): a venue on a POS whose first
// items open a bill that names itself, a published menu of one item paid first, the payment jobs,
// and the guest at the card form.
//
// A guest adds two of the pay-first item and taps Send: the Send's pay-first part is a payment,
// read by the handle in `X-Restro-Payment` until the card form. The guest pays at the form and
// comes back: the hold is taken, the round is entered on a free payment table (its first line
// naming the guest's table), checked against the hold, closed and captured. The table's state
// shows the line as paid first while it waits, and nothing of the payment's handle.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

/** Cloudflare's dummy token, which its test secret passes (playwright.config.ts). */
const HUMAN_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const SETTLED = { timeout: 60_000, intervals: [500, 1_000] }
/** The item's POS article and price (the simulator's Aperol Spritz). */
const ARTICLE = '2002'
const PRICE_MINOR = 1_100

let harness: ChildProcessWithoutNullStreams
let code: string
let itemId: string
const events: Record<string, unknown>[] = []

/** Waits for the harness's JSON line with `event` (and `paymentId`, when given); the last one. */
async function harnessSaid(event: string, paymentId?: string, after = 0, timeout = 120_000) {
  const find = () =>
    events
      .slice(after)
      .find(
        (line) =>
          line.event === 'pay_harness_failed' ||
          (line.event === event && (paymentId === undefined || line.paymentId === paymentId)),
      ) ?? null
  await expect.poll(find, { timeout }).not.toBeNull()
  const failed = events.find((line) => line.event === 'pay_harness_failed')
  if (failed) throw new Error(`the pay harness failed: ${JSON.stringify(failed)}`)
  return find() as Record<string, unknown>
}

type Bill = { state: string; rows: { article: string; note: string | null }[] }

/** The bills on the POS's payment tables, as the harness reads them from the simulator. */
async function paymentTableBills(): Promise<Bill[]> {
  const after = events.length
  harness.stdin.write('bills\n')
  return (await harnessSaid('pay_harness_bills', undefined, after)).bills as Bill[]
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const workerDir = fileURLToPath(new URL('../../worker/', import.meta.url))
  harness = spawn(process.execPath, ['--import', 'tsx', 'src/e2e/pay-harness.ts'], {
    cwd: workerDir,
    env: { ...process.env, LOG_LEVEL: 'warn', PAY_HARNESS_MODE: 'pay-first' },
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
  let stderr = ''
  harness.stderr.setEncoding('utf8')
  harness.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4_000)
  })
  harness.on('exit', (exitCode) => {
    if (exitCode !== 0) events.push({ event: 'pay_harness_failed', exitCode, stderr })
  })
  const ready = await harnessSaid('pay_harness_ready')
  code = String(ready.code)
  itemId = String(ready.itemId)
})

test.afterAll(async () => {
  if (harness === undefined || harness.exitCode !== null) return
  const exited = new Promise((resolve) => harness.once('exit', resolve))
  harness.stdin.end()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30_000))])
  if (harness.exitCode === null) harness.kill()
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
  expect(await paymentTableBills()).toEqual([])

  // The guest pays and comes back: entered on a payment table, checked, closed, captured.
  harness.stdin.write(`pay ${atForm.id}\n`)
  await harnessSaid('pay_harness_paid', atForm.id)
  const returned = await act({ kind: 'pay.returned', actionId: randomUUID() })
  expect(returned.result.status).toBe('accepted')
  await expect.poll(async () => (await payment()).state, SETTLED).toBe('captured')
  const paid = await payment()
  expect(paid.amountMinor).toBe(2 * PRICE_MINOR)
  expect(paid.form).toBeNull()

  // The round is on one payment table, as one bill of its own, closed; its line names table 1.
  const bills = await paymentTableBills()
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
