// The owner's ordering settings and the Telegram link on the service write path (#87) on a real
// Postgres, as the restro_app role: hours and the ordering rules need `settings.guards`, alert
// recipients and the Telegram group `settings.alerts`, each with a sign-in of the last 15 minutes;
// a change merges into the saved settings and is one `record` Log entry naming the keys; hours that
// don't fit the night are refused; the worker's Telegram link writes the group and a person's id,
// refusing one id for two people. Skipped without a database.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasDatabase } from '../apply/test-database'
import { readOrderingSettings } from '../ordering-settings'
import { openServiceWorld, type ServiceWorld } from '../testing/service-world'
import type { ServiceActor, ServiceContext } from './context'
import { applyService, readVenueAccess, type ServiceCommand } from './index'

describe.skipIf(!hasDatabase)('the owner settings commands (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  let managerId: string
  let managerStaffId: `sm_${string}`

  beforeAll(async () => {
    world = await openServiceWorld('owner-settings')
    ownerId = await world.addUser('owner')
    managerId = await world.addUser('member')
    // A manager without `settings.guards`, with `settings.alerts`.
    managerStaffId = (await world.addStaff(
      ['tables.open_close', 'settings.alerts'],
      managerId,
    )) as typeof managerStaffId
  })

  afterAll(async () => {
    await world?.close()
  })

  const user = (userId: string): ServiceActor => ({
    kind: 'user',
    userId,
    sessionId: `sess-${randomUUID()}`,
  })
  const context = (
    origin: ServiceContext['origin'],
    actor: ServiceActor,
    signedInAt: Date | null,
  ): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin,
    actor,
    jobId: `req-${randomUUID()}`,
    ...(signedInAt === null ? {} : { signedInAt }),
  })
  const run = async (
    command: ServiceCommand,
    actor: ServiceActor = user(ownerId),
    signedInAt: Date | null = new Date(),
  ) => (await applyService(world.app, command, context('staff', actor, signedInAt))).result
  const worker = async (command: ServiceCommand) =>
    (await applyService(world.app, command, context('worker', { kind: 'system' }, null))).result
  const settings = async () => {
    const { rows } = await world.owner.query<{ settings: Record<string, unknown> }>(
      'select settings from restro.venues where id = $1',
      [world.venueId],
    )
    return readOrderingSettings(rows[0]?.settings ?? {})
  }
  const logOf = async (reason: string) => {
    const { rows } = await world.owner.query<{
      retention: string
      details: Record<string, unknown>
    }>(
      `select retention, details from restro.log_entries
        where venue_id = $1 and kind = 'settings.changed' and reason = $2 order by seq`,
      [world.venueId, reason],
    )
    return rows
  }

  const THURSDAY = { opens: '23:00', lastOrders: '04:30', closes: '05:00' }

  it('saves hours and rules as a record Log entry naming the keys, and merges into what is saved', async () => {
    const result = await run({
      type: 'settings.ordering_set',
      changes: {
        capMinor: 20_000,
        serviceHours: { ...(await settings()).serviceHours, thu: THURSDAY },
      },
    })
    expect(result).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(await settings()).toMatchObject({
      capMinor: 20_000,
      onlyOpenTables: true,
      serviceHours: { thu: THURSDAY },
    })
    const entries = await logOf('ordering')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.retention).toBe('record')
    expect(entries[0]?.details).toEqual({ keys: 'capMinor,serviceHours' })
    // Another key later keeps the cap and the hours.
    await run({ type: 'settings.ordering_set', changes: { pacePer15Minutes: null } })
    expect(await settings()).toMatchObject({ capMinor: 20_000, pacePer15Minutes: null })
  })

  it('logs nothing when nothing changes, and an empty change only checks the right', async () => {
    const before = (await logOf('ordering')).length
    expect(await run({ type: 'settings.ordering_set', changes: {} })).toMatchObject({
      status: 'accepted',
      details: { changed: false },
    })
    expect((await logOf('ordering')).length).toBe(before)
  })

  it('refuses hours that do not fit the night, naming nothing but the problem, and saves none', async () => {
    const before = await settings()
    const result = await run({
      type: 'settings.ordering_set',
      changes: {
        serviceHours: {
          ...before.serviceHours,
          fri: { opens: '23:00', lastOrders: '22:00', closes: '05:00' },
        },
      },
    })
    expect(result).toMatchObject({ status: 'refused', code: 'invalid_settings' })
    expect(await settings()).toEqual(before)
  })

  it('refuses last orders closer than 15 minutes to the day end', async () => {
    const before = await settings()
    const result = await run({
      type: 'settings.ordering_set',
      changes: {
        serviceHours: {
          ...before.serviceHours,
          sat: { opens: '23:00', lastOrders: '06:50', closes: '06:55' },
        },
      },
    })
    expect(result).toMatchObject({ status: 'refused', code: 'invalid_settings' })
  })

  it('asks for the password again after 15 minutes, and refuses a person without the right', async () => {
    const stale = new Date(Date.now() - 16 * 60_000)
    expect(
      await run(
        { type: 'settings.ordering_set', changes: { capMinor: 10_000 } },
        user(ownerId),
        stale,
      ),
    ).toMatchObject({ code: 'sign_in_again' })
    expect(
      await run({ type: 'settings.ordering_set', changes: { capMinor: 10_000 } }, user(managerId)),
    ).toMatchObject({ code: 'permission_denied' })
  })

  it('refuses a payload that touches keys outside the command’s own set', async () => {
    const before = await settings()
    expect(
      await run({
        type: 'settings.ordering_set',
        changes: { alertRecipientUserIds: [ownerId] },
      } as never),
    ).toMatchObject({ code: 'invalid_command' })
    expect(
      await run(
        { type: 'settings.alerts_set', changes: { capMinor: 1 } } as never,
        user(managerId),
      ),
    ).toMatchObject({ code: 'invalid_command' })
    expect(await settings()).toEqual(before)
  })

  it('refuses the alert settings after 15 minutes, and a person with only settings.alerts the rules', async () => {
    const stale = new Date(Date.now() - 16 * 60_000)
    expect(
      await run(
        { type: 'settings.alerts_set', changes: { telegramChatId: null } },
        user(managerId),
        stale,
      ),
    ).toMatchObject({ code: 'sign_in_again' })
    expect(
      await run({ type: 'settings.ordering_set', changes: { capMinor: 5 } }, user(managerId)),
    ).toMatchObject({ code: 'permission_denied' })
  })

  it('lets a person with settings.alerts choose who gets alerts, among the organisation’s accounts', async () => {
    expect(
      await run(
        { type: 'settings.alerts_set', changes: { alertRecipientUserIds: [managerId] } },
        user(managerId),
      ),
    ).toMatchObject({ status: 'accepted' })
    expect((await settings()).alertRecipientUserIds).toEqual([managerId])
    expect(
      await run(
        { type: 'settings.alerts_set', changes: { alertRecipientUserIds: ['someone-else'] } },
        user(managerId),
      ),
    ).toMatchObject({ code: 'account_unknown' })
    expect(
      await run(
        { type: 'settings.alerts_set', changes: { telegramChatId: null } },
        user(managerId),
      ),
    ).toMatchObject({ status: 'accepted' })
  })

  it('links the Telegram group the poller heard, keeps its name only in the Log, and unlinks on the bot leaving', async () => {
    const linked = await worker({
      type: 'telegram.link',
      what: 'group',
      chatId: '-100123456',
      title: 'Club Nova staff',
    })
    expect(linked).toMatchObject({ status: 'accepted' })
    expect((await settings()).telegramChatId).toBe('-100123456')
    expect((await logOf('telegram_linked'))[0]?.details).toEqual({ group: 'Club Nova staff' })

    // Another group leaving changes nothing.
    await worker({ type: 'telegram.link', what: 'group_left', chatId: '-100999' })
    expect((await settings()).telegramChatId).toBe('-100123456')
    await worker({
      type: 'telegram.link',
      what: 'group_left',
      chatId: '-100123456',
      title: 'Club Nova staff',
    })
    expect((await settings()).telegramChatId).toBeNull()
    expect((await logOf('telegram_left'))[0]?.retention).toBe('record')
  })

  it('refuses the worker’s link from a staff origin, and a staff command from the worker', async () => {
    expect(
      (
        await applyService(
          world.app,
          { type: 'telegram.link', what: 'group', chatId: '-1' },
          context('staff', user(ownerId), new Date()),
        )
      ).result,
    ).toMatchObject({ code: 'origin_not_allowed' })
    expect(await worker({ type: 'settings.ordering_set', changes: { capMinor: 1 } })).toMatchObject(
      { code: 'origin_not_allowed' },
    )
  })

  it('links a person’s Telegram id for one person only, and unlinks it from the settings', async () => {
    const link = (staffMemberId: string, telegramUserId: string) =>
      worker({ type: 'telegram.link', what: 'person', staffMemberId, telegramUserId })
    expect(await link(managerStaffId, '777')).toMatchObject({
      status: 'accepted',
      details: { changed: true },
    })
    const { rows } = await world.owner.query<{ telegram_user_id: string | null }>(
      'select telegram_user_id from restro.staff_members where id = $1',
      [managerStaffId],
    )
    expect(rows[0]?.telegram_user_id).toBe('777')

    const otherStaffId = await world.addStaff(['tables.open_close'])
    expect(await link(otherStaffId, '777')).toMatchObject({ code: 'telegram_taken' })
    expect(await link(otherStaffId, '778')).toMatchObject({ status: 'accepted' })

    // The owner unlinks from the settings (a `record` Log entry); a repeat changes nothing.
    expect(
      await run({
        type: 'staff.link_telegram',
        staffMemberId: managerStaffId,
        telegramUserId: null,
      }),
    ).toMatchObject({ status: 'accepted', details: { changed: true } })
    expect(
      await run({
        type: 'staff.link_telegram',
        staffMemberId: managerStaffId,
        telegramUserId: null,
      }),
    ).toMatchObject({ details: { changed: false } })
    const { rows: log } = await world.owner.query<{ retention: string }>(
      `select retention from restro.log_entries
        where venue_id = $1 and kind = 'staff.changed' and to_state = 'telegram_unlinked'`,
      [world.venueId],
    )
    expect(log).toHaveLength(1)
    expect(log[0]?.retention).toBe('record')
  })

  it('reads what a person holds here, and that a shared device holds no settings right', async () => {
    const owner = await readVenueAccess(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(ownerId),
    })
    expect(owner).toMatchObject({ ok: true, device: false })
    expect(owner.ok && owner.permissions).toContain('settings.guards')

    const manager = await readVenueAccess(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: user(managerId),
    })
    expect(manager.ok && [...manager.permissions].sort()).toEqual([
      'settings.alerts',
      'tables.open_close',
    ])

    const sessionId = `sess-${randomUUID()}`
    await world.addSharedDevice(sessionId)
    const device = await readVenueAccess(world.app, {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'user', userId: ownerId, sessionId },
    })
    expect(device).toMatchObject({ ok: true, device: true })
    expect(device.ok && device.permissions.some((p) => p.startsWith('settings.'))).toBe(false)
  })
})
