// Sets the bars and the payment-table marks of the Paying Club venue for the payment tables test
// (#215; scripts/seed-paying-e2e.ts makes the venue, three tables in one hall). Run by the test
// itself, as the database owner:
//
//   two-bars   table 1 and 2 belong to "Main bar", table 3 to "Roof bar"; no payment table, every
//              table shown and without a code.
//   no-bars    the POS names no bar for any table; the same clean state.
//   old-sign-in <email>   that person's sign-in is 20 minutes old: a settings change asks for the
//              password again (D122 §7).
//
// A table's bar is read from the POS and a payment table is Restro's own mark; the test sets them
// here as the floor reading and the mark would. Refuses a database that is not on this machine.
import { newId } from '@restro/core'
import pg from 'pg'

import { assertDevEnvironment } from '../scripts/lib/guard'

const BARS = { main: 'Main bar', roof: 'Roof bar' } as const

const [state, email] = process.argv.slice(2)
if (state !== 'two-bars' && state !== 'no-bars' && !(state === 'old-sign-in' && email)) {
  console.error('payment-tables-state <two-bars|no-bars|old-sign-in <email>>')
  process.exit(1)
}

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('payment-tables-state needs DATABASE_URL_OWNER (see .env.example).')
assertDevEnvironment({ ...process.env, DATABASE_URL: url })
const owner = new pg.Pool({ connectionString: url, max: 1 })
try {
  if (state === 'old-sign-in') {
    await owner.query(
      `update restro.auth_session set created_at = now() - interval '20 minutes'
        where user_id = (select id from restro.auth_user where email = $1)`,
      [email],
    )
    await owner.end()
    process.exit(0)
  }
  const { rows } = await owner.query<{ tenant_id: string; id: string }>(
    `select tenant_id, id from restro.venues where slug = 'paying-club'`,
  )
  const venue = rows[0]
  if (!venue) throw new Error('Run scripts/seed-paying-e2e.ts first: there is no Paying Club.')

  const barId = async (name: string): Promise<string> => {
    const found = await owner.query<{ id: string }>(
      'select id from restro.bars where venue_id = $1 and name = $2',
      [venue.id, name],
    )
    const existing = found.rows[0]
    if (existing) return existing.id
    const id = newId('br')
    await owner.query(
      `insert into restro.bars (id, tenant_id, venue_id, name, source_key) values ($1, $2, $3, $4, $1)`,
      [id, venue.tenant_id, venue.id, name],
    )
    return id
  }

  // Clean: every table shown, none a payment table, no code.
  await owner.query(
    `update restro.tables
        set is_payment_table = false, hidden = false, bar_id = null,
            qr_code_hash = null, qr_code_sealed = null
      where venue_id = $1`,
    [venue.id],
  )
  if (state === 'two-bars') {
    const main = await barId(BARS.main)
    const roof = await barId(BARS.roof)
    const tables = await owner.query<{ id: string; number: string }>(
      'select id, number from restro.tables where venue_id = $1',
      [venue.id],
    )
    for (const table of tables.rows) {
      await owner.query('update restro.tables set bar_id = $2 where id = $1', [
        table.id,
        table.number === '3' ? roof : main,
      ])
    }
  }
  console.log(JSON.stringify({ level: 'info', event: 'payment_tables_state', state }))
} finally {
  await owner.end()
}
