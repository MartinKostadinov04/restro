// The other half of the paying end-to-end test (#110; apps/web/e2e/guest-pay.spec.ts). The web
// app may not import a payment provider, and the e2e worker beside it syncs no POS, so this
// process, on the worker's side, plays the venue's till and the card provider for one run:
//
//   1. a fresh organisation with a venue on the simulated POS (`demo-bar`, over HTTP), its floor
//      read, table 1 with an open sitting and a code the test gets, the location check off (paying
//      is never located) and a connected account on the simulated provider (`@restro/sim-pay`);
//   2. a waiter's round on the POS (one 2001, two 2002), read onto the table's bill;
//   3. a worker on the same queue with only the table reading and the payment jobs, so a guest's
//      Pay is priced and held, and the bill is read again when a phone asks;
//   4. it prints one JSON line `pay_harness_ready` with the table's code, then reads commands on
//      stdin: `pay <paymentId>` is the guest finishing the card form (`guest.pay`), answered by a
//      `pay_harness_paid` line; `bills` prints the payment tables' bills on the POS
//      (`pay_harness_bills`). Closing stdin stops everything.
//
// With `PAY_HARNESS_MODE=pay-first` (apps/web/e2e/guest-pay-first.spec.ts, #113) the POS runs the
// `pay-first` scenario (its first items open a bill that names itself), table 1 has no round, and
// step 2 publishes a menu of one item, the POS's Aperol Spritz, paid first: its id is in the ready
// line.
//
// It refuses a database that is not on this machine, and the simulated provider refuses
// production. Its own log goes to stderr, so stdout carries only the JSON lines.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

import {
  DEFAULT_ORDERING_SETTINGS,
  hashTableCode,
  type IntegrationId,
  newId,
  newTableToken,
  providerRef,
  type VenueId,
} from '@restro/core'
import {
  appendSourceRecords,
  apply,
  createIntegration,
  mapBarsyVenue,
  provisionMenu,
  provisionTenant,
  provisionVenue,
  publishMenu,
  setFloorSource,
  setGuestFeatures,
  setVenuePresentation,
  updateIntegration,
  upsertBarsyVenues,
} from '@restro/core/apply'
import { createPool } from '@restro/db'
import { createSimPayProvider, SIM_PAY_KIND, SimPayEngine } from '@restro/sim-pay'
import { createSimServer } from '@restro/sim-pos'
import pg from 'pg'

import { loadConfig } from '../config'
import { InstanceBudgets, readFloorOf } from '../jobs/floor'
import { createPaymentJobs } from '../jobs/payments'
import { createReadingJobs, ReadingBudgets, readTableOf } from '../jobs/readings'
import { createLogger } from '../logger'
import { startWorker } from '../worker'

/** Demo Bar's table 1 on the simulator. */
const POS_TABLE = '30001'
/** Demo Bar's two payment tables in the main hall, on the simulator. */
const PAYMENT_TABLES = ['39001', 'pay main 2']
/** The pay-first run (#113): its scenario, and the POS article its one item is (an Aperol Spritz). */
const PAY_FIRST = process.env.PAY_HARNESS_MODE === 'pay-first'
const SCENARIO = PAY_FIRST ? 'pay-first' : 'demo-bar'
const PAY_FIRST_ARTICLE = { id: '2002', name: 'Aperol Spritz', priceMinor: 1_100 }
/** This run's key for the bill's line ids (the e2e worker reads no bill). */
const BILL_ID_KEY = `e2e-pay-harness-${randomUUID()}`.padEnd(48, 'x')
const SEED = ['restro', 'system', 'e2e-pay-harness'] as const

