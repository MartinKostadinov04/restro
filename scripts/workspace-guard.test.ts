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

import { vitestPackageDirs, workspaceParents } from './workspace-packages.ts'

// The workspace guard (A6-F2, D67). A package that pnpm, Vitest or the typecheck does not know
// about is silently left out: its tests never run and `pnpm test` stays green. This test fails
// instead. For every package.json under apps/ and packages/ (any depth) it checks that the
// package is
//   1. matched by a glob in pnpm-workspace.yaml (so `pnpm -r` sees it),
//   2. a Vitest project (vitest.config.ts builds its projects from scripts/workspace-packages.ts),
//   3. typechecked: it has a tsconfig.json and a "typecheck" script.
// The self-tests build fake trees, so the guard itself is pinned (as depcruise-rules.test.ts does).

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Folders that never hold source packages (dependencies and build output).
const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
])

/** Every folder under `apps/` and `packages/` that has a package.json, relative with "/". */
function findPackageDirs(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    const path = join(root, dir)
    if (!existsSync(path)) return
    const entries = readdirSync(path, { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name === 'package.json')) found.push(dir)
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) walk(`${dir}/${entry.name}`)
    }
  }
  for (const top of ['apps', 'packages']) walk(top)
  return found.filter((dir) => dir !== 'apps' && dir !== 'packages').sort()
}

