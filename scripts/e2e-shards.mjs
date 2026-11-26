// Splits the end-to-end specs over the CI shards by how long each spec takes (#621).
//
// `playwright test --shard=n/N` cuts the list of test files into pieces with the same NUMBER of tests
// (Playwright 1.63, runner `filterForShard`; it has no timing data to use). The count is a poor
// guide here: faces-visual.spec.ts alone has 130 tests that CI skips, so one shard drew them all and
// finished in 3 minutes while the others ran for 15 to 17. This script cuts the same alphabetical
// list into N pieces of about the same measured time instead.
//
// Each shard is a run of neighbouring files. Playwright runs a shard's files in name order on one
// worker and the specs share the database (guest-send-events.spec.ts says why that order matters),
// so a shard keeps the order it always had; only the places where the list is cut move.
//
// The times are in scripts/e2e-shard-timings.json: seconds per spec file, the median of the same
// spec's wall time in three green CI runs (first test start to the next file's first test start, so
// a file's hooks count). A spec missing from that file is still planned (it takes the median of the
// others' time, and the list command says so), so the plan is only less even until the numbers are
// refreshed.
//
// Some specs only pass when no earlier spec of their shard has run (they share the shard's
// database). Those pairs are listed under `apart` in the timings file, and the plan never puts both
// in one shard. A spec that passes after a shard's change of neighbours is not proof it is free of
// such a dependency: a new failure of this kind belongs in `apart`, with the reason.
//
// `--test-list` never fails on a name it does not know: a shard whose list matched nothing would run
// zero tests and stay green. So the `check` command, run in CI's static job, compares the files the
// shards are planned to run with the ones Playwright itself collects, and fails on any difference.
//
// Commands (no dependencies, no install step needed):
//   node scripts/e2e-shards.mjs list <shard> <total>   the spec files of one shard, one per line
//                                                      (a Playwright --test-list file); the shard's
//                                                      expected time goes to stderr
//   node scripts/e2e-shards.mjs plan <total>           every shard's files and expected time
//   node scripts/e2e-shards.mjs check <list.json>      fails when the files Playwright collects (from
//                                                      `playwright test --list --reporter json`) are
//                                                      not exactly the files the shards are planned to run
//   node scripts/e2e-shards.mjs timings <report.json>...
//                                                      new timings from Playwright JSON reports of
//                                                      green runs, one per shard (see below)
//
// Refreshing the numbers, when the shards drift apart (each shard's CI log prints its expected time
// next to the real one): download the `playwright-blob-*` artifacts of two or three green runs
// (`gh run download <run> -n playwright-blob-<n>`), put each shard's zip in a folder of its own, and
// make one JSON report of each folder
//   pnpm --filter @restro/web exec playwright merge-reports --reporter json <folder> > shard-1.json
// then pass all the JSON files to `timings` and paste its output over e2e-shard-timings.json. One
// report per shard, never several shards in one: a shard is one worker, and the times are read from
// the order its files ran in. A file that only skips (faces-visual.spec.ts) does not show up in the
// output: add it with 0.

