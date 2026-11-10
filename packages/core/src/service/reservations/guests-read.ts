// The read side of a venue's guests (ticket #333; D140, D141): the venue's list, one guest's card
// with his counts and his recent bookings, the regulars suggested while a name is typed, and a
// manager's own private list.
//
// **Whose list is whose is decided here, on the read** — never only by what a screen leaves out:
// - The venue's list is everyone's who works the door (`reservations.tonight`): every hostess reads
//   the same guests. A role without the key is refused `permission_denied`, never emptied.
// - A private list is one person's. `privateListOwner` answers who may read one, and every read of
//   `guest_private_notes` below filters on **that** staff member's id: there is no query here that
//   can return another person's note, whatever the screen asks for. It needs the guest records
//   permission (settings-class, D141) and the person's own sign-in: a shared device's account, or
//   a PIN-named person on it, never reads one.
//
// The visit and no-show counts are counted here from this venue's own reservations, when asked
// (D140): a rough count for a hostess, never a money record, and no total is made of them.
//
// Read-only on `withTenant`: nothing here writes, no POS is called, and an erased guest is nobody —
// he is in no list, no suggestion and no card.

import {
  type DbPool,
  guestPrivateNotes,
  guests,
  type ReadTx,
  reservationSettings,
  reservationSpots,
  reservations,
  spots,
  staffMembers,
  withTenant,
} from '@restro/db'
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'

import type { Reader, ReadInput } from '../night-read'
import {
  accessOf,
  openReservations,
  type ReservationAccess,
  type ReservationReadRefusal,
} from './read'
import type { ReservationKind, ReservationStatus } from './status'

/** How many guests one read of the list returns at most: well above an MVP hostess's 2000. */
export const MAX_GUEST_ROWS = 5000

/** How many regulars a name suggests at most. */
export const MAX_GUEST_SUGGESTIONS = 8

/** How many letters (or digits) a suggestion waits for (D140: "three letters"). */
export const SUGGEST_AFTER = 3

/** How many of a guest's bookings his card lists, newest first. */
export const RECENT_GUEST_BOOKINGS = 10

/** One guest on the venue's list. */
export interface GuestListRow {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly isRegular: boolean
  readonly archived: boolean
  /** On the reader's own private list; always false for anyone who keeps none. */
  readonly onMyList: boolean
}

/** The venue's list as one person reads it. */
export interface GuestListRead {
  readonly rows: readonly GuestListRow[]
  /** More guests than were returned (over `MAX_GUEST_ROWS`). */
  readonly hasMore: boolean
  /** The reader keeps a private list here (`privateListOwner`): the screen offers its filter. */
  readonly privateList: boolean
}

/** One regular a typed name suggests: what the tap fills in. */
export interface GuestSuggestion {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
}

/** One of a guest's bookings on his card. */
export interface GuestBooking {
  readonly id: string
  readonly kind: ReservationKind
  readonly status: ReservationStatus
  readonly serviceDate: string
  readonly startsAt: Date
  readonly partySize: number | null
  /** Every spot it held, by name. */
  readonly spots: readonly string[]
}

/** One guest's card. */
export interface GuestCard {
  readonly id: string
  readonly name: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly note: string | null
  readonly isRegular: boolean
  readonly archived: boolean
  /** How many times he came (seated, then finished), from this venue's own nights only (D140). */
  readonly came: number
  /** How many times he was a no-show, the same way. A rough count for a hostess, not accounting. */
  readonly missed: number
  /** His newest bookings first. */
  readonly bookings: readonly GuestBooking[]
  /**
   * The reader's own private list: null when the reader keeps none here; otherwise whether the
   * guest is on it, and the reader's own note. Never anybody else's.
   */
  readonly mine: { readonly onList: boolean; readonly note: string | null } | null
}

/** Why a private list cannot be read by this person. */
export type PrivateListRefusal =
  | ReservationReadRefusal
  | 'own_sign_in_required'
  | 'private_notes_off'
  | 'not_a_staff_member'

/**
 * Who may read a private list here, and whose it is (D140, D141): a person signed in as himself,
 * not a shared device and not a PIN typed on one; holding the guest records permission; at a venue
 * that keeps private lists; with a staff record of his own, because a note is his by that record.
 */
export async function privateListOwner(
  tx: ReadTx,
  reader: Reader,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly staffMemberId: string }
  | { readonly ok: false; readonly code: PrivateListRefusal }
