// Club Biad, the demo club of Martin's acceptance walk (`pnpm db:seed:demo`): everything about it
// that is a decision rather than a database write. Pure — no I/O but reading the scenario file,
// which is plain data on disk — so `demo-club.test.ts` can check the whole description without a
// database.
//
// The club is a POS venue on the simulated POS (`sim-pos`, scenario `club-biad`): a venue's source
// is fixed at creation (D64), the pilot club runs a POS, and a walk over ordering and paying has to
// go through the integration layer to mean anything. So its menu is the POS's catalogue, written
// through `apply()` with till provenance exactly as a barsy pull would be (`demo-bar.ts` does the
// work; the scenario file is the one source of both the simulator's state and the menu), and
// Restro's own layers only enrich: allergens, descriptions, and one item hidden from the phones.
//
// Its floor is the real club's paper plan, ported in `club-biad-plan.ts`. A table's `number` in the
// scenario is the plan's spot name and its `hall` is the spot's area, so a spot, the Table orders
// go onto and its QR code are the same place, with no mapping table in between.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Floor, LocalizedText, ServiceCapabilities, ServiceHours } from '@restro/core'
import { NO_SERVICE_CAPABILITIES, posRef } from '@restro/core'
import { z } from 'zod'

import { type CLUB_BIAD_KINDS, type ClubBiadSpot, clubBiadFloor } from './club-biad-plan'

// --- who and where -------------------------------------------------------------------------------

/** The organisation (= tenant) the demo club belongs to. */
export const DEMO_ORGANIZATION = { name: 'Club Biad', slug: 'club-biad' } as const

/** The venue itself. Europe/Sofia and a service day ending at 07:00 are `provisionVenue`'s own. */
export const DEMO_VENUE = { name: 'Club Biad Sofia', slug: 'club-biad' } as const

/** The simulated instance and the scenario it runs. */
export const DEMO_INSTANCE_NAME = 'Симулиран POS'
/**
 * The simulated payment provider's kind (`@restro/sim-pay`), and the account reference the demo
 * records for it. The worker builds that provider only with `WORKER_PAYMENTS_SIM=on`, and it
 * refuses production, so no setting can make a guest "pay" a simulator at a real venue.
 */
export const DEMO_PAY_PROVIDER = 'sim-pay'
export const DEMO_PAY_ACCOUNT = 'simpay_club_biad'

/**
 * The host the guest page is served from, for the provider's wallets (D125 3.6): whatever
 * `PUBLIC_BASE_URL` names, so a machine serving the demo on another port or name needs no edit.
 */
export function demoGuestHost(env: Record<string, string | undefined> = process.env): string {
  const base = env.PUBLIC_BASE_URL?.trim()
  if (base === undefined || base === '') return 'localhost'
  try {
    return new URL(base).hostname
  } catch {
    return 'localhost'
  }
}

export const DEMO_SCENARIO = 'club-biad'

/**
 * Where `pnpm sim:serve` listens: its own `SIM_POS_PORT`, or the 4010 it defaults to. The seed
 * writes this as the instance's host, so a machine that runs the simulator on another port (two
 * clubs side by side on one PC) needs no edit here.
 */
export function demoSimHost(env: Record<string, string | undefined> = process.env): string {
  const port = env.SIM_POS_PORT?.trim()
  return `localhost:${port !== undefined && /^\d{1,5}$/.test(port) ? port : '4010'}`
}

/** The till venue (`bid`) the club serves on its instance. */
export const DEMO_BID = 1

/**
 * The club's spot on the map (D118's "the venue's spot"), so the owner's Ordering screen is filled
 * in and the location check can be switched on with one tap. Sofia's centre, to a block or so: the
 * prototype records no coordinates for the club and nothing may be invented more precisely than
 * that (the owner drags the pin in Settings).
 */
export const DEMO_VENUE_SPOT = { lat: 42.6977, lng: 23.3219 } as const

/**
 * The club's service hours, per weekday: a club night. Opens 22:00, last orders 05:30, closes
 * 06:00, inside the service day that ends at 07:00. Without hours ordering from phones is closed
 * every day (`DEFAULT_ORDERING_SETTINGS`), and the walk would find the menu read-only.
 */
