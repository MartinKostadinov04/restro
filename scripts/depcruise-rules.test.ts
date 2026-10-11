import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { cruise, type IConfiguration, type ICruiseResult } from 'dependency-cruiser'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Proves that every rule in .dependency-cruiser.cjs fires on a forbidden import, and that a
// legitimate layout produces no violations. Each case builds a tiny fake repository in a
// temporary folder (so no violation is ever committed), runs dependency-cruiser on it with the
// real rule set, and compares the violations that come back.

const config = createRequire(import.meta.url)('../.dependency-cruiser.cjs') as IConfiguration

type Files = Record<string, string>

let sandbox: string
let caseNumber = 0

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'restro-depcruise-'))
})

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

/** Writes the files to a fresh folder, cruises it, and returns "rule: from -> to" lines. */
async function violationsFor(files: Files): Promise<string[]> {
  caseNumber += 1
  const root = join(sandbox, `case-${caseNumber}`)
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  const result = await cruise(
    ['apps', 'packages'],
    { ...config.options, ruleSet: config, validate: true, baseDir: root, outputType: 'json' },
    config.options?.enhancedResolveOptions,
  )
  // With outputType 'json' the result arrives as a JSON string.
  const output = JSON.parse(result.output as string) as ICruiseResult
  return output.summary.violations
    .map((violation) => `${violation.rule.name}: ${violation.from} -> ${violation.to}`)
    .sort()
}

const ruleNames = (lines: string[]) => [...new Set(lines.map((line) => line.split(':')[0]))].sort()

const seenRules = new Set<string>()
async function expectRules(files: Files, expected: string[]) {
  const lines = await violationsFor(files)
  const names = ruleNames(lines)
  for (const name of names) if (name) seenRules.add(name)
  expect(names, lines.join('\n')).toEqual([...expected].sort())
  return lines
}

// Files that exist in most fixtures, so relative and package imports have something to resolve to.
const base: Files = {
  'packages/db/src/index.ts': 'export const db = 1',
  'packages/db/src/write/index.ts': 'export const write = 1',
  'packages/barsy/src/index.ts': 'export const barsy = 1',
  'packages/core/src/index.ts': 'export const core = 1',
  'packages/shell/src/index.ts': 'export const shell = 1',
  'packages/faces/qr-phone/src/index.ts': 'export const face = 1',
  'apps/web/app/page.ts': 'export const page = 1',
  'apps/worker/src/index.ts': 'export const worker = 1',
}

describe('allowed layout', () => {
  it('reports nothing for the imports the architecture permits', async () => {
    const lines = await violationsFor({
      ...base,
      'packages/core/src/apply/apply.ts':
        "import { write } from '@restro/db/write'\nexport const a = write",
      'packages/core/src/apply/relative.ts':
        "import { write } from '../../../db/src/write/index'\nexport const b = write",
      'packages/core/src/read.ts': "import { db } from '../../db/src/index'\nexport const c = db",
      'packages/shell/src/view.ts':
        "import { core } from '../../core/src/index'\nexport const d = core",
      'packages/faces/qr-phone/src/view.ts':
        "import type { shell } from '../../../shell/src/index'\nexport type E = typeof shell",
      'packages/barsy/src/client.ts': "import { barsy } from './index'\nexport const f = barsy",
      'apps/web/app/layout.ts':
        "import { core } from '../../../packages/core/src/index'\nimport { db } from '../../../packages/db/src/index'\nexport const g = [core, db]",
      'apps/worker/src/sync.ts':
        "import { barsy } from '../../../packages/barsy/src/index'\nimport '@restro/barsy'\nexport const h = barsy",
      // The db package may use its own insides; everyone else uses the entry points.
      'packages/db/src/internal/pool.ts': 'export const pool = 1',
      'packages/db/src/schema.ts': 'export const schema = 1',
      'packages/db/src/read.ts':
        "import { pool } from './internal/pool'\nimport { schema } from './schema'\nexport const r = [pool, schema]",
      'packages/db/src/write/tx.ts':
        "import { pool } from '../internal/pool'\nimport { schema } from '../schema'\nexport const tx = [pool, schema]",
      'packages/db/tests/pool.test.ts':
        "import { pool } from '../src/internal/pool'\nimport { write } from '../src/write/index'\nexport const t = [pool, write]",
      'apps/worker/src/heartbeat.ts':
        "import { db } from '@restro/db'\nimport { db as again } from '../../../packages/db/src/index'\nexport const i = [db, again]",
    })
    expect(lines).toEqual([])
  })
})