/** The glob lines of the `packages:` list in pnpm-workspace.yaml (no YAML library needed). */
function workspaceGlobs(root: string): string[] {
  const globs: string[] = []
  let inPackages = false
  for (const line of readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/)) {
    if (/^packages\s*:\s*$/.test(line)) {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    const item = /^\s+-\s+(.+?)\s*$/.exec(line)
    if (item?.[1]) {
      globs.push(item[1].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2'))
    } else if (!/^\s*(#.*)?$/.test(line)) {
      inPackages = false // another top-level key ends the list
    }
  }
  return globs
}

/** pnpm's folder globs: `*` is one folder name, `**` is any number of folders. */
function globToRegExp(glob: string): RegExp {
  const source = glob
    .split(/(\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**') return '.*'
      if (part === '*') return '[^/]*'
      if (part === '?') return '[^/]'
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
  return new RegExp(`^${source}$`)
}

function inWorkspace(dir: string, globs: string[]): boolean {
  const included = globs
    .filter((glob) => !glob.startsWith('!'))
    .some((g) => globToRegExp(g).test(dir))
  const excluded = globs
    .filter((glob) => glob.startsWith('!'))
    .some((glob) => globToRegExp(glob.slice(1)).test(dir))
  return included && !excluded
}

/** What is wrong with the workspace, one sentence per problem. Empty means the guard passes. */
function checkWorkspace(root: string): string[] {
  const problems: string[] = []
  const globs = workspaceGlobs(root)
  const projectDirs = new Set(vitestPackageDirs(root))
  for (const dir of findPackageDirs(root)) {
    if (!inWorkspace(dir, globs)) {
      problems.push(
        `${dir}: not matched by any glob in pnpm-workspace.yaml (${globs.join(', ')}), so pnpm -r skips it. Add its glob there.`,
      )
    }
    if (!projectDirs.has(dir)) {
      problems.push(
        `${dir}: not a Vitest project, so its tests never run. vitest.config.ts scans ${workspaceParents.join(', ')} (scripts/workspace-packages.ts); add its parent folder there.`,
      )
    }
    if (!existsSync(join(root, dir, 'tsconfig.json'))) {
      problems.push(`${dir}: no tsconfig.json.`)
    }
    const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    if (!manifest.scripts?.typecheck) {
      problems.push(`${dir}: package.json has no "typecheck" script, so pnpm typecheck skips it.`)
    }
  }
  return problems
}

describe('the real workspace', () => {
  it('finds the packages it is meant to guard (so the check is not vacuous)', () => {
    const dirs = findPackageDirs(repoRoot)
    for (const expected of [
      'apps/web',
      'apps/worker',
      'packages/core',
      'packages/db',
      'packages/barsy',
      'packages/faces/qr-phone',
    ]) {
      expect(dirs).toContain(expected)
    }
  })

  it('has every package in pnpm-workspace.yaml, in Vitest and in the typecheck', () => {
    expect(checkWorkspace(repoRoot)).toEqual([])
  })

  it('reads the globs of pnpm-workspace.yaml', () => {
    expect(workspaceGlobs(repoRoot)).toEqual(['apps/*', 'packages/*', 'packages/faces/*'])
  })
})

describe('the guard itself (fake trees)', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'restro-workspace-guard-'))
  let caseNumber = 0
  afterAll(() => rmSync(sandbox, { recursive: true, force: true }))

  const realWorkspaceFile = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  const withTypecheck = JSON.stringify({ name: 'x', scripts: { typecheck: 'tsc --noEmit' } })

  /** Writes a fake repository and returns its root. `pnpm-workspace.yaml` is the real one. */
  function fakeTree(files: Record<string, string>): string {
    caseNumber += 1
    const root = join(sandbox, `case-${caseNumber}`)
    for (const [path, content] of Object.entries({
      'pnpm-workspace.yaml': realWorkspaceFile,
      ...files,
    })) {
      const file = join(root, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, content)
    }
    return root
  }

  it('passes a complete package in a covered folder', () => {
    const root = fakeTree({
      'packages/ok/package.json': withTypecheck,
      'packages/ok/tsconfig.json': '{}',
      'packages/faces/pretty/package.json': withTypecheck,
      'packages/faces/pretty/tsconfig.json': '{}',
      'apps/site/package.json': withTypecheck,
      'apps/site/tsconfig.json': '{}',
    })
    expect(checkWorkspace(root)).toEqual([])
  })

  it('fails a package at packages/connectors/x: no workspace glob, not a Vitest project', () => {
    // The layout A3 proposes for connectors. Today nothing covers it; CF-06 adds the glob and the
    // Vitest parent with the first such package, and this case then needs a new "uncovered" path.
    const root = fakeTree({
      'packages/connectors/x/package.json': withTypecheck,
      'packages/connectors/x/tsconfig.json': '{}',
    })
    const problems = checkWorkspace(root)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toMatch(
      /^packages\/connectors\/x: not matched by any glob in pnpm-workspace\.yaml/,
    )
    expect(problems[1]).toMatch(/^packages\/connectors\/x: not a Vitest project/)
  })

  it('fails a package without a tsconfig.json', () => {
    const root = fakeTree({ 'packages/a/package.json': withTypecheck })
    expect(checkWorkspace(root)).toEqual(['packages/a: no tsconfig.json.'])
  })

  it('fails a package without a typecheck script', () => {
    const root = fakeTree({
      'packages/b/package.json': JSON.stringify({ name: 'b', scripts: { build: 'tsc' } }),
      'packages/b/tsconfig.json': '{}',
    })
    expect(checkWorkspace(root)).toEqual([
      'packages/b: package.json has no "typecheck" script, so pnpm typecheck skips it.',
    ])
  })

  it('fails a package that has no scripts at all', () => {
    const root = fakeTree({
      'apps/c/package.json': JSON.stringify({ name: 'c' }),
      'apps/c/tsconfig.json': '{}',
    })
    expect(checkWorkspace(root)).toHaveLength(1)
  })

  it('fails a package nested deeper than the globs reach', () => {
    const root = fakeTree({
      'packages/faces/qr/extra/package.json': withTypecheck,
      'packages/faces/qr/extra/tsconfig.json': '{}',
    })
    expect(checkWorkspace(root)).toHaveLength(2)
  })

  it('ignores package.json files inside node_modules and build output', () => {
    const root = fakeTree({
      'packages/ok/package.json': withTypecheck,
      'packages/ok/tsconfig.json': '{}',
      'packages/ok/node_modules/dep/package.json': '{}',
      'apps/web/.next/standalone/package.json': '{}',
    })
    expect(checkWorkspace(root)).toEqual([])
  })

  it('honours an exclusion glob and a glob that reaches deeper', () => {
    const root = fakeTree({
      'pnpm-workspace.yaml': 'packages:\n  - apps/*\n  - packages/**\n  - "!packages/skip"\n',
      'packages/deep/er/package.json': withTypecheck,
      'packages/deep/er/tsconfig.json': '{}',
      'packages/skip/package.json': withTypecheck,
      'packages/skip/tsconfig.json': '{}',
    })
    const problems = checkWorkspace(root)
    // packages/deep/er is in the workspace but is not a Vitest project; packages/skip is excluded.
    expect(problems.filter((p) => p.startsWith('packages/deep/er')).length).toBe(1)
    expect(problems.some((p) => p.startsWith('packages/skip: not matched'))).toBe(true)
  })
})