/** Only a database on this machine: the harness writes as the owner. */
function assertLocal(url: string, name: string): void {
  const { hostname } = new URL(url)
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
    throw new Error(`${name} is not on this machine: the pay harness runs against a local database`)
  }
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`the pay harness needs ${name}`)
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
  const config = loadConfig({
    ...process.env,
    WORKER_ID: 'e2e-pay-harness',
    WORKER_POS_SYNC: 'off',
  })
  const log = await createLogger({
    level: 'warn',
    pretty: false,
    destination: { write: (line: string) => process.stderr.write(line) },
  })
  const env = { log, now: () => new Date() }

  const pool = createPool(appUrl, { applicationName: 'restro-e2e-pay-harness', max: 4 })
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  const query = async <Row extends object>(sql: string, values: unknown[] = []) =>
    (await owner.query(sql, values)).rows as Row[]
  const sim = createSimServer({ scenario: SCENARIO, print: () => {} })
  const host = `127.0.0.1:${await sim.listen(0)}`
  // A run of its own: the refs of an earlier run on the same database stay unique.
  const engine = new SimPayEngine({
    clock: { now: () => new Date() },
    run: randomUUID().replaceAll('-', ''),
  })
  const provider = createSimPayProvider({ env: config.sim.env, engine })

  // 1. The organisation, its venue on the POS, the floor, table 1 and the account.
  const tenantId = newId('tn')
  await provisionTenant(pool, { tenantId, name: 'Pay Club' })
  await query('insert into restro.auth_organization (id, name, slug) values ($1, $2, $3)', [
    tenantId,
    'Pay Club',
    `pay-club-${tenantId.slice(3, 13).toLowerCase()}`,
  ])
  const integrationId = (await createIntegration(pool, tenantId, { kind: 'sim', host }))
    .id as IntegrationId
  // The connector declares what the scenario's switches allow; the floor reading records it.
  if (PAY_FIRST) {
    await updateIntegration(pool, tenantId, integrationId, { config: { sim_scenario: SCENARIO } })
  }
  const venue = await provisionVenue(pool, tenantId, {
    name: 'Pay Bar',
    slug: `pay-bar-${tenantId.slice(3, 13).toLowerCase()}`,
  })
  const venueId = venue.id as VenueId
  await upsertBarsyVenues(pool, tenantId, integrationId, [{ bid: 1, name: 'Demo Bar' }])
  const mapped = await mapBarsyVenue(pool, tenantId, integrationId, 1, venueId)
  if (!mapped.ok) throw new Error('the venue could not be mapped to the simulated POS')
  await setFloorSource(pool, tenantId, {
    venueId,
    // PM1 and PM2 are the payment tables the route moves a payment's lines to (#111).
    source: { halls: null, bars: null, paymentTables: ['PM1', 'PM2'] },
  })
  const floor = await readFloorOf(
    { pool, ...env },
    { tenantId, integrationId, venueId },
    { sim: config.sim, budgets: new InstanceBudgets() },
  )
  if (floor.kind !== 'read') throw new Error(`the floor was not read: ${floor.kind}`)
  // Paying is on only with a payment table in every bar (D125 2.3): PM1 and PM2 are the first
  // bar's, PU1 is the second's.
  await query(
    `update restro.tables set is_payment_table = true where venue_id = $1 and number = 'PU1'`,
    [venueId],
  )
  const [table] = await query<{ id: `tb_${string}` }>(
    `select id from restro.tables where venue_id = $1 and number = '1'`,
    [venueId],
  )
  if (table === undefined) throw new Error('the simulated floor has no table 1')
  await query(
    `update restro.venues set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ordering}', $2::jsonb)
      where id = $1`,
    [venueId, JSON.stringify({ ...DEFAULT_ORDERING_SETTINGS, locationCheck: false })],
  )
  const account = engine.addAccount()
  engine.finishConnecting(account)
  await query(
    `insert into restro.payment_accounts
       (tenant_id, venue_id, provider_kind, account_ref, state, checks, connected_at, source, actor, job_id)
     values ($1, $2, $3, $4, 'connected', '{"cardPayments":true,"ticks":{"cardTypeInTill":{"at":"2026-10-27T00:00:00Z","by":"system"},"receiptEmailsOff":{"at":"2026-10-27T00:00:00Z","by":"system"}}}'::jsonb, now(), $5, $6, $7)`,
    [tenantId, venueId, SIM_PAY_KIND, account.provider, ...SEED],
  )

  // The table's code and its sitting, as the staff's "Open table" would leave them.
  const code = newTableToken()
  await query('update restro.tables set qr_token = $2, qr_code_hash = $3 where id = $1', [
    table.id,
    code,
    await hashTableCode(code),
  ])
  await query(
    `insert into restro.sittings
       (id, tenant_id, venue_id, table_id, service_date, opened_how, source, actor, job_id)
     values ($1, $2, $3, $4, $5, 'one', $6, $7, $8)`,
    [newId('st'), tenantId, venueId, table.id, new Date().toISOString().slice(0, 10), ...SEED],
  )

  // 2. The waiter's round, read onto the bill; for pay-first, the menu with its one item.
  let itemId: string | null = null
  if (PAY_FIRST) {
    itemId = await publishPayFirstMenu(pool, { tenantId, venueId, integrationId })
  } else {
    sim.host.engine.waiter.addRound(POS_TABLE, [
      { article: '2001' },
      { article: '2002', quantity: '2' },
    ])
    const reading = await readTableOf(
      { pool, ...env },
      { tenantId, venueId, tableId: table.id },
      {
        sim: config.sim,
        billIdKey: BILL_ID_KEY,
        budgets: new InstanceBudgets(),
        readingBudgets: new ReadingBudgets(),
      },
    )
    if (reading.kind !== 'recorded') throw new Error(`the bill was not read: ${reading.kind}`)
  }

  // 3. The worker: the table reading and the payment jobs only. It shares the e2e worker's queue,
  // so it leaves the schedules alone: its short list would remove that worker's ticks for the
  // specs after this one (live.json's remake among them). Its health endpoint takes any free port
  // (0): the ports beside the web's are the e2e worker's and the simulated POS's.
  const worker = await startWorker(
    { ...config, healthPort: 0 },
    {
      logger: log,
      schedules: false,
      jobs: [
        ...createReadingJobs({ sim: config.sim, billIdKey: BILL_ID_KEY }),
        ...createPaymentJobs({ sim: config.sim, providers: new Map([[SIM_PAY_KIND, provider]]) }),
      ],
    },
  )

  let stopping = false
  const stop = async (exitCode: number) => {
    if (stopping) return
    stopping = true
    await worker.stop().catch(() => undefined)
    await sim.close().catch(() => undefined)
    await pool.end().catch(() => undefined)
    await owner.end().catch(() => undefined)
    process.exit(exitCode)
  }

  // 4. Ready, then the test's commands.
  print({ event: 'pay_harness_ready', code, itemId })
  const lines = createInterface({ input: process.stdin })
  lines.on('line', (line) => {
    const [command, paymentId] = line.trim().split(/\s+/)
    if (command === 'bills') {
      const bills = sim.host.engine.state.bills
        .filter((bill) => PAYMENT_TABLES.includes(bill.table))
        .map((bill) => ({
          state: bill.state,
          rows: bill.rows.map((row) => ({ article: row.article, note: row.note })),
        }))
      print({ event: 'pay_harness_bills', bills })
      return
    }
    if (command !== 'pay' || paymentId === undefined) return
    void (async () => {
      const [row] = await query<{ ref: string | null }>(
        'select provider_payment_ref as ref from restro.payments where id = $1',
        [paymentId],
      )
      if (row?.ref == null) {
        print({ event: 'pay_harness_failed', paymentId, why: 'no provider payment yet' })
        return
      }
      engine.guest.pay(providerRef(row.ref))
      print({ event: 'pay_harness_paid', paymentId })
    })().catch((error: unknown) => {
      print({ event: 'pay_harness_failed', paymentId, why: String(error) })
    })
  })
  lines.on('close', () => void stop(0))
  process.on('SIGTERM', () => void stop(0))
  process.on('SIGINT', () => void stop(0))
}

