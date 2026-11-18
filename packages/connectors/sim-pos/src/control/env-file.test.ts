import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { envFileValue, envLocalValue } from './env-file'

describe('envFileValue', () => {
  it('reads a plain, quoted and exported value, and the last one wins', () => {
    expect(envFileValue('A=1\nSIM_POS_URL=http://127.0.0.1:4011\n', 'SIM_POS_URL')).toBe(
      'http://127.0.0.1:4011',
    )
    expect(envFileValue('SIM_POS_URL="http://x:1" # mine', 'SIM_POS_URL')).toBe('http://x:1')
    expect(envFileValue("export SIM_POS_URL='http://x:2'\r\n", 'SIM_POS_URL')).toBe('http://x:2')
    expect(envFileValue('SIM_POS_URL=a\nSIM_POS_URL=b', 'SIM_POS_URL')).toBe('b')
  })

  it('ignores comments, other keys and an empty value', () => {
    expect(
      envFileValue('# SIM_POS_URL=http://x\nOTHER_SIM_POS_URL=y', 'SIM_POS_URL'),
    ).toBeUndefined()
    expect(envFileValue('SIM_POS_URL=', 'SIM_POS_URL')).toBeUndefined()
  })
})

describe('envLocalValue', () => {
  it('reads .env.local of a folder, and nothing when there is none', () => {
    const folder = mkdtempSync(join(tmpdir(), 'sim-pos-env-'))
    try {
      expect(envLocalValue(folder, 'SIM_POS_URL')).toBeUndefined()
      writeFileSync(join(folder, '.env.local'), 'SIM_POS_URL=http://127.0.0.1:4020\n')
      expect(envLocalValue(folder, 'SIM_POS_URL')).toBe('http://127.0.0.1:4020')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  })
})
