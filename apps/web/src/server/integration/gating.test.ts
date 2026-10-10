import { describe, expect, it } from 'vitest'

import { type SyncGateInput, syncGate } from './gating'

const ready: SyncGateInput = {
  canManage: true,
  integration: { hasCredentials: true, status: 'connected' },
  venueMapped: true,
  rootChosen: true,
  activeJob: null,
}

describe('syncGate', () => {
  it('opens when connected, both pickers are set and nothing is running', () => {
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
    ['no barsy venue chosen', { venueMapped: false }, 'no_barsy_venue'],
    ['no catalogue root chosen', { rootChosen: false }, 'no_root'],
    ['a pull that is queued or running', { activeJob: 'pull' }, 'busy'],
    ['a connection check that is queued or running', { activeJob: 'connect' }, 'checking'],
  ] as const)('is closed for %s', (_name, change, reason) => {
    expect(syncGate({ ...ready, ...change } as SyncGateInput)).toEqual({ enabled: false, reason })
  })

  it('names the first thing that stands in the way, in the order a manager fixes them', () => {
    const nothingDone: SyncGateInput = {
      canManage: true,
      integration: null,
      venueMapped: false,
      rootChosen: false,
      activeJob: null,
    }
    expect(syncGate(nothingDone)).toEqual({ enabled: false, reason: 'no_credentials' })
    expect(
      syncGate({
        ...nothingDone,
        integration: { hasCredentials: true, status: 'connected' },
      }),
    ).toEqual({ enabled: false, reason: 'no_barsy_venue' })
    // Not being allowed to manage outranks everything: there is nothing for that person to fix.
    expect(syncGate({ ...nothingDone, canManage: false })).toEqual({
      enabled: false,
      reason: 'not_manager',
    })
  })
})