describe('rule 1: shell and faces stay pure', () => {
  it('rejects @restro/db, @restro/barsy and apps/ from the shell (as written and by path)', async () => {
    const lines = await expectRules(
      {
        ...base,
        'packages/shell/src/a.ts': "import '@restro/db'",
        'packages/shell/src/b.ts': "import '../../db/src/index'",
        'packages/shell/src/c.ts': "import '../../barsy/src/index'",
        'packages/shell/src/d.ts': "import '../../../apps/web/app/page'",
        'packages/shell/src/e.ts':
          "import type { db } from '@restro/db'\nexport type T = typeof db",
      },
      ['pure-layers-no-data-or-apps', 'barsy-only-from-worker', 'packages-never-import-apps'],
    )
    for (const file of ['a', 'b', 'c', 'd', 'e']) {
      expect(lines.some((line) => line.includes(`packages/shell/src/${file}.ts`))).toBe(true)
    }
  })

  it('rejects the same imports from a face (which the faces rule refuses too)', async () => {
    const lines = await expectRules(
      {
        ...base,
        'packages/faces/qr-phone/src/a.ts': "import '@restro/db'",
        'packages/faces/qr-phone/src/b.ts': "import '@restro/barsy'",
        'packages/faces/qr-phone/src/c.ts': "import '../../../../apps/web/app/page'",
      },
      [
        'faces-only-react-and-shell',
        'pure-layers-no-data-or-apps',
        'barsy-only-from-worker',
        'packages-never-import-apps',
      ],
    )
    expect(lines.filter((line) => line.startsWith('faces-only-react-and-shell'))).toHaveLength(3)
  })

  it.each([
    'fs',
    'node:fs',
    'fs/promises',
    'node:fs/promises',
    'net',
    'http',
    'https',
    'child_process',
  ])('rejects the Node built-in %s from the shell and from a face', async (builtin) => {
    const lines = await expectRules(
      {
        ...base,
        'packages/shell/src/io.ts': `import '${builtin}'`,
        'packages/faces/qr-phone/src/io.ts': `import '${builtin}'`,
      },
      ['faces-only-react-and-shell', 'pure-layers-no-io-builtins'],
    )
    // The shell file breaks the I/O rule; the face file breaks it and the faces rule.
    expect(lines).toHaveLength(3)
    expect(lines.filter((line) => line.startsWith('pure-layers-no-io-builtins'))).toHaveLength(2)
  })

  it.each(['pg', 'pg-boss', 'postgres'])('rejects the database package %s', async (name) => {
    await expectRules({ ...base, 'packages/shell/src/io.ts': `import '${name}'` }, [
      'pure-layers-no-database-drivers',
    ])
  })

  it('allows harmless built-ins and packages in the shell', async () => {
    await expectRules(
      {
        ...base,
        'packages/shell/src/ok.ts': "import 'node:crypto'\nimport 'node:util'\nimport 'react'",
      },
      [],
    )
  })
})

describe('rule 2: only core/apply imports the db write side', () => {
  it('rejects @restro/db/write from anywhere else', async () => {
    const lines = await expectRules(
      {
        ...base,
        'packages/core/src/apply/apply.ts': "import '@restro/db/write'",
        'packages/core/src/other.ts': "import '@restro/db/write'",
        'packages/core/src/relative.ts': "import '../../db/src/write/index'",
        'apps/web/app/action.ts': "import '@restro/db/write'",
        'apps/worker/src/job.ts': "import '../../../packages/db/src/write/index'",
      },
      ['db-write-only-from-core-apply'],
    )
    expect(lines).toHaveLength(4)
    expect(lines.some((line) => line.includes('packages/core/src/apply/'))).toBe(false)
  })
})

