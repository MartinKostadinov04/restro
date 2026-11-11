// The demo club's night, and the people who work it: what Martin's acceptance walk should already
// find on the screens. Everything here goes through `applyService` (rule 1) in the role it really
// belongs to:
//
// - the staff's own work (the roles, the people, opening tables, the book, the blocks) as the
//   signed-in owner, through `runSettingsCommand`, which is what the screens call;
// - the phones' work (a round in the bag, a waiter call) as a **guest** and the POS's bills as the
//   **worker's** `reading.record`, through `src/server/seed/service.ts`: the guest context carries
//   the table's code hash, which is what the table row already holds, so no plain code is needed,
//   and the reading is the very command the sync sends.
//
// What is deliberately not here, and why, is in the report: no payment (the simulated provider's
// account lives in the worker's memory, so a seeded one would read back as missing), no closed
// bill with a receipt (a closed bill is the worker's own read), and no sent round (a Send without
// the worker running would sit Unconfirmed; the walk sends one itself).

import { randomUUID } from 'node:crypto'
import { serviceDate } from '@restro/core'
import { type DbPool, venues, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import {
  countSeededNight,
  readSeededStaff,
  runGuestCommand,
  runWorkerCommand,
} from '../../src/server/seed/service'
import { actorOf, runSettingsCommand } from '../../src/server/settings/command'
import { staffServiceOptions } from '../../src/server/staff/service'
import { loadDemoBarScenario, optionKey } from './demo-bar'
import {
  DEMO_BILLS,
  DEMO_BLOCK,
  DEMO_CALLS,
  DEMO_OPEN_TABLES,
  DEMO_PARTIES,
  DEMO_PEOPLE,
  DEMO_ROUNDS,
  DEMO_SCENARIO,
  DEMO_WAITING,
} from './demo-club'
import type { SeededDemoClub } from './seed-demo-club'

/** What the night left behind, for the printed summary. */
export interface SeededDemoNight {
  readonly serviceDate: string
  readonly opened: number
  readonly bills: number
  readonly rounds: number
  readonly calls: number
  readonly bookings: number
  readonly waiting: number
  readonly blocked: number
  /** Why a step did nothing, one line each: what the walk will not find. */
  readonly skipped: readonly string[]
}

type Scope = Parameters<typeof runSettingsCommand>[0]

/** The staff records, each on one of the editable default roles. */
export interface SeededPeople {
  readonly staff: readonly { readonly name: string; readonly role: string }[]
  readonly skipped: readonly string[]
}

/**
 * The club's staff: one record per person, on the default role their job calls for, linked to the
 * account of the same name so the person can sign in and be themselves. No role is copied or
 * edited — what each of them may do is what the role editor shows, which is the point of having
 * them to switch between.
 */
export async function seedDemoPeople(
  scope: Scope,
  accounts: ReadonlyMap<string, string>,
): Promise<SeededPeople> {
  const staff: { name: string; role: string }[] = []
  const skipped: string[] = []
  // Who is on the staff already: `staff.add` names nobody, so a second run would otherwise make a
  // second Весела. The owner is no staff record — they own the organisation.
  const already = await readSeededStaff(
    { pool: scope.pool, tenantId: scope.tenantId, venueId: scope.venueId },
    actorOf(scope, true),
  )
  for (const person of DEMO_PEOPLE) {
    if (person.defaultRole === null || already.has(person.name)) {
      staff.push({ name: person.name, role: person.role })
      continue
    }
    const userId = accounts.get(person.email)
    // `staffServiceOptions()` carries the PIN pepper and the seal key, exactly as the Staff screen's
    // own action does: a new person is given a PIN, and only the worker's reveal can read it back.
    const added = await runSettingsCommand(
      scope,
      { type: 'staff.add', displayName: person.name, roleId: person.defaultRole },
      { own: true, service: staffServiceOptions() },
    )
    if (!added.ok) {
      // A repeat run finds the person already there, which is not a failure of the seed.
      skipped.push(`${person.name}: ${added.error}`)
      continue
    }
    const staffMemberId = added.details.staffMemberId
    if (typeof staffMemberId === 'string' && userId !== undefined) {
      const linked = await runSettingsCommand(
        scope,
        { type: 'staff.link_account', staffMemberId, userId },
        { own: true, service: staffServiceOptions() },
      )
      if (!linked.ok) skipped.push(`${person.name}'s account was not linked: ${linked.error}`)
    }
    staff.push({ name: person.name, role: person.role })
  }
  return { staff, skipped }
}

/** The night itself. */
export async function seedDemoNight(
  pool: DbPool,
  tenantId: string,
  club: SeededDemoClub,
  scope: Scope,
): Promise<SeededDemoNight> {
  const skipped: string[] = []
  const [venue] = await withTenant(pool, tenantId, (tx) =>
    tx
      .select({ timezone: venues.timezone, serviceDayEndsAt: venues.serviceDayEndsAt })
      .from(venues)
      .where(eq(venues.id, club.venueId)),
  )
  if (venue === undefined) throw new Error('the demo club went missing before its night')
  const now = new Date()
  const day = serviceDate(now, venue.timezone, venue.serviceDayEndsAt)

  // Whether this night is already set up. The book is what says so: its commands refuse a spot
  // that is taken (`spot_taken`), and the cancelled booking would be written afresh every run.
  const standing = await countSeededNight(
    { pool, tenantId, venueId: club.venueId },
    actorOf(scope, true),
    day,
  )
  const set = standing > 0
  if (set) {
    skipped.push(
      `the night of ${day} already holds ${standing} line(s) in the book: its rounds, calls and bookings were left as they are`,
    )
  }

  // Opening a table and recording a reading are idempotent in themselves — a table already open
  // stays open, and a reading replaces the bills it reads — so they run every time. A round and a
  // waiter call are not: each would be a second round in the bag and a second call on the floor.
  const opened = await openTables(scope, club, skipped)
  const bills = await recordBills(pool, tenantId, club, now, skipped)
  const rounds = set ? 0 : await addRounds(pool, tenantId, club, skipped)
  const calls = set ? 0 : await callWaiters(pool, tenantId, club, skipped)
  const book = set
    ? { bookings: standing, waiting: 0, blocked: 0 }
    : await seedBook(scope, club, day, now, skipped)

  return {
    serviceDate: day,
    opened,
    bills,
    rounds,
    calls,
    bookings: book.bookings,
    waiting: book.waiting,
    blocked: book.blocked,
    skipped,
  }
}

/** Opens the night's tables for phones, as a waiter's tap on Tonight does. */
async function openTables(scope: Scope, club: SeededDemoClub, skipped: string[]): Promise<number> {
  let opened = 0
  for (const number of DEMO_OPEN_TABLES) {
    const tableId = club.tableIds.get(number)
    if (tableId === undefined) {
      skipped.push(`table ${number} is not on the club's floor`)
      continue
    }
    const result = await runSettingsCommand(scope, { type: 'table.open', tableId })
    if (result.ok) opened += 1
    else skipped.push(`table ${number} did not open: ${result.error}`)
  }
  return opened
}

/**
 * The three bills the simulator holds, as a reading of each table: the Tonight screen then shows
 * real bills before the worker has ever run. The worker's own first read replaces each of them.
 */
async function recordBills(
  pool: DbPool,
  tenantId: string,
  club: SeededDemoClub,
  now: Date,
  skipped: string[],
): Promise<number> {
  if (!process.env.BILL_ID_KEY?.trim()) {
    skipped.push('the bills were not written: BILL_ID_KEY is not set (see .env.example)')
    return 0
  }
  const scenario = loadDemoBarScenario(DEMO_SCENARIO)
  let written = 0
  for (const bill of DEMO_BILLS) {
    const tableId = club.tableIds.get(bill.table)
    if (tableId === undefined) {
      skipped.push(`the bill of table ${bill.table} has no table`)
      continue
    }
    const openedAt = new Date(now.getTime() - bill.minutesAgo * 60_000)
    let total = 0
    const lines = bill.rows.map((row, index) => {
      const article = scenario.articles.get(row.article)
      if (article === undefined) throw new Error(`no article ${row.article} in the scenario`)
      const amountMinor = article.priceMinor * row.quantity
      total += amountMinor
      return {
        pos: `${bill.table}-${index + 1}`,
        itemPos: row.article,
        posName: article.name,
        quantity: String(row.quantity),
        amountMinor,
        enteredBy: row.by,
        enteredAt: new Date(openedAt.getTime() + index * 60_000).toISOString(),
        restroRef: null,
      }
    })
    const recorded = await runWorkerCommand(
      { pool, tenantId, venueId: club.venueId },
      {
        type: 'reading.record',
        tableId,
        reading: {
          complete: true,
          currency: 'EUR',
          bills: [
            {
              pos: `demo-${bill.table}`,
              totalMinor: total,
              paidMinor: bill.paidMinor,
              openedAt: openedAt.toISOString(),
              openedByRestro: false,
              paymentInFlight: false,
              lines,
            },
          ],
        },
      },
      { integrationId: club.integrationId },
      { billIdKey: process.env.BILL_ID_KEY },
    )
    if (recorded.ok) written += 1
    else skipped.push(`the bill of table ${bill.table} was refused: ${recorded.error}`)
  }
  return written
}

/** The rounds in the bag: guest commands, with the table's code hash as a phone's carries it. */
async function addRounds(
  pool: DbPool,
  tenantId: string,
  club: SeededDemoClub,
  skipped: string[],
): Promise<number> {
  let added = 0
  for (const round of DEMO_ROUNDS) {
    const tableId = club.tableIds.get(round.table)
    const codeHash = club.codeHashes.get(round.table)
    if (tableId === undefined || codeHash === undefined) {
      skipped.push(`the round for table ${round.table} has no table or no code`)
      continue
    }
    for (const line of round.lines) {
      const itemId = club.itemsByArticle.get(line.article)
      if (itemId === undefined) {
        skipped.push(`article ${line.article} has no item on the menu`)
        continue
      }
      const optionIds: string[] = []
      if (line.option !== undefined) {
        const key = optionKey(line.article, line.option[0], line.option[1])
        const optionId = club.optionsByKey.get(key)
        if (optionId === undefined) skipped.push(`option ${key} has no node on the menu`)
        else optionIds.push(optionId)
      }
      const placed = await runGuestCommand(
        { pool, tenantId, venueId: club.venueId },
        {
          type: 'order.add',
          tableId,
          actionId: randomUUID(),
          ageMs: 0,
          itemId,
          optionIds,
          qty: line.qty,
          note: line.note ?? '',
        },
        { tableCodeHash: codeHash },
      )
      if (placed.ok) added += 1
      else skipped.push(`a round line on table ${round.table} was refused: ${placed.error}`)
    }
  }
  return added
}

/** The waiter calls waiting on the floor: guest commands too. */
async function callWaiters(
  pool: DbPool,
  tenantId: string,
  club: SeededDemoClub,
  skipped: string[],
): Promise<number> {
  let called = 0
  for (const call of DEMO_CALLS) {
    const tableId = club.tableIds.get(call.table)
    const codeHash = club.codeHashes.get(call.table)
    if (tableId === undefined || codeHash === undefined) {
      skipped.push(`the call from table ${call.table} has no table or no code`)
      continue
    }
    const rang = await runGuestCommand(
      { pool, tenantId, venueId: club.venueId },
      { type: 'waiter.call', tableId, actionId: randomUUID(), kind: call.kind, ageMs: 0 },
      { tableCodeHash: codeHash },
    )
    if (rang.ok) called += 1
    else skipped.push(`the call from table ${call.table} was refused: ${rang.error}`)
  }
  return called
}

/** The night's book: bookings in each state, the waiting list and the blocked booth. */
async function seedBook(
  scope: Scope,
  club: SeededDemoClub,
  day: string,
  now: Date,
  skipped: string[],
): Promise<{ bookings: number; waiting: number; blocked: number }> {
  const spotsOf = (names: readonly string[]): string[] => {
    const ids: string[] = []
    for (const name of names) {
      const id = club.spotIds.get(name)
      if (id === undefined) skipped.push(`spot "${name}" is not on the club's plan`)
      else ids.push(id)
    }
    return ids
  }
  let bookings = 0
  for (const party of DEMO_PARTIES) {
    const spotIds = spotsOf(party.spots)
    if (spotIds.length === 0) continue
    const startsAt = new Date(now.getTime() + party.minutesFromNow * 60_000)
    const created = await runSettingsCommand(scope, {
      type: 'reservation.create',
      serviceDate: day,
      startsAt: startsAt.toISOString(),
      kind: 'booking',
      status: 'reserved',
      partySize: party.partySize,
      phone: party.phone,
      guestName: party.name,
      spotIds,
      ...(party.note === undefined ? {} : { note: party.note }),
      ...(party.regular === true ? { saveAsRegular: true } : {}),
    })
    if (!created.ok) {
      skipped.push(`the booking for ${party.name} was refused: ${created.error}`)
      continue
    }
    bookings += 1
    const reservationId = created.details.reservationId
    if (typeof reservationId !== 'string') continue
    if (party.state === 'seated') {
      const arrived = await runSettingsCommand(scope, {
        type: 'reservation.arrive',
        reservationId,
        sameGuests: true,
      })
      if (!arrived.ok) skipped.push(`${party.name} could not be seated: ${arrived.error}`)
    }
    if (party.state === 'cancelled') {
      const off = await runSettingsCommand(scope, { type: 'reservation.cancel', reservationId })
      if (!off.ok) skipped.push(`${party.name}'s cancellation was refused: ${off.error}`)
    }
  }

  let waiting = 0
  for (const party of DEMO_WAITING) {
    const added = await runSettingsCommand(scope, {
      type: 'waiting.add',
      serviceDate: day,
      partySize: party.partySize,
      phone: party.phone,
      guestName: party.name,
    })
    if (added.ok) waiting += 1
    else skipped.push(`${party.name} was not put on the waiting list: ${added.error}`)
  }

  let blocked = 0
  const blockSpots = spotsOf(DEMO_BLOCK.spots)
  if (blockSpots.length > 0) {
    const block = await runSettingsCommand(scope, {
      type: 'block.save',
      serviceDate: day,
      startsAt: now.toISOString(),
      spotIds: blockSpots,
      reason: DEMO_BLOCK.reason,
      note: DEMO_BLOCK.note,
    })
    if (block.ok) blocked = blockSpots.length
    else skipped.push(`the blocked booth was refused: ${block.error}`)
  }
  return { bookings, waiting, blocked }
}