import { readdirSync, readFileSync } from 'node:fs'
import { sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const SPEC_DIRECTORY = fileURLToPath(new URL('../apps/web/e2e/', import.meta.url))
export const TIMINGS_FILE = fileURLToPath(new URL('./e2e-shard-timings.json', import.meta.url))

/** Seconds that stand in for a spec with no measured time, when no spec at all is measured. */
const FALLBACK_SECONDS = 20

/**
 * The spec files under the end-to-end folder, as Playwright names them (the path from that folder,
 * with forward slashes), in name order. Subfolders count, as they do for Playwright's testDir.
 * @param {string} [directory]
 * @returns {string[]}
 */
export function listSpecs(directory = SPEC_DIRECTORY) {
  return readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .map((name) => name.split(sep).join('/'))
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
}

/**
 * The seconds each spec is expected to take; a spec without a measurement gets the median of the
 * measured ones.
 * @param {string[]} specs
 * @param {Record<string, number>} measured
 * @returns {{ seconds: Map<string, number>, unmeasured: string[] }}
 */
export function expectedSeconds(specs, measured) {
  const known = specs
    .map((spec) => measured[spec])
    .filter((value) => value !== undefined)
    .sort((a, b) => a - b)
  const middle = known.length > 0 ? known[Math.floor((known.length - 1) / 2)] : FALLBACK_SECONDS
  const unmeasured = specs.filter((spec) => measured[spec] === undefined)
  const seconds = new Map(specs.map((spec) => [spec, measured[spec] ?? middle ?? FALLBACK_SECONDS]))
  return { seconds, unmeasured }
}

/**
 * Cuts `specs` (in order) into `total` runs of neighbouring files so that the busiest run is as
 * short as it can be; among the plans with that busiest run, the one whose runs differ least from
 * each other. Every spec lands in exactly one shard. A pair in `apart` (earlier spec, later spec)
 * is never put in the same shard: a cut falls between them.
 * @param {string[]} specs
 * @param {Map<string, number>} seconds
 * @param {number} total
 * @param {[string, string][]} [apart]
 * @returns {string[][]}
 */
export function planShards(specs, seconds, total, apart = []) {
  if (!Number.isInteger(total) || total < 1) {
    throw new Error(`The shard count must be a whole number of 1 or more: ${total}`)
  }
  if (specs.length < total) throw new Error(`${specs.length} specs cannot fill ${total} shards`)
  // A little weight for every file, so a file of skipped tests still takes up a place.
  const weight = specs.map((spec) => Math.max(seconds.get(spec) ?? 0, 1))
  const prefix = [0]
  let running = 0
  for (const value of weight) {
    running += value
    prefix.push(running)
  }
  // A run [from, to) may not hold both specs of a pair that is to be kept apart.
  const pairs = apart.map(([earlier, later]) => [specs.indexOf(earlier), specs.indexOf(later)])
  const span = (/** @type {number} */ from, /** @type {number} */ to) => {
    for (const [early, late] of pairs) {
      if (early !== undefined && late !== undefined && from <= early && late < to) return Infinity
    }
    return (prefix[to] ?? 0) - (prefix[from] ?? 0)
  }

  // best.get(`${k}:${i}`): the best way to put the first i specs into k non-empty runs, as the
  // longest run and the sum of the squares of the runs (smaller is better, the longest first), and
  // where the last run starts.
  /** @type {Map<string, { longest: number, squares: number, cut: number }>} */
  const best = new Map([['0:0', { longest: 0, squares: 0, cut: 0 }]])
  for (let k = 1; k <= total; k++) {
    for (let i = k; i <= specs.length; i++) {
      for (let cut = k - 1; cut < i; cut++) {
        const before = best.get(`${k - 1}:${cut}`)
        if (!before) continue
        const last = span(cut, i)
        if (last === Infinity) continue
        const longest = Math.max(before.longest, last)
        const squares = before.squares + last * last
        const current = best.get(`${k}:${i}`)
        if (
          !current ||
          longest < current.longest ||
          (longest === current.longest && squares < current.squares)
        ) {
          best.set(`${k}:${i}`, { longest, squares, cut })
        }
      }
    }
  }
  /** @type {string[][]} */
  const shards = []
  let end = specs.length
  for (let k = total; k >= 1; k--) {
    const cell = best.get(`${k}:${end}`)
    if (!cell) throw new Error('No plan found')
    shards.unshift(specs.slice(cell.cut, end))
    end = cell.cut
  }
  return shards
}

/**
 * @param {string[]} files
 * @param {Map<string, number>} seconds
 * @returns {number}
 */
function totalSeconds(files, seconds) {
  return files.reduce((sum, file) => sum + (seconds.get(file) ?? 0), 0)
}

/**
 * What each spec takes, from Playwright JSON reports of green runs, one report per shard (a shard
 * runs its files one after the other on one worker). A file's time runs from its first test's
 * start to the first start of the next file, so its hooks are in it; a file that only skips costs
 * nothing and is left out. The result is the median over the reports.
 * @param {unknown[]} reports
 * @returns {Record<string, number>}
 */
export function timingsFromReports(reports) {
  /** @type {Map<string, number[]>} */
  const perFile = new Map()
  for (const report of reports) {
    /** @type {{ file: string, start: number, end: number }[]} */
    const results = []
    const visit = (/** @type {any} */ suite, /** @type {string} */ file) => {
      const here = suite.file ?? file
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            if (result.status === 'skipped') continue
            const start = Date.parse(result.startTime)
            results.push({ file: here, start, end: start + result.duration })
          }
        }
      }
      for (const child of suite.suites ?? []) visit(child, here)
    }
    for (const suite of /** @type {any} */ (report).suites ?? []) visit(suite, suite.file)

    results.sort((a, b) => a.start - b.start)
    /** @type {string[]} */
    const order = []
    /** @type {Map<string, { first: number, last: number }>} */
    const edges = new Map()
    for (const result of results) {
      const edge = edges.get(result.file)
      if (edge) {
        edge.last = Math.max(edge.last, result.end)
      } else {
        edges.set(result.file, { first: result.start, last: result.end })
        order.push(result.file)
      }
    }
    for (const [index, file] of order.entries()) {
      const edge = /** @type {{ first: number, last: number }} */ (edges.get(file))
      const following = order[index + 1]
      const finish =
        following === undefined ? edge.last : (edges.get(following)?.first ?? edge.last)
      const list = perFile.get(file) ?? []
      list.push(Math.round((finish - edge.first) / 1000))
      perFile.set(file, list)
    }
  }
  /** @type {Record<string, number>} */
  const seconds = {}
  for (const [file, values] of [...perFile].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const sorted = values.sort((a, b) => a - b)
    seconds[file] = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
  }
  return seconds
}

