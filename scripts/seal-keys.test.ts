import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { parseSealPublicKey } from '../packages/core/src/seal/index'
import { isSealKeyPair, parseSealPrivateKey } from '../packages/core/src/seal/open/index'
import { writeEnv } from './seal-keys.mjs'

const SCRIPT = fileURLToPath(new URL('./seal-keys.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'restro-seal-keys-'))
let fileNumber = 0
const freshFile = (content?: string) => {
  fileNumber += 1
  const file = join(dir, `.env.case-${fileNumber}`)
  if (content !== undefined) writeFileSync(file, content)
  return file
}

/** The value of `NAME=` in an env file. */
const valueOf = (text: string, name: string) =>
  new RegExp(`^${name}=(.*)$`, 'm').exec(text)?.[1] ?? ''

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('pnpm keys:seal', () => {
  it('appends a pair that @restro/core reads, keeping what the file had', () => {
    const file = freshFile('DATABASE_URL=postgres://x')
    const result = writeEnv(file)
    const text = readFileSync(file, 'utf8')
    expect(text.startsWith('DATABASE_URL=postgres://x\n')).toBe(true)
    const publicText = valueOf(text, 'SEAL_PUBLIC_KEY')
    const privateText = valueOf(text, 'SEAL_PRIVATE_KEY')
    expect(result).toEqual({ outcome: 'written', path: file, publicKey: publicText })
    expect(isSealKeyPair(parseSealPublicKey(publicText), parseSealPrivateKey(privateText))).toBe(
      true,
    )
  })

  it('leaves a file that has both keys alone, and refuses one with a single key or .env.example', () => {
    const file = freshFile()
    writeEnv(file)
    const before = readFileSync(file, 'utf8')
    expect(writeEnv(file)).toMatchObject({ outcome: 'kept', publicKey: null })
    expect(readFileSync(file, 'utf8')).toBe(before)

    const half = freshFile('export SEAL_PUBLIC_KEY=abc\n# SEAL_PRIVATE_KEY=commented\n')
    expect(() => writeEnv(half)).toThrow(/only one of/)
    // Empty placeholders (as in .env.example) count as unset.
    const placeholders = freshFile('SEAL_PUBLIC_KEY=\nSEAL_PRIVATE_KEY=\n')
    expect(writeEnv(placeholders).outcome).toBe('written')
    expect(() => writeEnv(join(dir, '.env.example'))).toThrow(/committed/)
  })

  it('prints the public key and the path, never the private key', () => {
    const file = freshFile()
    const run = spawnSync(process.execPath, [SCRIPT, '--write-env', file], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    const text = readFileSync(file, 'utf8')
    const privateText = valueOf(text, 'SEAL_PRIVATE_KEY')
    expect(privateText.length).toBeGreaterThan(40)
    expect(run.stdout).toContain(valueOf(text, 'SEAL_PUBLIC_KEY'))
    expect(run.stdout).toContain(file)
    expect(`${run.stdout}${run.stderr}`).not.toContain(privateText)
  })

  it('without --write-env it prints the usage and generates nothing', () => {
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(run.status).toBe(2)
    expect(run.stderr).toContain('Usage: pnpm keys:seal --write-env <file>')
    expect(run.stdout).toBe('')
  })
})