describe('rule 2b: outside packages/db only the two entry points are importable', () => {
  const inside: Files = {
    ...base,
    'packages/db/src/internal/pool.ts': 'export const pool = 1',
    'packages/db/src/schema.ts': 'export const schema = 1',
  }

  it('rejects deep imports of packages/db/src from apps and packages', async () => {
    const lines = await expectRules(
      {
        ...inside,
        'apps/worker/src/a.ts': "import '../../../packages/db/src/internal/pool'",
        'apps/web/app/b.ts': "import '../../../packages/db/src/schema'",
        'packages/core/src/c.ts': "import '../../db/src/internal/pool'",
        'packages/core/src/d.ts': "import type { schema } from '../../db/src/schema'",
      },
      ['db-entry-points-only'],
    )
    expect(lines).toHaveLength(4)
  })

  it('rejects the package-name form of a deep import', async () => {
    const lines = await expectRules(
      {
        ...inside,
        'apps/worker/src/a.ts': "import '@restro/db/src/internal/pool'",
        'packages/core/src/b.ts': "import '@restro/db/src/schema'",
        'packages/core/src/c.ts': "import '@restro/db/src'",
      },
      ['db-entry-points-only'],
    )
    expect(lines).toHaveLength(3)
  })

  it('allows both entry points, by package name and by path', async () => {
    await expectRules(
      {
        ...inside,
        'apps/worker/src/a.ts': "import '@restro/db'",
        'packages/core/src/apply/b.ts': "import '@restro/db/write'",
        'packages/core/src/apply/c.ts': "import '../../../db/src/write/index'",
        'apps/web/app/d.ts': "import '../../../packages/db/src/index'",
      },
      [],
    )
  })

  it('does not restrict code inside packages/db', async () => {
    await expectRules(
      {
        ...inside,
        'packages/db/src/read.ts': "import './internal/pool'\nimport './schema'",
        'packages/db/tests/t.test.ts': "import '../src/internal/pool'\nimport '../src/schema'",
      },
      [],
    )
  })
})

describe('rule 2c: the db read side never imports the write side', () => {
  it('rejects the read entry, the pool and the schema importing packages/db/src/write', async () => {
    const lines = await expectRules(
      {
        ...base,
        'packages/db/src/index.ts':
          "import { write } from './write/index'\nexport const db = write",
        'packages/db/src/internal/pool.ts':
          "import { write } from '../write/index'\nexport const pool = write",
        'packages/db/src/schema.ts':
          "import type { write } from './write/index'\nexport type S = typeof write",
      },
      ['db-read-side-no-write'],
    )
    expect(lines).toHaveLength(3)
    for (const file of ['index', 'internal/pool', 'schema']) {
      expect(lines.some((line) => line.includes(`packages/db/src/${file}.ts`))).toBe(true)
    }
  })

  it('allows the write side to use the pool and the schema', async () => {
    await expectRules(
      {
        ...base,
        'packages/db/src/internal/pool.ts': 'export const pool = 1',
        'packages/db/src/schema.ts': 'export const schema = 1',
        'packages/db/src/write/index.ts':
          "import { pool } from '../internal/pool'\nimport { schema } from '../schema'\nexport const write = [pool, schema]",
      },
      [],
    )
  })

  it('does not apply to tests outside src', async () => {
    await expectRules(
      { ...base, 'packages/db/tests/write.test.ts': "import '../src/write/index'" },
      [],
    )
  })
})

describe('rules 3 and 4: only the worker imports barsy', () => {
  it('rejects @restro/barsy from the web app, core and db', async () => {
    const lines = await expectRules(
      {
        ...base,
        'apps/web/app/barsy.ts': "import '@restro/barsy'",
        'apps/web/app/relative.ts': "import '../../../packages/barsy/src/index'",
        'packages/core/src/barsy.ts': "import '@restro/barsy'",
        'packages/db/src/barsy.ts': "import '@restro/barsy'",
      },
      ['barsy-only-from-worker', 'web-no-barsy'],
    )
    expect(lines.filter((line) => line.startsWith('web-no-barsy'))).toHaveLength(2)
    expect(lines.filter((line) => line.startsWith('barsy-only-from-worker'))).toHaveLength(4)
  })
})

