// Fixtures for the Send's end-to-end test (#77). Run by the test itself (`seed <sim host> [Style]`):
//
//   seed   an organisation "Send Club" of its own with Demo Bar on a simulated POS, its instance
//          pointed at the simulator the test runs (`<sim host>`, 127.0.0.1:<port>), table 1 with a
//          code the test knows and a fresh sitting, and the menu published in the Style the test
//          names (Basic unless it names one): scripts/lib/seed-demo-bar-table.ts. The location check
//          is off: the Send is under test here, not the check (#76's spec covers it).
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on
// this machine. It prints one JSON line with the menu's path and the code (`seed_send_e2e_done`).
import { getPool } from '../src/server/db'
import { isSeedStyle, type SeedStyle, seedDemoBarTable } from './lib/seed-demo-bar-table'

const TENANT_ID = `tn_${'E2eSendClub'.padEnd(22, '0')}`

async function seed(simHost: string, style: SeedStyle): Promise<void> {
  const { path, code } = await seedDemoBarTable({
    tenantId: TENANT_ID,
    organizationName: 'Send Club',
    organizationSlug: 'send-club',
    simHost,
    style,
    ordering: { locationCheck: false },
    features: {
      filters: true,
      call_waiter: { enabled: false, kinds: [] },
      bill: false,
      ordering: true,
      pay: false,
    },
  })
  console.log(JSON.stringify({ level: 'info', event: 'seed_send_e2e_done', path, code }))
}

const [step, simHost, style = 'basic'] = process.argv.slice(2)
if (step !== 'seed' || simHost === undefined || !isSeedStyle(style)) {
  console.error(`seed-send-e2e: unknown step "${step}" (seed <sim host> [basic|editorial])`)
  process.exit(1)
}
seed(simHost, style)
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-send-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
