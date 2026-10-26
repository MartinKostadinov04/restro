// Paying for lines of the bill (#110), on a production build, against the simulated POS and the
// simulated card provider. No template draws paying yet, so the phones are the guest API's own
// callers, each with its own phone value, as the page will be. The other half of the test is the
// pay harness on the worker's side (apps/worker/src/e2e/pay-harness.ts): the web app may not import
// a payment provider, so it seeds a venue on the simulated POS with a waiter's round on table 1,
// runs the payment jobs and plays the guest at the card form.
//
// One phone pays for a line: it is greyed for a friend's phone (`beingPaid`), the payer's phone
// reads its payment by the handle in `X-Restro-Payment` until the card form, the guest pays at the
// form, and after `pay.returned` the payment is `held`. Another phone starts a Pay of another line
// and cancels it: the line ungreys. Neither the handle, the provider's references nor the form's
// values show in any table state, and the handle is in no address.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { type APIRequestContext, expect, test } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
/** The harness's worker health port: beside the e2e worker's (PORT + 2). */
const HARNESS_PORT = PORT + 3
/** Cloudflare's dummy token, which its test secret passes (playwright.config.ts). */
const HUMAN_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const SETTLED = { timeout: 60_000, intervals: [500, 1_000] }

let harness: ChildProcessWithoutNullStreams
let code: string
const events: Record<string, unknown>[] = []

/** Waits for the harness's JSON line with `event` (and `paymentId`, when given). */
async function harnessSaid(event: string, paymentId?: string, timeout = 120_000) {
  await expect
    .poll(
      () =>
        events.find(
          (line) =>
            line.event === 'pay_harness_failed' ||
            (line.event === event && (paymentId === undefined || line.paymentId === paymentId)),
        ) ?? null,
      { timeout },
    )
    .not.toBeNull()
  const failed = events.find((line) => line.event === 'pay_harness_failed')
  if (failed) throw new Error(`the pay harness failed: ${JSON.stringify(failed)}`)
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  const workerDir = fileURLToPath(new URL('../../worker/', import.meta.url))
  harness = spawn(process.execPath, ['--import', 'tsx', 'src/e2e/pay-harness.ts'], {
    cwd: workerDir,
    env: { ...process.env, PAY_HARNESS_PORT: String(HARNESS_PORT), LOG_LEVEL: 'warn' },
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
  await harnessSaid('pay_harness_ready')
  code = String(events.find((line) => line.event === 'pay_harness_ready')?.code)
})

test.afterAll(async () => {
  if (harness === undefined || harness.exitCode !== null) return
  const exited = new Promise((resolve) => harness.once('exit', resolve))
  harness.stdin.end()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30_000))])
  if (harness.exitCode === null) harness.kill()
})

type Line = { id: string; quantity: string; amountMinor: number; beingPaid: boolean }

