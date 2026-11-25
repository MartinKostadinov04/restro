// Scenario files (#71; #51 design §6): a named JSON file under `scenarios/` that holds a starting
// state for the simulated POS (its floor, catalogue, logins and open bills), the switches it runs
// on, the faults it starts with, and, for the dev seed, the menu the venue's owner would have made
// from that catalogue. `quiet-night`, `busy-friday` and `payment-trouble` build on `demo-bar`.
//
// The dev seed (apps/web) cannot import this package (the web never imports a connector), so it
// reads the same JSON files from disk and checks the part it needs (`menu`) itself. The files are
// plain data: nothing in them is a secret (every simulated login uses `SIM_PASSWORD`).

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { runWaiterOp } from './control/ops'
import { type Clock, ManualClock } from './engine/clock'
import { SimEngine } from './engine/engine'
import type { FaultRule, SimFault } from './engine/faults'
import { DEFAULT_SCENARIO, SIM_PASSWORD, type SimScenario } from './engine/scenario'
import { CAUTIOUS, PROFILE_NAMES, type SimSwitches, switchesOf } from './switches'

/** The folder the scenario files live in. */
export const SCENARIOS_DIR = fileURLToPath(new URL('../scenarios/', import.meta.url))

/** The scenario the standalone server and the dev seed start from. */
export const DEFAULT_SCENARIO_NAME = 'quiet-night'

const NAME = /^[a-z][a-z0-9-]{0,40}$/
const Id = z.string().min(1).max(200)

// --- the pieces ---------------------------------------------------------------------------------

const LocalizedTextSchema = z.strictObject({
  bg_BG: z.string().min(1).max(200),
  en_US: z.string().min(1).max(200).optional(),
})

const OptionSchema = z.strictObject({
  id: Id,
  name: LocalizedTextSchema,
  priceDeltaMinor: z.int().nonnegative(),
})

const OptionGroupSchema = z.strictObject({
  id: Id,
  name: LocalizedTextSchema,
  min: z.int().nonnegative(),
  max: z.int().positive(),
  options: z.array(OptionSchema).min(1),
})

/** One menu item: the article it sells, its names, and the marks the demo shows. */
const MenuItemSchema = z.strictObject({
  article: Id,
  name: LocalizedTextSchema,
  /** Sold out at the POS: the item is written not for sale. */
  soldOut: z.boolean().optional(),
  /** Pay-first items are marked for part 2; no field carries the mark yet. */
  payment: z.enum(['on_the_bill', 'pay_first']).optional(),
  /** Required options: a group with a minimum above zero. */
  optionGroups: z.array(OptionGroupSchema).optional(),
})

const MenuSectionSchema = z.strictObject({
  id: Id,
  title: LocalizedTextSchema,
  items: z.array(MenuItemSchema),
})

/** The menu the dev seed writes through `apply()` with POS provenance. */
export const ScenarioMenuSchema = z.strictObject({ sections: z.array(MenuSectionSchema).min(1) })
export type ScenarioMenu = z.output<typeof ScenarioMenuSchema>

const FORCED_REFUSALS = [
  'bill_closed',
  'bill_locked',
  'no_rights',
  'busy',
  'article_unknown',
  'sold_out',
  'credentials',
] as const

const FaultSchema: z.ZodType<SimFault> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hang') }),
  z.strictObject({ kind: z.literal('landsThenHangs') }),
  z.strictObject({ kind: z.literal('landsPartly'), rows: z.int().positive().optional() }),
  z.strictObject({ kind: z.literal('landsLate') }),
  z.strictObject({ kind: z.literal('fail') }),
  z.strictObject({ kind: z.literal('dropItem') }),
  z.strictObject({
    kind: z.literal('refuse'),
    code: z.enum(FORCED_REFUSALS),
    line: z.int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal('slow'),
    ms: z.union([
      z.int().nonnegative(),
      z.strictObject({ min: z.int().nonnegative(), max: z.int().nonnegative() }),
    ]),
  }),
  z.strictObject({ kind: z.literal('loginOffline') }),
  z.strictObject({ kind: z.literal('waiterRoundSlipsIn'), identical: z.boolean() }),
  z.strictObject({ kind: z.literal('waiterVoidsLine') }),
  z.strictObject({ kind: z.literal('waiterClosesBill'), bill: Id.optional() }),
  z.strictObject({ kind: z.literal('noReceipt') }),
]) as z.ZodType<SimFault>

