import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'
import { BASELINE_FILE, WORDS, ZONES } from './vendor-words.config.ts'
import {
  bannedHits,
  checkVendorWords,
  findBannedPatterns,
  formatReport,
  messageHits,
  RULE_SENTENCE,
  readBaseline,
  scanVendorWords,
  sourceHits,
  type Violation,
} from './vendor-words.ts'

// The vendor-word test (A6-F7, D67). Vendor words (barsy, lukanet, mistral, zamboo) belong only in
// a connector's own package and a few named folders. This test counts them in code (not comments)
// and fails when:
//   - a "wall" zone (what guests see) has any, or a connector's package has another kind's word;
//   - a "ratchet" zone file has more than its entry in scripts/vendor-words.baseline.json, has
//     words and no entry, or has fewer (the entry is stale: lower it with
//     `pnpm vendor-words:baseline`). The baseline only shrinks.
// This test never writes the baseline; only scripts/vendor-words-baseline.ts does.
// The second half builds fake repositories and proves each rule fires.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function assertNoViolations(violations: Violation[]) {
  if (violations.length > 0) throw new Error(`\n${formatReport(violations)}`)
}

/** Does the folder pattern (with `*` = any one folder name) match an existing folder? */
function folderExists(root: string, pattern: string): boolean {
  const walk = (base: string, segments: string[]): boolean => {
    const [head, ...rest] = segments
    if (head === undefined) return true
    if (head !== '*') return existsSync(join(base, head)) && walk(join(base, head), rest)
    if (!existsSync(base)) return false
    return readdirSync(base, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && walk(join(base, entry.name), rest),
    )
  }
  return walk(root, pattern.split('/'))
}

describe('the real repository', () => {
  const baselinePath = join(repoRoot, BASELINE_FILE)
  const baselineAtStart = existsSync(baselinePath) ? readFileSync(baselinePath, 'utf8') : ''
  const baseline = readBaseline(repoRoot)

  it('has a baseline file', () => {
    expect(baseline, 'scripts/vendor-words.baseline.json is missing').not.toBeNull()
  })

  it('has no vendor word where none is allowed, and none above or below the baseline', () => {
    assertNoViolations(checkVendorWords(scanVendorWords(repoRoot), baseline ?? {}))
  })

  it('has none of the banned float and rounding patterns next to the barsy code', () => {
    assertNoViolations(findBannedPatterns(repoRoot))
  })

  it('still scans what it is meant to scan (a moved folder must not empty a wall)', () => {
    const missing = ZONES.filter((zone) => !zone.name.startsWith('connector:')).flatMap((zone) =>
      zone.include
        .filter((folder) => !folderExists(repoRoot, folder))
        .map((f) => `${zone.name}: ${f}`),
    )
    expect(missing).toEqual([])
    const scanned = scanVendorWords(repoRoot)
    for (const name of ['published', 'core', 'db', 'web', 'worker', 'connector:barsy']) {
      expect(
        scanned.filter((entry) => entry.zone.name === name).length,
        `zone ${name} scans no file`,
      ).toBeGreaterThan(0)
    }
  })

  it('only reads: the scanner has no way to write, and the baseline is as it was', () => {
    // readBaseline above already throws on an entry that is not a whole number of 1 or more.
    const scanner = readFileSync(
      fileURLToPath(new URL('./vendor-words.ts', import.meta.url)),
      'utf8',
    )
    expect(scanner).not.toMatch(/\bwrite(File|FileSync)\b|\bappendFile|\bunlink|\brename|\brmSync/)
    expect(readFileSync(baselinePath, 'utf8')).toBe(baselineAtStart)
  })
})

