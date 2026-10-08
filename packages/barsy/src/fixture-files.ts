// Reading and writing fixture files. The only part of the package that touches the file system
// (apart from the recorder CLI around it).

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BarsyConfigError } from './errors.ts'
import { assertFixtureName, type BarsyFixture, fixtureSchema, serialiseFixture } from './fixture.ts'

/** `packages/barsy/fixtures`, wherever the repository is checked out. */
export const FIXTURES_ROOT = fileURLToPath(new URL('../fixtures/', import.meta.url))

export async function readFixture(path: string): Promise<BarsyFixture> {
  const text = await readFile(path, 'utf8')
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new BarsyConfigError(`fixture ${path} is not valid JSON`)
  }
  const result = fixtureSchema.safeParse(json)
  if (!result.success) {
    const where = result.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ')
    throw new BarsyConfigError(`fixture ${path} does not match the fixture format (${where})`)
  }
  return result.data
}

/** Every `*.json` fixture in `dir` (not recursive), sorted by file name. */
export async function readFixtureDir(dir: string): Promise<BarsyFixture[]> {
  const entries = await readdir(dir)
  const files = entries.filter((entry) => entry.endsWith('.json')).sort()
  return Promise.all(files.map((file) => readFixture(join(dir, file))))
}

export interface WriteFixtureOptions {
  readonly root: string
  readonly label: string
  readonly name: string
  /** Replace an existing file. Without it, an existing recording is never overwritten. */
  readonly force?: boolean
}

/** Writes `<root>/<label>/<name>.json` and returns its path. */
export async function writeFixture(
  fixture: BarsyFixture,
  options: WriteFixtureOptions,
): Promise<string> {
  assertFixtureName(options.name)
  const path = join(options.root, options.label, `${options.name}.json`)
  await mkdir(dirname(path), { recursive: true })
  try {
    // 'wx' fails when the file exists, so a recording is never lost by accident.
    await writeFile(path, serialiseFixture(fixture), {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new BarsyConfigError(`${path} already exists; pass --force to replace it`)
    }
    throw error
  }
  return path
}