describe('sealed credentials: only the worker opens them (D55)', () => {
  const seal: Files = {
    'packages/core/src/seal/index.ts': 'export const seal = 1',
    'packages/core/src/seal/open/index.ts': "import '../index'\nexport const open = 1",
  }

  it('rejects the opening half from the web app (by package name and by path), core and barsy', async () => {
    const lines = await expectRules(
      {
        ...base,
        ...seal,
        'apps/web/app/connect.ts': "import '@restro/core/seal-open'",
        'apps/web/app/relative.ts': "import '../../../packages/core/src/seal/open/index'",
        'packages/core/src/seal/credentials.ts': "import './open/index'",
        'packages/barsy/src/sync.ts': "import '@restro/core/seal-open'",
      },
      ['seal-open-only-from-worker'],
    )
    expect(lines).toHaveLength(4)
    expect(lines.filter((line) => line.includes('apps/web/'))).toHaveLength(2)
  })

  it('allows the worker, the opening half itself, and the sealing half anywhere', async () => {
    await expectRules(
      {
        ...base,
        ...seal,
        'apps/worker/src/credentials.ts': "import '@restro/core/seal-open'",
        'apps/worker/src/relative.ts': "import '../../../packages/core/src/seal/open/index'",
        'packages/core/src/seal/open/open.test.ts': "import './index'",
        'apps/web/app/seal.ts': "import '../../../packages/core/src/seal/index'",
      },
      [],
    )
  })
})

describe('rule 5: packages never import apps', () => {
  it('rejects apps/ by path and by package name', async () => {
    await expectRules(
      {
        ...base,
        'packages/core/src/a.ts': "import '../../../apps/web/app/page'",
        'packages/db/src/b.ts': "import '@restro/web'",
        'packages/barsy/src/c.ts': "import '@restro/worker'",
      },
      ['packages-never-import-apps'],
    )
  })
})

describe('rule 6: no circular dependencies', () => {
  it('rejects a cycle of two modules', async () => {
    await expectRules(
      {
        ...base,
        'packages/core/src/a.ts': "import { b } from './b'\nexport const a = b",
        'packages/core/src/b.ts': "import { a } from './a'\nexport const b = a",
      },
      ['no-circular'],
    )
  })

  it('rejects a cycle that only goes through type imports', async () => {
    await expectRules(
      {
        ...base,
        'packages/core/src/a.ts': "import type { B } from './b'\nexport type A = { b: B }",
        'packages/core/src/b.ts': "import type { A } from './a'\nexport type B = { a: A }",
      },
      ['no-circular'],
    )
  })
})

describe('packages/assets: storage only, no database or barsy', () => {
  it('rejects @restro/db, @restro/barsy and a relative path into packages/db', async () => {
    await expectRules(
      {
        ...base,
        'packages/assets/src/db.ts': "import '@restro/db'",
        'packages/assets/src/barsy.ts': "import '@restro/barsy'",
        'packages/assets/src/relative-db.ts': "import '../../db/src/index'",
      },
      ['assets-no-database-or-barsy', 'barsy-only-from-worker'],
    )
  })

  it('rejects a path into apps/', async () => {
    await expectRules(
      { ...base, 'packages/assets/src/app.ts': "import '../../../apps/web/app/page'" },
      ['assets-no-database-or-barsy', 'packages-never-import-apps'],
    )
  })
})

describe('the guest page reads published files only (rule 4)', () => {
  const guestBase: Files = {
    ...base,
    'packages/assets/src/index.ts': 'export const assets = 1',
    'packages/core/src/apply/index.ts': 'export const apply = 1',
    'apps/web/src/server/db.ts': 'export const pool = 1',
  }

  it('rejects the database, apply(), the stores and the server helpers from the guest code', async () => {
    await expectRules(
      {
        ...guestBase,
        'apps/web/src/guest/db.ts': "import '@restro/db'",
        'apps/web/src/guest/apply.ts': "import '@restro/core/apply'",
        'apps/web/src/guest/assets.ts': "import '@restro/assets'",
        'apps/web/src/guest/server.ts': "import '../server/db'",
        'apps/web/app/m/[venue]/page.ts': "import '../../../src/server/db'",
        'apps/web/src/guest/pg.ts': "import 'pg'",
      },
      ['guest-page-reads-published-files-only'],
    )
  })

  it('allows the shell, the face and core types in the guest code', async () => {
    await expectRules(
      {
        ...guestBase,
        'apps/web/src/guest/menu.ts':
          "import '@restro/shell'\nimport '@restro/qr-phone'\nimport '@restro/core'",
        'apps/web/src/server/token.ts': "import '@restro/assets'",
      },
      [],
    )
  })
})

