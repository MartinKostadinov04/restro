// Drizzle's migrator applies a migration only if its journal timestamp (`when`) is newer than
// the last one applied, so a migration merged from an older branch with an earlier timestamp
// would be skipped silently. These checks keep the journal strictly ordered and in step with
// the SQL files on disk.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))

interface Journal {
  dialect: string
  entries: { idx: number; when: number; tag: string; breakpoints: boolean }[]
}

const journal = JSON.parse(
  readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
) as Journal

describe('migrations journal', () => {
  it('is for PostgreSQL and numbers its entries 0, 1, 2, …', () => {
    expect(journal.dialect).toBe('postgresql')
    expect(journal.entries.map((entry) => entry.idx)).toEqual(journal.entries.map((_, i) => i))
  })

  it('has strictly increasing timestamps (an older one would never be applied)', () => {
    for (let i = 1; i < journal.entries.length; i += 1) {
      const previous = journal.entries[i - 1]
      const current = journal.entries[i]
      expect(current?.when, `${current?.tag} must be newer than ${previous?.tag}`).toBeGreaterThan(
        previous?.when ?? Number.POSITIVE_INFINITY,
      )
    }
  })

  it('lists exactly the SQL files in migrations/, each starting with its index', () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort()
    expect(files).toEqual(journal.entries.map((entry) => `${entry.tag}.sql`))
    for (const entry of journal.entries) {
      expect(entry.tag.startsWith(String(entry.idx).padStart(4, '0'))).toBe(true)
      expect(entry.breakpoints).toBe(true)
    }
  })
})