> {
  if (input.actor.kind !== 'user' || reader.device) {
    return { ok: false, code: 'own_sign_in_required' }
  }
  if (!reader.held.has('settings.guests')) return { ok: false, code: 'permission_denied' }
  const [settings] = await tx
    .select({ privateNotesOn: reservationSettings.privateNotesOn })
    .from(reservationSettings)
    .where(eq(reservationSettings.venueId, reader.venue.id))
  // A venue that has saved no settings keeps D140's default: the private list is on.
  if (settings !== undefined && !settings.privateNotesOn) {
    return { ok: false, code: 'private_notes_off' }
  }
  const [member] = await tx
    .select({ id: staffMembers.id })
    .from(staffMembers)
    .where(
      and(
        eq(staffMembers.tenantId, input.tenantId),
        eq(staffMembers.userId, input.actor.userId),
        isNull(staffMembers.archivedAt),
      ),
    )
  if (member === undefined) return { ok: false, code: 'not_a_staff_member' }
  return { ok: true, staffMemberId: member.id }
}

/**
 * The guests one staff member keeps on his own list here: a note of his that is not cleared and
 * not erased. The filter on `staffMemberId` is the privacy; nothing else reads these rows.
 */
async function ownNotes(
  tx: ReadTx,
  venueId: string,
  staffMemberId: string,
  guestIds?: readonly string[],
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ guestId: guestPrivateNotes.guestId, note: guestPrivateNotes.note })
    .from(guestPrivateNotes)
    .where(
      and(
        eq(guestPrivateNotes.venueId, venueId),
        eq(guestPrivateNotes.staffMemberId, staffMemberId),
        isNull(guestPrivateNotes.erasedAt),
        isNotNull(guestPrivateNotes.note),
        guestIds === undefined ? undefined : inArray(guestPrivateNotes.guestId, [...guestIds]),
      ),
    )
  return new Map(rows.map((row) => [row.guestId, row.note ?? '']))
}

/** The guests nobody erased, of one venue. */
const livingGuests = (venueId: string) => and(eq(guests.venueId, venueId), isNull(guests.erasedAt))

/**
 * The venue's list of guests: everyone who booked with a number, and the regulars among them, the
 * archived included (the screen filters them; nothing is a second screen). Sorted by name, the
 * nameless last, so 2000 regulars scroll in one list.
 */
export async function readGuestList(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | { readonly ok: true; readonly access: ReservationAccess; readonly list: GuestListRead }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const rows = await tx
      .select({
        id: guests.id,
        name: guests.name,
        phone: guests.phone,
        email: guests.email,
        isRegular: guests.isRegular,
        archivedAt: guests.archivedAt,
      })
      .from(guests)
      .where(livingGuests(reader.venue.id))
      .orderBy(sql`${guests.name} is null`, asc(guests.name), asc(guests.id))
      .limit(MAX_GUEST_ROWS + 1)
    const owner = await privateListOwner(tx, reader, input)
    const mine = owner.ok ? await ownNotes(tx, reader.venue.id, owner.staffMemberId) : new Map()
    return {
      ok: true,
      access: accessOf(reader, opened.editPastNights, opened.phoneRequired),
      list: {
        rows: rows.slice(0, MAX_GUEST_ROWS).map((row) => ({
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          isRegular: row.isRegular,
          archived: row.archivedAt !== null,
          onMyList: mine.has(row.id),
        })),
        hasMore: rows.length > MAX_GUEST_ROWS,
        privateList: owner.ok,
      },
    } as const
  })
}

/** `%` and `_` typed by a person are letters, not patterns. */
const likeText = (text: string) => text.replace(/[\\%_]/g, (one) => `\\${one}`)

/**
 * The regulars a typed name suggests (D140: three letters): by any part of the name, or by the
 * digits of the number when digits are typed. Only regulars nobody archived; the venue's own.
 */
export async function readGuestSuggestions(
  pool: DbPool,
  input: ReadInput & { readonly query: string },
): Promise<
  | { readonly ok: true; readonly suggestions: readonly GuestSuggestion[] }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const typed = input.query.trim()
    const digits = typed.replace(/[^0-9]/g, '')
    if (typed.length < SUGGEST_AFTER) return { ok: true, suggestions: [] } as const
    const rows = await tx
      .select({ id: guests.id, name: guests.name, phone: guests.phone })
      .from(guests)
      .where(
        and(
          livingGuests(opened.reader.venue.id),
          eq(guests.isRegular, true),
          isNull(guests.archivedAt),
          or(
            ilike(guests.name, `%${likeText(typed)}%`),
            digits.length >= SUGGEST_AFTER
              ? sql`${guests.phoneKey} like ${`%${digits}%`}`
              : undefined,
          ),
        ),
      )
      .orderBy(asc(guests.name), asc(guests.id))
      .limit(MAX_GUEST_SUGGESTIONS)
    return { ok: true, suggestions: rows } as const
  })
}

