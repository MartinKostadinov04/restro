// The owner's ordering settings on the service write path (#87; D118, D122 §4, §7): hours and the
// ordering rules need `settings.guards`, alert recipients and the Telegram group `settings.alerts`,
// each with a sign-in of the last 15 minutes. A change merges into `venues.settings.ordering` under
// the venue's row lock (core/apply's `patchOrderingSettingsIn`) and is one `settings.changed`
// `record` Log entry naming the keys that changed. The worker's Telegram poller writes the group
// it was added to (or removed from) through the same function: a signed link the owner made, not a
// person, is its authority.

import { authMember, logEntries } from '@restro/db'
import { and, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'

import { OrderingSettingsError, patchOrderingSettingsIn } from '../apply/ordering-settings'
import { OrderingSettingsSchema, PreOpeningRuleSchema } from '../ordering-settings'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'
import { telegramLinkPerson } from './staff'

/** A Telegram user id: digits. */
export const TelegramUserIdSchema = z.string().regex(/^[0-9]{1,20}$/)

const {
  alertRecipientUserIds,
  telegramChatId,
  preOpeningCheck: _preOpeningCheck,
  ...guardKeys
} = OrderingSettingsSchema.shape

/** The keys `settings.ordering_set` may change: all but the alert keys; a key left out stays. */
export const OrderingChangesSchema = z
  .strictObject(guardKeys)
  .partial()
  .extend({ preOpeningCheck: PreOpeningRuleSchema.optional() })

/** The keys `settings.alerts_set` may change. */
export const AlertChangesSchema = z
  .strictObject({ alertRecipientUserIds, telegramChatId })
  .partial()

type Changes = Parameters<typeof patchOrderingSettingsIn>[2]

/** Applies a patch and logs it; a result that doesn't pass its checks is refused with the problem. */
async function change(
  stx: ServiceTx,
  patch: Changes,
  reason: 'ordering' | 'alerts' | 'telegram_unlinked',
): Promise<ServiceResult> {
  try {
    const done = await patchOrderingSettingsIn(stx.tx, stx.venueId, patch)
    if (done.changed.length > 0) {
      await stx.log({
        kind: 'settings.changed',
        reason,
        details: { keys: done.changed.join(',') },
      })
    }
    return accepted(null, { details: { changed: done.changed.length > 0 } })
  } catch (error) {
    if (error instanceof OrderingSettingsError && error.code === 'invalid_input') {
      return refused(null, 'invalid_settings', { problem: error.message.slice(0, 200) })
    }
    throw error
  }
}

/** `settings.ordering_set`: hours and the ordering rules (the owner's Hours and Ordering screens). */
export async function setOrderingRules(
  stx: ServiceTx,
  command: { readonly changes: z.infer<typeof OrderingChangesSchema> },
): Promise<ServiceResult> {
  return change(stx, command.changes as Changes, 'ordering')
}

/** `settings.alerts_set`: who gets alerts on their devices, and the Telegram group (unlink). */
export async function setAlertSettings(
  stx: ServiceTx,
  command: { readonly changes: z.infer<typeof AlertChangesSchema> },
): Promise<ServiceResult> {
  const ids = command.changes.alertRecipientUserIds
  if (ids !== undefined && ids.length > 0) {
    const members = await stx.tx
      .select({ userId: authMember.userId })
      .from(authMember)
      .where(and(eq(authMember.organizationId, stx.tenantId), inArray(authMember.userId, ids)))
    if (new Set(members.map((member) => member.userId)).size !== new Set(ids).size) {
      return refused(null, 'account_unknown')
    }
  }
  const unlinks = command.changes.telegramChatId === null
  return change(stx, command.changes as Changes, unlinks ? 'telegram_unlinked' : 'alerts')
}

/**
 * True when the venue's group was linked, unlinked or left since the link was made (RR-9). The Log
 * is what outlives a worker's restart.
 */
async function groupLinkSpent(stx: ServiceTx, issuedAt: Date): Promise<boolean> {
  const rows = await stx.tx
    .select({ seq: logEntries.seq })
    .from(logEntries)
    .where(
      and(
        eq(logEntries.venueId, stx.venueId),
        gte(logEntries.at, issuedAt),
        eq(logEntries.kind, 'settings.changed'),
        inArray(logEntries.reason, ['telegram_linked', 'telegram_left', 'telegram_unlinked']),
      ),
    )
    .limit(1)
  return rows.length > 0
}

/** The Telegram link command's payload: what the worker heard, after checking a signed link. */
export const TelegramLinkSchema = z.strictObject({
  type: z.literal('telegram.link'),
  what: z.enum(['group', 'group_left', 'person']),
  chatId: z
    .string()
    .regex(/^-?[0-9]{1,20}$/)
    .optional(),
  /** The group's name, kept only in the Log entry ("Linked to {group}"). */
  title: z.string().max(128).optional(),
  staffMemberId: z
    .string()
    .regex(/^sm_[0-9A-Za-z]+$/)
    .optional(),
  telegramUserId: TelegramUserIdSchema.optional(),
  /** When the signed link was made: one older than the current link is spent (RR-9). */
  linkIssuedAt: z.iso.datetime({ offset: true }).optional(),
})

/**
 * `telegram.link` (the worker's poller, origin `worker`): the bot was added to a group by the
 * owner's link (`group`), removed from it (`group_left`), or a person pressed Start on the link
 * the owner made for them (`person`).
 */
export async function telegramLink(
  stx: ServiceTx,
  command: z.infer<typeof TelegramLinkSchema>,
): Promise<ServiceResult> {
  if (command.what === 'person') {
    if (command.staffMemberId === undefined || command.telegramUserId === undefined) {
      return refused(null, 'invalid_command')
    }
    return telegramLinkPerson(stx, {
      staffMemberId: command.staffMemberId,
      telegramUserId: command.telegramUserId,
      ...(command.linkIssuedAt === undefined
        ? {}
        : { linkIssuedAt: new Date(command.linkIssuedAt) }),
    })
  }
  if (command.chatId === undefined) return refused(null, 'invalid_command')
  if (command.what === 'group') {
    if (
      command.linkIssuedAt !== undefined &&
      (await patchOrderingSettingsIn(stx.tx, stx.venueId, {})).after.telegramChatId !==
        command.chatId &&
      (await groupLinkSpent(stx, new Date(command.linkIssuedAt)))
    ) {
      return refused(null, 'link_spent')
    }
    const done = await patchOrderingSettingsIn(stx.tx, stx.venueId, {
      telegramChatId: command.chatId,
    })
    await stx.log({
      kind: 'settings.changed',
      reason: 'telegram_linked',
      details: { group: command.title ?? '' },
    })
    return accepted(null, { details: { changed: done.changed.length > 0 } })
  }
  // The bot left: only when it is the group this venue has.
  const done = await patchOrderingSettingsIn(stx.tx, stx.venueId, {})
  if (done.after.telegramChatId !== command.chatId) {
    return accepted(null, { details: { changed: false } })
  }
  await patchOrderingSettingsIn(stx.tx, stx.venueId, { telegramChatId: null })
  await stx.log({
    kind: 'settings.changed',
    reason: 'telegram_left',
    details: { group: command.title ?? '' },
  })
  return accepted(null, { details: { changed: true } })
}
