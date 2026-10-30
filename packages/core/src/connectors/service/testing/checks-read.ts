// The read checks (#51 design §5, "Readings"; spec #64 §1). Each check resets the POS, runs one
// behaviour and returns the problems it found. Each runs only where its capability is declared,
// and otherwise checks the declared fallback (the field is null, the operation is absent).

import { isDeepStrictEqual } from 'node:util'
import { ServiceCapabilitiesSchema } from '../capabilities'
import type { ServiceContext } from '../connector'
import {
  AvailabilitySchema,
  FloorSchema,
  ProbeResultSchema,
  type Reading,
  readingSchema,
  TableBillsSchema,
} from '../schemas'
import { posIdLeaks } from './guard'
import { KIT_MARGIN_MS, KIT_TIMINGS, type ReadHarness } from './harness'

export type Check<H> = (harness: H) => Promise<string[]>

export function kitContext(harness: { readonly now?: () => Date }): ServiceContext {
  return { now: harness.now ?? (() => new Date()), timings: KIT_TIMINGS }
}

export async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now()
  const value = await run()
  return { value, ms: performance.now() - started }
}

export function writesIn(harness: { readonly pos: ReadHarness['pos'] }): string[] {
  return harness.pos
    .calls()
    .filter((call) => call.write)
    .map((call) => call.name)
}

function schemaProblems(
  label: string,
  schema: { safeParse(v: unknown): { success: boolean; error?: unknown } },
  value: unknown,
): string[] {
  const parsed = schema.safeParse(value)
  return parsed.success ? [] : [`${label} does not match its schema: ${String(parsed.error)}`]
}

const FloorReadingSchema = readingSchema(FloorSchema)
const TableReadingSchema = readingSchema(TableBillsSchema)
const AvailabilityReadingSchema = readingSchema(AvailabilitySchema)

/** The declaration is complete, and the optional read exists exactly where it is declared. */
export const capabilitiesCheck: Check<ReadHarness> = async ({ connector }) => {
  const problems = schemaProblems('capabilities', ServiceCapabilitiesSchema, connector.capabilities)
  const offers = typeof connector.readAvailability === 'function'
  if (offers !== connector.capabilities.itemAvailability) {
    problems.push(
      offers
        ? 'readAvailability is offered but itemAvailability is not declared'
        : 'itemAvailability is declared but readAvailability is missing',
    )
  }
  const readsClosed = typeof connector.readClosedBill === 'function'
  if (readsClosed !== connector.capabilities.readClosedBills) {
    problems.push(
      readsClosed
        ? 'readClosedBill is offered but readClosedBills is not declared'
        : 'readClosedBills is declared but readClosedBill is missing',
    )
  }
  return problems
}

/** On a healthy POS the probe answers, and it writes nothing (rule 7, D120's cheap read). */
export const probeAnswersWithoutWritingCheck: Check<ReadHarness> = async (harness) => {
  await harness.pos.reset()
  const before = await harness.pos.digest?.()
  const result = await harness.connector.probe(kitContext(harness))
  const problems = schemaProblems('the probe result', ProbeResultSchema, result)
  if (result.kind !== 'answered')
    problems.push(`the probe on a healthy POS answered ${result.kind}`)
  if (result.kind === 'answered') {
    if (!harness.connector.capabilities.trainingMode && result.mode !== null) {
      problems.push('the probe reports a mode, but trainingMode is not declared')
    }
  }
  problems.push(...writesIn(harness).map((name) => `the probe wrote to the POS: ${name}`))
  const after = await harness.pos.digest?.()
  if (before !== after) problems.push('the POS state changed during the probe')
  problems.push(...posIdLeaks(result))
  return problems
}