const RULE_TARGETS = [
  'ping',
  'listTables',
  'listBars',
  'listBills',
  'listOpenBills',
  'listRows',
  'addRows',
  'moveRows',
  'voidRow',
  'closeBill',
  'sale',
  'read',
  'write',
  'any',
] as const

const RuleSchema = z.strictObject({
  on: z.enum(RULE_TARGETS),
  from: z.int().positive().optional(),
  times: z.int().positive().optional(),
  login: Id.optional(),
  fault: FaultSchema,
})

const ChaosSchema = z.strictObject({
  seed: z.int(),
  rate: z.number().min(0).max(1),
  faults: z.array(FaultSchema).min(1),
})

const SetupSchema = z.strictObject({
  op: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
})

const SimScenarioPartsSchema = {
  bars: z.array(z.strictObject({ id: Id, name: z.string().min(1) })),
  tables: z.array(
    z.strictObject({
      id: Id,
      number: z.string().min(1),
      hall: z.string().min(1),
      bar: Id,
      payment: z.boolean(),
    }),
  ),
  articles: z.array(
    z.strictObject({
      id: Id,
      name: z.string().min(1),
      priceMinor: z.int().nonnegative(),
      tip: z.boolean(),
    }),
  ),
  paymentTypes: z.array(
    z.strictObject({ id: Id, name: z.string().min(1), kind: z.enum(['cash', 'card']) }),
  ),
  logins: z.array(
    z.strictObject({
      id: Id,
      password: z.string().min(1).optional(),
      kind: z.enum(['api', 'waiter']),
      name: z.string().min(1),
      bars: z.array(Id),
    }),
  ),
  bills: z.array(
    z.strictObject({
      table: Id,
      by: Id,
      minutesAgo: z.int().nonnegative(),
      rows: z.array(z.strictObject({ article: Id, quantity: z.string().min(1) })),
    }),
  ),
}

// --- the file -----------------------------------------------------------------------------------

/** A scenario file as written: every part but the name is optional when it extends another. */
export const ScenarioFileSchema = z.strictObject({
  name: z.string().regex(NAME),
  extends: z.string().regex(NAME).optional(),
  description: z.string().min(1).max(1000),
  profile: z.enum(PROFILE_NAMES).optional(),
  /** Switch values over the profile's. Keys and types are checked against the switches. */
  switches: z.record(z.string(), z.unknown()).optional(),
  seed: z.int().optional(),
  pageSize: z.int().positive().max(1000).optional(),
  menu: ScenarioMenuSchema.optional(),
  faults: z.array(RuleSchema).optional(),
  chaos: ChaosSchema.optional(),
  /** Waiter operations run once the scenario is built (a locked bill, a sold-out article). */
  setup: z.array(SetupSchema).optional(),
  bars: SimScenarioPartsSchema.bars.optional(),
  tables: SimScenarioPartsSchema.tables.optional(),
  articles: SimScenarioPartsSchema.articles.optional(),
  paymentTypes: SimScenarioPartsSchema.paymentTypes.optional(),
  logins: SimScenarioPartsSchema.logins.optional(),
  bills: SimScenarioPartsSchema.bills.optional(),
})
export type ScenarioFile = z.output<typeof ScenarioFileSchema>

/** A scenario file with its base applied: everything the engine needs. */
export interface ResolvedScenario {
  readonly name: string
  readonly description: string
  readonly profile: (typeof PROFILE_NAMES)[number]
  readonly switches: SimSwitches
  readonly seed: number
  readonly pageSize: number
  readonly scenario: SimScenario
  readonly menu: ScenarioMenu | null
  readonly faults: readonly FaultRule[]
  readonly chaos: z.output<typeof ChaosSchema> | null
  readonly setup: readonly z.output<typeof SetupSchema>[]
}

/** Thrown for a scenario file that is missing, malformed or inconsistent. */
export class ScenarioFileError extends Error {
  override name = 'ScenarioFileError'
}

/** The names of the scenario files on disk, sorted. */
export function listScenarioNames(): string[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
}

/** Reads and checks one scenario file by name. */
export function readScenarioFile(name: string): ScenarioFile {
  if (!NAME.test(name)) throw new ScenarioFileError(`"${name}" is not a scenario name`)
  let text: string
  try {
    text = readFileSync(new URL(`../scenarios/${name}.json`, import.meta.url), 'utf8')
  } catch {
    throw new ScenarioFileError(
      `no scenario called "${name}" (known: ${listScenarioNames().join(', ')})`,
    )
  }
  const parsed = ScenarioFileSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new ScenarioFileError(`scenario ${name}: ${z.prettifyError(parsed.error)}`)
  }
  if (parsed.data.name !== name) {
    throw new ScenarioFileError(`scenario file ${name}.json is named "${parsed.data.name}"`)
  }
  return parsed.data
}