/** One guest's card; `card` is null when the venue has no such guest, or he was erased. */
export async function readGuestCard(
  pool: DbPool,
  input: ReadInput & { readonly guestId: string },
): Promise<
  | { readonly ok: true; readonly access: ReservationAccess; readonly card: GuestCard | null }
  | { readonly ok: false; readonly code: ReservationReadRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const { reader } = opened
    const access = accessOf(reader, opened.editPastNights, opened.phoneRequired)
    const [guest] = await tx
      .select()
      .from(guests)
      .where(and(eq(guests.id, input.guestId), livingGuests(reader.venue.id)))
    if (guest === undefined) return { ok: true, access, card: null } as const

    // His bookings at this venue: a line taken out of the book is not one, and a block is nobody.
    const his = and(
      eq(reservations.venueId, reader.venue.id),
      eq(reservations.guestId, guest.id),
      isNull(reservations.deletedAt),
      ne(reservations.kind, 'block'),
    )
    const [counts] = await tx
      .select({
        came: sql<number>`count(*) filter (where ${reservations.status} in ('seated', 'finished'))::int`,
        missed: sql<number>`count(*) filter (where ${reservations.status} = 'no_show')::int`,
      })
      .from(reservations)
      .where(his)
    const recent = await tx
      .select({
        id: reservations.id,
        kind: reservations.kind,
        status: reservations.status,
        serviceDate: reservations.serviceDate,
        startsAt: reservations.startsAt,
        partySize: reservations.partySize,
      })
      .from(reservations)
      .where(his)
      .orderBy(desc(reservations.startsAt), desc(reservations.id))
      .limit(RECENT_GUEST_BOOKINGS)
    const held = new Map<string, string[]>()
    if (recent.length > 0) {
      const rows = await tx
        .selectDistinct({ reservationId: reservationSpots.reservationId, name: spots.name })
        .from(reservationSpots)
        .innerJoin(spots, eq(spots.id, reservationSpots.spotId))
        .where(
          inArray(
            reservationSpots.reservationId,
            recent.map((one) => one.id),
          ),
        )
        .orderBy(asc(spots.name))
      for (const row of rows)
        held.set(row.reservationId, [...(held.get(row.reservationId) ?? []), row.name])
    }

    const owner = await privateListOwner(tx, reader, input)
    const mine = owner.ok
      ? await ownNotes(tx, reader.venue.id, owner.staffMemberId, [guest.id])
      : null

    return {
      ok: true,
      access,
      card: {
        id: guest.id,
        name: guest.name,
        phone: guest.phone,
        email: guest.email,
        note: guest.note,
        isRegular: guest.isRegular,
        archived: guest.archivedAt !== null,
        came: counts?.came ?? 0,
        missed: counts?.missed ?? 0,
        bookings: recent.map((one) => ({
          id: one.id,
          kind: one.kind as ReservationKind,
          status: one.status as ReservationStatus,
          serviceDate: one.serviceDate,
          startsAt: one.startsAt,
          partySize: one.partySize,
          spots: held.get(one.id) ?? [],
        })),
        mine:
          mine === null ? null : { onList: mine.has(guest.id), note: mine.get(guest.id) ?? null },
      },
    } as const
  })
}

/**
 * A person's own private list (D140): the guests he keeps and his note on each. **Refused** to
 * anyone `privateListOwner` does not name — a colleague, a shared device, a PIN on one — rather
 * than answered empty, so the refusal itself is what a test can hold the read to.
 */
export async function readPrivateList(
  pool: DbPool,
  input: ReadInput,
): Promise<
  | {
      readonly ok: true
      readonly entries: readonly { readonly guestId: string; readonly note: string }[]
    }
  | { readonly ok: false; readonly code: PrivateListRefusal }
> {
  return withTenant(pool, input.tenantId, async (tx) => {
    const opened = await openReservations(tx, input)
    if (!opened.ok) return opened
    const owner = await privateListOwner(tx, opened.reader, input)
    if (!owner.ok) return owner
    const notes = await ownNotes(tx, opened.reader.venue.id, owner.staffMemberId)
    return {
      ok: true,
      entries: [...notes].map(([guestId, note]) => ({ guestId, note })),
    } as const
  })
}