/** A stalled POS: the probe says `unknown` within its budget, never `refused`, and writes nothing. */
export const probeTimeoutCheck: Check<ReadHarness> = async (harness) => {
  await harness.pos.reset()
  harness.faults.stall()
  const { value, ms } = await timed(() => harness.connector.probe(kitContext(harness)))
  const problems = schemaProblems('the probe result', ProbeResultSchema, value)
  if (value.kind !== 'unknown') problems.push(`a stalled probe answered ${value.kind}, not unknown`)
  if (ms > KIT_TIMINGS.probeBudgetMs + KIT_MARGIN_MS) {
    problems.push(
      `a stalled probe took ${Math.round(ms)} ms: it ignores the probe budget it was given`,
    )
  }
  problems.push(...writesIn(harness).map((name) => `the probe wrote to the POS: ${name}`))
  return problems
}

/** Refused credentials: the probe says `refused` with a login or venue scope, and writes nothing. */
export const probeRefusedCheck: Check<ReadHarness> = async (harness) => {
  const refuseLogin = harness.faults.refuseLogin
  if (refuseLogin === undefined) return []
  await harness.pos.reset()
  refuseLogin()
  const result = await harness.connector.probe(kitContext(harness))
  const problems = schemaProblems('the probe result', ProbeResultSchema, result)
  if (result.kind !== 'refused') {
    problems.push(`a refused login probed as ${result.kind}, not refused`)
  } else if (result.refusal.scope !== 'login' && result.refusal.scope !== 'venue') {
    problems.push(
      `a refused login is scoped to the ${result.refusal.scope}, not the login or venue`,
    )
  }
  problems.push(...writesIn(harness).map((name) => `the probe wrote to the POS: ${name}`))
  return problems
}

/** The floor reads complete; no made-up bar where the POS gives none; no POS id outside a PosRef. */
export const floorCheck: Check<ReadHarness> = async (harness) => {
  await harness.pos.reset()
  const reading = await harness.connector.readFloor(kitContext(harness))
  const problems = schemaProblems('the floor reading', FloorReadingSchema, reading)
  if (!reading.complete) return [...problems, `the floor read incomplete: ${reading.reason}`]
  if (!harness.connector.capabilities.tableBar) {
    if (reading.value.bars.length > 0)
      problems.push('bars are listed, but tableBar is not declared')
    if (reading.value.tables.some((table) => table.bar !== null)) {
      problems.push(
        'a table names a bar, but tableBar is not declared (D124 §1: never a made-up bar)',
      )
    }
  }
  problems.push(...writesIn(harness).map((name) => `reading the floor wrote to the POS: ${name}`))
  problems.push(...posIdLeaks(reading))
  return problems
}

/**
 * Reads once on a healthy POS to count the read calls a whole reading takes (k), then once for
 * each n = 1..k with the reads failing from the nth on: each of those must come back incomplete,
 * never as the pages that did answer (rule 6).
 */
async function failedPartProblems<T>(
  harness: ReadHarness,
  label: string,
  schema: { safeParse(v: unknown): { success: boolean; error?: unknown } },
  read: () => Promise<Reading<T>>,
): Promise<string[]> {
  await harness.pos.reset()
  const healthy = await read()
  if (!healthy.complete) return [`the ${label} read incomplete on a healthy POS: ${healthy.reason}`]
  const reads = harness.pos.calls().filter((call) => !call.write).length
  if (reads === 0) return [`reading the ${label} made no POS call the harness saw`]
  const problems: string[] = []
  for (let n = 1; n <= reads; n += 1) {
    await harness.pos.reset()
    harness.faults.failReadsFrom(n)
    const reading = await read()
    problems.push(...schemaProblems(`the ${label} reading`, schema, reading))
    if (reading.complete) {
      problems.push(`a ${label} read whose call ${n} of ${reads} failed came back complete`)
    }
  }
  return problems
}

/** A failed part: the floor reads incomplete, never a shorter list (rule 6). */
export const floorFailedPartCheck: Check<ReadHarness> = (harness) =>
  failedPartProblems(harness, 'floor', FloorReadingSchema, () =>
    harness.connector.readFloor(kitContext(harness)),
  )

