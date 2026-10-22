// The conformance kit on the simulated POS (#68 done-when): both profiles, in process and over
// HTTP through MSW, plus one run with every capability the switches can declare switched on, so
// the kit's declared branches (several bills, first items open a bill, part quantities, who
// entered a line, Restro's reference, bars, receipt numbers, training mode) run too.

import { serviceConnectorSuite } from '@restro/core/connectors/testing'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll } from 'vitest'

import { fetchTransport } from './client'
import { ManualClock } from './engine/clock'
import { SimEngine } from './engine/engine'
import { PROFILE_NAMES, type SimSwitches, switchesOf } from './switches'
import { inProcessTransport, simPosHandlers, simPosHarness } from './testing'

function engineOf(switches: Parameters<typeof switchesOf>[0], changes: Partial<SimSwitches> = {}) {
  const clock = new ManualClock()
  return { clock, engine: new SimEngine({ switches: switchesOf(switches, changes), clock }) }
}

for (const profile of PROFILE_NAMES) {
  const { clock, engine } = engineOf(profile)
  serviceConnectorSuite(
    simPosHarness({
      name: `sim-pos ${profile}, in process`,
      engine,
      clock,
      transport: inProcessTransport(engine),
    }),
  )
}

const overHttp = PROFILE_NAMES.map((profile) => ({
  profile,
  base: `http://${profile}.sim-pos.localhost`,
  ...engineOf(profile),
}))
const server = setupServer(...overHttp.flatMap(({ engine, base }) => simPosHandlers(engine, base)))
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

for (const { profile, base, clock, engine } of overHttp) {
  serviceConnectorSuite(
    simPosHarness({
      name: `sim-pos ${profile}, over HTTP`,
      engine,
      clock,
      transport: fetchTransport(base, { env: 'test' }),
    }),
  )
}

const wide = engineOf('pilot', {
  billsPerTable: 'several',
  firstItemsOpenBill: true,
  lineShowsWhoAndWhen: true,
  lineCarriesCallerRef: true,
  repeatSafeAdd: true,
  movePartialQuantity: true,
  readsTableBar: true,
  oneLoginPerBar: false,
  notesReachTicket: true,
  receiptNumberOnClose: true,
  trainingMode: true,
})
serviceConnectorSuite(
  simPosHarness({
    name: 'sim-pos with every capability on, in process',
    engine: wide.engine,
    clock: wide.clock,
    transport: inProcessTransport(wide.engine),
  }),
)
