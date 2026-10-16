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
//   4. the highest number in the index is not the highest file.
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
