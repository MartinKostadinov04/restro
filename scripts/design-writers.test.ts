import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// The design record's one writer (D129, rule 1). `venues.settings.design` is written by the
// `setDesign` operation of `core.apply`, and by nothing else: no second path can skip the revision
// check, the provenance or the event. This test fails when
//   1. source under `apps/` or `packages/` names a writer the record retired;
//   2. a file other than core's apply writes the `design` key of a venue's settings, or the keys
//      the record replaced (`theme`, `presentation`), by SQL or by laying it into `settings`.
// Migration files are not source here: 0043 wrote the first records. Only tightens (D67): a pattern
// is never removed and an allowed file never added to let code through.

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo'])

/** The writer of the record: the one file that may store it. */
const THE_WRITER = 'packages/core/src/apply/apply.ts'

/** The design e2e's seed: it empties the demo venue's record, as a fresh start, between runs. */
const E2E_RESET = 'apps/web/scripts/seed-design-e2e.ts'

/** What the record retired (any mention means a writer came back, or a caller was left behind). */
const RETIRED = [
  'setVenueTheme',
  'setVenuePresentation',
  'setMenuSettings',
  'setMenuSettingsAction',
  'chooseTemplateAction',
  'saveFeatureOptionsAction',
  'readVenueTheme',
  'readPresentation',
] as const

/** The settings keys only the one writer may write, in an SQL path or an object literal. */
const KEYS = 'design|theme|presentation'

/** A write of one of those keys. Reading (`readDesign`, `settings -> 'design'`) matches none. */
const WRITES: readonly RegExp[] = [
  // jsonb_set(settings, '{design}', …), '{design,items}', and with a schema-qualified column.
  new RegExp(`jsonb_set\\s*\\([\\s\\S]{0,120}?'\\{\\s*(?:${KEYS})\\b`, 'i'),
  // jsonb_build_object('design', …) and a `||` merge of a literal: '{"design": …}'.
  new RegExp(`jsonb_build_object\\s*\\(\\s*'(?:${KEYS})'`, 'i'),
  new RegExp(`'\\{\\s*"(?:${KEYS})"\\s*:`, 'i'),
  // settings - 'design' takes it away.
  new RegExp(`settings\\s*-\\s*'(?:${KEYS})'`, 'i'),
  // settings: { ...venue.settings, design: … } and settings = { …, design: … } on one line.
  new RegExp(`\\bsettings\\b[^\\n;]*[{,][ \\t]*(?:${KEYS})[ \\t]*:`),
  // The key's own name, as a computed key.
  /\[\s*DESIGN_SETTINGS_KEY\s*\][ \t]*:/,
]

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : sourceFiles(path)
    return /\.(?:[cm]?[jt]s|tsx|jsx)$/.test(entry.name) ? [path] : []
  })
}

const isTest = (path: string) =>
  /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes('/e2e/')

/** The patterns a text breaks. */
const writesIn = (text: string) =>
  WRITES.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern))

const retiredIn = (text: string) => RETIRED.filter((name) => new RegExp(`\\b${name}\\b`).test(text))

describe('the design record’s one writer', () => {
  const files = ['apps', 'packages'].flatMap((top) =>
    sourceFiles(join(repoRoot, top)).map((path) => ({
      name: relative(repoRoot, path).replaceAll(sep, '/'),
      text: readFileSync(path, 'utf8'),
    })),
  )

  it('finds the source', () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files.some((file) => file.name === THE_WRITER)).toBe(true)
  })

  // Tests are left out: one may assert that the package no longer exports the name, and a test that
  // called it would not compile.
  it('no code names a writer the record retired', () => {
    const found = files
      .filter((file) => !isTest(file.name))
      .flatMap((file) => retiredIn(file.text).map((name) => `${file.name}: ${name}`))
    expect(found).toEqual([])
  })

  it('only core’s apply writes the record, or the keys it replaced', () => {
    const found = files
      .filter((file) => !isTest(file.name) && file.name !== THE_WRITER && file.name !== E2E_RESET)
      .flatMap((file) => writesIn(file.text).map((pattern) => `${file.name}: ${pattern}`))
    expect(found).toEqual([])
  })

  it('core’s apply writes it in one place, the `{design}` key alone', () => {
    const writer = files.find((file) => file.name === THE_WRITER)
    const writes = writer?.text.match(/jsonb_set\s*\([^)]*'\{[^}]*\}'/g) ?? []
    expect(writes).toEqual(["jsonb_set(settings, '{design}'"])
  })

  it('the e2e seed only takes the record away, and never stores one', () => {
    const seed = files.find((file) => file.name === E2E_RESET)
    expect(writesIn(seed?.text ?? '')).toEqual([String(WRITES[3])])
  })

  it('catches a planted writer (self-test on text)', () => {
    for (const planted of [
      `sql\`update restro.venues set settings = jsonb_set(settings, '{design}', $1)\``,
      `sql\`update venues set settings = jsonb_set(coalesce(settings, '{}'), '{design,items}', $1)\``,
      `sql\`update venues set settings = jsonb_set(settings, '{theme}', $1)\``,
      `sql\`update venues set settings = settings || jsonb_build_object('design', $1)\``,
      `sql\`update venues set settings = settings || '{"presentation": {}}'\``,
      `sql\`update venues set settings = settings - 'design'\``,
      'tx.update(venues).set({ settings: { ...venue.settings, design: record } })',
      'const next = { settings: { design: record } }',
      'settings[DESIGN_SETTINGS_KEY] = x; const y = { [DESIGN_SETTINGS_KEY]: record }',
    ]) {
      expect(writesIn(planted), planted).not.toEqual([])
    }
    for (const reading of [
      'const { design } = readDesign(venue.settings)',
      `sql\`select settings -> 'design' from restro.venues\``,
      'const settings = readDesignRecord(row.settings)',
      "// settings.design is the record; the 'design' key is written by setDesign",
    ]) {
      expect(writesIn(reading), reading).toEqual([])
    }
    expect(retiredIn('await setVenueTheme(pool, tenant, input)')).toEqual(['setVenueTheme'])
    expect(retiredIn('await setVenueThemes(pool)')).toEqual([])
  })
})
