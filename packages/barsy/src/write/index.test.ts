import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as write from './index.ts'

// CLAUDE.md rule 7: sync never writes into barsy. packages/barsy/src/write/ exports only calls on
// Martin's allowlist, and that allowlist is currently empty. If you are here because this test
// failed, a call was added to write/ without his approval recorded in docs/tracker.md: remove it,
// or get the approval first and then update this test in the same change.
describe('barsy write allowlist (rule 7)', () => {
  it('exports nothing', () => {
    expect(Object.keys(write)).toStrictEqual([])
  })

  it('has no export statement other than the empty one', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n')
    const exportStatements = code.match(/\bexport\b[^\n]*/g) ?? []
    expect(exportStatements).toStrictEqual(['export {}'])
  })
})