export const DEMO_SERVICE_HOURS = {
  opens: '22:00',
  lastOrders: '05:30',
  closes: '06:00',
} as const

/** Every weekday open, so the walk works whichever night Martin runs it. */
export const DEMO_WEEK: ServiceHours = {
  mon: DEMO_SERVICE_HOURS,
  tue: DEMO_SERVICE_HOURS,
  wed: DEMO_SERVICE_HOURS,
  thu: DEMO_SERVICE_HOURS,
  fri: DEMO_SERVICE_HOURS,
  sat: DEMO_SERVICE_HOURS,
  sun: DEMO_SERVICE_HOURS,
}

/**
 * The venue's legal details (#198, RR-O44): made-up values for a demo, in the shape the owner's
 * Paying screen saves. Ordering from phones turns on only once the privacy notice link is on file,
 * so these come before the guest features.
 */
export const DEMO_LEGAL = {
  name: 'Клуб Биад ЕООД',
  eik: '207654321',
  address: 'гр. София, ул. Демо 1',
  privacyUrl: 'https://club-biad.example/privacy',
} as const

/** The turn time the club holds a spot for (D135: the one setting, and the gap before the next booking). */
export const DEMO_TURN_MINUTES = 150

// --- the people ----------------------------------------------------------------------------------

/**
 * Who Martin can sign in as. The roles are the editable defaults Restro ships (`staff`, `manager`)
 * — no role is copied or edited here, so what each person may do is what the role editor shows.
 * The owner is the organisation's owner account, which holds every permission at every venue
 * implicitly (`grants.ts`), so it carries no staff role at all.
 *
 * Every account shares the local development password (`DEV_ADMIN_PASSWORD`, published in
 * `.env.example`): a seed invents no secret, and this one only opens a database on this machine.
 */
export interface DemoPerson {
  /** The sign-in address. */
  readonly email: string
  /** The account's name, and the staff member's display name. */
  readonly name: string
  /** What the person is, in the club's own words, for the printed list. */
  readonly role: string
  /** The default role they are assigned, or null for the organisation's owner. */
  readonly defaultRole: 'staff' | 'manager' | null
}

export const DEMO_PEOPLE: readonly DemoPerson[] = [
  {
    email: 'owner@club-biad.test',
    name: 'Мартин (собственик)',
    role: 'Собственик',
    defaultRole: null,
  },
  { email: 'manager@club-biad.test', name: 'Весела', role: 'Мениджър', defaultRole: 'manager' },
  { email: 'host@club-biad.test', name: 'Ния', role: 'Хостеса', defaultRole: 'staff' },
  { email: 'waiter1@club-biad.test', name: 'Никола', role: 'Сервитьор', defaultRole: 'staff' },
  { email: 'waiter2@club-biad.test', name: 'Борис', role: 'Сервитьор', defaultRole: 'staff' },
  { email: 'bar@club-biad.test', name: 'Бар 1', role: 'Бар', defaultRole: 'staff' },
]

// --- the scenario's floor ------------------------------------------------------------------------

const SCENARIOS_DIR = fileURLToPath(
  new URL('../../../../packages/connectors/sim-pos/scenarios/', import.meta.url),
)

/**
 * The parts of the scenario file this module reads: its bars and its tables with the hall and the
 * bar of each. `demo-bar.ts`'s own schema drops those three keys (Demo Bar's floor needs neither),
 * so the floor reading is described here instead of widening that one.
 */
const FloorPart = z.object({
  name: z.string(),
  bars: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  tables: z.array(
    z.object({
      id: z.string().min(1),
      number: z.string().min(1),
      hall: z.string().min(1),
      bar: z.string().min(1).nullable(),
      payment: z.boolean(),
    }),
  ),
})

/** The simulator's floor, as the file holds it. */
export type DemoClubScenarioFloor = z.output<typeof FloorPart>

