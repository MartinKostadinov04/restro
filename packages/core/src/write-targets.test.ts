// The write-target guard (D122 §9; spec #64 Implementation Decisions 3; ticket #66). Two write
// paths share the write side of the db package (`db-write-only-from-core-write-paths`): `apply()`
// in core/apply writes the menu side, `applyService()` in core/service the service side. This
// static check pins which tables each one may name, so neither drifts into the other's tables.
// Only tightens (D67): a new target for core/service is added to SERVICE_WRITE_TARGETS by the
// ticket that writes it, and never a menu-side table.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const srcRoot = fileURLToPath(new URL('.', import.meta.url))
const applyRoot = join(srcRoot, 'apply')
const serviceRoot = join(srcRoot, 'service')

/**
 * The service side: the Drizzle exports and Postgres names of the tables only `applyService`
 * writes (migrations 0028 and 0030). `tables.code_generation` belongs here too (see below).
 */
const SERVICE_TABLES: Readonly<Record<string, string>> = {
  sittings: 'sittings',
  tableOrders: 'table_orders',
  sentOrders: 'sent_orders',
  sentOrderNotes: 'sent_order_notes',
  locks: 'locks',
  billReadings: 'bill_readings',
  logEntries: 'log_entries',
  waiterCalls: 'waiter_calls',
  alerts: 'alerts',
  pauses: 'pauses',
  serviceDays: 'service_days',
  staffMembers: 'staff_members',
  venueRoles: 'venue_roles',
  staffAssignments: 'staff_assignments',
  sharedDevices: 'shared_devices',
  pushSubscriptions: 'push_subscriptions',
  operators: 'operators',
  // Paying (D127, #104): no code writes them yet; the tickets that do add them to
  // SERVICE_WRITE_TARGETS.
  payments: 'payments',
  paymentLines: 'payment_lines',
  paymentSteps: 'payment_steps',
  paymentAccounts: 'payment_accounts',
  providerNotices: 'provider_notices',
}

/** The paying tables: written by core/service and nowhere else in the repo (#104). */
const PAYING_TABLES = [
  'payments',
  'paymentLines',
  'paymentSteps',
  'paymentAccounts',
  'providerNotices',
] as const

const repoRoot = join(srcRoot, '..', '..', '..')

/**
 * What core/service may write, by Drizzle export (only ever names from SERVICE_TABLES, plus
 * `venueTables` for `code_generation` alone). #69's machinery writes the table's order (its
 * version and ring of action ids), the lease rows and the Log; #71's floor commands write the
 * pause of a vanished table; each later command adds the tables it writes (#70: `venueTables`, for
 * the re-issue's code generation; #72: the staff side, i.e. people, roles, assignments and shared
 * devices, never `operators`; #73: the sittings).
 */
const SERVICE_WRITE_TARGETS: readonly string[] = [
  'sittings',
  'tableOrders',
  'locks',
  'logEntries',
  'pauses',
  'venueTables',
  'staffMembers',
  'venueRoles',
  'staffAssignments',
  'sharedDevices',
]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return ['node_modules', '.next', 'dist', 'e2e', 'tests'].includes(entry.name)
        ? []
        : sourceFiles(path)
    }
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** The table each Drizzle write in the text targets: `.insert(x)`, `.update(x)`, `.delete(x)`. */
function drizzleWriteTargets(text: string): string[] {
  return [...text.matchAll(/\.(?:insert|update|delete)\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map(
    (match) => match[1] ?? '',
  )
}

/** The tables raw SQL in the text writes: `insert into restro.x`, `update restro.x`, `delete from restro.x`. */
function sqlWriteTargets(text: string): string[] {
  return [
    ...text.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+"?restro"?\."?([a-z_]+)"?/gi),
  ].map((match) => (match[1] ?? '').toLowerCase())
}

/** Every name the text imports from the db package's read or write side. */
function dbImports(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@restro\/db(?:\/write)?['"]/g,
  )) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim()
      if (name) names.push(name)
    }
  }
  return names
}

const rel = (file: string) => relative(srcRoot, file).replaceAll('\\', '/')

