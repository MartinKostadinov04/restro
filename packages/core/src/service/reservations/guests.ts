// The venue's guest records and the erasure (ticket #323; D140, D83). `settings.guests`, a
// settings-class key on purpose: a PIN on a shared device never reaches a guest's phone number,
// and erasing somebody always has a person's own sign-in behind it (D141).
//
// A record is keyed by the phone number normalised to its digits, so one person is one row however
// many bookings he has. Nothing is shared between venues: a guest of one club is unknown at
// another.
//
// **Nothing here reaches the Log but ids.** A Log entry about a guest names his `gu_` id and
// never his name, number, email or note, before or after the change (D140): the record itself is
// where his details live, and once it is erased they are nowhere.

import { guestPrivateNotes, guests, staffMembers } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { newId } from '../../ids'
import type { ServiceTx } from '../definition'
import { accepted, type ServiceResult } from '../results'
import { lockGuest, lockGuestByPhone, readSettings, refuse } from './rows'

/**
 * A phone number as the key: its digits, with a leading `00` read as the `+` it stands for. Null
 * for anything that is not a number at all, which the command refuses rather than storing.
 */
export function phoneKeyOf(phone: string): string | null {
  const digits = phone.replace(/[^0-9]/g, '')
  const key = digits.startsWith('00') ? digits.slice(2) : digits
  return key.length >= 6 && key.length <= 20 ? key : null
}

/** What a guest record is saved with; a value left out keeps what the record had. */
export interface GuestSaveCommand {
  readonly guestId?: string
  readonly phone?: string
  readonly name?: string | null
  readonly email?: string | null
  readonly note?: string | null
  readonly isRegular?: boolean
  /** Take him out of the list staff browse, without erasing him. */
  readonly archived?: boolean
}

/**
 * Saves a guest record: a new one keyed by the number, or the one named. A number that already
 * belongs to another record is refused `guest_exists` — the list never holds one person twice, and
 * the hostess is sent to the record that is already there rather than being given a second one.
 */
export async function saveGuest(stx: ServiceTx, command: GuestSaveCommand): Promise<ServiceResult> {
  const existing = command.guestId === undefined ? null : await lockGuest(stx, command.guestId)
  if (command.guestId !== undefined && existing === null) return refuse('guest_missing')
  let phoneKey = existing?.phoneKey ?? null
  if (command.phone !== undefined) {
    const key = phoneKeyOf(command.phone)
    if (key === null) return refuse('invalid_command')
    if (key !== existing?.phoneKey) {
      const other = await lockGuestByPhone(stx, key)
      if (other !== null && other.id !== existing?.id) {
        return refuse('guest_exists')
      }
    }
    phoneKey = key
  }
  if (phoneKey === null) return refuse('invalid_command')
  const guestId = existing?.id ?? newId('gu')
  const archived = command.archived ?? existing?.archivedAt != null
  const values = {
    phoneKey,
    phone: command.phone ?? existing?.phone ?? null,
    name: command.name === undefined ? (existing?.name ?? null) : command.name,
    email: command.email === undefined ? (existing?.email ?? null) : command.email,
    note: command.note === undefined ? (existing?.note ?? null) : command.note,
    isRegular: command.isRegular ?? existing?.isRegular ?? false,
    archivedAt: archived ? (existing?.archivedAt ?? stx.now) : null,
  }
  if (existing === null) {
    await stx.tx.insert(guests).values({
      id: guestId,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      ...values,
      ...stx.provenance,
    })
  } else {
    await stx.tx
      .update(guests)
      .set({ ...values, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(guests.id, guestId))
  }
  // The entry names the record and what kind of change it was. Never a detail of the person.
  await stx.log({
    kind: 'guest.changed',
    guestId,
    toState: archived ? 'archived' : 'listed',
    reason: existing === null ? 'created' : 'changed',
    details: { regular: values.isRegular },
  })
  return accepted(null, { details: { guestId, archived } })
}

/**
 * Erases a guest (D140, D83): an **update** that clears every detail of the person — the key
 * included, so a later booking from the same number starts a new record — takes him out of the
 * venue's list and empties every private note about him. His reservations keep their party size
 * and their spot and are not rewritten: the night's record stays true, and nobody can be read out
 * of it.
 *
 * The Log keeps that it happened, when and by whom (the audit D140 asks for) and names the
 * record's own id, which from now on points at an empty row.
 */
export async function eraseGuest(
  stx: ServiceTx,
  command: { readonly guestId: string },
): Promise<ServiceResult> {
  const guest = await lockGuest(stx, command.guestId)
  if (guest === null) return refuse('guest_missing')
  await stx.tx
    .update(guests)
    .set({
      phoneKey: null,
      phone: null,
      name: null,
      email: null,
      note: null,
      isRegular: false,
      archivedAt: sql`now()`,
      erasedAt: sql`now()`,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(guests.id, guest.id))
  await stx.tx
    .update(guestPrivateNotes)
    .set({ note: null, erasedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(and(eq(guestPrivateNotes.venueId, stx.venueId), eq(guestPrivateNotes.guestId, guest.id)))
  await stx.log({ kind: 'guest.erased', guestId: guest.id, toState: 'erased' })
  return accepted(null, { details: { guestId: guest.id } })
}

/**
 * Whose note this is: the staff member the actor is. A signed-in person is matched to their own
 * staff record, because the note is keyed by the person and not by the account; a PIN on a shared
 * device names the staff member itself (though `settings.guests` is settings-class, so a PIN never
 * gets this far). Restro's own team and the worker are nobody's staff and get null.
 */
async function authorOf(stx: ServiceTx): Promise<string | null> {
  if (stx.actor.kind === 'staff') return stx.actor.staffMemberId
  if (stx.actor.kind !== 'user') return null
  const [member] = await stx.tx
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.tenantId, stx.tenantId),
        eq(staffMembers.userId, stx.actor.userId),
        isNull(staffMembers.archivedAt),
      ),
    )
  return member?.id ?? null
}

/**
 * A manager's own private note about a guest (D140): his list, which other staff never read. The
 * row is keyed by the staff member, so the privacy is the **read's** — only the person whose note
 * it is reads it back — and no second Postgres role is needed for it.
 *
 * Refused `private_notes_off` while the venue has not switched them on, and `not_a_staff_member`
 * for an actor who is nobody's staff member: an operator of Restro's own team keeps no private
 * notes about a venue's guests, and neither does an account with no staff record of its own.
 */
export async function setGuestPrivateNote(
  stx: ServiceTx,
  command: { readonly guestId: string; readonly note: string | null },
): Promise<ServiceResult> {
  const settings = await readSettings(stx)
  if (settings === null) return refuse('settings_missing')
  if (!settings.privateNotesOn) return refuse('private_notes_off')
  const staffMemberId = await authorOf(stx)
  if (staffMemberId === null) return refuse('not_a_staff_member')
  const guest = await lockGuest(stx, command.guestId)
  if (guest === null) return refuse('guest_missing')
  await stx.tx
    .insert(guestPrivateNotes)
    .values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      guestId: guest.id,
      staffMemberId,
      note: command.note,
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [
        guestPrivateNotes.tenantId,
        guestPrivateNotes.guestId,
        guestPrivateNotes.staffMemberId,
      ],
      set: { note: command.note, ...stx.provenance, updatedAt: sql`now()` },
    })
  // What the note says is never logged: that is the whole point of a private note (D140).
  await stx.log({
    kind: 'guest.changed',
    guestId: guest.id,
    toState: command.note === null ? 'note_cleared' : 'note_kept',
    reason: 'private_note',
  })
  return accepted(null, { details: { guestId: guest.id } })
}
