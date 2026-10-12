import { describe, expect, it } from 'vitest'

import { type SyncAllGateInput, type SyncGateInput, syncAllGate, syncGate } from './gating'

const ready: SyncGateInput = {
  canManage: true,
  integration: { hasCredentials: true, status: 'connected' },
  venueLinked: true,
  menuKnown: true,
  activeJob: null,
}

describe('syncGate', () => {
  it('opens when connected, the venue is linked and nothing is running', () => {
    expect(syncGate(ready)).toEqual({ enabled: true })
  })

  it.each([
    ['someone who cannot manage', { canManage: false }, 'not_manager'],
    ['no integration at all', { integration: null }, 'no_credentials'],
    [
      'an integration without credentials',
      { integration: { hasCredentials: false, status: 'new' } },
      'no_credentials',
    ],
    [
      'an integration that was never checked',
      { integration: { hasCredentials: true, status: 'new' } },
      'not_connected',
    ],
    [
      'an integration in error',
      { integration: { hasCredentials: true, status: 'error' } },
      'not_connected',
    ],
    ['a venue that is not linked', { venueLinked: false }, 'no_till_venue'],
    ['menus the system has not reported', { menuKnown: false }, 'no_menu'],
    ['a pull that is queued or running', { activeJob: 'pull' }, 'busy'],
    ['a connection check that is queued or running', { activeJob: 'connect' }, 'checking'],
  ] as const)('is closed for %s', (_name, change, reason) => {
    expect(syncGate({ ...ready, ...change } as SyncGateInput)).toEqual({ enabled: false, reason })
  })

  it('names the first thing that stands in the way, in the order a manager fixes them', () => {
    const nothingDone: SyncGateInput = {
      canManage: true,
      integration: null,
      venueLinked: false,
      menuKnown: false,
      activeJob: null,
    }
    expect(syncGate(nothingDone)).toEqual({ enabled: false, reason: 'no_credentials' })
    expect(
      syncGate({
        ...nothingDone,
        integration: { hasCredentials: true, status: 'connected' },
      }),
    ).toEqual({ enabled: false, reason: 'no_till_venue' })
    // Not being allowed to manage outranks everything: there is nothing for that person to fix.
    expect(syncGate({ ...nothingDone, canManage: false })).toEqual({
      enabled: false,
      reason: 'not_manager',
    })
  })
})

describe('syncAllGate ("Sync everything now")', () => {
  const ready: SyncAllGateInput = {
    canManage: true,
    integration: { hasCredentials: true, status: 'connected' },
    linkedVenues: 2,
    pullableVenues: 1,
    activeJob: null,
  }

  it('opens when connected and at least one linked venue can be read', () => {
    expect(syncAllGate(ready)).toEqual({ enabled: true })
  })

  it.each([
    ['someone who cannot manage', { canManage: false }, 'not_manager'],
    ['no integration at all', { integration: null }, 'no_credentials'],
    [
      'an integration that was never checked',
      { integration: { hasCredentials: true, status: 'new' } },
      'not_connected',
    ],
    ['no venue linked', { linkedVenues: 0, pullableVenues: 0 }, 'no_till_venue'],
    ['linked venues whose menus are not reported', { pullableVenues: 0 }, 'no_menu'],
    ['a pull that is queued or running', { activeJob: 'pull' }, 'busy'],
    ['a connection check that is queued or running', { activeJob: 'connect' }, 'checking'],
  ] as const)('is closed for %s', (_name, change, reason) => {
    expect(syncAllGate({ ...ready, ...change } as SyncAllGateInput)).toEqual({
      enabled: false,
      reason,
    })
  })
})
