// Gives the Tonight test club a closing hour, or takes it away again, for the night's end test
// (#332; scripts/seed-tonight-e2e.ts makes the club, which has no service hours of its own). Run by
// the test itself, as the database owner:
//
//   set     every weekday open from 07:00 to 06:59, last orders 06:30: whenever the test runs, the
//           club's closing hour for tonight is still ahead, so ending the night is ending it early.
//   clear   the club's ordering settings removed, as the seed leaves it (closed every day).
//
// A venue's settings are written by Settings' own path in the app; a fixture in an `e2e` folder is
// where a test sets them up, as reservations-state.ts does. Refuses a database not on this machine.
import { DEFAULT_ORDERING_SETTINGS, serviceHoursProblem } from '@restro/core'
import pg from 'pg'

import { assertDevEnvironment } from '../scripts/lib/guard'

const [state] = process.argv.slice(2)
if (state !== 'set' && state !== 'clear') {
  console.error('night-end-hours <set|clear>')
  process.exit(1)
}

const url = process.env.DATABASE_URL_OWNER
if (!url) throw new Error('night-end-hours needs DATABASE_URL_OWNER (see .env.example).')
assertDevEnvironment({ ...process.env, DATABASE_URL: url })
const owner = new pg.Pool({ connectionString: url, max: 1 })
try {
  const { rows } = await owner.query<{ id: string; service_day_ends_at: string }>(
    `select id, service_day_ends_at from restro.venues where slug = 'tonight-club'`,
  )
  const venue = rows[0]
  if (!venue)
    throw new Error('Run scripts/seed-tonight-e2e.ts seed first: there is no Tonight Club.')
  if (state === 'set') {
    const day = { opens: '07:00', lastOrders: '06:30', closes: '06:59' }
    const problem = serviceHoursProblem(day, venue.service_day_ends_at)
    if (problem !== null) throw new Error(`night-end-hours: ${problem}`)
    const ordering = {
      ...DEFAULT_ORDERING_SETTINGS,
      serviceHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    }
    await owner.query(
      `update restro.venues
         set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{ordering}', $2::jsonb)
       where id = $1`,
      [venue.id, JSON.stringify(ordering)],
    )
  } else {
    await owner.query(`update restro.venues set settings = settings - 'ordering' where id = $1`, [
      venue.id,
    ])
  }
} finally {
  await owner.end()
}
