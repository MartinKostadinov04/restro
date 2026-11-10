// Where the PIN falls, as pure data (ticket #324; D141). What is pinned here is the agreement the
// engine depends on: every reservation command a shared device can run is one of the venue's
// actions, the stored default says the same thing as the commands' own `quickOnSharedDevice`
// flags, the two commands that split by payload split where D141 says ("seat a walk-in" and
// "change the guest count" are taps, writing a booking and editing its details are four digits),
// and a stored value the code no longer understands is ignored rather than taken as a refusal.
import { describe, expect, it } from 'vitest'

import { RESERVATION_COMMANDS } from './commands'
import {
  actionsBehindPin,
  DEFAULT_PIN_FALL,
  fallOf,
  PIN_FALL_ACTIONS,
  PinActionsSchema,
  type PinFallAction,
  pinFallActionOf,
  storedPinActions,
} from './pin-fall'

/**
 * The action every reservation command is, for a payload that carries nothing but what the command
 * needs. Null is "the venue's list does not cover it": the settings and guest-record commands (a
 * PIN never reaches a settings-class permission), the plan and the spots a venue lays out from its
 * own screen, and the worker's sweep, which no person taps at all.
 */
const ACTION_OF: Readonly<Record<string, PinFallAction | null>> = {
  'plan.save': null,
  'plan.remove': null,
  'spot.save': null,
  'spot.remove': null,
  'spot.set_seats': null,
  'reservation_closed_date.add': null,
  'reservation_closed_date.remove': null,
  'spot_kind.save': null,
  'spot_kind.remove': null,
  'reservation_settings.set': null,
  'guest.save': null,
  'guest.private_note': null,
  'guest.erase': null,
  'reservation.create': 'create',
  'reservation.edit': 'edit',
  'reservation.cancel': 'cancel',
  'reservation.delete': 'delete',
  'reservation.restore': 'restore',
  'reservation.copy': 'copy',
  'reservation.set_status': 'status',
  'reservation.put_back': 'put_back',
  // The door (#329): marking a party present is the same action as finishing one, its Undo is
  // that action again, "how many came?" is the guest count and a walk-in is a walk-in — so the
  // three new commands need no action of their own.
  'reservation.arrive': 'status',
  'reservation.seat_walk_in': 'walk_in',
  'reservation.set_guests': 'guest_count',
  'reservation.undo_arrival': 'status',
  // #334: the pay rule a party carries is four digits of its own, D141's own line for money.
  'reservation.set_pay_rule': 'pay_rule',
  'reservation.hold_spots': 'spots',
  'reservation.release_spots': 'spots',
  // #331: changing a party's tables is the same tap as holding or freeing its spots.
  'reservation.change_tables': 'spots',
  'waiting.add': 'waiting',
  'waiting.reorder': 'waiting',
  'block.save': 'block',
  'block.remove': 'block',
  'reservation_night.close': 'end_night',
  'reservation_night.sweep': null,
}

