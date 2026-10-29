// The other half of the refunds and disputes end-to-end test (#222; apps/web/e2e/tonight-refunds.spec.ts).
// The web app may not import a payment provider, so this process, on the worker's side, plays the
// venue's Dashboard and the guest's bank for one run, and the worker's own notice job reads the
// payment back:
//
//   1. it takes the Tonight fixture's venue (`seed-tonight-e2e.ts night refunds`, which leaves
//      four captured card payments whose provider ids are still to be made), connects it to a
//      simulated provider account (`@restro/sim-pay`) and makes each payment real in the engine:
//      a hold for the payment, the guest paying, the capture;
//   2. it prints one JSON line `refunds_harness_ready`, then reads commands on stdin:
//        `refund <table> <minor>`       the venue refunds in its Dashboard (sim-pay's function);
//        `refund-fails <table> <minor>` that refund does not go through;
//        `dispute <table>`              the guest's bank opens a dispute;
//        `close <table> won|lost`       the dispute closes.
//      Each one stores the provider's notice as the web route does (`recordProviderNotice`) and
//      runs the worker's `provider-notices` step, which reads the payment back from the engine and
//      records it through `payment.observe`; the answer is a `refunds_harness_done` line. Closing
//      stdin stops everything.
//
// It refuses a database that is not on this machine. Its own log goes to stderr, so stdout carries
// only the JSON lines.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

import { type ProviderRef, providerRef } from '@restro/core'
import { recordProviderNotice } from '@restro/core/service/notices'
import { createPool } from '@restro/db'
import {
  createSimPayProvider,
  SIM_PAY_KIND,
  SimPayEngine,
  type SimPayEvent,
  simPayNotice,
} from '@restro/sim-pay'
import pg from 'pg'

import { handleProviderNotices } from '../jobs/provider-notices'
import { createLogger } from '../logger'

const SEED = ['restro', 'system', 'e2e-refunds-harness'] as const

function assertLocal(url: string, name: string): void {
  const { hostname } = new URL(url)
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(
      `${name} is not on this machine: the refunds harness runs against a local database`,
    )
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`the refunds harness needs ${name}`)
  return value
}