/**
 * The spec files in the output of `playwright test --list --reporter json`: the files Playwright
 * itself would run.
 * @param {unknown} report
 * @returns {string[]}
 */
export function specFilesInList(report) {
  /** @type {Set<string>} */
  const files = new Set()
  const visit = (/** @type {any} */ suite) => {
    if ((suite.specs ?? []).length > 0 && suite.file)
      files.add(String(suite.file).split(sep).join('/'))
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of /** @type {any} */ (report).suites ?? []) visit(suite)
  return [...files].sort()
}

/**
 * What is wrong between the specs this script plans and the ones Playwright collects (empty when
 * they are the same). A spec in no shard never runs, and a planned name Playwright does not know
 * leaves a shard running nothing while the run stays green (`--test-list` does not fail on it).
 * @param {string[]} planned
 * @param {string[]} collected
 * @returns {string[]}
 */
export function driftBetween(planned, collected) {
  const plannedSet = new Set(planned)
  const collectedSet = new Set(collected)
  return [
    ...collected
      .filter((file) => !plannedSet.has(file))
      .map((file) => `${file}: Playwright runs it, but no shard is planned to`),
    ...planned
      .filter((file) => !collectedSet.has(file))
      .map((file) => `${file}: planned, but Playwright does not collect it`),
  ]
}

/**
 * The plan for the real specs, with the committed timings.
 * @param {number} total
 */
export function currentPlan(total) {
  const specs = listSpecs()
  const file = JSON.parse(readFileSync(TIMINGS_FILE, 'utf8'))
  const { seconds, unmeasured } = expectedSeconds(specs, file.seconds)
  const apart = (file.apart ?? []).map((/** @type {{ earlier: string, later: string }} */ pair) => [
    pair.earlier,
    pair.later,
  ])
  return { shards: planShards(specs, seconds, total, apart), seconds, unmeasured, apart }
}

/** @param {string[]} args */
function main(args) {
  const [command, ...rest] = args
  if (command === 'list') {
    const shard = Number(rest[0])
    const total = Number(rest[1])
    if (!Number.isInteger(shard) || !Number.isInteger(total) || shard < 1 || shard > total) {
      throw new Error('Usage: e2e-shards.mjs list <shard> <total>   (shards count from 1)')
    }
    const { shards, seconds, unmeasured } = currentPlan(total)
    const mine = shards[shard - 1] ?? []
    console.log(mine.join('\n'))
    const minutes = (totalSeconds(mine, seconds) / 60).toFixed(1)
    console.error(
      `Shard ${shard} of ${total}: ${mine.length} spec files, expected ${minutes} min of tests`,
    )
    if (unmeasured.length > 0) {
      console.error(
        `No timing yet for ${unmeasured.join(', ')}: counted at the median. Refresh scripts/e2e-shard-timings.json (how: scripts/e2e-shards.mjs).`,
      )
    }
    return
  }
  if (command === 'plan') {
    const total = Number(rest[0])
    const { shards, seconds } = currentPlan(total)
    for (const [index, files] of shards.entries()) {
      const minutes = (totalSeconds(files, seconds) / 60).toFixed(1)
      console.log(`shard ${index + 1} of ${total}: ${minutes} min, ${files.length} files`)
      console.log(`  ${files[0]} .. ${files[files.length - 1]}`)
    }
    return
  }
  if (command === 'check' && rest[0]) {
    const total = Number(rest[1] ?? 4)
    const collected = specFilesInList(JSON.parse(readFileSync(rest[0], 'utf8')))
    const drift = driftBetween(currentPlan(total).shards.flat(), collected)
    if (drift.length > 0) {
      throw new Error(
        [
          'The end-to-end shard plan (scripts/e2e-shards.mjs) and Playwright disagree:',
          ...drift,
        ].join('\n'),
      )
    }
    console.log(
      `The ${collected.length} spec files Playwright collects are the ones the shards run.`,
    )
    return
  }
  if (command === 'timings' && rest.length > 0) {
    const reports = rest.map((path) => JSON.parse(readFileSync(path, 'utf8')))
    console.log(JSON.stringify({ seconds: timingsFromReports(reports) }, null, 2))
    return
  }
  throw new Error(
    'Usage: e2e-shards.mjs list <shard> <total> | plan <total> | check <list.json> [total] | timings <report.json>...',
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
