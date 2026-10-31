// The people commands (D122 §7; ticket #72) on a real Postgres, as the restro_app role: default
// roles are read-only and copied, nobody grants what they don't hold, a new person gets a PIN kept
// only as its HMAC and a sealed copy, a reset draws another, a reveal is a `record` Log entry, a
// settings change needs a sign-in of the last 15 minutes, Restro's admin team acts at any venue,
// a shared device asks for a PIN and the fifth wrong one in five minutes trips the guard.
// Skipped without a database.
import { generateKeyPairSync, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { PinGuard } from '../pin-guard'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { identifyStaffByPin } from './identify'
import { applyService, readStaffSettings, type ServiceCommand } from './index'
import { pinHmac } from './pins'

const { publicKey } = generateKeyPairSync('x25519')
const PEPPER = 'a-test-pepper-of-at-least-32-characters'
const OPTIONS = { sealPublicKey: publicKey, pinPepper: PEPPER }

/** An id from a command's details, typed by its prefix. */
const sm = (value: unknown) => String(value) as `sm_${string}`
const rl = (value: unknown) => String(value) as `rl_${string}`
const dv = (value: unknown) => String(value) as `dv_${string}`

describe.skipIf(!hasDatabase)('the people commands (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string

  beforeAll(async () => {
    world = await openServiceWorld('staff')
    ownerId = await world.addUser('owner')
  })

  afterAll(async () => {
    await world?.close()
  })

  /** `signedInAt` null: the sign-in time is unknown. */
  const context = (actor: ServiceActor, signedInAt: Date | null) =>
    ({
      tenantId: world.tenantId,
      venueId: world.venueId,
      origin: 'staff',
      actor,
      jobId: `req-${randomUUID()}`,
      ...(signedInAt === null ? {} : { signedInAt }),
    }) satisfies ServiceContext
  const owner = (): ServiceActor => ({
    kind: 'user',
    userId: ownerId,
    sessionId: `sess-${randomUUID()}`,
  })
  const run = async (
    command: ServiceCommand,
    actor: ServiceActor = owner(),
    signedInAt: Date | null = new Date(),
  ) => {
    const { result } = await applyService(world.app, command, context(actor, signedInAt), OPTIONS)
    return result
  }
  const accepted = async (command: ServiceCommand, actor?: ServiceActor) => {
    const result = await run(command, actor)
    if (result.status !== 'accepted') throw new Error(`refused: ${JSON.stringify(result)}`)
    return result.details
  }
  const memberRow = async (id: string) => {
    const { rows } = await world.owner.query<{
      pin_hmac: string | null
      pin_sealed: string | null
      archived_at: Date | null
    }>('select pin_hmac, pin_sealed, archived_at from restro.staff_members where id = $1', [id])
    return rows[0]
  }
  /** The PIN behind an HMAC, found by trying all 10 000 (the test never opens the seal). */
  const pinOf = (hmac: string | null | undefined): string => {
    for (let n = 0; n < 10_000; n += 1) {
      const pin = String(n).padStart(4, '0')
      if (pinHmac(PEPPER, world.tenantId, pin) === hmac) return pin
    }
    throw new Error('no PIN matches')
  }
  const logOf = async (kind: string) => {
    const { rows } = await world.owner.query<{
      retention: string
      details: Record<string, unknown>
      actor: string
    }>(
      'select retention, details, actor from restro.log_entries where venue_id = $1 and kind = $2 order by seq',
      [world.venueId, kind],
    )
    return rows
  }

  it('asks for the password again after 15 minutes, or when the sign-in time is unknown', async () => {
    const add = { type: 'staff.add', displayName: 'Ana', roleId: 'staff' } as const
    expect(await run(add, owner(), null)).toMatchObject({ code: 'sign_in_again' })
    const stale = new Date(Date.now() - 16 * 60_000)
    expect(await run(add, owner(), stale)).toMatchObject({ code: 'sign_in_again' })
  })

  it('adds a person with a PIN kept only as its HMAC and a sealed copy, all in the Log', async () => {
    const { staffMemberId } = await accepted({
      type: 'staff.add',
      displayName: 'Ana',
      roleId: 'staff',
    })
    const row = await memberRow(sm(staffMemberId))
    expect(row?.pin_hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.pin_sealed).toMatch(/^rs1\./)
    const pin = pinOf(row?.pin_hmac)
    for (const kind of ['staff.changed', 'assignment.changed', 'pin.changed']) {
      const entries = await logOf(kind)
      expect(entries.length, kind).toBeGreaterThan(0)
      for (const entry of entries) {
        expect(entry.retention, kind).toBe('record')
        expect(JSON.stringify(entry.details), kind).not.toContain(pin)
        expect(JSON.stringify(entry.details), kind).not.toContain(row?.pin_hmac ?? 'x')
      }
    }
  })

  it('draws a new PIN on reset, and logs a reveal', async () => {
    const { staffMemberId } = await accepted({
      type: 'staff.add',
      displayName: 'Boris',
      roleId: 'staff',
    })
    const id = sm(staffMemberId)
    const before = await memberRow(id)
    await accepted({ type: 'pin.reset', staffMemberId: id })
    const after = await memberRow(id)
    expect(after?.pin_hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(after?.pin_hmac).not.toBe(before?.pin_hmac)
    expect(after?.pin_sealed).not.toBe(before?.pin_sealed)
    await accepted({ type: 'pin.reveal', staffMemberIds: [id] })
    const reveals = await logOf('pin.revealed')
    expect(reveals.at(-1)).toMatchObject({ retention: 'record' })
  })

  it('keeps default roles read-only; a copy is the venue own role', async () => {
    const settings = await readStaffSettings(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: owner(),
    })
    if (!settings.ok) throw new Error(settings.code)
    const staffRole = settings.settings.roles.find((role) => role.defaultKind === 'staff')
    expect(staffRole).toMatchObject({ readOnly: true })
    expect(staffRole?.id).toMatch(/^rl_/)
    expect(
      await run({ type: 'role.update', roleId: rl(staffRole?.id), permissions: ['sold_out'] }),
    ).toMatchObject({ code: 'role_read_only' })

    const { roleId } = await accepted({ type: 'role.copy', fromRoleId: 'staff', name: 'Bar' })
    await accepted({
      type: 'role.update',
      roleId: rl(roleId),
      permissions: ['tables.open_close', 'sold_out'],
    })
    const again = await readStaffSettings(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: owner(),
    })
    if (!again.ok) throw new Error(again.code)
    expect(again.settings.roles.find((role) => role.id === roleId)).toMatchObject({
      name: 'Bar',
      readOnly: false,
      permissions: ['tables.open_close', 'sold_out'],
    })
    expect(await run({ type: 'role.copy', fromRoleId: 'staff', name: 'bar' })).toMatchObject({
      code: 'role_name_taken',
    })
  })

  it('lets nobody grant what they do not hold, nor manage someone holding more', async () => {
    const managerId = await world.addUser('member')
    await world.addStaff(['settings.roles', 'tables.open_close'], managerId)
    const manager = (): ServiceActor => ({
      kind: 'user',
      userId: managerId,
      sessionId: `sess-${randomUUID()}`,
    })
    expect(
      await run({ type: 'staff.add', displayName: 'Vera', roleId: 'owner' }, manager()),
    ).toMatchObject({ code: 'permission_not_held' })
    expect(
      await run({ type: 'role.copy', fromRoleId: 'manager', name: 'Shift lead' }, manager()),
    ).toMatchObject({ code: 'permission_not_held' })

    const { staffMemberId: boss } = await accepted({
      type: 'staff.add',
      displayName: 'Boss',
      roleId: 'manager',
    })
    expect(await run({ type: 'pin.reset', staffMemberId: sm(boss) }, manager())).toMatchObject({
      code: 'permission_denied',
    })
  })

  it("lets Restro's admin team act at any venue, until its grant is revoked", async () => {
    const operatorId = await world.addUser()
    await world.addOperator(operatorId)
    const operator: ServiceActor = { kind: 'operator', userId: operatorId }
    const { staffMemberId } = await accepted(
      { type: 'staff.add', displayName: 'Dora', roleId: 'owner' },
      operator,
    )
    await accepted({ type: 'pin.reveal', staffMemberIds: [sm(staffMemberId)] }, operator)
    expect((await logOf('pin.revealed')).at(-1)?.actor).toBe(`operator:${operatorId}`)

    const revokedId = await world.addUser()
    await world.addOperator(revokedId, true)
    const refused = await run(
      { type: 'staff.add', displayName: 'Eli', roleId: 'staff' },
      { kind: 'operator', userId: revokedId },
    )
    expect(refused.status).toBe('refused')
  })

  it('archives a person (no PIN left) and refuses to archive a role in use', async () => {
    const { roleId } = await accepted({ type: 'role.copy', fromRoleId: 'staff', name: 'Door' })
    const { staffMemberId } = await accepted({
      type: 'staff.add',
      displayName: 'Filip',
      roleId: rl(roleId),
    })
    expect(await run({ type: 'role.archive', roleId: rl(roleId) })).toMatchObject({
      code: 'role_in_use',
    })
    await accepted({ type: 'staff.archive', staffMemberId: sm(staffMemberId) })
    const row = await memberRow(sm(staffMemberId))
    expect(row).toMatchObject({ pin_hmac: null, pin_sealed: null })
    expect(row?.archived_at).not.toBeNull()
    await accepted({ type: 'role.archive', roleId: rl(roleId) })
  })

  it('asks a shared device for a PIN; the PIN never unlocks settings', async () => {
    const barId = await world.addUser('member')
    const barSession = `sess-${randomUUID()}`
    const bar: ServiceActor = { kind: 'user', userId: barId, sessionId: barSession }
    await world.addStaff(['settings.roles'], barId)
    const { deviceId } = await accepted({ type: 'device.mark_shared', name: 'Bar tablet' }, bar)
    // The bar device's own sign-in no longer counts: every write there asks for a PIN.
    expect(await run({ type: 'device.mark_shared', name: 'Again' }, bar)).toMatchObject({
      code: 'pin_required',
    })
    expect(
      await run({ type: 'staff.add', displayName: 'Gosho', roleId: 'staff' }, bar),
    ).toMatchObject({ code: 'pin_required' })

    const { staffMemberId } = await accepted({
      type: 'staff.add',
      displayName: 'Hristo',
      roleId: 'owner',
    })
    const pin = pinOf((await memberRow(sm(staffMemberId)))?.pin_hmac)
    const guard = new PinGuard()
    const identify = (tried: string, sessionId = barSession) =>
      identifyStaffByPin(world.app, {
        tenantId: world.tenantId,
        venueId: world.venueId,
        userId: barId,
        sessionId,
        pin: tried,
        pepper: PEPPER,
        guard,
        jobId: `req-${randomUUID()}`,
      })
    expect(await identify(pin, `sess-${randomUUID()}`)).toEqual({
      ok: false,
      code: 'not_shared_device',
    })
    expect(await identify(pin)).toEqual({ ok: true, staffMemberId, deviceId, name: 'Hristo' })

    // An owner's PIN on the shared device still never reaches settings.
    const staffActor: ServiceActor = {
      kind: 'staff',
      staffMemberId: sm(staffMemberId),
      sessionId: barSession,
    }
    expect(
      await run({ type: 'staff.add', displayName: 'Ivo', roleId: 'staff' }, staffActor),
    ).toMatchObject({ status: 'refused' })

    const wrong = pin === '9999' ? '9998' : String((Number(pin) + 1) % 10_000).padStart(4, '0')
    const answers = []
    for (let n = 0; n < 5; n += 1) answers.push(await identify(wrong))
    expect(answers.slice(0, 4).every((answer) => !answer.ok && answer.code === 'pin_wrong')).toBe(
      true,
    )
    expect(answers[4]).toEqual({ ok: false, code: 'device_waiting', retryAfterSeconds: 60 })
    expect(await identify(pin)).toMatchObject({ ok: false, code: 'device_waiting' })
    const trips = await logOf('guard.tripped')
    expect(trips.at(-1)).toMatchObject({ details: { deviceId, trip: 1, waitSeconds: 60 } })
    expect(JSON.stringify(trips.at(-1)?.details)).not.toContain(wrong)

    // Revoked from another session, the device is an ordinary sign-in again.
    await accepted({ type: 'device.revoke', deviceId: dv(deviceId) })
    expect(await identify(pin)).toEqual({ ok: false, code: 'not_shared_device' })
  })

  it('reads the people settings with no PIN or HMAC in them', async () => {
    const settings = await readStaffSettings(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: owner(),
    })
    if (!settings.ok) throw new Error(settings.code)
    expect(settings.settings.roles.map((role) => role.defaultKind).slice(0, 3)).toEqual([
      'staff',
      'manager',
      'owner',
    ])
    expect(settings.settings.staff.find((person) => person.displayName === 'Ana')).toMatchObject({
      hasPin: true,
      hasAccount: false,
    })
    expect(JSON.stringify(settings)).not.toMatch(/pin_?hmac|pin_?sealed|rs1\./i)
  })
})
