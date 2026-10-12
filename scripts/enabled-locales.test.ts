// Guardrail (D77; adjustments L1): a venue's menu languages come from one core function,
// `venueLanguages` (packages/core/src/languages.ts); no workflow reads `venues.enabled_locales`
// on its own. The scanner looks for the column (`enabled_locales`) and its Drizzle name
// (`enabledLocales`) in every non-test source file of the apps and packages.
//
// Two lists: ALLOWED holds the files that must read the column (the schema, the function and its
// readers, the venue's creation). RATCHET holds the readers that exist today, from before the
// function, and may only shrink: a package that rebuilds a screen or a writer moves it to
// `venueLanguages` and removes its entry here. A file in neither list that reads the column fails
// the build; so does a RATCHET entry that no longer reads it (remove the entry).
//
// Loosening either list is a guardrail change (D67): the lead's or Martin's explicit OK.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const SCANNED = ['apps/web/src', 'apps/web/app', 'apps/worker/src', 'packages']
const SKIPPED_FOLDERS = new Set(['node_modules', '.next', 'tests', 'testing', 'e2e', 'fixtures'])
const SKIPPED_FILE = /\.(test|spec)\.[^/]*$/
const SOURCE_FILE = /\.(ts|tsx|mjs|cjs|js)$/
const PATTERN = /\benabled_locales\b|\benabledLocales\b/

/** The files that must read the column. */
const ALLOWED = new Set([
  'packages/db/src/schema.ts',
  'packages/core/src/languages.ts',
  'packages/core/src/apply/languages.ts',
  'packages/core/src/apply/provision.ts',
])

/** Readers from before `venueLanguages`, to be moved to it (the list only shrinks). */
const RATCHET = new Set([
  'apps/web/src/components/admin/new-venue-dialog.tsx',
  'apps/web/src/components/admin/venue-card.tsx',
  'apps/web/src/components/admin/venue-settings.tsx',
  'apps/web/src/composer/actions.ts',
  'apps/web/src/composer/composer-tab.tsx',
  'apps/web/src/composer/composer.tsx',
  'apps/web/src/composer/item-sheet-media-tab.tsx',
  'apps/web/src/composer/item-sheet-test-data.ts',
  'apps/web/src/composer/item-sheet-translations-tab.tsx',
  'apps/web/src/composer/item-sheet.tsx',
  'apps/web/src/composer/new-item-dialog.tsx',
  'apps/web/src/composer/new-section-dialog.tsx',
  'apps/web/src/composer/tags-panel.tsx',
  'apps/web/src/fields/environment.tsx',
  'apps/web/src/fields/item-fields-preview.tsx',
  'apps/web/src/fields/tag-form.tsx',
  'apps/web/src/fields/types/tags.tsx',
  'apps/web/src/fields/types/text.tsx',
  'apps/web/src/server/item-sheet/service.ts',
  'apps/web/src/server/item-sheet/types.ts',
  'apps/web/src/server/venues-actions.ts',
  'packages/core/src/apply/tags.ts',
  'packages/core/src/tags.ts',
])

function sourceFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) return SKIPPED_FOLDERS.has(name) ? [] : sourceFiles(path)
    return SOURCE_FILE.test(name) && !SKIPPED_FILE.test(name) ? [path] : []
  })
}

function readers(): Set<string> {
  const found = new Set<string>()
  for (const dir of SCANNED) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      if (PATTERN.test(readFileSync(file, 'utf8'))) {
        found.add(relative(ROOT, file).replaceAll('\\', '/'))
      }
    }
  }
  return found
}

describe('venue languages come from venueLanguages() (D77)', () => {
  const found = readers()

  it('no file outside the allowed and ratchet lists reads venues.enabled_locales', () => {
    const strangers = [...found].filter((file) => !ALLOWED.has(file) && !RATCHET.has(file)).sort()
    expect(
      strangers,
      'read the venue’s languages through venueLanguages() (packages/core/src/languages.ts)',
    ).toEqual([])
  })

  it('every ratchet entry still reads the column (else remove it: the list only shrinks)', () => {
    const stale = [...RATCHET].filter((file) => !found.has(file)).sort()
    expect(stale, 'remove these from RATCHET in scripts/enabled-locales.test.ts').toEqual([])
  })

  it('the allowed files are the ones that must read it', () => {
    const missing = [...ALLOWED].filter((file) => !found.has(file)).sort()
    expect(missing).toEqual([])
  })
})
