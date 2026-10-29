// Sets the payment account of the Paying settings test's venue (#116; scripts/seed-paying-e2e.ts
// makes the venue). Run by the test itself, as the database owner:
//
//   none        never connected: the venue's payment account removed, and the owner's ticks, the
//               legal details and the smallest card payment with it.
//   connected   an account the provider has not finished: its name, no card payments yet.
//   on          card payments are on (#216): a finished account, both ticks, the venue's last table
//               a payment table, and the POS declaring that first items open a bill. The legal
//               details are not set here: the Paying card does not depend on them.
//
// The paying tables are written by core/service alone (write-targets.test.ts); a fixture in an
// `e2e` folder is where a test sets one up, as the pay harness does. Refuses a database that is
// not on this machine.
import pg from 'pg'

import { assertDevEnvironment } from '../scripts/lib/guard'

const SEED = ['restro', 'system', 'e2e-paying-account'] as const

const [state] = process.argv.slice(2)
if (state !== 'none' && state !== 'connected' && state !== 'on') {
  console.error('paying-account <none|connected|on>')
  process.exit(1)
}

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('paying-account needs DATABASE_URL_OWNER (see .env.example).')
assertDevEnvironment({ ...process.env, DATABASE_URL: url })
const owner = new pg.Pool({ connectionString: url, max: 1 })
try {
  const { rows } = await owner.query<{ tenant_id: string; id: string }>(
    `select tenant_id, id from restro.venues where slug = 'paying-club'`,
  )
  const venue = rows[0]
  if (!venue) throw new Error('Run scripts/seed-paying-e2e.ts first: there is no Paying Club.')
  await owner.query('delete from restro.payment_accounts where venue_id = $1', [venue.id])
  await owner.query(
    `update restro.venues set settings = settings - 'legalDetails' - 'paying' where id = $1`,
    [venue.id],
  )
  // Every state starts from the same floor: no payment table, no pay-first capability, no choices.
  await owner.query(`update restro.venues set settings = settings - 'payFirst' where id = $1`, [
    venue.id,
  ])
  await owner.query(
    `update restro.tables
        set is_payment_table = false, hidden = false
      where venue_id = $1 and is_payment_table`,
    [venue.id],
  )
  await owner.query(
    `update restro.integrations
        set config = jsonb_set(config, '{service_capabilities,first_items_open_bill}', to_jsonb($2::boolean))
      where id in (select integration_id from restro.barsy_venues where venue_id = $1)`,
    [venue.id, state === 'on'],
  )
  if (state === 'on') {
    const [table] = (
      await owner.query<{ id: string }>(
        `select id from restro.tables where venue_id = $1 and archived_at is null order by id desc limit 1`,
        [venue.id],
      )
    ).rows
    if (!table) throw new Error('the venue has no table to use for payments')
    await owner.query(
      `update restro.tables set is_payment_table = true, hidden = true, qr_code_hash = null where id = $1`,
      [table.id],
    )
    const tick = JSON.stringify({ at: new Date().toISOString(), by: 'e2e' })
    await owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, account_name, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'simpay_seed_1', 'connected', 'Paying Club Ltd',
               jsonb_build_object('cardPayments', true, 'missing', '[]'::jsonb,
                 'ticks', jsonb_build_object('cardTypeInTill', $6::jsonb, 'receiptEmailsOff', $6::jsonb)),
               now(), $3, $4, $5)`,
      [venue.tenant_id, venue.id, ...SEED, tick],
    )
  } else if (state === 'connected') {
    await owner.query(
      `insert into restro.payment_accounts
         (tenant_id, venue_id, provider_kind, account_ref, state, account_name, checks, connected_at, source, actor, job_id)
       values ($1, $2, 'sim-pay', 'simpay_seed_1', 'connected', 'Paying Club Ltd',
               '{"cardPayments":false,"missing":["business details"]}'::jsonb, now(), $3, $4, $5)`,
      [venue.tenant_id, venue.id, ...SEED],
    )
  }
} finally {
  await owner.end()
}
