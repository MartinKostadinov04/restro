import { describe, expect, it } from 'vitest'

import { type PushRecipient, pushTargets } from './push-targets'

const person = (
  userId: string,
  over: Partial<Omit<PushRecipient, 'userId'>> = {},
): PushRecipient => ({
  userId,
  owner: false,
  switchedOn: false,
  holds: new Set<string>(),
  ...over,
})
const ids = (list: readonly PushRecipient[]) => list.map((p) => p.userId)

const owner = person('owner', { owner: true, switchedOn: true })
const manager = person('manager', { switchedOn: true, holds: new Set(['money.follow_up']) })
const waiter = person('waiter', { switchedOn: true, holds: new Set(['alerts.answer']) })
const offManager = person('offManager', { holds: new Set(['money.follow_up']) })
const offOwner = person('offOwner', { owner: true })

describe('who an alert pushes to (#87)', () => {
  it('rings an alert with no permission for every switched-on person, and no one else', () => {
    expect(ids(pushTargets([owner, manager, waiter, offManager], null, false))).toEqual([
      'owner',
      'manager',
      'waiter',
    ])
  })

  it('rings a money alert only for switched-on people who hold the permission; an owner always does', () => {
    expect(
      ids(pushTargets([owner, manager, waiter, offManager], 'money.follow_up', false)),
    ).toEqual(['owner', 'manager'])
  })

  it('narrows to owners when the step says so, still after the permission', () => {
    expect(ids(pushTargets([owner, manager, waiter], 'money.follow_up', true))).toEqual(['owner'])
  })

  it('never silences it: when no switched-on person holds it, every holder rings', () => {
    expect(ids(pushTargets([waiter, offManager, offOwner], 'money.follow_up', false))).toEqual([
      'offManager',
      'offOwner',
    ])
    expect(ids(pushTargets([waiter, offManager, offOwner], 'money.follow_up', true))).toEqual([
      'offOwner',
    ])
  })

  it('falls back to the owners for an owners-only step when only a non-owner holder is switched on', () => {
    // The owner's switch is off, a switched-on manager holds the permission: the owners-only step
    // still rings the owner, never nobody.
    expect(ids(pushTargets([manager, offOwner], 'money.follow_up', true))).toEqual(['offOwner'])
    expect(ids(pushTargets([manager, offOwner], 'money.follow_up', false))).toEqual(['manager'])
  })

  it('rings no one when nobody holds it at all', () => {
    expect(pushTargets([waiter], 'money.follow_up', false)).toEqual([])
  })
})
