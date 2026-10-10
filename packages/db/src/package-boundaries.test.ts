// Static checks of the package's shape (no database needed): the read/write split cannot be
// undone by a re-export, and only the two entry points are importable.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const srcRoot = join(packageRoot, 'src')
const writeRoot = join(srcRoot, 'write')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

/** Every module specifier in `import ... from '…'`, `export ... from '…'` and `import('…')`. */
function specifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) found.push(match[1])
  }
  return found
}

describe('@restro/db package boundaries', () => {
  it('exports exactly two entry points: the read side and the write side', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    expect(manifest.exports).toEqual({
      '.': './src/index.ts',
      './write': './src/write/index.ts',
    })
  })

  it('nothing outside src/write imports the write side (so @restro/db never re-exports it)', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(srcRoot)) {
      if (file.startsWith(writeRoot)) continue
      for (const specifier of specifiers(file)) {
        const target = specifier.startsWith('.') ? resolve(file, '..', specifier) : specifier
        if (target.startsWith(writeRoot) || /@restro\/db\/write/.test(specifier)) {
          offenders.push(`${relative(packageRoot, file)} -> ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('src never imports scripts/ (owner-only code) and keeps extensionless relative imports', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(srcRoot)) {
      for (const specifier of specifiers(file)) {
        if (!specifier.startsWith('.')) continue
        if (resolve(file, '..', specifier).startsWith(join(packageRoot, 'scripts'))) {
          offenders.push(`${relative(packageRoot, file)} imports owner-only ${specifier}`)
        }
        // Apps type-check src/ with their own tsconfig, which rejects '.ts' extensions.
        if (specifier.endsWith('.ts')) {
          offenders.push(`${relative(packageRoot, file)} uses a .ts extension: ${specifier}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
