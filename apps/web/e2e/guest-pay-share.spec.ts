// Splitting the amount: a table's guests settle one bill together (#544, D160 §2 and §3), on a
// production build, against the simulated POS and the simulated card provider. The other half is
// the pay harness on the worker's side (apps/worker/src/e2e/pay-harness.ts, `PAY_HARNESS_MODE=
// share`): Demo Bar on a POS that takes several card payments on one close, table 1 open with a
// waiter's order, read onto the bill.
//
// Two phones at the same table share it: the first starts the share and takes half, the second
// takes "The rest". A third phone, the one that opened the table's QR or the link the first phone
// showed, sees the same share with no part of its own — that is what the QR and the link carry.
// Each part is a card hold: nothing reads as paid until the close has happened at the POS, and only
// then is every hold captured. One bill is closed on a payment table, with every line on it.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { type APIRequestContext, expect, test } from '@playwright/test'

/** Cloudflare's dummy token, which its test secret passes (playwright.config.ts). */
const HUMAN_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const SETTLED = { timeout: 90_000, intervals: [500, 1_000] }

let harness: ChildProcessWithoutNullStreams
let code = ''
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
    env: { ...process.env, LOG_LEVEL: 'warn', PAY_HARNESS_MODE: 'share' },
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

type Line = { id: string; quantity: string; amountMinor: number }
type State = {
  bill: { parts: { lines: Line[] }[] } | null
  ordering: { sharing: boolean; minCardMinor: number } | null
}
type Share = {
  id: string
  state: string
  sharedMinor: number
  heldMinor: number
  claimedMinor: number
  leftMinor: number
  minimumMinor: number
  holds: number
  endsAt: string | null
  lines: { quantity: string; amountMinor: number }[]
  mine: { state: string; amountMinor: number; form: { provider: string } | null } | null
} | null

