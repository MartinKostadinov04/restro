// Fixtures for the shared order's end-to-end test (#75). Run by the test itself (`seed [Style]`):
//
//   seed   an organisation "Order Club" of its own with Demo Bar on a simulated POS, table 1 with a
//          code the test knows and a fresh sitting, its order empty, and the menu published in the
//          Style the test names (Basic unless it names one): scripts/lib/seed-demo-bar-table.ts. A
//          hand-made item is never orderable, so the venue is on the POS. Nothing in this spec
//          reaches the POS (it never Sends), so its instance points at a port nothing listens on.
//          The venue checks location (#76) with its spot at `ORDER_SPOT` and takes waiter calls.
//
// Like `db:seed:dev` this refuses to run unless NODE_ENV is development and the database is on
// this machine. It prints one JSON line with the menu's path and the code (`seed_order_e2e_done`).
import { CALL_WAITER_KINDS } from '@restro/core'

import { ORDER_SPOT } from '../e2e/support'
import { getPool } from '../src/server/db'
import { isSeedStyle, type SeedStyle, seedDemoBarTable } from './lib/seed-demo-bar-table'

const TENANT_ID = `tn_${'E2eOrderClub'.padEnd(22, '0')}`

async function seed(style: SeedStyle): Promise<void> {
  const { path, code } = await seedDemoBarTable({
    tenantId: TENANT_ID,
    organizationName: 'Order Club',
    organizationSlug: 'order-club',
    simHost: '127.0.0.1:9',
    style,
    // The location check on, with the venue's spot set (with none it fails closed).
    ordering: { locationCheck: true, spot: ORDER_SPOT },
    features: {
      filters: true,
      call_waiter: { enabled: true, kinds: [...CALL_WAITER_KINDS] },
      bill: false,
      ordering: true,
      pay: false,
    },
  })
  console.log(JSON.stringify({ level: 'info', event: 'seed_order_e2e_done', path, code }))
}

const [step, style = 'basic'] = process.argv.slice(2)
if (step !== 'seed' || !isSeedStyle(style)) {
  console.error(`seed-order-e2e: unknown step "${step}" (seed [basic|editorial])`)
  process.exit(1)
}
seed(style)
  .then(async () => {
    await getPool().end()
    process.exit(0)
  })
  .catch((error: unknown) => {
    console.error(
      `seed-order-e2e ${step} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exit(1)
  })
