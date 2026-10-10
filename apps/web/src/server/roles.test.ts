import { describe, expect, it } from 'vitest'

import { canManageIntegration } from './roles'

describe('canManageIntegration', () => {
  it('allows owners and admins', () => {
    expect(canManageIntegration('owner')).toBe(true)
    expect(canManageIntegration('admin')).toBe(true)
  })

  it('allows a person with several roles when one of them is owner or admin', () => {
    expect(canManageIntegration('member,admin')).toBe(true)
    expect(canManageIntegration(' Owner ')).toBe(true)
  })

  it('refuses members, unknown roles and a missing role', () => {
    expect(canManageIntegration('member')).toBe(false)
    expect(canManageIntegration('administrator')).toBe(false)
    expect(canManageIntegration('')).toBe(false)
    expect(canManageIntegration(null)).toBe(false)
    expect(canManageIntegration(undefined)).toBe(false)
  })
})