describe('what counts as a vendor word', () => {
  const hits = (text: string, file = 'src/x.ts') => sourceHits(file, text, WORDS)

  it('counts identifiers, also inside a longer name and in any case', () => {
    expect(hits('const linkedToBarsy = 1\nconst BARSY_HOST = 2\nfunction Lukanet() {}')).toEqual([
      { line: 1, word: 'barsy' },
      { line: 2, word: 'barsy' },
      { line: 3, word: 'lukanet' },
    ])
  })

  it('counts every occurrence, so barsyBarsy is two', () => {
    expect(hits('const barsyBarsy = 1')).toHaveLength(2)
  })

  it('counts mistral and zamboo too', () => {
    expect(hits("const a = 'Mistral Software'\nconst zamboo = 1")).toEqual([
      { line: 1, word: 'mistral' },
      { line: 2, word: 'zamboo' },
    ])
  })

  it('counts string literals, in imports and in types as well', () => {
    expect(hits("import { x } from '@restro/barsy'\nexport type K = 'barsy' | 'other'")).toEqual([
      { line: 1, word: 'barsy' },
      { line: 2, word: 'barsy' },
    ])
  })

  it('counts every part of a template literal, on the right line', () => {
    // Built from parts, so that this file holds no template placeholder inside a plain string.
    const dollar = '$'
    const text = [
      `const a = \`barsy ${dollar}{x}`,
      `mid barsy ${dollar}{y}`,
      'end barsy`',
      'const b = `no substitution barsy`',
    ].join('\n')
    expect(hits(text)).toEqual([
      { line: 1, word: 'barsy' },
      { line: 2, word: 'barsy' },
      { line: 3, word: 'barsy' },
      { line: 4, word: 'barsy' },
    ])
  })

  it('counts JSX text and JSX attribute names', () => {
    const text = 'export const A = () => (\n  <p data-barsy="x">\n    Connect barsy\n  </p>\n)'
    expect(hits(text, 'src/a.tsx')).toEqual([
      { line: 2, word: 'barsy' },
      { line: 3, word: 'barsy' },
    ])
  })

  it('skips line, block and JSDoc comments', () => {
    const text = [
      '// barsy in a line comment',
      '/* lukanet in a block comment */',
      '/**',
      ' * A barsy mention.',
      ' * @param {string} barsyId the barsy id',
      ' * @see https://docs.lukanet.com/barsy.api',
      ' */',
      'export function f(id: string) {',
      '  return id // zamboo',
      '}',
    ].join('\n')
    expect(hits(text)).toEqual([])
  })

  it('keeps counting code that sits next to a comment', () => {
    expect(hits('const a = 1 // barsy\nconst barsy = 2 /* barsy */')).toEqual([
      { line: 2, word: 'barsy' },
    ])
  })

  it('ignores words that merely contain no vendor name', () => {
    expect(hits("const bars = ['bar', 'barista']")).toEqual([])
  })

  describe('in messages/*.json', () => {
    const messages = (value: unknown, allowKeys?: string[]) =>
      messageHits('apps/web/messages/en.json', JSON.stringify(value, null, 2), WORDS, allowKeys)

    it('counts a word in a key and in a string value, each once', () => {
      expect(
        messages({ integration: { barsy: { title: 'Connect barsy', note: 'Plain' } } }),
      ).toEqual([
        { line: 3, word: 'barsy' },
        { line: 4, word: 'barsy' },
      ])
    })

    it('counts a word in a nested key path, in arrays and in deep values', () => {
      expect(messages({ list: ['ok', 'Mistral'], deep: { a: { b: 'x lukanet' } } })).toEqual([
        { line: 4, word: 'mistral' },
        { line: 8, word: 'lukanet' },
      ])
    })

    it('skips the whole subtree of an allowed key path', () => {
      const value = {
        connectors: { barsy: { title: 'Connect barsy', help: { text: 'barsy' } } },
        other: { barsy: 'x' },
      }
      expect(messages(value)).toHaveLength(4)
      expect(messages(value, ['connectors.*'])).toEqual([{ line: 11, word: 'barsy' }])
    })

    it('fails loudly on invalid JSON', () => {
      expect(() => messageHits('apps/web/messages/en.json', '{ "a": ', WORDS)).toThrow()
    })
  })
})

