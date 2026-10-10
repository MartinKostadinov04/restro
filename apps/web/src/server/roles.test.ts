import { describe, expect, it } from 'vitest'

import { canManageIntegration, canPublishMenu } from './roles'

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

describe('canPublishMenu', () => {
  it('is for owners and admins, like the integration, and nobody else', () => {
    for (const role of ['owner', 'admin', 'member,admin', ' Owner ']) {
      expect(canPublishMenu(role), role).toBe(true)
    }
    for (const role of ['member', 'administrator', '', null, undefined]) {
      expect(canPublishMenu(role), String(role)).toBe(false)
    }
  })
})
