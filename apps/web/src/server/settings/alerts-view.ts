// What the Alerts section draws (#87, plan `2026-10-27-settings-alerts-export-plan.md` §A): the
// people of this venue who have their own account (the only ones with a phone to ring and a
// Restro account to press Done with), how many devices each has installed, who is ticked, and the
// venue's Telegram group. The group's name is not stored anywhere: it is the name the Log entry of
// the link carries, and "the bot left" is the Log's last Telegram entry (no table is added). Reads
// only; plain data safe for the browser.
import { readOrderingSettings } from '@restro/core'
import {
  logEntries,
  pushSubscriptions,
  staffAssignments,
  staffMembers,
  type Venue,
  withTenant,
} from '@restro/db'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import { getPool } from '../db'

/** One person of the venue, as the Alerts section lists them. */
export interface AlertPersonView {
  readonly id: string
  readonly name: string
  /** The person's own account; null: they have only a PIN (no device to ring, no Done). */
  readonly userId: string | null
  /** Installed devices that can ring (0: none yet). */
  readonly devices: number
  /** True when their phone gets alerts. */
  readonly ticked: boolean
  /** True when their Telegram is linked, so they can press Done in the group. */
  readonly telegramLinked: boolean
}

/** The venue's Telegram group. */
export type TelegramGroupView =
  | { readonly state: 'none' }
  | { readonly state: 'linked'; readonly group: string }
  | { readonly state: 'left'; readonly group: string }

/** Everything the Alerts section draws. */
export interface AlertsView {
  readonly venueId: string
  readonly people: readonly AlertPersonView[]
  readonly telegram: TelegramGroupView
  /** The accounts ticked now, strangers to this list included (a toggle keeps them). */
  readonly recipientIds: readonly string[]
  /** What the signed-in person holds that the section needs beyond `settings.alerts`. */
  readonly canUnlinkPerson: boolean
  /** The signed-in person's email, for the password again. */
  readonly email: string
}

const TELEGRAM_REASONS = ['telegram_linked', 'telegram_left', 'telegram_unlinked'] as const

/** The venue's alerts view. */
export async function loadAlertsView(input: {
  readonly tenantId: string
  readonly venue: Venue
  readonly email: string
  readonly canUnlinkPerson: boolean
}): Promise<AlertsView> {
  const settings = readOrderingSettings(input.venue.settings)
  const { people, devices, entry } = await withTenant(getPool(), input.tenantId, async (tx) => {
    const people = await tx
      .select({
        id: staffMembers.id,
        name: staffMembers.displayName,
        userId: staffMembers.userId,
        telegramUserId: staffMembers.telegramUserId,
      })
      .from(staffMembers)
      .innerJoin(
        staffAssignments,
        and(
          eq(staffAssignments.staffMemberId, staffMembers.id),
          eq(staffAssignments.venueId, input.venue.id),
          isNull(staffAssignments.endedAt),
        ),
      )
      .where(isNull(staffMembers.archivedAt))
      .orderBy(staffMembers.displayName, staffMembers.id)
    const userIds = people.flatMap((person) => (person.userId === null ? [] : [person.userId]))
    const devices =
      userIds.length === 0
        ? []
        : await tx
            .select({ userId: pushSubscriptions.userId })
            .from(pushSubscriptions)
            .where(
              and(inArray(pushSubscriptions.userId, userIds), isNull(pushSubscriptions.revokedAt)),
            )
    const [entry] = await tx
      .select({ reason: logEntries.reason, details: logEntries.details })
      .from(logEntries)
      .where(
        and(
          eq(logEntries.venueId, input.venue.id),
          eq(logEntries.kind, 'settings.changed'),
          inArray(logEntries.reason, [...TELEGRAM_REASONS]),
        ),
      )
      .orderBy(desc(logEntries.at), desc(logEntries.seq))
      .limit(1)
    return { people, devices, entry }
  })
  const count = new Map<string, number>()
  for (const device of devices) count.set(device.userId, (count.get(device.userId) ?? 0) + 1)
  const ticked = new Set(settings.alertRecipientUserIds)
  const group =
    typeof entry?.details === 'object' && entry.details !== null && 'group' in entry.details
      ? String((entry.details as { group?: unknown }).group ?? '')
      : ''
  const telegram: TelegramGroupView =
    settings.telegramChatId !== null
      ? {
          state: 'linked',
          group: entry?.reason === 'telegram_linked' ? group : '',
        }
      : entry?.reason === 'telegram_left'
        ? { state: 'left', group }
        : { state: 'none' }
  return {
    venueId: input.venue.id,
    people: people.map((person) => ({
      id: person.id,
      name: person.name,
      userId: person.userId,
      devices: person.userId === null ? 0 : (count.get(person.userId) ?? 0),
      ticked: person.userId !== null && ticked.has(person.userId),
      telegramLinked: person.telegramUserId !== null,
    })),
    telegram,
    recipientIds: settings.alertRecipientUserIds,
    canUnlinkPerson: input.canUnlinkPerson,
    email: input.email,
  }
}
