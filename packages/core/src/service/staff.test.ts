// The people commands (D122 §7; ticket #72) on a real Postgres, as the restro_app role: the
// venue's Staff and Manager roles are ticked in place and reset while the Owner's stays fixed
// (#366), nobody grants what they don't hold, a new person gets a PIN kept
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
import {
  applyService,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  readStaffSettings,
  readVenueAccess,
  type ServiceCommand,
} from './index'
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

  it('keeps the Owner role fixed; a copy is the venue own role', async () => {
    const settings = await readStaffSettings(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: owner(),
    })
    if (!settings.ok) throw new Error(settings.code)
    const ownerRole = settings.settings.roles.find((role) => role.defaultKind === 'owner')
    expect(ownerRole).toMatchObject({ readOnly: true })
    expect(ownerRole?.id).toMatch(/^rl_/)
    // An owner who could take `settings.roles` off their own role would lock the venue out (#366).
    expect(
      await run({ type: 'role.update', roleId: rl(ownerRole?.id), permissions: ['sold_out'] }),
    ).toMatchObject({ code: 'role_read_only' })
    expect(await run({ type: 'role.reset', roleId: 'owner' })).toMatchObject({
      code: 'role_read_only',
    })
    expect(await run({ type: 'role.archive', roleId: rl(ownerRole?.id) })).toMatchObject({
      code: 'role_read_only',
    })

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

  /** The venue's roles as the role editor reads them, by kind. */
  const roleView = async (kind: string) => {
    const settings = await readStaffSettings(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: owner(),
    })
    if (!settings.ok) throw new Error(settings.code)
    const role = settings.settings.roles.find((candidate) => candidate.defaultKind === kind)
    if (role === undefined) throw new Error(`no ${kind} role`)
    return role
  }
  /** What the permission check says an actor holds at the venue (`resolveGrants`). */
  const holdsOf = async (actor: ServiceActor) => {
    const access = await readVenueAccess(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor,
    })
    if (!access.ok) throw new Error(access.code)
    return [...access.permissions].sort()
  }
  /** The `known_permissions` marker of a default role, straight from the row. */
  const markerOf = async (kind: string) => {
    const { rows } = await world.owner.query<{ known_permissions: string[] | null }>(
      'select known_permissions from restro.venue_roles where venue_id = $1 and default_kind = $2',
      [world.venueId, kind],
    )
    return rows[0]?.known_permissions ?? null
  }

  it('ticks the Staff role in place: the editor and the permission check answer the same (#366)', async () => {
    const waiterId = await world.addUser('member')
    const { staffMemberId } = await accepted({
      type: 'staff.add',
      displayName: 'Nina',
      roleId: 'staff',
    })
    await world.owner.query('update restro.staff_members set user_id = $2 where id = $1', [
      sm(staffMemberId),
      waiterId,
    ])
    const waiter = (): ServiceActor => ({
      kind: 'user',
      userId: waiterId,
      sessionId: `sess-${randomUUID()}`,
    })
    const shipped = [...DEFAULT_ROLE_PERMISSIONS.staff].sort()

    // As Restro ships it: no marker, the code's table, and the same answer on both sides.
    expect(await markerOf('staff')).toBeNull()
    expect(await roleView('staff')).toMatchObject({ readOnly: false, edited: false })
    expect([...(await roleView('staff')).permissions].sort()).toEqual(shipped)
    expect(await holdsOf(waiter())).toEqual(shipped)

    // The venue takes one ability off, in place: no copy, nobody moved.
    const without = DEFAULT_ROLE_PERMISSIONS.staff.filter(
      (permission) => permission !== 'alerts.answer',
    )
    await accepted({ type: 'role.update', roleId: 'staff', permissions: without })
    const edited = await roleView('staff')
    expect(edited).toMatchObject({ edited: true, readOnly: false, newPermissions: [] })
    expect([...edited.permissions].sort()).toEqual([...without].sort())
    expect(await holdsOf(waiter())).toEqual([...without].sort())
    expect(await markerOf('staff')).toEqual([...PERMISSIONS])
    // The Log names the role and what it holds now, in the entry's own details.
    const entry = (await logOf('role.changed')).at(-1)
    expect(entry).toMatchObject({ retention: 'record' })
    expect(entry?.details).toMatchObject({ holdsCount: without.length, removed: 'alerts.answer' })
    expect(String(entry?.details.holds)).toContain('tables.open_close')

    // Reset puts back exactly what Restro ships, and the role follows the table again.
    await accepted({ type: 'role.reset', roleId: 'staff' })
    expect(await markerOf('staff')).toBeNull()
    expect(await roleView('staff')).toMatchObject({ edited: false })
    expect([...(await roleView('staff')).permissions].sort()).toEqual(shipped)
    expect(await holdsOf(waiter())).toEqual(shipped)
    expect((await logOf('role.changed')).at(-1)?.details).toMatchObject({
      holdsCount: DEFAULT_ROLE_PERMISSIONS.staff.length,
    })
  })

  it('leaves a permission Restro adds later unticked on an edited role, and marks it new (#366)', async () => {
    // The venue edited its Manager role before this permission existed: its marker holds the keys
    // the code knew then. Whatever permission is added next, this is what happens to it.
    const added = PERMISSIONS.at(-1) ?? 'settings.guests'
    const knownBefore = PERMISSIONS.filter((permission) => permission !== added)
    await accepted({ type: 'role.update', roleId: 'manager', permissions: knownBefore })
    await world.owner.query(
      'update restro.venue_roles set known_permissions = $3::jsonb where venue_id = $1 and default_kind = $2',
      [world.venueId, 'manager', JSON.stringify(knownBefore)],
    )
    const view = await roleView('manager')
    expect(view.permissions).not.toContain(added)
    expect(view.newPermissions).toEqual([added])

    const staff = await roleView('staff')
    // A role the venue never edited still gets it from the code, with nothing marked new.
    expect(staff.newPermissions).toEqual([])
    expect(staff.permissions.includes(added)).toBe(DEFAULT_ROLE_PERMISSIONS.staff.includes(added))
    await accepted({ type: 'role.reset', roleId: 'manager' })
  })

  it('keeps the three default names as Restro ships them, and keeps all three (#366)', async () => {
    expect(await run({ type: 'role.update', roleId: 'staff', name: 'Waiters' })).toMatchObject({
      code: 'role_read_only',
    })
    const staffRole = await roleView('staff')
    expect(staffRole.name).toBe('Staff')
    expect(await run({ type: 'role.archive', roleId: rl(staffRole.id) })).toMatchObject({
      code: 'role_read_only',
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

  it('makes a browser the bar tablet only for a staff-only account (RR-O35), with a fresh sign-in', async () => {
    const person = async (
      orgRole: 'owner' | 'admin' | 'member' | null,
      venueRole: 'staff' | 'manager' | null,
    ): Promise<ServiceActor> => {
      const userId = await world.addUser(orgRole ?? undefined)
      if (venueRole !== null) await world.addStaff(DEFAULT_ROLE_PERMISSIONS[venueRole], userId)
      return { kind: 'user', userId, sessionId: `sess-${randomUUID()}` }
    }
    const mark = { type: 'device.mark_shared', name: 'Bar tablet' } as const
    const devices = async () =>
      (
        await world.owner.query<{ n: number }>(
          'select count(*)::int as n from restro.shared_devices where venue_id = $1',
          [world.venueId],
        )
      ).rows[0]?.n
    const before = await devices()

    // Owner, admin and manager hold more than staff: one refusal that names the account to use.
    for (const actor of [
      owner(),
      await person('admin', null),
      await person('owner', 'staff'),
      await person('member', 'manager'),
    ]) {
      expect(await run(mark, actor)).toMatchObject({
        status: 'refused',
        code: 'staff_account_required',
      })
    }
    // A plain member holds nothing here; Restro's admin team never marks a venue's device.
    expect(await run(mark, await person('member', null))).toMatchObject({
      status: 'refused',
      code: 'permission_denied',
    })
    const operatorId = await world.addUser()
    await world.addOperator(operatorId)
    expect((await run(mark, { kind: 'operator', userId: operatorId })).status).toBe('refused')
    expect(await devices()).toBe(before)

    // The staff account: only with the password of the last 15 minutes.
    const waiter = await person('member', 'staff')
    expect(await run(mark, waiter, new Date(Date.now() - 20 * 60_000))).toMatchObject({
      code: 'sign_in_again',
    })
    expect(await run(mark, waiter)).toMatchObject({ status: 'accepted' })
    expect(await devices()).toBe((before ?? 0) + 1)
  })

  it('asks a shared device for a PIN; the PIN never unlocks settings', async () => {
    const barId = await world.addUser('member')
    const barSession = `sess-${randomUUID()}`
    const bar: ServiceActor = { kind: 'user', userId: barId, sessionId: barSession }
    // The bar tablet's account: a staff-only one (RR-O35).
    await world.addStaff(DEFAULT_ROLE_PERMISSIONS.staff, barId)
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
