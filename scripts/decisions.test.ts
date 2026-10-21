import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The decisions guard (D67). Each decision is a file docs/decisions/D<n>.md; docs/decisions.md is
// the index; code and docs cite decisions as "D<n>". This test fails when
//   1. a decision file is not named D<n>.md, lacks the frontmatter `status:` line, or its
//      "# D<n>:" heading number differs from its filename;
//   2. the index lists a decision with no file, or a file is missing from the index;
//   3. a decision number cited in apps/, packages/, scripts/, docs/, CLAUDE.md, GLOSSARY.md or
//      .claude/skills/ has no file;
//   4. the highest number in the index is not the highest file;
//   5. a decision log (docs/deliverables/*-decision-log.md, D114) has a row with a status outside
//      firm / later / on request / out / open, a firm row that points to no binding text, or an
//      open / later / on-request row that points to no ticket, D-file or docs/open-items.md;
//   6. a decision log is named by no decision file, or a decision file names a log that does not exist.
// Gaps inside the numbering are allowed only if they exist today (none do).

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'docs', '.claude/skills']
const SCAN_FILES = ['CLAUDE.md', 'GLOSSARY.md']
const EXTENSIONS = /\.(ts|tsx|md|sql|mjs|cjs|json|yml|yaml)$/
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
])
// "D76" but not a hex colour (#D76), an identifier (ID76, _D76, a.D76, D-76) or a longer word. Decisions
// start at D1, so "D0" (JPEG marker names in packages/assets/src/inspect-image.ts) is no citation.
const CITE = /(?<![#\w.-])D([1-9]\d{0,2})(?![\w-])/g

const decisionsDir = join(repoRoot, 'docs/decisions')
const deliverablesDir = join(repoRoot, 'docs/deliverables')
const LOG_NAME = /^\d{4}-\d{2}-\d{2}-[\w-]+-decision-log\.md$/
const STATUSES = /^(firm|later|on request|out|open)\b/
// Where a firm row's binding text may live (docs/agents/domain.md, "Decision logs").
const BINDING = /\bD\d+\b|#\d+|GLOSSARY|\bCQ\b|CLAUDE\.md|restro-flow/
const FOLLOW_UP = /\bD\d+\b|#\d+|open-items/

/** The decision numbers of the files in docs/decisions/, plus problems with a file's shape. */
function readFiles(): { numbers: Set<number>; problems: string[] } {
  const numbers = new Set<number>()
  const problems: string[] = []
  for (const name of readdirSync(decisionsDir)) {
    const match = /^D(\d+)\.md$/.exec(name)
    if (!match?.[1]) {
      problems.push(`${name}: not named D<n>.md`)
      continue
    }
    const n = Number(match[1])
    numbers.add(n)
    const text = readFileSync(join(decisionsDir, name), 'utf8').replace(/\r\n/g, '\n')
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
    if (!/^status:\s*\S/m.test(front))
      problems.push(`${name}: no "status:" line in the frontmatter`)
    const heading = /^# D(\d+):/m.exec(text.slice(front.length))?.[1]
    if (heading === undefined || Number(heading) !== n) {
      problems.push(`${name}: the "# D<n>:" heading is missing or has another number`)
    }
  }
  return { numbers, problems }
}

/** The decision numbers in the rows of docs/decisions.md. */
function readIndex(): number[] {
  const text = readFileSync(join(repoRoot, 'docs/decisions.md'), 'utf8')
  return [...text.matchAll(/^\|\s*\[D(\d+)\]\(decisions\/D(\d+)\.md\)/gm)].map((m) => {
    expect(m[2], `index row D${m[1]} links to another file`).toBe(m[1])
    return Number(m[1])
  })
}

/** Every decision number cited under the scanned paths, with one example file each. */
function scanCitations(): Map<number, string> {
  const cited = new Map<number, string>()
  const read = (rel: string) => {
    const text = readFileSync(join(repoRoot, rel), 'utf8')
    for (const m of text.matchAll(CITE)) if (!cited.has(Number(m[1]))) cited.set(Number(m[1]), rel)
  }
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(`${rel}/${entry.name}`)
      } else if (EXTENSIONS.test(entry.name)) {
        read(`${rel}/${entry.name}`)
      }
    }
  }
  for (const root of SCAN_ROOTS) walk(root)
  for (const file of SCAN_FILES) read(file)
  return cited
}

describe('the decision files', () => {
  const { numbers, problems } = readFiles()

  it('are named D<n>.md, with a status line and a matching heading', () => {
    expect(numbers.size).toBeGreaterThan(90) // not vacuous
    expect(problems).toEqual([])
  })

  it('match the index, with no gap at the top', () => {
    const indexed = readIndex()
    const files = [...numbers].sort((a, b) => a - b)
    expect(indexed.length).toBe(new Set(indexed).size)
    expect(
      indexed.filter((n) => !numbers.has(n)).map((n) => `D${n}: in the index, no file`),
    ).toEqual([])
    expect(
      files.filter((n) => !indexed.includes(n)).map((n) => `D${n}: file, not in the index`),
    ).toEqual([])
    expect(Math.max(...indexed)).toBe(files[files.length - 1])
  })

  it('exist for every D<n> cited in the code and docs', () => {
    const cited = scanCitations()
    expect(cited.size).toBeGreaterThan(50) // not vacuous
    const missing = [...cited]
      .filter(([n]) => !numbers.has(n))
      .map(([n, file]) => `D${n} (${file})`)
    expect(missing).toEqual([])
  })
})

describe('the decision logs', () => {
  const logs = readdirSync(deliverablesDir).filter((name) => LOG_NAME.test(name))
  const decisionTexts = readdirSync(decisionsDir).map((name) =>
    readFileSync(join(decisionsDir, name), 'utf8'),
  )

  it('give every row a status, and point each one where it is recorded', () => {
    expect(logs.length).toBeGreaterThan(0) // not vacuous
    const problems: string[] = []
    for (const log of logs) {
      const text = readFileSync(join(deliverablesDir, log), 'utf8')
      for (const line of text.split(/\r?\n/).filter((l) => /^\|\s*\d+\.\d+\s*\|/.test(l))) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim())
        const [row, , , status = '', recorded = ''] = cells
        if (cells.length !== 5) problems.push(`${log} ${row}: ${cells.length} cells, not 5`)
        else if (!STATUSES.test(status)) problems.push(`${log} ${row}: status "${status}"`)
        else if (status.startsWith('firm') && !BINDING.test(recorded))
          problems.push(`${log} ${row}: firm, but "${recorded}" is no binding text`)
        else if (/^(later|on request|open)/.test(status) && !FOLLOW_UP.test(recorded))
          problems.push(`${log} ${row}: ${status}, but "${recorded}" names no ticket or D-file`)
      }
    }
    expect(problems).toEqual([])
  })

  it('are named by a decision file, and every log a decision file names exists', () => {
    expect(
      logs
        .filter((log) => !decisionTexts.some((t) => t.includes(log)))
        .map((log) => `${log}: named by no decision file`),
    ).toEqual([])
    const named = decisionTexts.flatMap((t) => [
      ...t.matchAll(/\d{4}-\d{2}-\d{2}-[\w-]+-decision-log\.md/g),
    ])
    expect(
      named
        .map((m) => m[0])
        .filter((log) => !logs.includes(log))
        .map((log) => `${log}: no such log`),
    ).toEqual([])
  })
})