const print = (line: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify(line)}\n`)
}

async function main(): Promise<void> {
  const appUrl = required('DATABASE_URL')
  const ownerUrl = required('DATABASE_URL_OWNER')
  assertLocal(appUrl, 'DATABASE_URL')
  assertLocal(ownerUrl, 'DATABASE_URL_OWNER')
  const log = await createLogger({
    level: 'warn',
    pretty: false,
    destination: { write: (line: string) => process.stderr.write(line) },
  })
  const pool = createPool(appUrl, { applicationName: 'restro-e2e-refunds-harness', max: 4 })
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  const query = async <Row extends object>(sql: string, values: unknown[] = []) =>
    (await owner.query(sql, values)).rows as Row[]

  // A run of its own: the refs of an earlier run on the same database stay unique. The provider
  // sends refund notices (the fallback of a daily list is not under test here).
  const engine = new SimPayEngine({
    clock: { now: () => new Date() },
    run: randomUUID().replaceAll('-', ''),
    switches: { refundNotices: true },
  })
  const provider = createSimPayProvider({ env: 'test', engine })

  const [venue] = await query<{ tenant_id: string; id: string }>(
    `select tenant_id, id from restro.venues where slug = 'tonight-club'`,
  )
  if (venue === undefined)
    throw new Error('run seed-tonight-e2e.ts first: there is no Tonight Club')
  const account = engine.addAccount()
  engine.finishConnecting(account)
  await query('delete from restro.payment_accounts where venue_id = $1', [venue.id])
  await query(
    `insert into restro.payment_accounts
       (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
     values ($1, $2, $3, $4, 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), $5, $6, $7)`,
    [venue.tenant_id, venue.id, SIM_PAY_KIND, account.provider, ...SEED],
  )

  // Each captured payment of the fixture is made real in the engine, then given its provider id.
  const byTable = new Map<string, { id: string; ref: ProviderRef }>()
  const pending = await query<{
    id: `py_${string}`
    number: string
    amount_minor: string
    captured_minor: string
  }>(
    `select p.id, t.number, p.amount_minor, p.captured_minor
       from restro.payments p join restro.tables t on t.id = p.table_id
      where p.venue_id = $1 and p.provider_kind = $2 and p.provider_payment_ref like 'pending\\_%'
      order by t.number`,
    [venue.id, SIM_PAY_KIND],
  )
  for (const row of pending) {
    const held = engine.createHold({
      paymentId: row.id,
      accountRef: account,
      amountMinor: Number(row.amount_minor),
      currency: 'EUR',
      idempotencyKey: `${row.id}-hold`,
      description: 'e2e payment',
    })
    if (held.kind !== 'done') throw new Error(`the hold of ${row.id} was not made: ${held.kind}`)
    const ref = held.result.paymentRef
    engine.guest.pay(ref)
    const captured = engine.capture({
      accountRef: account,
      paymentRef: ref,
      amountMinor: Number(row.captured_minor),
      idempotencyKey: `${row.id}-capture`,
    })
    if (captured.kind !== 'done') throw new Error(`${row.id} was not captured: ${captured.kind}`)
    await query('update restro.payments set provider_payment_ref = $2 where id = $1', [
      row.id,
      ref.provider,
    ])
    byTable.set(row.number, { id: row.id, ref })
  }

  /** The provider's notice, stored as the route does, then the worker's step reads it back. */
  async function deliver(event: SimPayEvent): Promise<Record<string, number>> {
    const stored = await recordProviderNotice(pool, {
      providerKind: SIM_PAY_KIND,
      live: false,
      notice: simPayNotice(event),
      jobId: `e2e-refunds-harness-${randomUUID()}`,
    })
    if (stored !== 'recorded') throw new Error(`the notice ${event.id} was stored before`)
    const counts = await handleProviderNotices(
      { pool, log, now: () => new Date(), jobId: 'e2e-refunds-harness' },
      { providers: new Map([[SIM_PAY_KIND, provider]]) },
    )
    return { ...counts }
  }

  const disputes = new Map<string, ProviderRef>()
  const payment = (table: string | undefined) => {
    const found = table === undefined ? undefined : byTable.get(table)
    if (found === undefined) throw new Error(`no captured payment at table ${table}`)
    return found
  }

  async function command(line: string): Promise<Record<string, number>> {
    const [name, table, argument] = line.trim().split(/\s+/)
    const target = payment(table)
    switch (name) {
      case 'refund':
        return deliver(engine.venue.refundsInDashboard(account, target.ref, Number(argument)))
      case 'refund-fails':
        return deliver(engine.venue.refundFails(account, target.ref, Number(argument)))
      case 'dispute': {
        const event = engine.bank.opensDispute(account, target.ref)
        disputes.set(table as string, providerRef(event.object))
        return deliver(event)
      }
      case 'close': {
        const dispute = disputes.get(table as string)
        if (dispute === undefined || (argument !== 'won' && argument !== 'lost')) {
          throw new Error(`close <table> won|lost needs an open dispute at table ${table}`)
        }
        return deliver(engine.bank.closesDispute(account, dispute, argument))
      }
      default:
        throw new Error(`unknown command "${line}"`)
    }
  }

  print({ event: 'refunds_harness_ready', tables: [...byTable.keys()] })
  const lines = createInterface({ input: process.stdin })
  // One command at a time, in order, whatever the speed of the lines.
  let queue: Promise<void> = Promise.resolve()
  lines.on('line', (line) => {
    if (line.trim() === '') return
    queue = queue.then(async () => {
      try {
        print({ event: 'refunds_harness_done', command: line.trim(), counts: await command(line) })
      } catch (error) {
        print({
          event: 'refunds_harness_failed',
          command: line.trim(),
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })
  })
  await new Promise<void>((resolve) => lines.once('close', resolve))
  await queue
  await pool.end()
  await owner.end()
}

main().catch((error) => {
  print({
    event: 'refunds_harness_failed',
    message: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
