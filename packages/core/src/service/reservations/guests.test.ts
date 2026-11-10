// Guests and regulars on a real Postgres, as the restro_app role (ticket #333; D140, D141, D83).
// What is pinned here is what only a database can show: one record per number however it is
// written; the venue's list worked with `reservations.tonight`; the manager's own list refused —
// not merely left empty — to anybody else; an erasure that is an UPDATE leaving the reservations
// standing and clearing both lists; and a Log that names who and when, never a phone or an email.
// Skipped without a database.
import { randomUUID } from 'node:crypto'

import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hasDatabase } from '../../apply/test-database'
import type { Id } from '../../ids'
import { openServiceWorld, type ServiceWorld } from '../../testing/service-world'
import { applyService } from '../apply-service'
import type { ServiceActor, ServiceContext } from '../context'
import type { ServiceCommand } from '../index'
import { phoneKeyOf } from './guests'
import { readGuestCard, readGuestList, readGuestSuggestions, readPrivateList } from './guests-read'

const at = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 10, day, hour, minute, 0)).toISOString()

describe('phoneKeyOf: one key for one number, however it is written', () => {
  it('reads a national number in the venue country, and 00 as +', () => {
    const key = '359888123456'
    for (const typed of ['+359 888 123 456', '00359888123456', '+359 (888) 12-34-56']) {
      expect(phoneKeyOf(typed, 'BG')).toBe(key)
    }
    expect(phoneKeyOf('0888 123 456', 'BG')).toBe(key)
    // Without a country we know, a national number stays as typed: never guessed into another.
    expect(phoneKeyOf('0888 123 456', null)).toBe('0888123456')
    expect(phoneKeyOf('0888 123 456', 'XX')).toBe('0888123456')
    // A number written with + is international already: its 0 is not the trunk prefix.
    expect(phoneKeyOf('+44 020 7946 0958', 'BG')).toBe('4402079460958')
  })

  it('refuses what is not a number', () => {
    expect(phoneKeyOf('call me', 'BG')).toBeNull()
    expect(phoneKeyOf('12345', 'BG')).toBeNull()
    expect(phoneKeyOf('1'.repeat(21), 'BG')).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('guests and regulars (as the restro_app role)', () => {
  let world: ServiceWorld
  let ownerId: string
  /** Works tonight's reservations, and nothing settings-class. */
  let hostessId: string
  /** Keeps a private list: `settings.guests` on top of the floor's keys. */
  let managerId: string
  let managerStaffId: string
  /** A second manager, the colleague who must never read the first one's list. */
  let colleagueId: string
  const spots = new Map<string, string>()
  const contact = { phones: new Set<string>(), emails: new Set<string>() }

  const staff = (userId: string, signedInAt = new Date()): ServiceContext => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    origin: 'staff',
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
    jobId: `req-${randomUUID()}`,
    signedInAt,
  })
  const reader = (userId: string) => ({
    tenantId: world.tenantId,
    venueId: world.venueId,
    actor: { kind: 'user', userId, sessionId: `sess-${randomUUID()}` } satisfies ServiceActor,
  })

  const run = async (command: ServiceCommand, context: ServiceContext = staff(ownerId)) =>
    (await applyService(world.app, command, context)).result

  async function accept(
    command: ServiceCommand,
    context: ServiceContext = staff(ownerId),
  ): Promise<Record<string, unknown>> {
    const result = await run(command, context)
    if (result.status !== 'accepted') {
      throw new Error(`${command.type} refused: ${result.code} ${JSON.stringify(result.details)}`)
    }
    return result.details
  }

  /** A number nobody used in this run, written the way a hostess would type it. */
  let counter = 0
  const freshPhone = () => {
    counter += 1
    const phone = `0888 ${String(100_000 + counter).padStart(6, '0')}`
    contact.phones.add(phoneKeyOf(phone, 'BG') ?? phone)
    return phone
  }

  const book = async (
    serviceDate: string,
    startsAt: string,
    spot: string,
    over: Record<string, unknown>,
  ) =>
    (
      await accept(
        {
          type: 'reservation.create',
          serviceDate,
          startsAt,
          kind: 'booking',
          status: 'reserved',
          partySize: 4,
          spotIds: [spots.get(spot) as Id<'sp'>],
          ...over,
        } as ServiceCommand,
        staff(hostessId),
      )
    ).reservationId as Id<'rv'>

  const guestRow = async (guestId: string) =>
    (
      await world.owner.query<{
        phone_key: string | null
        phone: string | null
        name: string | null
        email: string | null
        note: string | null
        is_regular: boolean
        archived_at: Date | null
        erased_at: Date | null
      }>(
        `select phone_key, phone, name, email, note, is_regular, archived_at, erased_at
           from restro.guests where id = $1`,
        [guestId],
      )
    ).rows[0]

  /** Every Log entry of the venue, as the text a reader of the Log could ever see of it. */
  const logText = async () =>
    (
      await world.owner.query<{ line: string }>(
        `select row_to_json(l)::text as line from restro.log_entries l where venue_id = $1`,
        [world.venueId],
      )
    ).rows.map((row) => row.line)

  /** The national part of a number (its last nine digits), as it could appear in any format. */
  const national = (key: string) => key.slice(-9)

  beforeAll(async () => {
    world = await openServiceWorld('guests')
    ownerId = await world.addUser('owner')
    hostessId = await world.addUser('member')
    await world.addStaff(['reservations.tonight'], hostessId)
    managerId = await world.addUser('member')
    managerStaffId = await world.addStaff(
      ['reservations.manage', 'reservations.tonight', 'settings.guests'],
      managerId,
    )
    colleagueId = await world.addUser('member')
    await world.addStaff(
      ['reservations.manage', 'reservations.tonight', 'settings.guests'],
      colleagueId,
    )
    // A booking by hand needs a phone where the settings say so (#328); here they do.
    await accept({
      type: 'reservation_settings.set',
      turnMinutes: 90,
      phoneRequired: true,
      privateNotesOn: true,
    } as ServiceCommand)
    const planId = (await accept({ type: 'plan.save', name: 'Hall', makeCurrent: true }))
      .planId as string
    await accept({ type: 'spot_kind.save', key: 'table', label: 'Table', defaultSeats: 4 })
    for (const [index, name] of ['T1', 'T2', 'T3', 'T4'].entries()) {
      const details = await accept({
        type: 'spot.save',
        planId,
        name,
        kind: 'table',
        shape: 'rect',
        x: index * 100,
        y: 0,
        width: 80,
        height: 80,
      } as ServiceCommand)
      spots.set(name, details.spotId as string)
    }
  }, 60_000)

  afterAll(async () => {
    await world?.close()
  })

  it('keeps one guest for one number: two bookings written two ways link to one row', async () => {
    const first = await book('2026-11-20', at(20, 21), 'T1', {
      phone: '+359 887 555 001',
      guestName: 'Mira Ivanova',
    })
    const second = await book('2026-11-21', at(21, 21), 'T1', {
      phone: '0887 555 001',
      guestName: 'Mira',
    })
    contact.phones.add('359887555001')
    const rows = (
      await world.owner.query<{ guest_id: string | null }>(
        'select guest_id from restro.reservations where id = any($1::text[]) order by id',
        [[first, second]],
      )
    ).rows
    expect(rows).toHaveLength(2)
    expect(rows[0]?.guest_id).toBeTruthy()
    expect(rows[1]?.guest_id).toBe(rows[0]?.guest_id)
    const keyed = await world.owner.query(
      'select id from restro.guests where venue_id = $1 and phone_key = $2',
      [world.venueId, '359887555001'],
    )
    expect(keyed.rows).toHaveLength(1)
    // The record keeps the name it had: the second booking's own name is the booking's label.
    expect(await guestRow(rows[0]?.guest_id ?? '')).toMatchObject({ name: 'Mira Ivanova' })
  })

  it('lets a hostess add, change, archive and restore a regular (reservations.tonight)', async () => {
    const phone = freshPhone()
    const guestId = (
      await accept(
        { type: 'guest.save', phone, name: 'Boris', isRegular: true } as ServiceCommand,
        staff(hostessId),
      )
    ).guestId as string
    expect(await guestRow(guestId)).toMatchObject({ name: 'Boris', is_regular: true })
    // The same number again is refused and names the guest who has it.
    expect(
      await run(
        { type: 'guest.save', phone: phone.replace(/ /g, ''), name: 'Bobby' } as ServiceCommand,
        staff(hostessId),
      ),
    ).toMatchObject({ status: 'refused', code: 'guest_exists', details: { guestId } })
    await accept(
      { type: 'guest.save', guestId, name: 'Boris Kolev', note: 'likes T2' } as ServiceCommand,
      staff(hostessId),
    )
    await accept(
      { type: 'guest.save', guestId, archived: true } as ServiceCommand,
      staff(hostessId),
    )
    expect((await guestRow(guestId))?.archived_at).not.toBeNull()
    // Archived is not erased: he is still on the list, under Archived, with his details.
    const listed = await readGuestList(world.app, reader(hostessId))
    expect(listed.ok && listed.list.rows.find((row) => row.id === guestId)).toMatchObject({
      name: 'Boris Kolev',
      archived: true,
    })
    await accept(
      { type: 'guest.save', guestId, archived: false } as ServiceCommand,
      staff(hostessId),
    )
    expect(await guestRow(guestId)).toMatchObject({ archived_at: null, name: 'Boris Kolev' })
    // Three letters suggest him; two do not.
    const three = await readGuestSuggestions(world.app, { ...reader(hostessId), query: 'bor' })
    expect(three.ok && three.suggestions.map((one) => one.id)).toContain(guestId)
    const two = await readGuestSuggestions(world.app, { ...reader(hostessId), query: 'bo' })
    expect(two.ok && two.suggestions).toEqual([])
    // Erasing is settings-class: the hostess's role does not reach it.
    expect(
      await run({ type: 'guest.erase', guestId } as ServiceCommand, staff(hostessId)),
    ).toMatchObject({ status: 'refused', code: 'permission_denied' })
  })

  it('saves a booking’s guest to the regulars when the form’s tick says so, and needs a phone for it', async () => {
    const phone = freshPhone()
    const id = await book('2026-11-22', at(22, 22), 'T2', {
      phone,
      guestName: 'Ana',
      saveAsRegular: true,
    })
    const guestId = (
      await world.owner.query<{ guest_id: string }>(
        'select guest_id from restro.reservations where id = $1',
        [id],
      )
    ).rows[0]?.guest_id as string
    expect(await guestRow(guestId)).toMatchObject({ is_regular: true, name: 'Ana' })
    expect(
      await run(
        {
          type: 'reservation.create',
          serviceDate: '2026-11-22',
          startsAt: at(22, 23),
          kind: 'booking',
          status: 'reserved',
          partySize: 2,
          partyLabel: 'No number',
          spotIds: [spots.get('T3') as Id<'sp'>],
          saveAsRegular: true,
        } as ServiceCommand,
        staff(ownerId),
      ),
    ).toMatchObject({ status: 'refused', code: 'phone_required' })
  })

  it('refuses the private list to anybody but its keeper, and leaves his note off their card', async () => {
    const phone = freshPhone()
    const guestId = (
      await accept({ type: 'guest.save', phone, name: 'Pavel' } as ServiceCommand, staff(hostessId))
    ).guestId as string
    await accept(
      { type: 'guest.private_note', guestId, note: 'tips well' } as ServiceCommand,
      staff(managerId),
    )
    const own = await readPrivateList(world.app, reader(managerId))
    expect(own).toMatchObject({ ok: true, entries: [{ guestId, note: 'tips well' }] })
    const ownCard = await readGuestCard(world.app, { ...reader(managerId), guestId })
    expect(ownCard.ok && ownCard.card?.mine).toEqual({ onList: true, note: 'tips well' })

    // The colleague keeps a list of his own, and it does not hold the first one's note.
    const colleague = await readPrivateList(world.app, reader(colleagueId))
    expect(colleague).toMatchObject({ ok: true, entries: [] })
    const colleagueCard = await readGuestCard(world.app, { ...reader(colleagueId), guestId })
    expect(colleagueCard.ok && colleagueCard.card?.mine).toEqual({ onList: false, note: null })
    expect(JSON.stringify(colleagueCard)).not.toContain('tips well')

    // The hostess keeps none: the read refuses her, and her card and list carry nothing of it.
    expect(await readPrivateList(world.app, reader(hostessId))).toEqual({
      ok: false,
      code: 'permission_denied',
    })
    const hostessCard = await readGuestCard(world.app, { ...reader(hostessId), guestId })
    expect(hostessCard.ok && hostessCard.card?.mine).toBeNull()
    const hostessList = await readGuestList(world.app, reader(hostessId))
    expect(hostessList.ok && hostessList.list.privateList).toBe(false)
    expect(JSON.stringify(hostessList)).not.toContain('tips well')
    // A staff actor (a PIN on a shared device) is never the keeper.
    const device = {
      tenantId: world.tenantId,
      venueId: world.venueId,
      actor: { kind: 'staff', staffMemberId: managerStaffId, sessionId: 'sess-device' } as const,
    }
    expect(await readPrivateList(world.app, device)).toMatchObject({ ok: false })

    // The owner's switch turns the lists off: the read and the write both refuse.
    await accept({ type: 'reservation_settings.set', privateNotesOn: false } as ServiceCommand)
    expect(await readPrivateList(world.app, reader(managerId))).toEqual({
      ok: false,
      code: 'private_notes_off',
    })
    expect(
      await run(
        { type: 'guest.private_note', guestId, note: 'again' } as ServiceCommand,
        staff(managerId),
      ),
    ).toMatchObject({ status: 'refused', code: 'private_notes_off' })
    await accept({ type: 'reservation_settings.set', privateNotesOn: true } as ServiceCommand)
  })

  it('erases a guest as an UPDATE: details and both lists go, the bookings stay, the Log keeps who and when', async () => {
    const phone = freshPhone()
    const email = `erase-${randomUUID().slice(0, 6)}@example.test`
    contact.emails.add(email)
    const guestId = (
      await accept(
        {
          type: 'guest.save',
          phone,
          name: 'Elena Erase',
          email,
          note: 'allergic to nuts',
          isRegular: true,
        } as ServiceCommand,
        staff(hostessId),
      )
    ).guestId as string
    for (const keeper of [managerId, colleagueId]) {
      await accept(
        { type: 'guest.private_note', guestId, note: `note of ${keeper}` } as ServiceCommand,
        staff(keeper),
      )
    }
    const kept = await book('2026-11-23', at(23, 22), 'T4', {
      phone,
      guestName: 'Elena',
      note: 'birthday, cake at midnight',
    })
    // A stale sign-in and a staff actor (a PIN) never erase: the person's own, fresh sign-in does.
    expect(
      await run(
        { type: 'guest.erase', guestId } as ServiceCommand,
        staff(managerId, new Date(Date.now() - 60 * 60_000)),
      ),
    ).toMatchObject({ status: 'refused', code: 'sign_in_again' })
    expect(
      await run({ type: 'guest.erase', guestId } as ServiceCommand, {
        ...staff(managerId),
        actor: { kind: 'staff', staffMemberId: managerStaffId, sessionId: 'sess-device' },
      }),
    ).toMatchObject({ status: 'refused' })
    const before = (
      await world.owner.query('select count(*)::int as n from restro.guests where id = $1', [
        guestId,
      ])
    ).rows[0]
    await accept({ type: 'guest.erase', guestId } as ServiceCommand, staff(managerId))

    // An UPDATE: the row is still there, emptied.
    const after = (
      await world.owner.query('select count(*)::int as n from restro.guests where id = $1', [
        guestId,
      ])
    ).rows[0]
    expect(after).toEqual(before)
    expect(await guestRow(guestId)).toMatchObject({
      phone_key: null,
      phone: null,
      name: null,
      email: null,
      note: null,
      is_regular: false,
    })
    expect((await guestRow(guestId))?.erased_at).not.toBeNull()
    const notes = (
      await world.owner.query<{ note: string | null; erased_at: Date | null }>(
        'select note, erased_at from restro.guest_private_notes where guest_id = $1',
        [guestId],
      )
    ).rows
    expect(notes).toHaveLength(2)
    for (const note of notes) {
      expect(note.note).toBeNull()
      expect(note.erased_at).not.toBeNull()
    }
    // His booking stands, with the party size and the spot only.
    const booking = (
      await world.owner.query<{
        guest_id: string
        party_size: number
        party_label: string | null
        note: string | null
        deleted_at: Date | null
      }>(
        'select guest_id, party_size, party_label, note, deleted_at from restro.reservations where id = $1',
        [kept],
      )
    ).rows[0]
    expect(booking).toMatchObject({
      guest_id: guestId,
      party_size: 4,
      party_label: null,
      note: null,
      deleted_at: null,
    })
    const held = await world.owner.query(
      'select spot_id from restro.reservation_spots where reservation_id = $1',
      [kept],
    )
    expect(held.rows).toEqual([{ spot_id: spots.get('T4') }])
    // Nobody reads him back: not on the list, no card.
    const list = await readGuestList(world.app, reader(managerId))
    expect(list.ok && list.list.rows.some((row) => row.id === guestId)).toBe(false)
    const card = await readGuestCard(world.app, { ...reader(managerId), guestId })
    expect(card.ok && card.card).toBeNull()
    const ownList = await readPrivateList(world.app, reader(managerId))
    expect(ownList.ok && ownList.entries.some((entry) => entry.guestId === guestId)).toBe(false)

    // The Log keeps who and when, and nothing of what was erased.
    const erased = (
      await world.owner.query<{ actor: string; at: Date; details: unknown }>(
        `select actor, at, details from restro.log_entries
          where venue_id = $1 and kind = 'guest.erased' and guest_id = $2`,
        [world.venueId, guestId],
      )
    ).rows
    expect(erased).toHaveLength(1)
    expect(erased[0]?.actor).toBe(`user:${managerId}`)
    expect(erased[0]?.at).toBeInstanceOf(Date)
    const text = (await logText()).join('\n')
    for (const word of ['Elena', 'allergic', 'birthday', 'note of', email]) {
      expect(text).not.toContain(word)
    }
  })

  it('counts came and did-not-come from this venue’s nights, and never adds them up', async () => {
    const phone = freshPhone()
    const first = await book('2026-11-24', at(24, 21), 'T1', { phone, guestName: 'Kalin' })
    const second = await book('2026-11-25', at(25, 21), 'T1', { phone, guestName: 'Kalin' })
    await book('2026-11-26', at(26, 21), 'T1', { phone, guestName: 'Kalin' })
    // Seating is #329's; the counts only read the state, so the test sets it as the night left it.
    await world.owner.query(`update restro.reservations set status = 'finished' where id = $1`, [
      first,
    ])
    await accept(
      {
        type: 'reservation.set_status',
        reservationId: second,
        status: 'no_show',
      } as ServiceCommand,
      staff(managerId),
    )
    const guestId = (
      await world.owner.query<{ guest_id: string }>(
        'select guest_id from restro.reservations where id = $1',
        [first],
      )
    ).rows[0]?.guest_id as string
    const card = await readGuestCard(world.app, { ...reader(hostessId), guestId })
    expect(card.ok && card.card).toMatchObject({ came: 1, missed: 1 })
    expect(card.ok && card.card?.bookings).toHaveLength(3)
    expect(card.ok && card.card && 'total' in card.card).toBe(false)
  })

  it('never writes a phone or an email into the Log, whatever the guest commands carry', async () => {
    const emailArb = fc
      .tuple(fc.stringMatching(/^[a-z]{3,8}$/), fc.stringMatching(/^[a-z]{3,8}$/))
      .map(([local, host]) => `${local}.${randomUUID().slice(0, 4)}@${host}.test`)
    const formatArb = fc.constantFrom(
      (n: string) => `0${n}`,
      (n: string) => `+359 ${n}`,
      (n: string) => `00359${n}`,
      (n: string) => `+359 (${n.slice(0, 3)}) ${n.slice(3)}`,
    )
    await fc.assert(
      fc.asyncProperty(emailArb, formatArb, fc.boolean(), async (email, format, regular) => {
        counter += 1
        const nationalNumber = `89${String(1_000_000 + counter).padStart(7, '0')}`
        const phone = format(nationalNumber)
        contact.phones.add(`359${nationalNumber}`)
        contact.emails.add(email)
        const guestId = (
          await accept(
            {
              type: 'guest.save',
              phone,
              name: 'Prop',
              email,
              isRegular: regular,
            } as ServiceCommand,
            staff(hostessId),
          )
        ).guestId as string
        await accept(
          { type: 'guest.save', guestId, email: `x${email}` } as ServiceCommand,
          staff(hostessId),
        )
        const day = 1 + (counter % 27)
        await book(
          `2026-12-${String(day).padStart(2, '0')}`,
          new Date(Date.UTC(2026, 11, day, 20, 0, 0)).toISOString(),
          'T3',
          { phone, guestName: 'Prop', saveAsRegular: !regular },
        )
        const text = (await logText()).join('\n')
        for (const key of contact.phones) expect(text).not.toContain(national(key))
        for (const known of contact.emails) expect(text).not.toContain(known)
      }),
      { numRuns: 12 },
    )
  }, 120_000)
})
