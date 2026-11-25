// Paying a linked group's whole bill (#542, D160 §2), on a production build, against the simulated
// POS and the simulated card provider. The other half is the pay harness on the worker's side
// (apps/worker/src/e2e/pay-harness.ts, `PAY_HARNESS_MODE=group`): a party booked on tables 1 and 2
// and marked present, so the two are one linked group, with a waiter's order on each.
//
// A phone at table 1 sees both tables' bills and that one payment may cover them (`paysAcross`).
// It pays "The whole bill": a phone at table 2 sees its own line as being paid. The guest pays at
// the card form, the route moves each table's lines onto one payment table and closes that one
// bill, and the payment is captured for the whole group's amount.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { type APIRequestContext, expect, test } from '@playwright/test'

/** Cloudflare's dummy token, which its test secret passes (playwright.config.ts). */
const HUMAN_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const SETTLED = { timeout: 90_000, intervals: [500, 1_000] }

let harness: ChildProcessWithoutNullStreams
const codes: { one: string; two: string } = { one: '', two: '' }
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
    env: { ...process.env, LOG_LEVEL: 'warn', PAY_HARNESS_MODE: 'group' },
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
  const ready = events.find((line) => line.event === 'pay_harness_ready')
  codes.one = String(ready?.code)
  codes.two = String(ready?.code2)
})

test.afterAll(async () => {
  if (harness === undefined || harness.exitCode !== null) return
  const exited = new Promise((resolve) => harness.once('exit', resolve))
  harness.stdin.end()
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 30_000))])
  if (harness.exitCode === null) harness.kill()
})

type Line = { id: string; quantity: string; amountMinor: number; beingPaid: boolean }
type GroupTable = { label: string; own: boolean; complete: boolean; parts: { lines: Line[] }[] }
type State = {
  bill: { parts: { lines: Line[] }[] } | null
  group: { paysAcross: boolean; owedMinor: number; tables: GroupTable[] } | null
}

/** One phone at a table: its own phone value, and the payment handle it was given. */
function phone(request: APIRequestContext, code: () => string) {
  const value = randomBytes(16).toString('base64url')
  let handle: string | null = null
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Table ${code()}`,
    'X-Restro-Phone': value,
    ...extra,
  })
  const paymentHeader = (): Record<string, string> =>
    handle === null ? {} : { 'X-Restro-Payment': handle }
  return {
    async state(): Promise<State> {
      const response = await request.get('/api/guest/state?view=bill', { headers: headers() })
      expect(response.status()).toBe(200)
      return (await response.json()) as State
    },
    async act(command: Record<string, unknown>, check?: Record<string, unknown>) {
      const response = await request.post('/api/guest/actions', {
        headers: headers(paymentHeader()),
        data: { command, ageMs: 50, ...(check === undefined ? {} : { check }) },
      })
      expect(response.status()).toBe(200)
      const answer = (await response.json()) as {
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
      return (await response.json()) as { id: string; state: string; amountMinor: number | null }
    },
  }
}

const linesOf = (table: GroupTable) => table.parts.flatMap((part) => part.lines)

test("pay a group's whole bill: one payment over both tables, one bill closed", async ({
  request,
}) => {
  test.setTimeout(180_000)
  const payer = phone(request, () => codes.one)
  const friend = phone(request, () => codes.two)

  // Both tables' bills, read, and one payment may cover them.
  await expect
    .poll(async () => (await payer.state()).group?.tables.every((t) => t.complete), SETTLED)
    .toBe(true)
  const group = (await payer.state()).group
  expect(group?.paysAcross).toBe(true)
  expect(group?.tables).toHaveLength(2)
  const every = (group?.tables ?? []).flatMap(linesOf)
  expect(every.length).toBeGreaterThanOrEqual(3)
  const total = every.reduce((sum, line) => sum + line.amountMinor, 0)
  expect(group?.owedMinor).toBe(total)

  // "The whole bill" from table 1: every line of both tables, as the phone saw them.
  const started = await payer.act(
    {
      kind: 'pay.start',
      actionId: randomUUID(),
      pick: {
        kind: 'lines',
        lines: every.map((line) => ({ lineId: line.id, quantity: line.quantity })),
      },
      seen: every.map((line) => ({
        lineId: line.id,
        quantity: line.quantity,
        amountMinor: line.amountMinor,
      })),
      tipMinor: null,
      tipPercent: null,
    },
    { humanToken: HUMAN_TOKEN },
  )
  expect(started.result).toMatchObject({ status: 'accepted', code: null })
  const paymentId = started.result.subjectId as string

  // Table 2's phone sees its own line as being paid.
  const atTwo = (await friend.state()).bill?.parts.flatMap((part) => part.lines) ?? []
  expect(atTwo.length).toBeGreaterThan(0)
  expect(atTwo.every((line) => line.beingPaid)).toBe(true)

  // The card form, the guest pays, and the route closes the one bill and captures the hold.
  await expect.poll(async () => (await payer.payment()).state, SETTLED).toBe('awaiting_guest')
  expect((await payer.payment()).amountMinor).toBe(total)
  harness.stdin.write(`pay ${paymentId}\n`)
  await harnessSaid('pay_harness_paid', paymentId)
  const returned = await payer.act({ kind: 'pay.returned', actionId: randomUUID() })
  expect(returned.result.status).toBe('accepted')
  await expect.poll(async () => (await payer.payment()).state, SETTLED).toBe('captured')
  expect((await payer.payment()).amountMinor).toBe(total)

  // One bill on the payment tables, closed, with both tables' lines on it.
  const before = events.length
  harness.stdin.write('bills\n')
  await expect
    .poll(() => events.slice(before).find((line) => line.event === 'pay_harness_bills') ?? null)
    .not.toBeNull()
  const said = events.slice(before).find((line) => line.event === 'pay_harness_bills') as {
    bills: { state: string; rows: { article: string }[] }[]
  }
  expect(said.bills).toHaveLength(1)
  expect(said.bills[0]?.state).toBe('closed')
  expect(said.bills[0]?.rows.map((row) => row.article).sort()).toEqual(['2001', '2001', '2002'])
})
