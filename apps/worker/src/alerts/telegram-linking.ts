// Linking Telegram, heard by the same long poll as "Done" (#87): the owner opened Restro's link, so
// the bot sees `/start CODE` in a group it was just added to (the venue's group) or in a person's
// private chat (their own Telegram), or sees itself removed from the group. A code is Restro's
// signed link (telegram-link.ts); a valid one is the authority to write the group's chat id or the
// person's Telegram user id, through the service write path (`telegram.link`, a `record` Log entry),
// never a person's rights. Nothing here logs a code, a Telegram user's name or a message's text.

import { randomUUID } from 'node:crypto'

import {
  type AlertLocale,
  alertLocale,
  applyService,
  type TelegramLinkSaying,
  telegramLinkText,
} from '@restro/core/service'
import { authOrganization, type DbPool, venues, withSystem, withTenant } from '@restro/db'
import { eq } from 'drizzle-orm'

import type { Logger } from '../logger'
import type { MembershipChange, StartMessage, TelegramClient } from './telegram'
import { type LinkClaims, linkIssuedAt, openLinkCode } from './telegram-link'

/** What linking needs besides the pool and the bot. */
export interface LinkingDeps {
  readonly pool: DbPool
  readonly telegram: TelegramClient
  readonly log: Pick<Logger, 'warn' | 'info'>
  readonly now: () => Date
  /** The secret the links are signed with (`linkSecretOf`); null: linking is off. */
  readonly linkSecret: string | null
  /** The codes accepted so far with their end time: a link is used once. */
  readonly used: Map<string, number>
}

interface FoundVenue {
  readonly tenantId: string
  readonly venueId: string
  readonly name: string
  readonly locale: AlertLocale
}

/** The live venue with this id, whatever its organisation, or null. */
async function venueById(pool: DbPool, venueId: string): Promise<FoundVenue | null> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  for (const organisation of organisations) {
    const [venue] = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({
          id: venues.id,
          name: venues.name,
          defaultLocale: venues.defaultLocale,
          archivedAt: venues.archivedAt,
        })
        .from(venues)
        .where(eq(venues.id, venueId)),
    )
    if (venue !== undefined && venue.archivedAt === null) {
      return {
        tenantId: organisation.id,
        venueId: venue.id,
        name: venue.name,
        locale: alertLocale(venue.defaultLocale),
      }
    }
  }
  return null
}

/** Forgets the codes that ran out. */
function forgetExpired(used: Map<string, number>, now: Date): void {
  for (const [code, until] of used) if (until <= now.getTime()) used.delete(code)
}

/** Handles a `/start CODE`. Never throws. */
export async function handleStart(deps: LinkingDeps, start: StartMessage): Promise<void> {
  if (deps.linkSecret === null) return
  const say = (locale: AlertLocale, saying: TelegramLinkSaying, venue = '') =>
    deps.telegram
      .sendMessage(start.chatId, telegramLinkText(locale, saying, venue))
      .then(() => undefined)
      .catch((error: unknown) => deps.log.warn({ err: error }, 'a link answer was not sent'))
  try {
    const now = deps.now()
    forgetExpired(deps.used, now)
    const claims = openLinkCode(deps.linkSecret, start.code, now)
    // Not one of ours: silent in a group (a command typed there), a line in a private chat. One of
    // ours that ran out or was used already: said everywhere.
    if (claims === null || claims === 'expired' || deps.used.has(start.code)) {
      if (claims !== null || start.chatType === 'private') await say('en', 'link_expired')
      return
    }
    const venue = await venueById(deps.pool, claims.venueId)
    if (venue === null) {
      await say('en', 'link_expired')
      return
    }
    const inGroup = start.chatType === 'group' || start.chatType === 'supergroup'
    if (claims.purpose === 'group' ? !inGroup : start.chatType !== 'private') {
      await say(venue.locale, 'link_wrong_place')
      return
    }
    const saying = await link(deps, venue, claims, start)
    if (saying === 'ok') deps.used.set(start.code, claims.expiresAt.getTime())
    await say(
      venue.locale,
      saying === 'ok' ? (claims.purpose === 'group' ? 'group_linked' : 'person_linked') : saying,
      venue.name,
    )
  } catch (error) {
    deps.log.warn({ err: error }, 'a Telegram link could not be handled')
    await say('en', 'failed')
  }
}

/** Writes what the link names; `ok`, or what the bot should say instead. */
async function link(
  deps: LinkingDeps,
  venue: FoundVenue,
  claims: LinkClaims,
  start: StartMessage,
): Promise<'ok' | 'link_expired' | 'person_taken' | 'not_working_here' | 'failed'> {
  const issued = linkIssuedAt(claims).toISOString()
  const { result } = await applyService(
    deps.pool,
    claims.purpose === 'group'
      ? {
          type: 'telegram.link',
          what: 'group',
          chatId: start.chatId,
          title: start.title,
          linkIssuedAt: issued,
        }
      : {
          type: 'telegram.link',
          what: 'person',
          staffMemberId: claims.staffMemberId,
          telegramUserId: start.userId,
          linkIssuedAt: issued,
        },
    {
      tenantId: venue.tenantId,
      venueId: venue.venueId,
      origin: 'worker',
      actor: { kind: 'system' },
      jobId: `telegram-link-${randomUUID()}`,
    },
  )
  if (result.status === 'accepted') return 'ok'
  if (result.code === 'link_spent') return 'link_expired'
  if (result.code === 'telegram_taken') return 'person_taken'
  if (result.code === 'staff_missing') return 'not_working_here'
  return 'failed'
}

/** Handles the bot being removed from a group: the venue that had it forgets the group. */
export async function handleMembership(
  deps: LinkingDeps & {
    readonly venueOfChat: (
      chatId: string,
    ) => Promise<Pick<FoundVenue, 'tenantId' | 'venueId'> | null>
  },
  change: MembershipChange,
): Promise<void> {
  if (change.chatType !== 'group' && change.chatType !== 'supergroup') return
  if (change.status !== 'left' && change.status !== 'kicked') return
  try {
    const venue = await deps.venueOfChat(change.chatId)
    if (venue === null) return
    await applyService(
      deps.pool,
      { type: 'telegram.link', what: 'group_left', chatId: change.chatId, title: change.title },
      {
        tenantId: venue.tenantId,
        venueId: venue.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: `telegram-left-${randomUUID()}`,
      },
    )
  } catch (error) {
    deps.log.warn({ err: error }, 'the bot leaving a group could not be recorded')
  }
}
