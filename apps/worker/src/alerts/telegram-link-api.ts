// The worker's side of "Link Telegram" in the owner's Alerts settings (#87): `POST /internal/telegram`
// on the same private HTTP server as the reveal endpoint, for the web app's server only (same Host
// rule and bearer token). The web app names the signed-in account and its session; `applyService`
// checks it holds `settings.alerts` at the venue with a sign-in of the last 15 minutes (an empty
// `settings.alerts_set`, which changes nothing), and only then does the worker make a link (the
// bot's username is only known here, and so is the signing key) or send the test message.
// Nothing here stores or logs a code or a message.

import { randomUUID } from 'node:crypto'

import { idSchema } from '@restro/core'
import {
  alertLocale,
  applyService,
  type ServiceContext,
  telegramLinkText,
} from '@restro/core/service'
import { type DbPool, staffAssignments, venues, withTenant } from '@restro/db'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import type { TelegramClient } from './telegram'
import { TelegramError } from './telegram'
import { makeLinkCode } from './telegram-link'

/** Where the endpoint listens. */
export const TELEGRAM_PATH = '/internal/telegram'

/** The largest request body read, in bytes. */
export const MAX_TELEGRAM_BODY_BYTES = 4 * 1024

/** What the web app sends. */
export const TelegramRequestSchema = z.strictObject({
  tenantId: idSchema('tn'),
  venueId: idSchema('vn'),
  actor: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('user'),
      userId: z.string().min(1).max(128),
      sessionId: z.string().min(1).max(256),
    }),
    z.strictObject({ kind: z.literal('operator'), userId: z.string().min(1).max(128) }),
  ]),
  signedInAt: z.iso.datetime({ offset: true }).optional(),
  action: z.enum(['link_group', 'link_person', 'test']),
  /** The person to link, for `link_person`. */
  staffMemberId: idSchema('sm').optional(),
})

/** A request as parsed. */
export type TelegramRequest = z.output<typeof TelegramRequestSchema>

/** What the endpoint answers. */
export type TelegramApiAnswer =
  | {
      readonly status: 'accepted'
      /** The link to open, for the two link actions. */
      readonly url?: string
      /** When the link ends (ISO), for the two link actions. */
      readonly expiresAt?: string
    }
  | { readonly status: 'refused'; readonly code: string }

/** What the endpoint needs. */
export interface TelegramApiDeps {
  readonly pool: DbPool
  readonly telegram: TelegramClient
  /** The link-signing secret (REVEAL_SERVICE_TOKEN). */
  readonly secret: string
  readonly now: () => Date
}

/** Makes the handler: the bot's username is asked once and kept. */
export function createTelegramApi(
  deps: TelegramApiDeps,
): (request: TelegramRequest) => Promise<TelegramApiAnswer> {
  let username: string | null = null

  async function bot(): Promise<string> {
    username ??= (await deps.telegram.getMe()).username
    return username
  }

  return async (request) => {
    const context: ServiceContext = {
      tenantId: request.tenantId,
      venueId: request.venueId,
      origin: 'staff',
      actor: request.actor,
      jobId: `telegram-api-${randomUUID()}`,
      ...(request.signedInAt === undefined ? {} : { signedInAt: new Date(request.signedInAt) }),
    }
    // The right to change alert settings, with a fresh sign-in: nothing is changed by this.
    const { result } = await applyService(
      deps.pool,
      { type: 'settings.alerts_set', changes: {} },
      context,
    )
    if (result.status === 'refused') return { status: 'refused', code: result.code }

    try {
      if (request.action === 'test') return await test(request)
      if (request.action === 'link_person') {
        if (request.staffMemberId === undefined) return { status: 'refused', code: 'invalid' }
        const [assigned] = await withTenant(deps.pool, request.tenantId, (tx) =>
          tx
            .select({ id: staffAssignments.staffMemberId })
            .from(staffAssignments)
            .where(
              and(
                eq(staffAssignments.staffMemberId, request.staffMemberId as string),
                eq(staffAssignments.venueId, request.venueId),
                isNull(staffAssignments.endedAt),
              ),
            ),
        )
        if (assigned === undefined) return { status: 'refused', code: 'staff_missing' }
      }
      const now = deps.now()
      const code = makeLinkCode(deps.secret, {
        purpose: request.action === 'link_group' ? 'group' : 'person',
        venueId: request.venueId,
        ...(request.staffMemberId === undefined ? {} : { staffMemberId: request.staffMemberId }),
        now,
      })
      const param = request.action === 'link_group' ? 'startgroup' : 'start'
      return {
        status: 'accepted',
        url: `https://t.me/${await bot()}?${param}=${code}`,
        expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      }
    } catch (error) {
      if (error instanceof TelegramError) return { status: 'refused', code: 'telegram_failed' }
      throw error
    }
  }

  async function test(request: TelegramRequest): Promise<TelegramApiAnswer> {
    const [venue] = await withTenant(deps.pool, request.tenantId, (tx) =>
      tx
        .select({ name: venues.name, locale: venues.defaultLocale, settings: venues.settings })
        .from(venues)
        .where(eq(venues.id, request.venueId)),
    )
    const chatId = (
      venue?.settings as { ordering?: { telegramChatId?: string | null } } | undefined
    )?.ordering?.telegramChatId
    if (venue === undefined || chatId === undefined || chatId === null) {
      return { status: 'refused', code: 'no_group' }
    }
    await deps.telegram.sendMessage(
      chatId,
      telegramLinkText(alertLocale(venue.locale), 'test', venue.name),
    )
    return { status: 'accepted' }
  }
}
