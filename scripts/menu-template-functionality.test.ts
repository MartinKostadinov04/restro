import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The menu functionality guard (D105, D67). docs/guides/menu-template-functionality.md is the one
// list of what a guest can do in a menu. It has one `### <name>` entry per capability, each with
// the bullets Shell key, Status, Drawn means and Where. This test fails when
//   1. a feature key the shell knows is missing from the entries' Shell key lines: the keys of
//      `ViewFeatures` (packages/shell/src/features.ts), each the first backticked word of some
//      entry's Shell key line; the manifest's `FEATURE_NAMES` (packages/shell/src/manifest.ts),
//      named anywhere in those lines; and the request kinds `CALL_WAITER_KINDS` (packages/core,
//      which the shell re-exports as its service kinds), named in the line of the entry that also
//      names `callWaiter`;
//   2. an entry has a status outside the four, or lacks one of the four bullets;
//   3. an entry with status `supported` or `drawn, platform parked` names no guide section (§) and
//      no decision (D<n>) in its Where line, or cites a § that is no heading of the designer guide
//      (that a cited D<n> has a file is decisions.test.ts's job).
// When the shell's lists and the file disagree, fix the file, never this test.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n')

const STATUSES = [
  'supported',
  'drawn, platform parked',
  'decided, not in the contract yet',
  'planned',
]
const DRAWN_STATUSES = ['supported', 'drawn, platform parked']

interface Entry {
  name: string
  bullets: Map<string, string>
}

/** The `### ` entries of the file, each with its `- **Label:** text` bullets. */
function readEntries(): Entry[] {
  const text = read('docs/guides/menu-template-functionality.md')
  return text
    .split(/^### /m)
    .slice(1)
    .map((block) => {
      const [name = '', ...rest] = block.split('\n')
      const bullets = new Map<string, string>()
      for (const line of rest) {
        const m = /^- \*\*([^:*]+):\*\*\s*(.*)$/.exec(line)
        if (m?.[1] !== undefined) bullets.set(m[1], m[2] ?? '')
      }
      return { name: name.trim(), bullets }
    })
}

/** The quoted words of a `const NAME = [ 'a', 'b' ] as const` list. */
function readList(rel: string, name: string): string[] {
  const body = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(read(rel))?.[1]
  expect(body, `${name} not found in ${rel}`).toBeDefined()
  return [...(body ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
}

/** The property names of `interface ViewFeatures { ... }`. */
function readViewFeatureKeys(): string[] {
  const body = /export interface ViewFeatures \{([\s\S]*?)\n\}/.exec(
    read('packages/shell/src/features.ts'),
  )?.[1]
  expect(body, 'interface ViewFeatures not found').toBeDefined()
  return [...(body ?? '').matchAll(/^\s+readonly (\w+):/gm)].map((m) => m[1] ?? '')
}

describe('the menu template functionality file', () => {
  const entries = readEntries()

  it('has entries, each with its four bullets and a valid status', () => {
    expect(entries.length).toBeGreaterThan(10) // not vacuous
    const problems: string[] = []
    for (const { name, bullets } of entries) {
      for (const label of ['Shell key', 'Status', 'Drawn means', 'Where']) {
        if (!bullets.get(label)) problems.push(`${name}: no "${label}" bullet`)
      }
      const status = bullets.get('Status')
      if (status !== undefined && !STATUSES.includes(status)) {
        problems.push(`${name}: status "${status}" is not one of ${STATUSES.join(' | ')}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('names every feature key the shell knows', () => {
    const keyLines = entries.map((e) => e.bullets.get('Shell key') ?? '')
    const primary = new Set(keyLines.map((line) => /`([^`]+)`/.exec(line)?.[1]))
    const viewKeys = readViewFeatureKeys()
    const manifestNames = readList('packages/shell/src/manifest.ts', 'FEATURE_NAMES')
    expect(viewKeys.length).toBeGreaterThanOrEqual(5) // not vacuous
    expect(manifestNames.length).toBeGreaterThanOrEqual(5)
    const missing = [
      ...viewKeys.filter((key) => !primary.has(key)),
      ...manifestNames.filter((key) => !keyLines.join('\n').includes(`\`${key}\``)),
    ]
    expect(missing.map((key) => `${key}: in no Shell key line`)).toEqual([])
  })

  it('names every request kind in the call-a-waiter entry', () => {
    const kinds = readList('packages/core/src/theme/presentation.ts', 'CALL_WAITER_KINDS')
    expect(kinds.length).toBeGreaterThan(0)
    const waiter = entries.find((e) => (e.bullets.get('Shell key') ?? '').includes('`callWaiter`'))
    expect(waiter, 'no entry has the Shell key `callWaiter`').toBeDefined()
    const line = waiter?.bullets.get('Shell key') ?? ''
    expect(kinds.filter((kind) => !line.includes(`\`${kind}\``))).toEqual([])
  })

  it('cites only sections the designer guide has', () => {
    const guide = read('docs/guides/shell-handoff/visualization-shell.md')
    const sections = new Set([...guide.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\.?\s/gm)].map((m) => m[1]))
    expect(sections.size).toBeGreaterThan(30) // not vacuous
    const unknown = entries.flatMap((e) =>
      [...(e.bullets.get('Where') ?? '').matchAll(/§(\d+(?:\.\d+)?)/g)]
        .map((m) => m[1] ?? '')
        .filter((n) => !sections.has(n))
        .map((n) => `${e.name}: §${n} is no heading of the guide`),
    )
    expect(unknown).toEqual([])
  })

  it('points every drawn entry at a guide section or a decision', () => {
    const drawn = entries.filter((e) => DRAWN_STATUSES.includes(e.bullets.get('Status') ?? ''))
    expect(drawn.length).toBeGreaterThan(5) // not vacuous
    const unpointed = drawn
      .filter((e) => !/§\d|\bD[1-9]\d{0,2}\b/.test(e.bullets.get('Where') ?? ''))
      .map((e) => `${e.name}: Where names no guide section or decision`)
    expect(unpointed).toEqual([])
  })
})
