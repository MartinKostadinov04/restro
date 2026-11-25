import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { JOB_NAMES, ONE_RUN_PER_GROUP_JOBS } from '../packages/core/src/jobs'

// The group guard (#308). A queue in `ONE_RUN_PER_GROUP_JOBS` runs one job of a key at a time only
// through the group each job is sent in (pg-boss `short` with `groupConcurrency: 1`): a job sent
// without one runs beside its key's other run. This test fails when non-test source under `apps/`
// or `packages/` sends a job of such a queue by name (`JOB_NAMES.x` or the queue's name in quotes)
// through `send(…)` or `enqueue(…)` with options that carry no group, or through `send(…)` with no
// options at all. An `enqueue(name, data)` with no options is the web app's `enqueueJob` (the
// worker's `enqueue` requires options), which, like the registry's `sendAgain`, takes the group
// from `prepareJob` itself. Only tightens (D67).

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo'])

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path)
    if (!/\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name)) return []
    return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [] : [path]
  })
}

const KEY_OF = new Map(Object.entries(JOB_NAMES).map(([key, name]) => [name, key]))
/** How a one-run queue is named in code: `JOB_NAMES.orderSend`, or `'order-send'`. */
const NAMED = [...ONE_RUN_PER_GROUP_JOBS].flatMap((name) => [
  `JOB_NAMES\\.${KEY_OF.get(name)}\\b`,
  `['"\`]${name}['"\`]`,
])
const SEND_CALL = new RegExp(`\\b(send|enqueue)\\s*\\(\\s*(?:${NAMED.join('|')})\\s*,`, 'g')

/** The text of the call that opens at `start` (its `(`), up to its closing parenthesis. */
function callText(text: string, start: number): string {
  let depth = 0
  for (let at = start; at < text.length; at += 1) {
    if (text[at] === '(') depth += 1
    if (text[at] === ')') {
      depth -= 1
      if (depth === 0) return text.slice(start, at + 1)
    }
  }
  return text.slice(start)
}

/** How many arguments the call text `(…)` passes: commas outside brackets and quotes. */
function argumentCount(call: string): number {
  let depth = 0
  let quote: string | null = null
  let count = 1
  for (let at = 1; at < call.length - 1; at += 1) {
    const char = call.charAt(at)
    if (quote !== null) {
      if (char === '\\') at += 1
      else if (char === quote) quote = null
    } else if (char === "'" || char === '"' || char === '`') quote = char
    else if ('([{'.includes(char)) depth += 1
    else if (')]}'.includes(char)) depth -= 1
    // A trailing comma before the `)` opens no argument.
    else if (char === ',' && depth === 0 && call.slice(at + 1, -1).trim() !== '') count += 1
  }
  return count
}

/** The sends of a one-run queue in `text` that pass no group, as their first line. */
function ungroupedSends(text: string): string[] {
  return [...text.matchAll(SEND_CALL)].flatMap((match) => {
    const call = callText(text, text.indexOf('(', match.index))
    const ungrouped =
      argumentCount(call) < 3
        ? // No options: fine for an `enqueue` (it is `enqueueJob`), never for a `send`.
          match[1] === 'send'
        : !/\bgroup\b/.test(call)
    return ungrouped ? [call.split('\n')[0] ?? call] : []
  })
}

describe('the group guard (#308)', () => {
  it('every send of a one-run-per-key queue in apps/ or packages/ passes its group', () => {
    const files = ['apps', 'packages'].flatMap((top) => sourceFiles(join(repoRoot, top)))
    expect(files.length).toBeGreaterThan(100)
    let sends = 0
    const found = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      sends += [...text.matchAll(SEND_CALL)].length
      return ungroupedSends(text).map(
        (call) => `${relative(repoRoot, file).replaceAll(sep, '/')}: ${call}`,
      )
    })
    expect(found).toEqual([])
    // The producers it reads today (publish, table files, live overlay, probes, a payment's
    // deadline): a guard that matches nothing guards nothing.
    expect(sends).toBeGreaterThanOrEqual(8)
  })

  it('catches a planted send without a group (self-test on text)', () => {
    for (const planted of [
      'await boss.send(JOB_NAMES.publishMenu, job.data, { singletonKey: job.singletonKey })',
      'await env.enqueue(JOB_NAMES.publishTableTokens, tokens.data, {\n  singletonKey: key,\n})',
      "await queue.send('order-send', data, { singletonKey: tableId })",
      'context.queue.send(JOB_NAMES.connectionProbe, job.data, { startAfter: wait(at) })',
      'await boss.send(JOB_NAMES.purgeVenue, { tenantId, venueId })',
    ]) {
      expect(ungroupedSends(planted), planted).toHaveLength(1)
    }
    for (const fine of [
      'await boss.send(JOB_NAMES.publishMenu, job.data, { singletonKey: k, group: job.group })',
      'send(JOB_NAMES.publishLive, d, {\n  ...(job.group === undefined ? {} : { group: job.group }),\n})',
      'await boss.send(JOB_NAMES.tableRead, job.data, { singletonKey: job.singletonKey })',
      'await enqueueJob(JOB_NAMES.publishFiles, data)',
      'await services.enqueue(JOB_NAMES.publishTableTokens, {\n  tenantId,\n  retired: [a, b],\n})',
    ]) {
      expect(ungroupedSends(fine), fine).toEqual([])
    }
  })
})