/** A stalled POS: the floor reads incomplete within its read timeout. */
export const floorTimeoutCheck: Check<ReadHarness> = async (harness) => {
  await harness.pos.reset()
  harness.faults.stall()
  const { value, ms } = await timed(() => harness.connector.readFloor(kitContext(harness)))
  const problems = schemaProblems('the floor reading', FloorReadingSchema, value)
  if (value.complete) problems.push('a stalled floor read came back complete')
  if (ms > KIT_TIMINGS.readTimeoutMs + KIT_MARGIN_MS) {
    problems.push(`a stalled floor read took ${Math.round(ms)} ms: it ignores the read timeout`)
  }
  return problems
}

/**
 * The table reads complete and exactly as expected: grouped per POS bill, the POS's own totals,
 * signed line amounts, decimal-text quantities; the fields of undeclared capabilities are null.
 */
export const tableCheck: Check<ReadHarness> = async (harness) => {
  const scenario = harness.table
  if ('none' in scenario) return []
  await harness.pos.reset()
  const reading = await harness.connector.readTable(kitContext(harness), scenario.ref)
  const problems = schemaProblems('the table reading', TableReadingSchema, reading)
  if (!reading.complete) return [...problems, `the table read incomplete: ${reading.reason}`]
  const caps = harness.connector.capabilities
  // Oldest first: the platform joins the first open bill it is given (D115, chooseTargetBill).
  const times = reading.value.bills.map((bill) => bill.openedAt)
  for (let i = 1; i < times.length; i += 1) {
    const [earlier, later] = [times[i - 1], times[i]]
    if (earlier != null && later != null && Date.parse(later) < Date.parse(earlier)) {
      problems.push(`the table's bills are not oldest first: ${later} comes after ${earlier}`)
    }
  }
  for (const bill of reading.value.bills) {
    if (!caps.billOpeningTime && bill.openedAt !== null) {
      problems.push('a bill has an opening time, but billOpeningTime is not declared')
    }
    for (const line of bill.lines) {
      if (!caps.whoEnteredLine && line.enteredBy !== null) {
        problems.push('a line says who entered it, but whoEnteredLine is not declared')
      }
      if (!caps.ownLineReference && line.restroRef !== null) {
        problems.push("a line carries Restro's reference, but ownLineReference is not declared")
      }
    }
  }
  if (!isDeepStrictEqual(reading.value, scenario.expected)) {
    problems.push(
      `the table reading differs from the POS's: got ${JSON.stringify(reading.value)}, expected ${JSON.stringify(scenario.expected)}`,
    )
  }
  problems.push(...writesIn(harness).map((name) => `reading a table wrote to the POS: ${name}`))
  problems.push(...posIdLeaks(reading))
  return problems
}

/** A failed part: the table reads incomplete, never fewer bills or lines (rule 6, D122 §6). */
export const tableFailedPartCheck: Check<ReadHarness> = async (harness) => {
  const scenario = harness.table
  if ('none' in scenario) return []
  return failedPartProblems(harness, 'table', TableReadingSchema, () =>
    harness.connector.readTable(kitContext(harness), scenario.ref),
  )
}

/** Where declared, every asked item is answered once; nothing is written. */
export const availabilityCheck: Check<ReadHarness> = async (harness) => {
  const read = harness.connector.readAvailability
  const items = harness.items ?? []
  if (read === undefined || items.length === 0) return []
  await harness.pos.reset()
  const reading = await read.call(harness.connector, kitContext(harness), items)
  const problems = schemaProblems('the availability reading', AvailabilityReadingSchema, reading)
  if (!reading.complete) return [...problems, `availability read incomplete: ${reading.reason}`]
  const asked = items.map((item) => item.pos).sort()
  const answered = reading.value.items.map((entry) => entry.item.pos).sort()
  if (!isDeepStrictEqual(asked, answered)) {
    problems.push(`availability answered ${answered.join(', ')} for ${asked.join(', ')}`)
  }
  problems.push(
    ...writesIn(harness).map((name) => `reading availability wrote to the POS: ${name}`),
  )
  return problems
}