describe('the write-target guard', () => {
  const applyFiles = sourceFiles(applyRoot)
  const serviceFiles = sourceFiles(serviceRoot)

  it('finds the menu write path (the guard is looking at real files)', () => {
    expect(applyFiles.length).toBeGreaterThan(10)
    expect(
      applyFiles.some((file) => drizzleWriteTargets(readFileSync(file, 'utf8')).length > 0),
    ).toBe(true)
  })

  it('core/apply imports no service table from the db package', () => {
    const found = applyFiles.flatMap((file) =>
      dbImports(readFileSync(file, 'utf8'))
        .filter((name) => Object.hasOwn(SERVICE_TABLES, name))
        .map((name) => `${rel(file)}: ${name}`),
    )
    expect(found).toEqual([])
  })

  it('core/apply writes no service table, by Drizzle or by SQL', () => {
    const serviceNames = new Set(Object.values(SERVICE_TABLES))
    const found = applyFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [
        ...drizzleWriteTargets(text).filter((name) => Object.hasOwn(SERVICE_TABLES, name)),
        ...sqlWriteTargets(text).filter((name) => serviceNames.has(name)),
      ].map((name) => `${rel(file)}: ${name}`)
    })
    expect(found).toEqual([])
  })

  it("core/apply never names a table's code generation (applyService re-issues codes)", () => {
    const found = applyFiles
      .filter((file) => /codeGeneration|code_generation/.test(readFileSync(file, 'utf8')))
      .map(rel)
    expect(found).toEqual([])
  })

  it('core/service writes only its declared targets, all on the service side', () => {
    for (const target of SERVICE_WRITE_TARGETS) {
      expect(Object.hasOwn(SERVICE_TABLES, target) || target === 'venueTables', target).toBe(true)
    }
    const allowed = new Set(SERVICE_WRITE_TARGETS)
    const allowedSql = new Set(
      SERVICE_WRITE_TARGETS.map(
        (name) => SERVICE_TABLES[name] ?? (name === 'venueTables' ? 'tables' : name),
      ),
    )
    const found = serviceFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [
        ...drizzleWriteTargets(text).filter((name) => !allowed.has(name)),
        ...sqlWriteTargets(text).filter((name) => !allowedSql.has(name)),
      ].map((name) => `${rel(file)}: ${name}`)
    })
    expect(found).toEqual([])
  })

  it('nothing outside core/service writes a paying table, anywhere in the repo', () => {
    const drizzleNames = new Set<string>(PAYING_TABLES)
    const sqlNames = new Set(PAYING_TABLES.map((name) => SERVICE_TABLES[name]))
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)))
    expect(files.length).toBeGreaterThan(100)
    const outside = (dir: string) => (file: string) => !file.startsWith(dir + sep)
    const found = files
      .filter(outside(serviceRoot))
      .filter(outside(join(repoRoot, 'packages', 'db')))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8')
        return [
          ...drizzleWriteTargets(text).filter((name) => drizzleNames.has(name)),
          ...sqlWriteTargets(text).filter((name) => sqlNames.has(name)),
        ].map((name) => `${relative(repoRoot, file).replaceAll(sep, '/')}: ${name}`)
      })
    expect(found).toEqual([])
  })

  it('core/service touches no column of `tables` but code_generation', () => {
    const found = serviceFiles.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      return [...text.matchAll(/\.update\(\s*venueTables\s*\)\s*\.set\(\s*\{([^}]*)\}/g)]
        .flatMap((match) =>
          (match[1] ?? '')
            .split(',')
            .map((part) => part.split(':')[0]?.trim() ?? '')
            .filter((key) => key !== '' && key !== 'codeGeneration' && key !== 'updatedAt'),
        )
        .map((key) => `${rel(file)}: tables.${key}`)
    })
    expect(found).toEqual([])
  })

  it('catches a write it is meant to catch (self-test on text)', () => {
    expect(drizzleWriteTargets('await tx.insert(sentOrders).values({})')).toEqual(['sentOrders'])
    expect(sqlWriteTargets('insert into restro.log_entries (seq) values (1)')).toEqual([
      'log_entries',
    ])
    expect(sqlWriteTargets('UPDATE "restro"."sittings" SET x = 1')).toEqual(['sittings'])
    expect(dbImports("import { type Venue, sittings as s, venues } from '@restro/db'")).toEqual([
      'Venue',
      'sittings',
      'venues',
    ])
  })
})
