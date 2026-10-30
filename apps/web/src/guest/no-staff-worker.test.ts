// RR-86: the service worker and the manifest are the staff's. A guest's page registers no worker and
// links no manifest, so it behaves exactly as if they weren't there (rule 4, D121). The running pages
// are checked by e2e/push-control.spec.ts; this reads the sources, so a new route can't slip one in.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const WEB = fileURLToPath(new URL('../../', import.meta.url))
const REPO = join(WEB, '../..')
const MENTIONS = /serviceWorker|\/sw\.js|manifest\.webmanifest|rel=["']manifest|\bmanifest: ['"]/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name === '.next') return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const webFile = (path: string) => relative(WEB, path).replaceAll('\\', '/')

describe('the staff worker and manifest stay off guest pages', () => {
  it('only Tonight registers the worker, and only the admin layout links the manifest', () => {
    const found = [...sourceFiles(join(WEB, 'app')), ...sourceFiles(join(WEB, 'src'))]
      .filter((file) => MENTIONS.test(readFileSync(file, 'utf8')))
      .map(webFile)
      .sort()
    expect(found).toEqual(['app/(admin)/layout.tsx', 'src/tonight/push-device.ts'])
  })

  it('the shell and the templates mention neither', () => {
    const found = [
      ...sourceFiles(join(REPO, 'packages/shell')),
      ...sourceFiles(join(REPO, 'packages/faces')),
    ].filter((file) => MENTIONS.test(readFileSync(file, 'utf8')))
    expect(found).toEqual([])
  })

  it('no route file convention links a manifest from every page', () => {
    const conventions = readdirSync(join(WEB, 'app')).filter((name) => /^manifest\./.test(name))
    expect(conventions).toEqual([])
  })

  it('the guest routes sit outside the admin layout and import nothing of Tonight', () => {
    expect(existsSync(join(WEB, 'app/(admin)/m'))).toBe(false)
    expect(existsSync(join(WEB, 'app/(admin)/t'))).toBe(false)
    const guest = [
      ...sourceFiles(join(WEB, 'app/m')),
      ...sourceFiles(join(WEB, 'app/t')),
      ...sourceFiles(join(WEB, 'src/guest')),
    ]
    expect(guest.length).toBeGreaterThan(0)
    const importing = guest
      .filter((file) =>
        /from '@\/tonight|push-control|push-device/.test(readFileSync(file, 'utf8')),
      )
      .map(webFile)
    expect(importing).toEqual([])
  })

  it('only the control uses the device code, and only Tonight draws the control', () => {
    const users = (word: RegExp) =>
      sourceFiles(join(WEB, 'src'))
        .concat(sourceFiles(join(WEB, 'app')))
        .filter((file) => word.test(readFileSync(file, 'utf8')))
        .map(webFile)
    expect(users(/from '\.\/push-device'|tonight\/push-device/)).toEqual([
      'src/tonight/push-control.tsx',
    ])
    expect(users(/from '\.\/push-control'|tonight\/push-control/)).toEqual([
      'src/tonight/tonight-panel.tsx',
    ])
  })
})
