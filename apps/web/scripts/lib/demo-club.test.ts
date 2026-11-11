// The demo club described against the two files it has to agree with: the ported paper plan and
// the simulated POS scenario. Pure: no database, no HTTP, no simulator. Every name the night
// mentions (an open table, a bill, a round, a call, a party, the blocked booth) must exist on both
// sides, or the seed would write a club whose screens point at nothing — which is the one failure
// Martin would meet as an empty screen rather than as an error.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { clubBiadFloor } from './club-biad-plan'
import { loadDemoBarScenario, optionKey } from './demo-bar'
import {
  clubFloorReading,
  DEMO_ALLERGENS,
  DEMO_BILLS,
  DEMO_BLOCK,
  DEMO_CALLS,
  DEMO_CAPABILITIES,
  DEMO_DESCRIPTIONS,
  DEMO_HIDDEN_ARTICLE,
  DEMO_OPEN_TABLES,
  DEMO_PARTIES,
  DEMO_PEOPLE,
  DEMO_ROUNDS,
  DEMO_SCENARIO,
  DEMO_SOLD_OUT_ARTICLE,
  DEMO_WAITING,
  loadDemoClubFloor,
} from './demo-club'

const plan = clubBiadFloor()
const floor = loadDemoClubFloor(DEMO_SCENARIO)
const scenario = loadDemoBarScenario(DEMO_SCENARIO)

/** The scenario's own switches, straight from the file: what the simulator says it can do. */
const switches = ((): Record<string, unknown> => {
  const path = fileURLToPath(
    new URL(
      `../../../../packages/connectors/sim-pos/scenarios/${DEMO_SCENARIO}.json`,
      import.meta.url,
    ),
  )
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const on = (parsed as { switches?: unknown }).switches
  if (on === null || typeof on !== 'object') throw new Error('the scenario declares no switches')
  return on as Record<string, unknown>
})()

/** The spots that take orders, by name: the only ones a Table, a bill or a round can name. */
const ordering = new Map(
  plan.spots.filter((spot) => spot.takesOrders).map((spot) => [spot.name, spot] as const),
)
/** The simulator's own tables, by the number it prints, payment tables apart. */
const posTables = new Map(
  floor.tables.filter((table) => !table.payment).map((table) => [table.number, table] as const),
)

describe('the demo club and the simulated POS', () => {
  it('puts one POS table behind every spot that takes orders, and no more', () => {
    expect([...posTables.keys()].sort()).toEqual([...ordering.keys()].sort())
  })

  it('stands every POS table in the area its spot stands in', () => {
    for (const [number, table] of posTables) {
      expect(table.hall, number).toBe(ordering.get(number)?.area)
    }
  })

  it('gives the payment tables a hall of their own, so they are no part of the plan', () => {
    const payment = floor.tables.filter((table) => table.payment)
    expect(payment.length).toBeGreaterThan(0)
    for (const table of payment) {
      expect(ordering.has(table.number)).toBe(false)
      expect(table.hall).toBe('Каса')
    }
    expect(scenario.paymentTableNames).toEqual(payment.map((table) => table.number))
  })

  it('sends the reading the worker would send', () => {
    const reading = clubFloorReading(floor)
    expect(reading.bars).toHaveLength(floor.bars.length)
    expect(reading.tables).toHaveLength(floor.tables.length)
    // Rule 3: a reading carries the POS's own ids only as prefixed refs, and marks no payment
    // table — the venue's floor source names those (D122 §8).
    const posIds = new Set(floor.tables.map((table) => table.id))
    for (const table of reading.tables) {
      expect(posIds.has(table.ref.pos), table.name ?? '').toBe(true)
      expect(table.paymentTable).toBeNull()
      if (table.bar !== null) {
        expect(floor.bars.some((bar) => bar.id === table.bar?.pos)).toBe(true)
      }
    }
    expect(reading.bars.map((bar) => bar.ref.pos)).toEqual(floor.bars.map((bar) => bar.id))
  })

  it('declares exactly what the scenario switches on', () => {
    expect(DEMO_CAPABILITIES.tableBar).toBe(switches.readsTableBar)
    expect(DEMO_CAPABILITIES.firstItemsOpenBill).toBe(switches.firstItemsOpenBill)
    expect(DEMO_CAPABILITIES.notesReachTicket).toBe(switches.notesReachTicket)
    expect(DEMO_CAPABILITIES.whoEnteredLine).toBe(switches.lineShowsWhoAndWhen)
    expect(DEMO_CAPABILITIES.ownLineReference).toBe(switches.lineCarriesCallerRef)
    expect(DEMO_CAPABILITIES.idempotentAdd).toBe(switches.repeatSafeAdd)
    expect(DEMO_CAPABILITIES.receiptNumberOnClose).toBe(switches.receiptNumberOnClose)
    expect(DEMO_CAPABILITIES.readClosedBills).toBe(switches.readClosedBills)
    // Nothing the scenario leaves off may be declared on: the simulator's own profile switches
    // none of these, so the venue must not claim them either.
    expect(DEMO_CAPABILITIES.approvalAtBar).toBe(false)
    expect(DEMO_CAPABILITIES.electronicReceipt).toBe(false)
    expect(DEMO_CAPABILITIES.severalBillsPerTable).toBe(false)
    expect(DEMO_CAPABILITIES.trainingMode).toBe(false)
  })
})