/** Reads the scenario file's floor from disk. */
export function loadDemoClubFloor(name: string = DEMO_SCENARIO): DemoClubScenarioFloor {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error(`"${name}" is not a scenario name`)
  return FloorPart.parse(JSON.parse(readFileSync(`${SCENARIOS_DIR}${name}.json`, 'utf8')))
}

/**
 * The floor reading `applyFloor` writes: the POS's bars and tables, as the worker's `floor_read`
 * job would hand them over. The payment tables are not marked here — the POS has no such mark
 * (`paymentTable: null`) and the venue's floor source names them by their POS names (D122 §8),
 * which is what the seed sets.
 */
export function clubFloorReading(floor: DemoClubScenarioFloor): Floor {
  return {
    bars: floor.bars.map((bar) => ({ ref: posRef(bar.id), name: bar.name })),
    tables: floor.tables.map((table) => ({
      ref: posRef(table.id),
      name: table.number,
      area: table.hall,
      bar: table.bar === null ? null : posRef(table.bar),
      paymentTable: null,
    })),
  }
}

/**
 * What the simulated connector declares for this scenario (D122 §3). Written out rather than
 * computed: the web app may not import a connector package, so `capabilitiesOf(switches)` is out of
 * reach here and `demo-club.test.ts` instead checks every key of this object against the scenario
 * file's own switches. The worker overwrites it with the connector's own declaration on its first
 * floor read, and the test keeps the two the same.
 *
 * `recordTipOnClose` is false although the scenario sets `tipAsLine`: the worker builds the
 * simulated connector without a tip article, so it declares no tip on close.
 */
export const DEMO_CAPABILITIES: ServiceCapabilities = Object.freeze({
  ...NO_SERVICE_CAPABILITIES,
  tableBar: true,
  moveLinesToTable: true,
  closeWithPaymentType: true,
  firstItemsOpenBill: true,
  notesReachTicket: true,
  whoEnteredLine: true,
  // Off, like every other simulated scenario: a POS that reads our own reference back onto the
  // line makes that reference a backend value, and the guest answer carries it as the sent
  // order's id, so every read of the table's state is refused. The report says more.
  ownLineReference: false,
  idempotentAdd: true,
  addToStaffOpenedBill: true,
  readClosedBills: true,
  receiptNumberOnClose: true,
})

// --- what Restro's own layers add to the POS's menu ----------------------------------------------

/**
 * The allergens of the club's drinks, by the POS's article id (EU codes, `allergens.ts`). Only
 * where they really apply: wine and sparkling wine carry sulphites, beer carries gluten, and the
 * one layered shot with cream liqueur carries milk. Spirits, mixers and soft drinks carry none —
 * an empty list is a statement, so nothing is listed for them.
 */
export const DEMO_ALLERGENS: ReadonlyMap<string, readonly string[]> = new Map([
  ['6105', ['sulphites']], // Moët & Chandon Brut
  ['6106', ['sulphites']], // Prosecco
  ['6303', ['milk']], // B-52
  ['6501', ['gluten']], // Stella Artois
  ['6502', ['gluten']], // Corona
  ['6503', ['gluten']], // Heineken 0.0
  ['6504', ['gluten']], // Guinness
])

/**
 * A line of Restro's own description on the items where one helps a guest choose, by article id
 * (the `description` field is the builder's: the POS has none).
 */
export const DEMO_DESCRIPTIONS: ReadonlyMap<string, LocalizedText> = new Map<string, LocalizedText>(
  [
    [
      '6105',
      {
        bg_BG: 'Бутилка шампанско, поднесена с лед и чаши.',
        en_US: 'A bottle on ice, with glasses.',
      },
    ],
    [
      '6201',
      {
        bg_BG: 'Бял ром, лайм, мента и малко захар.',
        en_US: 'White rum, lime, mint and a little sugar.',
      },
    ],
    ['6203', { bg_BG: 'Водка, кафе и кафеен ликьор.', en_US: 'Vodka, coffee and coffee liqueur.' }],
    ['6206', { bg_BG: 'Изберете джина; тоник и лайм.', en_US: 'Choose the gin; tonic and lime.' }],
    ['6503', { bg_BG: 'Безалкохолна бира.', en_US: 'Alcohol-free beer.' }],
    ['6606', { bg_BG: 'Изцеден на момента.', en_US: 'Squeezed to order.' }],
  ],
)