/** One phone at the table: its own phone value, and the payment handle it was given. */
function phone(request: APIRequestContext) {
  const value = randomBytes(16).toString('base64url')
  let handle: string | null = null
  const seen: string[] = []
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Table ${code}`,
    'X-Restro-Phone': value,
    ...extra,
  })
  const paymentHeader = (): Record<string, string> =>
    handle === null ? {} : { 'X-Restro-Payment': handle }

  return {
    /** Every table state this phone was answered, as text. */
    seen,
    get handle() {
      return handle
    },
    async lines(): Promise<Line[]> {
      const response = await request.get('/api/guest/state?view=bill', { headers: headers() })
      expect(response.status()).toBe(200)
      const text = await response.text()
      seen.push(text)
      const state = JSON.parse(text) as { bill: { parts: { lines: Line[] }[] } | null }
      return state.bill?.parts.flatMap((part) => part.lines) ?? []
    },
    async act(command: Record<string, unknown>, check?: Record<string, unknown>) {
      const response = await request.post('/api/guest/actions', {
        headers: headers(paymentHeader()),
        data: { command, ageMs: 50, ...(check === undefined ? {} : { check }) },
      })
      expect(response.status()).toBe(200)
      const text = await response.text()
      seen.push(text)
      const answer = JSON.parse(text) as {
        result: { status: string; code: string | null; subjectId: string | null }
        handle: string | null
      }
      if (answer.handle !== null) handle = answer.handle
      return answer
    },
    async payment() {
      const response = await request.get('/api/guest/payment', {
        headers: headers(paymentHeader()),
      })
      expect(response.status()).toBe(200)
      return (await response.json()) as {
        id: string
        state: string
        amountMinor: number | null
        form: { provider: string; values: Record<string, string> } | null
      }
    },
  }
}

/** A Pay of the given lines, exactly as the phone saw them, with no tip. */
const payStart = (lines: readonly Line[]) => ({
  kind: 'pay.start',
  actionId: randomUUID(),
  pick: {
    kind: 'lines',
    lines: lines.map((line) => ({ lineId: line.id, quantity: line.quantity })),
  },
  seen: lines.map((line) => ({
    lineId: line.id,
    quantity: line.quantity,
    amountMinor: line.amountMinor,
  })),
  tipMinor: null,
  tipPercent: null,
})

test('a guest pays for a line: a friend sees it greyed, the card form holds it', async ({
  request,
}) => {
  test.setTimeout(150_000)
  const payer = phone(request)
  const friend = phone(request)

  const lines = await payer.lines()
  expect(lines.length).toBeGreaterThanOrEqual(2)
  const [line] = lines as [Line]
  expect(line.beingPaid).toBe(false)

  const started = await payer.act(payStart([line]), { humanToken: HUMAN_TOKEN })
  expect(started.result).toMatchObject({ status: 'accepted', code: null })
  expect(payer.handle).toMatch(/^[A-Za-z0-9_-]{22}$/)
  const paymentId = started.result.subjectId as string
  expect(paymentId).toMatch(/^py_/)

  // The friend's phone sees the line greyed, and only that line.
  const greyed = await friend.lines()
  expect(greyed.find((l) => l.id === line.id)?.beingPaid).toBe(true)
  expect(greyed.filter((l) => l.id !== line.id).every((l) => !l.beingPaid)).toBe(true)

  // The payer's phone reads its payment until the card form: the POS's amount, the form's values.
  await expect.poll(async () => (await payer.payment()).state, SETTLED).toBe('awaiting_guest')
  const atForm = await payer.payment()
  expect(atForm.amountMinor).toBe(line.amountMinor)
  expect(atForm.form?.provider).toBe('sim-pay')
  const formValues = Object.values(atForm.form?.values ?? {})
  expect(formValues.length).toBeGreaterThan(0)

  // The guest pays at the form and comes back: the payment is held, the line still greyed.
  harness.stdin.write(`pay ${paymentId}\n`)
  await harnessSaid('pay_harness_paid', paymentId)
  const returned = await payer.act({ kind: 'pay.returned', actionId: randomUUID() })
  expect(returned.result.status).toBe('accepted')
  await expect.poll(async () => (await payer.payment()).state, SETTLED).toBe('held')
  expect((await payer.payment()).form).toBeNull()
  expect((await friend.lines()).find((l) => l.id === line.id)?.beingPaid).toBe(true)

  // No table state carries the handle or the form's values, to either phone.
  for (const text of [...friend.seen, ...payer.seen.filter((t) => !t.includes('"handle":"'))]) {
    expect(text).not.toContain(payer.handle as string)
    for (const value of formValues) expect(text).not.toContain(value)
  }
})

test('a guest cancels a Pay, and the line ungreys', async ({ request }) => {
  test.setTimeout(150_000)
  const payer = phone(request)
  const friend = phone(request)

  const free = (await payer.lines()).filter((l) => !l.beingPaid)
  expect(free.length).toBeGreaterThan(0)
  const [line] = free as [Line]
  const started = await payer.act(payStart([line]), { humanToken: HUMAN_TOKEN })
  expect(started.result.status).toBe('accepted')
  expect((await friend.lines()).find((l) => l.id === line.id)?.beingPaid).toBe(true)

  const cancelled = await payer.act({ kind: 'pay.cancel', actionId: randomUUID() })
  expect(cancelled.result.status).toBe('accepted')
  await expect
    .poll(async () => (await friend.lines()).find((l) => l.id === line.id)?.beingPaid, SETTLED)
    .toBe(false)
  await expect.poll(async () => (await payer.payment()).state, SETTLED).toBe('released')
})