/** One phone at the table: its own phone value, and the handle of its own part, once it has one. */
function phone(request: APIRequestContext) {
  const value = randomBytes(16).toString('base64url')
  let handle: string | null = null
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Table ${code}`,
    'X-Restro-Phone': value,
    ...extra,
  })
  const held = (): Record<string, string> => (handle === null ? {} : { 'X-Restro-Payment': handle })
  return {
    async state(): Promise<State> {
      const response = await request.get('/api/guest/state?view=bill', { headers: headers() })
      expect(response.status()).toBe(200)
      return (await response.json()) as State
    },
    async share(): Promise<Share> {
      const response = await request.get('/api/guest/share', { headers: headers(held()) })
      expect(response.status()).toBe(200)
      return (await response.json()) as Share
    },
    async act(command: Record<string, unknown>, check?: Record<string, unknown>) {
      const response = await request.post('/api/guest/actions', {
        headers: headers(held()),
        data: { command, ageMs: 50, view: 'bill', ...(check === undefined ? {} : { check }) },
      })
      expect(response.status()).toBe(200)
      const answer = (await response.json()) as {
        result: { status: string; code: string | null; subjectId: string | null }
        handle: string | null
      }
      if (answer.handle !== null) handle = answer.handle
      return answer
    },
  }
}

test('split the amount: two parts cover one bill, and a third phone sees the same share', async ({
  request,
}) => {
  test.setTimeout(180_000)
  const first = phone(request)
  const second = phone(request)
  const third = phone(request)

  // The bill is read, and this POS lets the table settle together (D160 2.8).
  await expect
    .poll(async () => (await first.state()).bill?.parts.flatMap((part) => part.lines).length ?? 0, {
      ...SETTLED,
    })
    .toBeGreaterThanOrEqual(3)
  const state = await first.state()
  expect(state.ordering?.sharing).toBe(true)
  const lines = state.bill?.parts.flatMap((part) => part.lines) ?? []
  const total = lines.reduce((sum, line) => sum + line.amountMinor, 0)

  // The first phone shares the whole bill, as the face's "Split the amount" does.
  const started = await first.act(
    {
      kind: 'share.start',
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
    },
    { humanToken: HUMAN_TOKEN },
  )
  expect(started.result).toMatchObject({ status: 'accepted', code: null })
  const paymentId = started.result.subjectId as string
  // The share is the table's: its handle is never given to a phone (rule 3, D160 2.1).
  expect(started.handle).toBeNull()

  // The share is priced, and every phone of the table sees it — a third phone that only opened the
  // table's QR or the link the first one showed, with no part of its own, sees the same share.
  await expect.poll(async () => (await third.share())?.sharedMinor, SETTLED).toBe(total)
  const seen = await third.share()
  expect(seen).toMatchObject({ id: paymentId, state: 'awaiting_guest', holds: 0, mine: null })
  expect(seen?.leftMinor).toBe(total)
  expect(seen?.lines).toHaveLength(lines.length)
  const minimum = seen?.minimumMinor ?? 0
  expect(minimum).toBeGreaterThan(0)

  // The first phone takes half. Both halves must clear the smallest card payment (D160 2.6).
  const partMinor = Math.floor(total / 2)
  expect(partMinor).toBeGreaterThanOrEqual(minimum)
  expect(total - partMinor).toBeGreaterThanOrEqual(minimum)
  const mine = await first.act(
    {
      kind: 'share.hold',
      actionId: randomUUID(),
      paymentId,
      part: { kind: 'amount', minor: partMinor },
      tipMinor: null,
      tipPercent: null,
    },
    { humanToken: HUMAN_TOKEN },
  )
  expect(mine.result).toMatchObject({ status: 'accepted', code: null })
  // Only a part's own handle reaches a phone: it is how this phone's hold is named.
  expect(mine.handle).not.toBeNull()

  // The card form, then the card: the part is held, and nothing is paid yet.
  await expect.poll(async () => (await first.share())?.mine?.state, SETTLED).toBe('awaiting_guest')
  expect((await first.share())?.mine?.form?.provider).toBeTruthy()
  harness.stdin.write(`holds ${paymentId}\n`)
  await harnessSaid('pay_harness_holds_paid', paymentId)
  expect((await first.act({ kind: 'share.returned', actionId: randomUUID() })).result.status).toBe(
    'accepted',
  )
  await expect.poll(async () => (await first.share())?.mine?.state, SETTLED).toBe('held')
  const half = await first.share()
  expect(half?.heldMinor).toBe(partMinor)
  expect(half?.leftMinor).toBe(total - partMinor)
  expect(half?.holds).toBe(1)
  // Half the amount is held and the bill is still open: no phone reads as paid (D72).
  expect(half?.state).toBe('awaiting_guest')
  expect(half?.endsAt).not.toBeNull()
  expect((await second.share())?.mine).toBeNull()

  // The second phone takes "The rest", and pays it.
  const rest = await second.act(
    {
      kind: 'share.hold',
      actionId: randomUUID(),
      paymentId,
      part: { kind: 'rest' },
      tipMinor: null,
      tipPercent: null,
    },
    { humanToken: HUMAN_TOKEN },
  )
  expect(rest.result).toMatchObject({ status: 'accepted', code: null })
  await expect.poll(async () => (await second.share())?.mine?.state, SETTLED).toBe('awaiting_guest')
  expect((await second.share())?.mine?.amountMinor).toBe(total - partMinor)
  const before = events.length
  harness.stdin.write(`holds ${paymentId}\n`)
  await expect
    .poll(
      () => events.slice(before).find((line) => line.event === 'pay_harness_holds_paid') ?? null,
    )
    .not.toBeNull()
  expect((await second.act({ kind: 'share.returned', actionId: randomUUID() })).result.status).toBe(
    'accepted',
  )

  // Covered: the bill is closed once, and only then is every part captured.
  await expect.poll(async () => (await third.share())?.state, SETTLED).toBe('captured')
  const closed = await third.share()
  // Both parts were captured, so both count as held and none is still gathering.
  expect(closed?.heldMinor).toBe(total)
  expect(closed?.holds).toBe(0)
  expect((await first.share())?.mine?.state).toBe('captured')
  expect((await second.share())?.mine?.state).toBe('captured')

  // One bill on the payment tables, closed, with the table's lines on it.
  const asked = events.length
  harness.stdin.write('bills\n')
  await expect
    .poll(() => events.slice(asked).find((line) => line.event === 'pay_harness_bills') ?? null)
    .not.toBeNull()
  const said = events.slice(asked).find((line) => line.event === 'pay_harness_bills') as {
    bills: { state: string; rows: { article: string }[] }[]
  }
  expect(said.bills).toHaveLength(1)
  expect(said.bills[0]?.state).toBe('closed')
  expect(said.bills[0]?.rows.map((row) => row.article).sort()).toEqual(['2001', '2002', '2002'])
})