describe('where the PIN falls', () => {
  it('reads an action off every reservation command, and nothing off any other', () => {
    const types = Object.keys(RESERVATION_COMMANDS).sort()
    expect(types).toEqual(Object.keys(ACTION_OF).sort())
    for (const type of types) {
      expect(pinFallActionOf(type, { type }), type).toBe(ACTION_OF[type])
    }
    // A command of another area, and a type that is no command at all.
    expect(pinFallActionOf('table.open', { type: 'table.open' })).toBeNull()
    expect(pinFallActionOf('nope', null)).toBeNull()
  })

  it('agrees with the commands own quick flags, so the default is one rule in two places', () => {
    for (const [type, definition] of Object.entries(RESERVATION_COMMANDS)) {
      const action = ACTION_OF[type]
      if (action === null || action === undefined) continue
      const quick = 'quickOnSharedDevice' in definition && definition.quickOnSharedDevice === true
      // The two that split by payload carry no flag: the engine reads the venue's list instead,
      // and the tap half of each ('walk_in', 'guest_count') is where the default puts it below.
      if (type === 'reservation.create' || type === 'reservation.edit') {
        expect(quick, type).toBe(false)
        continue
      }
      expect(DEFAULT_PIN_FALL[action], type).toBe(quick ? 'tap' : 'pin')
    }
    expect(DEFAULT_PIN_FALL.walk_in).toBe('tap')
    expect(DEFAULT_PIN_FALL.guest_count).toBe('tap')
  })

  it('places every action, and puts D141s five taps on one tap', () => {
    expect(Object.keys(DEFAULT_PIN_FALL).sort()).toEqual([...PIN_FALL_ACTIONS].sort())
    const taps = PIN_FALL_ACTIONS.filter((action) => DEFAULT_PIN_FALL[action] === 'tap')
    expect([...taps]).toEqual(['status', 'guest_count', 'walk_in', 'waiting', 'spots'])
  })

  it('tells seating a walk-in from writing a booking', () => {
    expect(pinFallActionOf('reservation.create', { kind: 'walk_in', partySize: 4 })).toBe('walk_in')
    expect(pinFallActionOf('reservation.create', { kind: 'booking', partySize: 4 })).toBe('create')
    // A payload with no kind is the stricter half: the schema refuses it afterwards anyway.
    expect(pinFallActionOf('reservation.create', {})).toBe('create')
  })

  it('tells the guest count at the door from an edit of the booking', () => {
    const edit = (fields: Record<string, unknown>) => pinFallActionOf('reservation.edit', fields)
    expect(edit({ reservationId: 'rs_1', partySize: 6 })).toBe('guest_count')
    expect(edit({ reservationId: 'rs_1', partySize: 6, note: 'by the DJ' })).toBe('edit')
    expect(edit({ reservationId: 'rs_1', partySize: 6, startsAt: '2026-11-09T22:00:00Z' })).toBe(
      'edit',
    )
    expect(edit({ reservationId: 'rs_1', partySize: 6, endsAt: null })).toBe('edit')
    expect(edit({ reservationId: 'rs_1', partySize: 6, turnMinutes: 120 })).toBe('edit')
    expect(edit({ reservationId: 'rs_1', partySize: 6, partyLabel: 'Ivo' })).toBe('edit')
    expect(edit({ reservationId: 'rs_1', note: 'by the DJ' })).toBe('edit')
  })

  it('takes a venues own choice, and ignores a stored value it cannot read', () => {
    const chosen = storedPinActions({
      status: 'pin',
      create: 'tap',
      cancel: 'nope',
      seat_everyone: 'tap',
      end_night: null,
    })
    expect(chosen).toEqual({ status: 'pin', create: 'tap' })
    expect(fallOf(chosen, 'status')).toBe('pin')
    expect(fallOf(chosen, 'create')).toBe('tap')
    // Everything the venue left alone falls where D141 puts it.
    expect(fallOf(chosen, 'cancel')).toBe('pin')
    expect(fallOf(chosen, 'waiting')).toBe('tap')
    expect(fallOf({}, 'end_night')).toBe('pin')
    // A row written before this ticket, and a row whose value is not an object at all.
    for (const value of [{}, null, undefined, 'tap', 7, []]) {
      expect(storedPinActions(value)).toEqual({})
    }
  })

  it('writes the night the Log needs: which actions asked for four digits', () => {
    expect(actionsBehindPin({})).toEqual([
      'create',
      'edit',
      'cancel',
      'delete',
      'restore',
      'put_back',
      'copy',
      'block',
      'pay_rule',
      'end_night',
    ])
    expect(actionsBehindPin({ status: 'pin', create: 'tap', edit: 'tap' })).toEqual([
      'status',
      'cancel',
      'delete',
      'restore',
      'put_back',
      'copy',
      'block',
      'pay_rule',
      'end_night',
    ])
  })

  it('accepts a command that moves one line, and refuses anything else', () => {
    expect(PinActionsSchema.safeParse({ walk_in: 'pin' }).success).toBe(true)
    expect(PinActionsSchema.safeParse({}).success).toBe(true)
    expect(PinActionsSchema.safeParse({ walk_in: 'maybe' }).success).toBe(false)
    expect(PinActionsSchema.safeParse({ everything: 'pin' }).success).toBe(false)
    expect(PinActionsSchema.safeParse({ walk_in: null }).success).toBe(false)
  })
})