/** The switches a file asks for, over a profile; refuses an unknown key or a value of the wrong type. */
export function scenarioSwitches(
  profile: (typeof PROFILE_NAMES)[number],
  overrides: Readonly<Record<string, unknown>>,
  name: string,
): SimSwitches {
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(CAUTIOUS, key)) throw new ScenarioFileError(`${name}: no switch "${key}"`)
    const known = CAUTIOUS[key as keyof SimSwitches]
    if (typeof value !== typeof known) {
      throw new ScenarioFileError(`${name}: switch "${key}" takes a ${typeof known}`)
    }
  }
  try {
    return switchesOf(profile, overrides as Partial<SimSwitches>)
  } catch (error) {
    throw new ScenarioFileError(
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Reads a scenario by name and applies its base (one level: a base does not extend). */
export function loadScenarioFile(name: string): ResolvedScenario {
  const file = readScenarioFile(name)
  const base = file.extends === undefined ? null : readScenarioFile(file.extends)
  if (base?.extends !== undefined) {
    throw new ScenarioFileError(`${name}: ${base.name} extends ${base.extends}; one level only`)
  }
  const pick = <K extends keyof ScenarioFile>(key: K): ScenarioFile[K] | undefined =>
    file[key] ?? base?.[key]
  const profile = file.profile ?? base?.profile ?? 'cautious'
  const switches = scenarioSwitches(profile, { ...base?.switches, ...file.switches }, name)

  const fallback = base === null && file.bars === undefined ? DEFAULT_SCENARIO : null
  const scenario: SimScenario = {
    bars: pick('bars') ?? fallback?.bars ?? [],
    tables: pick('tables') ?? fallback?.tables ?? [],
    articles: pick('articles') ?? fallback?.articles ?? [],
    paymentTypes: pick('paymentTypes') ?? fallback?.paymentTypes ?? [],
    logins: (pick('logins') ?? fallback?.logins ?? []).map((login) => ({
      ...login,
      password: login.password ?? SIM_PASSWORD,
    })),
    bills: pick('bills') ?? fallback?.bills ?? [],
  }
  return {
    name,
    description: file.description,
    profile,
    switches,
    seed: pick('seed') ?? 1,
    pageSize: pick('pageSize') ?? 20,
    scenario,
    menu: pick('menu') ?? null,
    faults: (file.faults ?? base?.faults ?? []) as FaultRule[],
    chaos: pick('chaos') ?? null,
    setup: file.setup ?? base?.setup ?? [],
  }
}

export interface BuildEngineOptions {
  readonly clock?: Clock
  /** Where chaos prints its seed. Default: the console. */
  readonly print?: (line: string) => void
}

/** Builds an engine from a resolved scenario: state, faults, chaos and the setup operations. */
export function buildEngine(
  resolved: ResolvedScenario,
  options: BuildEngineOptions = {},
): SimEngine {
  const engine = new SimEngine({
    switches: resolved.switches,
    scenario: resolved.scenario,
    clock: options.clock ?? new ManualClock(),
    seed: resolved.seed,
    pageSize: resolved.pageSize,
  })
  for (const op of resolved.setup) runWaiterOp(engine, op.op, op.args)
  for (const rule of resolved.faults) engine.faults.add(rule)
  if (resolved.chaos !== null) {
    engine.faults.chaos({
      ...resolved.chaos,
      ...(options.print === undefined ? {} : { print: options.print }),
    })
  }
  return engine
}

/**
 * The login Restro's connector reads the whole floor with: the API login that sees every bar. A
 * simulated POS with one login per bar (`oneLoginPerBar`, Q19) has none: each of its logins sees
 * one bar, and one connector per login is not built yet, so a scenario that uses the floor reading
 * turns the switch off.
 */
export function readingLogin(resolved: ResolvedScenario): { user: string; password: string } {
  const login = resolved.scenario.logins.find(
    (candidate) =>
      candidate.kind === 'api' &&
      (resolved.switches.oneLoginPerBar ? candidate.bars.length > 0 : candidate.bars.length === 0),
  )
  if (login === undefined || resolved.switches.oneLoginPerBar) {
    throw new ScenarioFileError(
      `${resolved.name}: no login sees every bar (turn oneLoginPerBar off to read the whole floor)`,
    )
  }
  return { user: login.id, password: login.password ?? SIM_PASSWORD }
}
