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
//   3. a file not on the list of settings writers below starts setting a venue's `settings`: each
//      of those patches its own key, and a new one is a review of whether it can reach the record.
// Migration files are not source here: 0045 wrote the first records. Only tightens (D67): a pattern
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

/** The files that set `venues.settings` today, each for a key of its own (none of `KEYS`). */
const SETTINGS_WRITERS: readonly string[] = [
  'packages/core/src/apply/floor.ts',
  'packages/core/src/apply/guest-features.ts',
  'packages/core/src/apply/languages.ts',
  'packages/core/src/apply/ordering-settings.ts',
  'packages/core/src/apply/pay-first-settings.ts',
  'packages/core/src/apply/paying-settings.ts',
  'packages/core/src/apply/tables.ts',
  'packages/core/src/apply/venue-lifecycle.ts',
  'packages/core/src/apply/venue-publish-rules.ts',
]

/** The text of the `.update(venues).set(…)` calls of a source file, laid out over any lines. */
function venueSetCalls(text: string): string[] {
  return [...text.matchAll(/\.update\(venues\)\s*\.set\(/g)].map((match) => {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    while (end < text.length && depth > 0) {
      if (text[end] === '(') depth += 1
      if (text[end] === ')') depth -= 1
      end += 1
    }
    return text.slice(start, end)
  })
}

/** A key of the record, as `design: …`, a shorthand `design,` or `design }`. */
const KEY_WRITTEN = new RegExp(`\\b(?:${KEYS})\\b[ \\t]*(?::|,|\\s*\\})`)

/** A settings object rebuilt with a key of the record, over any lines: `{ ...x.settings, design }`. */
const SPREAD_WITH_KEY = new RegExp(
  `\\.\\.\\.[^,\\n]*\\bsettings\\b[^,\\n]*,\\s*(?:[\\w$]+(?:[ \\t]*:[^,\\n]+)?,\\s*)*(?:${KEYS})\\b[ \\t]*(?::|,|\\s*\\})`,
)

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
const writesIn = (text: string) => [
  ...WRITES.filter((pattern) => pattern.test(text)).map((pattern) => String(pattern)),
  ...(SPREAD_WITH_KEY.test(text) ? [String(SPREAD_WITH_KEY)] : []),
  ...(venueSetCalls(text).some((call) => KEY_WRITTEN.test(call)) ? ['.update(venues).set'] : []),
]

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

  it('no new file sets a venue’s settings', () => {
    const found = files
      .filter((file) => !isTest(file.name) && file.name !== THE_WRITER)
      .filter((file) => venueSetCalls(file.text).some((call) => /\bsettings\b/.test(call)))
      .map((file) => file.name)
    expect(found.sort()).toEqual([...SETTINGS_WRITERS].sort())
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
      'tx\n  .update(venues)\n  .set({\n    settings: {\n      ...venue.settings,\n      design: record,\n    },\n  })',
      'tx.update(venues).set({ settings: { ...venue.settings, design } })',
      'const next = {\n  ...venue.settings,\n  other: 1,\n  design: record,\n}',
      'const next = { ...locked.venue.settings, theme }',
    ]) {
      expect(writesIn(planted), planted).not.toEqual([])
    }
    for (const reading of [
      'const { design } = readDesign(venue.settings)',
      `sql\`select settings -> 'design' from restro.venues\``,
      'const settings = readDesignRecord(row.settings)',
      "// settings.design is the record; the 'design' key is written by setDesign",
      'tx.update(venues).set({ settings: { ...venue.settings, ordering: after } })',
      'tx\n  .update(venues)\n  .set({ settings })\n  .where(eq(venues.design, 1))',
      'const next = { ...venue.settings, floor_source: next }\nconst design = 1',
    ]) {
      expect(writesIn(reading), reading).toEqual([])
    }
    expect(retiredIn('await setVenueTheme(pool, tenant, input)')).toEqual(['setVenueTheme'])
    expect(retiredIn('await setVenueThemes(pool)')).toEqual([])
  })
})