/**
 * The POS article the phones never show: the cover charge the door takes in cash. The POS sells it,
 * so it is in the catalogue and on the menu; Restro hides it with its own `visible: false`, which
 * is a layer making the menu more cautious than the POS and nothing else (rule 5).
 */
export const DEMO_HIDDEN_ARTICLE = '6701'

/**
 * The article the scenario marks sold out at the POS, so the walk sees a line marked Sold out that
 * no Restro layer put there. Named here for the report and the test, never written: the POS's own
 * `for_sale` carries it (`demo-bar.ts`).
 */
export const DEMO_SOLD_OUT_ARTICLE = '6504'

// --- the night -----------------------------------------------------------------------------------

/**
 * The tables the night opens, as spot names. Eight of the club's own numbers across the three
 * bars, not all 76: a Tonight screen with every table open says nothing about a busy night, and
 * "Open all" is one tap away.
 */
export const DEMO_OPEN_TABLES = ['9', '22', '45', '61', '3', '17', '70', '84'] as const

/** One open POS bill of the night: the table, what is on it and how much of it is paid. */
export interface DemoBill {
  /** The spot's name, which is the Table's number. */
  readonly table: string
  /** How long ago the bill was opened, in minutes. */
  readonly minutesAgo: number
  /**
   * What the POS says is already paid, in minor units; 0 on a bill nobody has paid anything on.
   * A part-paid bill is the POS's own statement, which is the only thing a reading may carry.
   */
  readonly paidMinor: number
  /** The POS's articles on it, the quantity, and who entered each row. */
  readonly rows: readonly {
    readonly article: string
    readonly quantity: number
    /** A waiter at the POS, or a round that came through Restro from a phone. */
    readonly by: 'staff' | 'restro'
  }[]
}

/**
 * The three bills the scenario has open at the simulator, described again here so the seed can
 * write a reading of them without talking to the POS: Tonight then shows real bills before the
 * worker has ever run. The worker's first real read of these tables replaces the reading — a
 * reading is one row per table, and the newer one wins — so nothing here outlives the first sync.
 *
 * Table 9 is the part-paid one (the POS says a little under half of it is settled) and table 45
 * carries a round Restro sent from a phone beside the waiter's own rows.
 */
export const DEMO_BILLS: readonly DemoBill[] = [
  {
    table: '9',
    minutesAgo: 70,
    paidMinor: 5000,
    rows: [
      { article: '6102', quantity: 1, by: 'staff' },
      { article: '6605', quantity: 4, by: 'staff' },
      { article: '6601', quantity: 2, by: 'staff' },
    ],
  },
  {
    table: '22',
    minutesAgo: 35,
    paidMinor: 0,
    rows: [
      { article: '6201', quantity: 2, by: 'staff' },
      { article: '6202', quantity: 2, by: 'staff' },
      { article: '6604', quantity: 1, by: 'staff' },
    ],
  },
  {
    table: '45',
    minutesAgo: 15,
    paidMinor: 0,
    rows: [
      { article: '6501', quantity: 3, by: 'staff' },
      { article: '6301', quantity: 4, by: 'restro' },
    ],
  },
]

/** A round a phone added and nobody has sent yet: the table, and what is in the bag. */
export interface DemoRound {
  readonly table: string
  readonly lines: readonly {
    readonly article: string
    readonly qty: number
    /** The option group and the option, by the scenario's own ids; none for a plain line. */
    readonly option?: readonly [string, string]
    readonly note?: string
  }[]
}

/**
 * The unsent rounds: two tables with something in the bag, so Tonight shows a table with guests
 * ordering and the guest page opens on an order in progress. Written as guest commands with the
 * table's code hash, the way a phone's would be.
 */
