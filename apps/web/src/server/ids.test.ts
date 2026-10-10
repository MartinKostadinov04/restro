import { isId } from '@restro/core'
import { describe, expect, it } from 'vitest'

import { authModelId } from './ids'

describe('authModelId', () => {
  it('makes an organisation id a tenant id: tn_ + 22 base62 characters', () => {
    for (let i = 0; i < 50; i++) expect(isId('tn', authModelId('organization'))).toBe(true)
  })

  it('makes the other Better Auth ids random 32-character base62 strings', () => {
    const ids = new Set<string>()
    for (const model of ['user', 'session', 'account', 'verification', 'member', 'invitation']) {
      const id = authModelId(model)
      expect(id).toMatch(/^[0-9A-Za-z]{32}$/)
      ids.add(id)
    }
    expect(ids.size).toBe(6)
  })
})