// ------------------------------------------------------------------ fake repositories

const sandbox = mkdtempSync(join(tmpdir(), 'restro-vendor-words-'))
let caseNumber = 0
afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

/** Writes the files into a fresh folder and returns its root. */
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

/** The violations the real rules find in a fake repository. */
function violationsFor(files: Record<string, string>, baseline: Record<string, number> = {}) {
  return checkVendorWords(scanVendorWords(writeRepo(files)), baseline)
}

const barsyConst = 'export const barsyId = 1\n'

describe('the wall zone "published": one new hit fails', () => {
  it('names file, line, word and zone, then the rule in one sentence', () => {
    const violations = violationsFor({
      'packages/shell/src/menu.ts': `export const ok = 1\nexport const label = 'Powered by barsy'\n`,
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({
      file: 'packages/shell/src/menu.ts',
      zone: 'published',
      line: 2,
    })
    const report = formatReport(violations)
    expect(report).toContain('packages/shell/src/menu.ts:2')
    expect(report).toContain('"barsy"')
    expect(report).toContain('zone published')
    expect(report.trimEnd().endsWith(RULE_SENTENCE)).toBe(true)
  })

  const published = ZONES.find((zone) => zone.name === 'published')?.include ?? []
  it.each(published)('fails a hit in %s', (folder) => {
    const dir = folder.replace('*', 'some-face')
    const violations = violationsFor({ [`${dir}/view.ts`]: barsyConst })
    expect(violations.map((violation) => violation.zone)).toEqual(['published'])
  })

  it('wins over a ratchet zone that includes the same folder, even with a baseline entry', () => {
    const file = 'packages/core/src/snapshot/build.ts'
    const violations = violationsFor({ [file]: barsyConst }, { [file]: 1 })
    expect(violations.map((violation) => violation.message).join('\n')).toContain(
      `${file}:1 "barsy" in zone published`,
    )
  })

  it('fails the guest routes of the web app too', () => {
    const violations = violationsFor({
      'apps/web/app/m/[venue]/page.tsx': 'export default () => <p>barsy</p>\n',
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]?.zone).toBe('published')
  })
})

describe('what is not scanned', () => {
  const skipped = [
    'packages/shell/src/menu.test.ts',
    'packages/shell/src/menu.test.tsx',
    'packages/shell/src/menu.spec.ts',
    'packages/shell/src/tests/menu.ts',
    'packages/shell/src/testing/menu.ts',
    'packages/shell/src/e2e/menu.ts',
    'packages/shell/src/scripts/menu.ts',
    'packages/shell/src/fixtures/menu.ts',
    'packages/shell/src/migrations/menu.ts',
    'packages/shell/src/node_modules/menu.ts',
    'packages/shell/src/.next/menu.ts',
  ]
  it.each(skipped)('skips %s', (file) => {
    expect(violationsFor({ [file]: barsyConst })).toEqual([])
  })

  it('skips files that are not .ts or .tsx, and code outside every zone', () => {
    expect(
      violationsFor({
        'packages/shell/src/notes.md': 'barsy',
        'packages/shell/src/style.css': '.barsy {}',
        'packages/shell/src/legacy.js': barsyConst,
        'apps/web/proxy.ts': barsyConst,
        'apps/web/tests/page.ts': barsyConst,
        'packages/assets/package.json': '{"barsy": 1}',
        'scripts/anything.ts': barsyConst,
      }),
    ).toEqual([])
  })

  it('does not scan the allowed folders, but allows exactly what is listed', () => {
    expect(
      violationsFor({
        'packages/core/src/connectors/barsy.ts': barsyConst,
        'apps/web/src/connectors/barsy.tsx': barsyConst,
        'apps/worker/src/connectors.ts': barsyConst,
      }),
    ).toEqual([])
    // A folder of the same name as an allowed file is not allowed.
    const lines = violationsFor({ 'apps/worker/src/connectors/barsy.ts': barsyConst })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.zone).toBe('worker')
  })

  it('does not let a baseline entry stand in for an allowed path', () => {
    const file = 'packages/core/src/connectors/barsy.ts'
    const lines = violationsFor({ [file]: barsyConst }, { [file]: 1 })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toContain('stale entry')
  })
})

describe("a connector's own package: its words are fine, another kind's are not", () => {
  it('allows the barsy package its own words', () => {
    expect(
      violationsFor({
        'packages/barsy/src/client.ts': "export const barsyHost = 'https://x.lukanet.com'\n",
        'packages/connectors/barsy/src/client.ts': barsyConst,
      }),
    ).toEqual([])
  })

  it('fails the barsy package for a mistral or zamboo word', () => {
    const lines = violationsFor({
      'packages/barsy/src/client.ts': "export const x = 'Mistral'\nexport const zamboo = 1\n",
    })
    expect(lines.map((line) => `${line.zone} ${line.line}`)).toEqual([
      'connector:barsy 1',
      'connector:barsy 2',
    ])
    expect(lines[0]?.message).toContain("another connector's word")
  })

  it('fails a future mistral package for barsy, and lets it use its own words', () => {
    const lines = violationsFor({
      'packages/connectors/mistral/src/client.ts':
        'export const barsy = 1\nexport const mistral = 2\n',
    })
    expect(lines.map((line) => `${line.zone} ${line.line}`)).toEqual(['connector:mistral 1'])
  })

  it("keeps the payment provider's name in its own package and web folder (#104)", () => {
    const stripeConst = 'export const stripeKey = 1\n'
    expect(
      violationsFor({
        'packages/payments/stripe/src/client.ts': stripeConst,
        'apps/web/src/connectors/stripe/pay.tsx': stripeConst,
        'apps/web/src/connectors/data.ts': barsyConst,
      }),
    ).toEqual([])
    const lines = violationsFor({
      'packages/payments/sim-pay/src/provider.ts': stripeConst,
      'apps/web/src/connectors/barsy/server.ts': stripeConst,
      'apps/web/src/connectors/stripe/pay.tsx': barsyConst,
      'apps/web/src/connectors/data.ts': stripeConst,
      'apps/worker/src/jobs/pay.ts': stripeConst,
    })
    expect(lines.map((line) => line.zone).sort()).toEqual([
      'connector:barsy',
      'connector:sim-pay',
      'connector:stripe',
      'web-connectors',
      'worker',
    ])
  })

  it('does not scan a connector package outside src, nor its testing folder', () => {
    expect(
      violationsFor({
        'packages/barsy/src/testing/mock.ts': 'export const mistral = 1\n',
        'packages/barsy/src/client.test.ts': 'export const mistral = 1\n',
        'packages/barsy/tests/x.ts': 'export const mistral = 1\n',
      }),
    ).toEqual([])
  })
})

describe('the ratchet zones: the baseline only shrinks', () => {
  const twoWords = 'export const barsyA = 1\nexport const barsyB = 2\n'
  const cases = [
    ['core', 'packages/core/src/sale.ts'],
    ['db', 'packages/db/src/schema.ts'],
    ['web', 'apps/web/src/server/service.ts'],
    ['worker', 'apps/worker/src/sync/run.ts'],
  ] as const

  describe.each(cases)('zone %s (%s)', (zone, file) => {
    it('passes at the baseline number', () => {
      expect(violationsFor({ [file]: twoWords }, { [file]: 2 })).toEqual([])
    })

    it('fails a file with words and no entry', () => {
      const lines = violationsFor({ [file]: twoWords })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toMatchObject({ file, zone })
      expect(lines[0]?.message).toContain('no baseline entry')
    })

    it('fails a file above its entry', () => {
      const lines = violationsFor({ [file]: twoWords }, { [file]: 1 })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toContain('2 vendor words, the baseline allows 1')
    })

    it('fails a file below its entry as a stale entry', () => {
      const lines = violationsFor({ [file]: barsyConst }, { [file]: 2 })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toContain('stale entry: lower it with pnpm vendor-words:baseline')
    })

    it('fails an entry whose file has no vendor word any more', () => {
      const lines = violationsFor({ [file]: 'export const ok = 1\n' }, { [file]: 1 })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toContain('has no vendor words now')
    })

    it('fails an entry whose file is gone', () => {
      const lines = violationsFor({ 'packages/shell/src/index.ts': 'export {}\n' }, { [file]: 1 })
      expect(lines).toHaveLength(1)
      expect(lines[0]?.message).toContain('is not scanned')
    })
  })

  it('fails an entry that points into a wall zone', () => {
    const file = 'packages/shell/src/menu.ts'
    const lines = violationsFor({ [file]: 'export const ok = 1\n' }, { [file]: 3 })
    expect(lines).toHaveLength(1)
    expect(lines[0]?.message).toContain('allows none')
  })

  it('counts words, not lines: two words on one line count twice', () => {
    const file = 'packages/core/src/a.ts'
    expect(violationsFor({ [file]: 'export const barsyBarsy = 1\n' }, { [file]: 2 })).toEqual([])
  })

  it('still counts a message file as one file with its own entry', () => {
    const file = 'apps/web/messages/en.json'
    const text = JSON.stringify({ a: { barsy: 'x' }, connectors: { barsy: { t: 'barsy' } } })
    expect(violationsFor({ [file]: text }, { [file]: 1 })).toEqual([])
    expect(violationsFor({ [file]: text })).toHaveLength(1)
  })
})

describe('banned patterns next to the barsy code', () => {
  const count = (text: string) =>
    bannedHits('packages/barsy/src/x.ts', text).map((hit) => hit.pattern)

  it('finds parseFloat, toFixed and multiplying by 100, in code', () => {
    expect(count('const a = parseFloat(x)')).toEqual(['parseFloat('])
    expect(count('const a = Number.parseFloat(x)')).toEqual(['parseFloat('])
    expect(count('const a = x.toFixed(2)')).toEqual(['.toFixed('])
    expect(count('const a = price * 100')).toEqual(['* 100'])
    expect(count('const a = 100 * price')).toEqual(['* 100'])
    expect(count('let a = 1\na *= 100')).toEqual(['* 100'])
    expect(count('const a = (price+1)*100')).toEqual(['* 100'])
  })

  it('ignores comments, strings and look-alikes', () => {
    expect(
      count(
        [
          '// never x * 100 or parseFloat(x) or n.toFixed(2)',
          "const a = 'parseFloat( x.toFixed( * 100'",
          'const b = price * 1000',
          'const c = price / 100',
          'const d = 100 + price',
          'const e = price ** 100',
        ].join('\n'),
      ),
    ).toEqual([])
  })

  it('fails a hit in packages/barsy/src and in a future connector package, not in tests', () => {
    const root = writeRepo({
      'packages/barsy/src/money.ts': 'export const a = (x: string) => parseFloat(x)\n',
      'packages/connectors/mistral/src/money.ts': 'export const b = (x: number) => x * 100\n',
      'packages/barsy/src/money.test.ts': 'export const c = (x: string) => parseFloat(x)\n',
      'packages/barsy/src/testing/money.ts': 'export const d = (x: string) => parseFloat(x)\n',
      'packages/core/src/money.ts': 'export const e = (x: string) => parseFloat(x)\n',
    })
    const lines = findBannedPatterns(root)
    expect(lines.map((line) => line.file)).toEqual([
      'packages/barsy/src/money.ts',
      'packages/connectors/mistral/src/money.ts',
    ])
    expect(lines[0]?.message).toContain(
      'packages/barsy/src/money.ts:1 banned pattern `parseFloat(`',
    )
  })
})