describe('the demo night', () => {
  const onlyRealTables = (what: string, used: readonly string[]): void => {
    it(`names only tables that exist (${what})`, () => {
      expect(used.length).toBeGreaterThan(0)
      for (const name of used) expect(ordering.has(name), `${what}: ${name}`).toBe(true)
    })
  }

  onlyRealTables('the tables it opens', [...DEMO_OPEN_TABLES])
  onlyRealTables(
    'the bills',
    DEMO_BILLS.map((bill) => bill.table),
  )
  onlyRealTables(
    'the rounds in the bag',
    DEMO_ROUNDS.map((round) => round.table),
  )
  onlyRealTables(
    'the waiter calls',
    DEMO_CALLS.map((call) => call.table),
  )

  it('opens every table a bill, a round or a call belongs to', () => {
    const open = new Set<string>(DEMO_OPEN_TABLES)
    for (const bill of DEMO_BILLS) expect(open.has(bill.table), `bill ${bill.table}`).toBe(true)
    for (const round of DEMO_ROUNDS) {
      expect(open.has(round.table), `round ${round.table}`).toBe(true)
    }
    for (const call of DEMO_CALLS) expect(open.has(call.table), `call ${call.table}`).toBe(true)
  })

  it('seats every party, the waiting list and the block on spots of the plan', () => {
    const spots = new Set(plan.spots.map((spot) => spot.name))
    for (const party of DEMO_PARTIES) {
      expect(party.spots.length).toBeGreaterThan(0)
      for (const name of party.spots) expect(spots.has(name), `${party.name}: ${name}`).toBe(true)
    }
    for (const name of DEMO_BLOCK.spots) expect(spots.has(name), `block: ${name}`).toBe(true)
  })

  it('gives every party a phone, because the venue asks for one', () => {
    // `phoneRequired` is on in the seeded rules, and a booking with no number is refused
    // (`phone_required`), so a party without one would quietly not be in the book at all.
    for (const party of [...DEMO_PARTIES, ...DEMO_WAITING]) {
      expect(party.phone, party.name).toMatch(/^\+359\d{9}$/)
      expect(party.partySize).toBeGreaterThan(0)
    }
  })

  it('shows the book in more than one state', () => {
    expect(new Set(DEMO_PARTIES.map((party) => party.state))).toEqual(
      new Set(['booked', 'late', 'seated', 'cancelled']),
    )
    expect(DEMO_WAITING.length).toBeGreaterThan(1)
  })

  it('bills only what the simulated POS sells, and part-pays exactly one bill', () => {
    let partPaid = 0
    for (const bill of DEMO_BILLS) {
      expect(bill.rows.length).toBeGreaterThan(0)
      let total = 0
      for (const row of bill.rows) {
        const article = scenario.articles.get(row.article)
        expect(article, `${bill.table}: article ${row.article}`).toBeDefined()
        expect(row.quantity).toBeGreaterThan(0)
        total += (article?.priceMinor ?? 0) * row.quantity
      }
      // A POS may say part of a bill is settled; it may never say more is paid than is owed.
      expect(bill.paidMinor).toBeGreaterThanOrEqual(0)
      expect(bill.paidMinor).toBeLessThanOrEqual(total)
      if (bill.paidMinor > 0) partPaid += 1
    }
    expect(partPaid).toBe(1)
    // One bill carries a line the POS says Restro entered: a round that has reached the till.
    expect(DEMO_BILLS.some((bill) => bill.rows.some((row) => row.by === 'restro'))).toBe(true)
  })

  it('orders only items the menu has, with options the menu offers', () => {
    const items = new Map(
      scenario.sections.flatMap((section) => section.items.map((item) => [item.article, item])),
    )
    for (const round of DEMO_ROUNDS) {
      for (const line of round.lines) {
        const item = items.get(line.article)
        expect(item, `the menu does not sell ${line.article}`).toBeDefined()
        expect(line.qty).toBeGreaterThan(0)
        if (line.option === undefined) continue
        const [groupKey, optionKeyName] = line.option
        const group = item?.optionGroups?.find((one) => one.id === groupKey)
        expect(group, optionKey(line.article, groupKey, optionKeyName)).toBeDefined()
        expect(
          group?.options.some((one) => one.id === optionKeyName),
          optionKey(line.article, groupKey, optionKeyName),
        ).toBe(true)
      }
    }
  })

  it('enriches, hides and sells out articles the catalogue really holds', () => {
    for (const article of [
      ...DEMO_ALLERGENS.keys(),
      ...DEMO_DESCRIPTIONS.keys(),
      DEMO_HIDDEN_ARTICLE,
      DEMO_SOLD_OUT_ARTICLE,
    ]) {
      expect(scenario.articles.get(article), article).toBeDefined()
    }
    // One hidden item and one sold-out item is what the walk should meet, so they are not the same
    // item; both are the cautious direction, which is the only one our layers may take (rule 5).
    expect(DEMO_HIDDEN_ARTICLE).not.toBe(DEMO_SOLD_OUT_ARTICLE)
  })
})

describe('the demo staff', () => {
  it('is one owner and a person for every screen the walk visits', () => {
    expect(DEMO_PEOPLE.filter((person) => person.defaultRole === null)).toHaveLength(1)
    expect(DEMO_PEOPLE.length).toBeGreaterThanOrEqual(5)
    expect(new Set(DEMO_PEOPLE.map((person) => person.email)).size).toBe(DEMO_PEOPLE.length)
    for (const person of DEMO_PEOPLE) {
      // Local-only accounts: a `.test` address reaches nobody, so no real inbox is ever named.
      expect(person.email).toMatch(/^[a-z0-9]+@club-biad\.test$/)
      expect(person.name.length).toBeGreaterThan(0)
      expect(person.role.length).toBeGreaterThan(0)
    }
  })
})
