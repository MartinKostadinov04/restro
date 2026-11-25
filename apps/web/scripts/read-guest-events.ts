// Reads back the guest events of the table a code names (D142; #335), for the end-to-end test that
// drives the real guest page. Nothing is written. Like the seeds it refuses to run unless NODE_ENV
// is development and the database is on this machine.
//
//   read <code>   prints one JSON line (`guest_events_read`) with the table's events, oldest first,
//                 and the table's own column names, so the test can see for itself that there is
//                 no column for a phone number, a name, an address or anything a guest typed.
import { hashTableCode } from '@restro/core'
import pg from 'pg'

import { assertDevEnvironment } from './lib/guard'

interface EventRow {
  readonly kind: string
  readonly node_id: string | null
  readonly locale: string | null
  readonly outcome: string | null
  readonly amount_minor: string | null
  readonly currency: string | null
  readonly retention: string
  readonly source: string
  readonly actor: string
  readonly service_date: string
}

async function read(code: string): Promise<void> {
  assertDevEnvironment(process.env)
  const ownerUrl = process.env.DATABASE_URL_OWNER
  if (!ownerUrl) throw new Error('read-guest-events needs DATABASE_URL_OWNER (see .env.example).')
  const owner = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    const { rows: tables } = await owner.query<{ id: string }>(
      'select id from restro.tables where qr_code_hash = $1',
      [await hashTableCode(code)],
    )
    const table = tables[0]
    if (table === undefined) throw new Error('no table holds that code')
    const { rows: events } = await owner.query<EventRow>(
      `select kind, node_id, locale, outcome, amount_minor, currency, retention, source, actor,
              service_date
         from restro.guest_events where table_id = $1 order by seq`,
      [table.id],
    )
    const { rows: columns } = await owner.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'restro' and table_name = 'guest_events' order by column_name`,
    )
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'guest_events_read',
        events,
        columns: columns.map((column) => column.column_name),
      }),
    )
  } finally {
    await owner.end()
  }
}

const [step, code] = process.argv.slice(2)
if (step !== 'read' || code === undefined) {
  console.error(`read-guest-events: unknown step "${step}" (read <code>)`)
  process.exit(1)
}
read(code)
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      `read-guest-events failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