describe('a face imports only react and the shell (SH-04)', () => {
  const faces: Files = {
    ...base,
    'packages/shell/testing/index.ts': 'export const testing = 1',
    'packages/faces/qr-phone/src/model.ts': 'export const model = 1',
    'packages/faces/editorial-market/src/index.ts': 'export const other = 1',
  }
  const FACE = 'packages/faces/qr-phone/src'

  it('rejects core, an icon library, another face and a Node built-in (as written and by path)', async () => {
    const lines = await expectRules(
      {
        ...faces,
        [`${FACE}/core.ts`]: "import '@restro/core'",
        [`${FACE}/core-by-path.ts`]: "import '../../../core/src/index'",
        [`${FACE}/icons.ts`]: "import 'lucide-react'",
        [`${FACE}/other-face.ts`]: "import '../../editorial-market/src/index'",
        [`${FACE}/other-face-by-name.ts`]: "import '@restro/editorial-market'",
        [`${FACE}/crypto.ts`]: "import 'node:crypto'",
        [`${FACE}/type-only.ts`]:
          "import type { Locale } from '@restro/core'\nexport type L = Locale",
        'packages/faces/editorial-market/src/deep.ts': "import '../../qr-phone/src/model'",
      },
      ['faces-only-react-and-shell'],
    )
    expect(lines).toHaveLength(8)
  })

  it('rejects the shell’s testing helpers from a face’s own code, by name and by path', async () => {
    const lines = await expectRules(
      {
        ...faces,
        [`${FACE}/by-name.ts`]: "import '@restro/shell/testing'",
        [`${FACE}/by-path.ts`]: "import '../../../shell/testing/index'",
      },
      ['faces-only-react-and-shell'],
    )
    expect(lines).toHaveLength(2)
  })

  it('allows its own files, react, react-dom (with internals), and the shell', async () => {
    await expectRules(
      {
        ...faces,
        [`${FACE}/face.ts`]:
          "import './model'\nimport { model } from './model'\nexport const face = model",
        [`${FACE}/react.ts`]:
          "import 'react'\nimport 'react/jsx-runtime'\nimport 'react-dom'\nimport 'react-dom/server'\nimport 'scheduler'",
        [`${FACE}/shell.ts`]:
          "import '@restro/shell'\nimport type { shell } from '../../../shell/src/index'\nexport type S = typeof shell",
      },
      [],
    )
  })

  it('leaves tests and test-* helpers alone, and does not look at code outside the faces', async () => {
    await expectRules(
      {
        ...faces,
        [`${FACE}/face.test.tsx`]:
          "import 'vitest'\nimport '@restro/shell/testing'\nimport '@restro/core'",
        [`${FACE}/test-views.ts`]: "import '@restro/shell/testing'\nimport '@restro/core'",
        'packages/shell/src/uses-core.ts': "import '../../core/src/index'",
        'apps/web/app/uses-icons.ts': "import 'lucide-react'\nimport '@restro/editorial-market'",
      },
      [],
    )
  })

  it('does not exempt a production file that merely has "test" in its name', async () => {
    const lines = await expectRules(
      {
        ...faces,
        [`${FACE}/contest.ts`]: "import '@restro/core'",
        [`${FACE}/latest.tsx`]: "import 'lucide-react'",
        [`${FACE}/testing.ts`]: "import '@restro/core'",
      },
      ['faces-only-react-and-shell'],
    )
    expect(lines).toHaveLength(3)
  })
})

describe('coverage of the rule set', () => {
  it('has a case above for every forbidden rule in the config', () => {
    const configured = (config.forbidden ?? []).map((rule) => rule.name).sort()
    expect(configured.length).toBeGreaterThanOrEqual(6)
    expect([...seenRules].sort()).toEqual(configured)
  })
})