/**
 * The pay-first run's menu (#113): one section with the POS's Aperol Spritz, linked to its article
 * as a menu sync links it, with the venue's ordering on and the item paid first; published as the
 * publish job does (the snapshot a Send prices its lines from). The item's id.
 */
async function publishPayFirstMenu(
  pool: ReturnType<typeof createPool>,
  target: { tenantId: string; venueId: VenueId; integrationId: IntegrationId },
): Promise<string> {
  const { tenantId, venueId, integrationId } = target
  const menu = await provisionMenu(pool, tenantId, venueId)
  const article = PAY_FIRST_ARTICLE
  const [record] = await appendSourceRecords(pool, tenantId, integrationId, [
    {
      externalType: 'article',
      externalId: article.id,
      scope: 'master',
      raw: JSON.stringify(article),
      payload: {},
    },
  ])
  if (record === undefined) throw new Error('the article record was not stored')
  const section = newId('nd')
  const item = newId('nd')
  const link = { integration: integrationId, externalType: 'article', externalId: article.id }
  const changeSet = (source: string, actor: string, ops: unknown[]) =>
    ({
      id: newId('cs'),
      source,
      jobId: newId('jb'),
      actor,
      observedAt: new Date().toISOString(),
      ops,
    }) as Parameters<typeof apply>[2]
  const till = (fieldKey: string, value: unknown, scope = 'master') => ({
    op: 'setField',
    node: { link },
    fieldKey,
    layer: 'till',
    scope,
    value,
    sourceRecordId: record.id,
    mappingVersion: 1,
  })
  const manual = (node: string, fieldKey: string, value: unknown) => ({
    op: 'setField',
    node: { id: node },
    fieldKey,
    layer: 'manual',
    scope: 'master',
    value,
  })
  const steps = [
    changeSet(`till:${integrationId}`, `integration:${integrationId}`, [
      { op: 'createNode', id: item, nodeType: 'item', parent: null, status: 'active' },
      { op: 'linkSource', node: { id: item }, link },
      till('name', { bg_BG: article.name, en_US: article.name }),
      till('price', { amount_minor: article.priceMinor, currency: 'EUR' }, `venue:${venueId}`),
      till('for_sale', true, `venue:${venueId}`),
      till('visible', true),
      till('allergens', []),
    ]),
    changeSet('manual', 'system', [
      {
        op: 'createNode',
        id: section,
        nodeType: 'section',
        parent: { id: menu.id },
        status: 'active',
        sortKey: 'end',
      },
      manual(section, 'title', { bg_BG: 'Коктейли', en_US: 'Cocktails' }),
      manual(item, 'payment_mode', 'pay_first'),
      { op: 'setPlacement', item: { id: item }, section: { id: section }, sortKey: 'end' },
    ]),
  ]
  for (const step of steps) {
    const applied = await apply(pool, tenantId, step)
    if (applied.rejected.length > 0) {
      throw new Error(`the pay-first menu was refused: ${JSON.stringify(applied.rejected)}`)
    }
  }
  await setVenuePresentation(pool, tenantId, {
    venueId,
    presentation: { face: 'qr-phone', options: {} },
  })
  await setGuestFeatures(pool, tenantId, {
    venueId,
    features: {
      filters: true,
      call_waiter: { enabled: false, kinds: [] },
      bill: true,
      ordering: true,
      pay: true,
    },
  })
  const published = await publishMenu(pool, tenantId, {
    menuId: menu.id,
    venueId,
    reason: 'manual',
    actor: 'system',
  })
  if (published.status === 'held') throw new Error('the pay-first menu was held, not published')
  return item
}

main().catch((error: unknown) => {
  process.stderr.write(
    `pay harness failed: ${error instanceof Error ? error.stack : String(error)}\n`,
  )
  process.exit(1)
})
