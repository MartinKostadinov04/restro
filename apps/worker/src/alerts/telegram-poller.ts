// "Done" from the venue's Telegram group (#83; D122 §7), heard by long polling: the worker asks
// Telegram for button presses, so Restro opens no public endpoint (spec #64, 13).
//
// A press names an alert (the button's data) in a group (the message's chat). The group says which
// venue; the Telegram user says who, through the staff member they are linked to; that person's
// account then presses Done like anyone, so their role decides (`alert.done`, via Telegram: the
// Log says so). The bot edits the group's message to "… Done by Maria, 02:14".
//
// The same poll also hears the links of #87 (`/start CODE`, the bot removed from a group):
// telegram-linking.ts.
//
// A press the bot cannot honour is answered with a short line (Telegram shows it to the person)
// and changes nothing. Nothing here logs a token, a Telegram user's name or a message's text.

import { randomUUID } from 'node:crypto'

import {
  type AlertLocale,
  alertLocale,
  applyService,
  doneLine,
  type TelegramAnswer,
  telegramAnswer,
} from '@restro/core/service'
import {
  authOrganization,
  type DbPool,
  staffMembers,
  venues,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Logger } from '../logger'
import type { ButtonPress, TelegramClient } from './telegram'
import { TelegramError } from './telegram'
import { handleMembership, handleStart } from './telegram-linking'

/** How long Telegram holds a poll open when nothing happens. */
export const POLL_SECONDS = 25
const ALERT_ID = /^al_[0-9A-Za-z]+$/

/** What the poller needs. */
export interface PollerDeps {
  readonly pool: DbPool
  readonly telegram: TelegramClient
  readonly log: Pick<Logger, 'warn' | 'info'>
  readonly now: () => Date
  /**
   * The secret the links of #87 are signed with (REVEAL_SERVICE_TOKEN); without it a `/start`
   * is ignored and nothing is linked from Telegram.
   */
  readonly linkSecret?: string | null
}

interface VenueOfChat {
  readonly tenantId: string
  readonly venueId: string
  readonly timezone: string
  readonly locale: AlertLocale
}

/** The live venue whose Telegram group this is, or null. */
export async function venueOfChat(pool: DbPool, chatId: string): Promise<VenueOfChat | null> {
  const organisations = await withSystem(pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  for (const organisation of organisations) {
    const [venue] = await withTenant(pool, organisation.id, (tx) =>
      tx
        .select({ id: venues.id, timezone: venues.timezone, defaultLocale: venues.defaultLocale })
        .from(venues)
        .where(
          and(
            isNull(venues.archivedAt),
            sql`${venues.settings} #>> '{ordering,telegramChatId}' = ${chatId}`,
          ),
        ),
    )
    if (venue !== undefined) {
      return {
        tenantId: organisation.id,
        venueId: venue.id,
        timezone: venue.timezone,
        locale: alertLocale(venue.defaultLocale),
      }
    }
  }
  return null
}

/**
 * Handles one press of a Done button. Never throws. The bot answers in the venue's language
 * (English where the group belongs to no venue).
 */
export async function handlePress(deps: PollerDeps, press: ButtonPress): Promise<void> {
  let locale: AlertLocale = 'en'
  const answer = (what: TelegramAnswer) =>
    deps.telegram
      .answerCallback(press.callbackId, telegramAnswer(locale, what))
      .catch(() => undefined)
  try {
    const venue = await venueOfChat(deps.pool, press.chatId)
    if (venue === null) {
      await answer('no_venue')
      return
    }
    locale = venue.locale
    if (!ALERT_ID.test(press.data)) {
      await answer('not_an_alert')
      return
    }
    // The person: a staff member linked to this Telegram user, with a Restro account.
    const [member] = await withTenant(deps.pool, venue.tenantId, (tx) =>
      tx
        .select({ userId: staffMembers.userId, name: staffMembers.displayName })
        .from(staffMembers)
        .where(
          and(
            eq(staffMembers.telegramUserId, press.userId),
            isNull(staffMembers.archivedAt),
            isNotNull(staffMembers.userId),
          ),
        ),
    )
    if (member?.userId == null) {
      await answer('not_linked')
      return
    }
    const { result } = await applyService(
      deps.pool,
      { type: 'alert.done', alertId: press.data },
      {
        tenantId: venue.tenantId,
        venueId: venue.venueId,
        origin: 'staff',
        actor: { kind: 'user', userId: member.userId, sessionId: `telegram:${press.chatId}` },
        via: 'telegram',
        jobId: `telegram-${randomUUID()}`,
      },
    )
    if (result.status === 'refused') {
      await answer(result.code === 'permission_denied' ? 'denied' : 'cannot')
      return
    }
    if (result.details.changed !== true) {
      await answer('already')
      return
    }
    // The message says who and when; it is recorded, so the sweep does not edit it again.
    const at = deps.now()
    await deps.telegram
      .editMessage(
        { chatId: press.chatId, messageId: press.messageId },
        `${press.text}\n\n${doneLine(member.name, at, venue.timezone, locale)}`,
      )
      .catch((error: unknown) =>
        deps.log.warn({ err: error }, 'the Done message could not be edited'),
      )
    await applyService(
      deps.pool,
      {
        type: 'alert.delivered',
        alertIds: [press.data],
        receiver: 'venueTelegram',
        step: 'done_edit',
      },
      {
        tenantId: venue.tenantId,
        venueId: venue.venueId,
        origin: 'worker',
        actor: { kind: 'system' },
        jobId: `telegram-edit-${randomUUID()}`,
      },
    )
    await answer('done')
  } catch (error) {
    deps.log.warn({ err: error }, 'a Done press could not be handled')
    await answer('failed')
  }
}

/** The running poller. */
export interface Poller {
  /** Stops asking Telegram and waits for the press in hand to be handled. */
  stop(): Promise<void>
}

/** Starts the poll loop. It runs until `stop`. */
export function startTelegramPoller(
  deps: PollerDeps & {
    /** Replaced in tests. */
    readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
    readonly pollSeconds?: number
  },
): Poller {
  const controller = new AbortController()
  // The links accepted so far, with their end: a link is used once (telegram-link.ts).
  const linking = {
    ...deps,
    linkSecret: deps.linkSecret ?? null,
    used: new Map<string, number>(),
    venueOfChat: (chatId: string) => venueOfChat(deps.pool, chatId),
  }
  const sleep =
    deps.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      }))

  const loop = (async () => {
    let offset = 0
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        const updates = await deps.telegram.getUpdates({
          offset,
          timeoutSeconds: deps.pollSeconds ?? POLL_SECONDS,
          signal: controller.signal,
        })
        failures = 0
        for (const update of updates) {
          offset = Math.max(offset, update.updateId + 1)
          if (update.press !== null) await handlePress(deps, update.press)
          if (update.start) await handleStart(linking, update.start)
          if (update.membership) await handleMembership(linking, update.membership)
        }
      } catch (error) {
        if (controller.signal.aborted) break
        failures += 1
        // 409: another poller (or a webhook) holds the bot. Say so and wait longer.
        const conflict = error instanceof TelegramError && error.status === 409
        deps.log.warn(
          { err: error, conflict },
          conflict ? 'another process is polling this bot' : 'Telegram polling failed',
        )
        await sleep(
          conflict ? 30_000 : Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5)),
          controller.signal,
        )
      }
    }
  })()

  return {
    async stop() {
      controller.abort()
      await loop
    },
  }
}
