// The command list (design §2.1; spec #64, 3 and 12): every command says where it may come from and
// what it needs, and the context names an actor that fits its origin.
import { describe, expect, it } from 'vitest'

import { SERVICE_COMMANDS, ServiceCommandSchema } from './commands'
import { actorText, ServiceContextSchema } from './context'

const TENANT = 'tn_0123456789ABCDEFGHIJKL'
const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const TABLE = 'tb_0123456789ABCDEFGHIJKL'

describe('the service commands', () => {
  it('gives a permission to every staff command and none to guest or worker commands', () => {
    for (const [type, definition] of Object.entries(SERVICE_COMMANDS)) {
      expect(definition.origins.length, type).toBeGreaterThan(0)
      if (definition.origins.includes('staff')) {
        expect(definition.permission, type).not.toBeNull()
      } else {
        expect(definition.permission, type).toBeNull()
      }
    }
  })

  it('makes every guest command carry an action id', () => {
    for (const [type, definition] of Object.entries(SERVICE_COMMANDS)) {
      if (!definition.origins.includes('guest')) continue
      const parsed = definition.schema.safeParse({ type, tableId: TABLE })
      expect(parsed.success, type).toBe(false)
    }
  })

  it('builds the table-code commands (#70), both needing settings.codes', () => {
    for (const type of ['table_code.reissue', 'table_code.reveal'] as const) {
      expect(SERVICE_COMMANDS[type].permission, type).toBe('settings.codes')
      expect(SERVICE_COMMANDS[type].handle, type).not.toBeNull()
    }
    const reveal = SERVICE_COMMANDS['table_code.reveal'].schema
    expect(reveal.safeParse({ type: 'table_code.reveal', tableIds: [] }).success).toBe(false)
    expect(reveal.safeParse({ type: 'table_code.reveal', tableIds: [TABLE] }).success).toBe(true)
  })

  it('builds the people commands (#72): settings.roles, from a person, with a fresh sign-in', () => {
    const types = [
      'role.copy',
      'role.update',
      'role.archive',
      'staff.add',
      'staff.rename',
      'staff.assign',
      'staff.unassign',
      'staff.archive',
      'staff.link_account',
      'pin.reset',
      'pin.reveal',
      'device.mark_shared',
      'device.revoke',
    ] as const
    for (const type of types) {
      const definition = SERVICE_COMMANDS[type]
      expect(definition.permission, type).toBe('settings.roles')
      expect(definition.origins, type).toEqual(['staff'])
      expect(definition.freshSignIn, type).toBe(true)
      expect(definition.handle, type).not.toBeNull()
    }
    const add = SERVICE_COMMANDS['staff.add'].schema
    expect(add.safeParse({ type: 'staff.add', displayName: 'Ana', roleId: 'staff' }).success).toBe(
      true,
    )
    expect(add.safeParse({ type: 'staff.add', displayName: 'Ana', roleId: 'boss' }).success).toBe(
      false,
    )
    expect(add.safeParse({ type: 'staff.add', displayName: '', roleId: 'staff' }).success).toBe(
      false,
    )
    const update = SERVICE_COMMANDS['role.update'].schema
    expect(
      update.safeParse({
        type: 'role.update',
        roleId: 'rl_0123456789ABCDEFGHIJKL',
        permissions: ['x'],
      }).success,
    ).toBe(false)
  })

  it('parses a command through the union and refuses unknown fields', () => {
    const add = { type: 'order.add', tableId: TABLE, actionId: crypto.randomUUID() }
    expect(ServiceCommandSchema.parse(add)).toEqual(add)
    expect(ServiceCommandSchema.safeParse({ ...add, priceMinor: 1 }).success).toBe(false)
  })
})

describe('the service context', () => {
  const base = { tenantId: TENANT, venueId: VENUE, jobId: 'req-1' }

  it('accepts an actor that fits the origin', () => {
    expect(
      ServiceContextSchema.safeParse({ ...base, origin: 'guest', actor: { kind: 'guest' } })
        .success,
    ).toBe(true)
    expect(
      ServiceContextSchema.safeParse({
        ...base,
        origin: 'staff',
        actor: { kind: 'user', userId: 'u1', sessionId: 's1' },
        via: 'telegram',
      }).success,
    ).toBe(true)
  })

  it('refuses a guest carrying a staff actor, or a guest write via Telegram', () => {
    expect(
      ServiceContextSchema.safeParse({
        ...base,
        origin: 'guest',
        actor: { kind: 'user', userId: 'u1', sessionId: 's1' },
      }).success,
    ).toBe(false)
    expect(
      ServiceContextSchema.safeParse({
        ...base,
        origin: 'guest',
        actor: { kind: 'guest' },
        via: 'telegram',
      }).success,
    ).toBe(false)
  })

  it('refuses a missing or malformed job id (rule 2: job_id NOT NULL)', () => {
    const context = {
      tenantId: TENANT,
      venueId: VENUE,
      origin: 'worker',
      actor: { kind: 'system' },
    }
    expect(ServiceContextSchema.safeParse(context).success).toBe(false)
    expect(ServiceContextSchema.safeParse({ ...context, jobId: ' bad' }).success).toBe(false)
  })

  it('writes actors as the database pattern expects', () => {
    expect(actorText({ kind: 'guest' })).toBe('guest')
    expect(actorText({ kind: 'staff', staffMemberId: 'sm_1', sessionId: 's' })).toBe('staff:sm_1')
    expect(actorText({ kind: 'operator', userId: 'u9' })).toBe('operator:u9')
  })
})
