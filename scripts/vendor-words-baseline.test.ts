import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'
import { BASELINE_FILE } from './vendor-words.config.ts'
import { checkVendorWords, readBaseline, scanVendorWords } from './vendor-words.ts'
import { updateBaseline } from './vendor-words-baseline.ts'

// `pnpm vendor-words:baseline` is the only writer of scripts/vendor-words.baseline.json (D67: the
// baseline only shrinks). These tests run it on fake repositories in a temporary folder; none of
// them touches the real baseline.

const SCRIPT = fileURLToPath(new URL('./vendor-words-baseline.ts', import.meta.url))
const sandbox = mkdtempSync(join(tmpdir(), 'restro-vendor-baseline-'))
let caseNumber = 0
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

function writeRepo(files: Record<string, string>): string {
  caseNumber += 1
  const root = join(sandbox, `case-${caseNumber}`)
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return root
}

const baselineText = (root: string) => readFileSync(join(root, BASELINE_FILE), 'utf8')
const word = (n: number) =>
  Array.from({ length: n }, (_, i) => `export const barsy${i} = ${i}\n`).join('')

describe('the first baseline', () => {
  const files = {
    'packages/core/src/b.ts': word(2),
    'packages/core/src/a.ts': word(1),
    'apps/worker/src/run.ts': word(3),
    'packages/db/src/schema.ts': word(1),
    // Not baseline-able or not counted: a wall zone, an allowed folder, a test, an own-kind word.
    'packages/shell/src/menu.ts': word(1),
    'packages/core/src/connectors/x.ts': word(5),
    'packages/core/src/a.test.ts': word(5),
    'packages/barsy/src/client.ts': word(5),
  }

  it('is refused without --allow-increase, and nothing is written', () => {
    const root = writeRepo(files)
    const result = updateBaseline(root, { allowIncrease: false })
    expect(result.written).toBe(false)
    expect(existsSync(join(root, BASELINE_FILE))).toBe(false)
    expect(result.messages.join('\n')).toContain('Refusing to raise')
    expect(result.messages.join('\n')).toContain('packages/core/src/a.ts: 0 -> 1')
    expect(result.messages.join('\n')).toContain('--allow-increase')
  })

  it('is written with --allow-increase: ratchet zones only, sorted, two spaces, one newline', () => {
    const root = writeRepo(files)
    const result = updateBaseline(root, { allowIncrease: true })
    expect(result.written).toBe(true)
    expect(baselineText(root)).toBe(
      [
        '{',
        '  "apps/worker/src/run.ts": 3,',
        '  "packages/core/src/a.ts": 1,',
        '  "packages/core/src/b.ts": 2,',
        '  "packages/db/src/schema.ts": 1',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('is exactly what the test accepts for those ratchet zones', () => {
    const root = writeRepo(files)
    updateBaseline(root, { allowIncrease: true })
    const violations = checkVendorWords(scanVendorWords(root), readBaseline(root) ?? {})
    // The only thing left is the wall-zone word in the shell: a baseline never hides it.
    expect(violations.map((violation) => violation.zone)).toEqual(['published'])
  })

  it('writes an empty object when no ratchet zone has a word', () => {
    const root = writeRepo({ 'packages/core/src/ok.ts': 'export const ok = 1\n' })
    expect(updateBaseline(root, { allowIncrease: true }).written).toBe(true)
    expect(baselineText(root)).toBe('{}\n')
  })
})

describe('an existing baseline', () => {
  const start = (extra: Record<string, string>, baseline: Record<string, number>) =>
    writeRepo({
      [BASELINE_FILE]: `${JSON.stringify(baseline, null, 2)}\n`,
      ...extra,
    })

  it('is lowered when words are removed', () => {
    const root = start(
      { 'packages/core/src/a.ts': word(1), 'packages/core/src/b.ts': word(2) },
      { 'packages/core/src/a.ts': 3, 'packages/core/src/b.ts': 2 },
    )
    const result = updateBaseline(root, { allowIncrease: false })
    expect(result.written).toBe(true)
    expect(JSON.parse(baselineText(root))).toEqual({
      'packages/core/src/a.ts': 1,
      'packages/core/src/b.ts': 2,
    })
  })

  it('drops the entry of a file with no words left, and of a deleted file', () => {
    const root = start(
      { 'packages/core/src/a.ts': 'export const ok = 1\n', 'packages/db/src/x.ts': word(1) },
      { 'packages/core/src/a.ts': 2, 'packages/core/src/gone.ts': 4, 'packages/db/src/x.ts': 1 },
    )
    expect(updateBaseline(root, { allowIncrease: false }).written).toBe(true)
    expect(JSON.parse(baselineText(root))).toEqual({ 'packages/db/src/x.ts': 1 })
  })

  it('refuses to raise one number even when another goes down, and leaves the file as it was', () => {
    const root = start(
      { 'packages/core/src/a.ts': word(1), 'packages/core/src/b.ts': word(4) },
      { 'packages/core/src/a.ts': 3, 'packages/core/src/b.ts': 2 },
    )
    const before = baselineText(root)
    const result = updateBaseline(root, { allowIncrease: false })
    expect(result.written).toBe(false)
    expect(baselineText(root)).toBe(before)
    expect(result.messages.join('\n')).toContain('packages/core/src/b.ts: 2 -> 4')
    expect(result.messages.join('\n')).not.toContain('packages/core/src/a.ts')
  })

  it('refuses a file that is new in the baseline', () => {
    const root = start({ 'packages/core/src/new.ts': word(1) }, {})
    expect(updateBaseline(root, { allowIncrease: false }).written).toBe(false)
  })

  it('raises numbers only with --allow-increase', () => {
    const root = start({ 'packages/core/src/a.ts': word(4) }, { 'packages/core/src/a.ts': 2 })
    expect(updateBaseline(root, { allowIncrease: true }).written).toBe(true)
    expect(JSON.parse(baselineText(root))).toEqual({ 'packages/core/src/a.ts': 4 })
  })

  it('rejects a malformed baseline file instead of overwriting it', () => {
    const root = writeRepo({ [BASELINE_FILE]: '[1, 2]', 'packages/core/src/a.ts': word(1) })
    expect(() => updateBaseline(root, { allowIncrease: true })).toThrow(/must be an object/)
    const zero = writeRepo({ [BASELINE_FILE]: '{"packages/core/src/a.ts": 0}' })
    expect(() => updateBaseline(zero, { allowIncrease: true })).toThrow(/whole number of 1 or more/)
  })
})

describe('the command line (pnpm vendor-words:baseline)', () => {
  // The script finds the repository from its own location, so it cannot be pointed at a fake tree.
  // The only case that is safe to run against the real one is the one that exits before it reads
  // anything: an unknown argument. The real baseline file is compared before and after.
  const realBaseline = fileURLToPath(new URL('./vendor-words.baseline.json', import.meta.url))

  it('rejects an unknown argument with exit code 2 and writes nothing', () => {
    const before = readFileSync(realBaseline, 'utf8')
    const run = spawnSync(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', SCRIPT, '--force'],
      { encoding: 'utf8' },
    )
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('Unknown argument: --force')
    expect(readFileSync(realBaseline, 'utf8')).toBe(before)
  })
})