export const DEMO_ROUNDS: readonly DemoRound[] = [
  {
    table: '22',
    lines: [
      { article: '6206', qty: 2, option: ['gin', 'hendricks'] },
      { article: '6604', qty: 1 },
    ],
  },
  {
    table: '61',
    lines: [
      { article: '6301', qty: 6, note: 'С лимон, моля' },
      { article: '6605', qty: 2 },
    ],
  },
]

/** The waiter calls waiting on the night's floor: the table and the kind of request. */
export const DEMO_CALLS: readonly { readonly table: string; readonly kind: string }[] = [
  { table: '45', kind: 'waiter' },
  { table: '17', kind: 'bill' },
]

/** One party of the night's book. */
export interface DemoParty {
  /** The guest's name, as the book shows it. */
  readonly name: string
  /** Their phone, which makes them one guest record (D140). */
  readonly phone: string
  readonly partySize: number
  /**
   * The hour they are booked for, as minutes from the moment the seed runs: negative for an hour
   * already past. Relative to the clock rather than to the club's 22:00, because Martin may run
   * the seed at any hour and the screens still have to show a night in progress.
   */
  readonly minutesFromNow: number
  /** The spots held, by name. */
  readonly spots: readonly string[]
  /** What the hostess did with it: the state the walk should find it in. */
  readonly state: 'booked' | 'late' | 'seated' | 'cancelled'
  readonly note?: string
  /** Kept on the venue's regulars list (D140). */
  readonly regular?: boolean
}

/**
 * The night's book: a party in each state the screens can show. "Late" is not a status of its own
 * (D135 has seven): it is a booking whose hour has passed and which is still Reserved, so it is
 * written as a booking behind the clock and then left alone.
 *
 * Every party carries a phone, because the venue's settings ask for one (D135's default) and a
 * phone is what makes a guest record. The numbers are made up, in a range no Bulgarian operator
 * hands out.
 */
export const DEMO_PARTIES: readonly DemoParty[] = [
  {
    name: 'Иван Петров',
    phone: '+359890000101',
    partySize: 6,
    minutesFromNow: 150,
    spots: ['2'],
    state: 'booked',
    note: 'Рожден ден — торта в 01:30',
    regular: true,
  },
  {
    name: 'Мария Георгиева',
    phone: '+359890000102',
    partySize: 4,
    minutesFromNow: 240,
    spots: ['70'],
    state: 'booked',
  },
  {
    name: 'Стефан Колев',
    phone: '+359890000103',
    partySize: 8,
    minutesFromNow: -45,
    spots: ['1'],
    state: 'late',
    note: 'Обадиха се, че закъсняват',
  },
  {
    name: 'Десислава Илиева',
    phone: '+359890000104',
    partySize: 5,
    minutesFromNow: -60,
    spots: ['9'],
    state: 'seated',
  },
  {
    name: 'Петър Димов',
    phone: '+359890000105',
    partySize: 10,
    minutesFromNow: 90,
    spots: ['3'],
    state: 'cancelled',
  },
]

/** The parties waiting at the door (D137: a walk-in with the Waiting status and a queue key). */
export const DEMO_WAITING: readonly {
  readonly name: string
  readonly phone: string
  readonly partySize: number
}[] = [
  { name: 'Компания на бара', phone: '+359890000106', partySize: 4 },
  { name: 'Двама на вратата', phone: '+359890000107', partySize: 2 },
]

/**
 * The spots blocked for the night and why: the DJ's own booth, out of the book (D137: a block is a
 * reservation of its own kind). The reason is a code, never free text.
 */
export const DEMO_BLOCK = {
  spots: ['16'],
  reason: 'private_event',
  note: 'DJ booth — не се дава',
} as const

// --- the plan -------------------------------------------------------------------------------------

/** The ported plan's name, as the Plan view titles it. */
export const DEMO_PLAN_NAME = 'Club Biad — основна зала'

/** The club's floor: the spots and kinds of the ported paper plan. */
export function demoClubPlan(): {
  readonly kinds: typeof CLUB_BIAD_KINDS
  readonly spots: readonly ClubBiadSpot[]
  readonly areas: readonly string[]
} {
  return clubBiadFloor()
}
