'use server'

// The Alerts section's server actions (#87): who gets alerts on their phone and the Telegram group,
// through `settings.alerts_set` (a `record` Log entry, `settings.alerts` and a sign-in of the last
// 15 minutes); a person's Telegram id is unlinked through `staff.link_telegram`; a link to open and
// the test message come from the worker (it holds the bot), which checks the same right.
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { revealConfig } from '../reveal'
import { qrSvg } from '../tables/qr-image'
import { askTelegram, type TelegramAsk } from '../telegram-link'
import { INVALID, inSettingsScope, runSettingsCommand, type SettingsResult } from './scope'

const venueId = idSchema('vn')
const staffMemberId = idSchema('sm')

const SetRecipients = z.strictObject({
  venueId,
  userIds: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/)).max(50),
})
const OnVenue = z.strictObject({ venueId })
const OnPerson = z.strictObject({ venueId, staffMemberId })

/** A link to open (and when it ends), or a refusal. */
export type LinkResult =
  | {
      readonly ok: true
      readonly url: string
      readonly expiresAt: string
      /** The link as a QR code (SVG), for a person's link to scan; null for the group's. */
      readonly svg: string | null
    }
  | { readonly ok: false; readonly error: string }

/** Chooses whose installed devices get the venue's alerts. */
export async function setRecipientsAction(input: unknown): Promise<SettingsResult> {
  const parsed = SetRecipients.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, {
      type: 'settings.alerts_set',
      changes: { alertRecipientUserIds: parsed.data.userIds },
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** The venue forgets its Telegram group (the bot stays in it until someone removes it there). */
export async function unlinkGroupAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, {
      type: 'settings.alerts_set',
      changes: { telegramChatId: null },
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** A person's Telegram is unlinked: they can no longer press Done in the group. */
export async function unlinkPersonAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, {
      type: 'staff.link_telegram',
      staffMemberId: parsed.data.staffMemberId,
      telegramUserId: null,
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}

/** Asks the worker for something Telegram: a link to open, or the test message. */
async function ask(
  venue: string,
  request: TelegramAsk,
): Promise<SettingsResult<{ url?: string; expiresAt?: string }>> {
  return inSettingsScope(venue, async (scope) => {
    const reply = await askTelegram(
      revealConfig(),
      {
        tenantId: scope.tenantId,
        venueId: scope.venueId,
        actor: {
          userId: scope.userId,
          sessionId: scope.sessionId,
          signedInAt: scope.signedInAt,
          operator: scope.operator,
        },
      },
      request,
    )
    return reply.ok
      ? ({
          ok: true,
          details: {},
          ...(reply.url === undefined ? {} : { url: reply.url }),
          ...(reply.expiresAt === undefined ? {} : { expiresAt: reply.expiresAt }),
        } as const)
      : ({ ok: false, error: reply.error } as const)
  }) as Promise<SettingsResult<{ url?: string; expiresAt?: string }>>
}

/** The link that adds the bot to the venue's Telegram group (`t.me/<bot>?startgroup=…`). */
export async function linkGroupAction(input: unknown): Promise<LinkResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await ask(parsed.data.venueId, { action: 'link_group' })
  return linkOf(result, false)
}

/** The link a person opens on their phone to link their Telegram (`t.me/<bot>?start=…`). */
export async function linkPersonAction(input: unknown): Promise<LinkResult> {
  const parsed = OnPerson.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'invalid' }
  const result = await ask(parsed.data.venueId, {
    action: 'link_person',
    staffMemberId: parsed.data.staffMemberId,
  })
  return linkOf(result, true)
}

/** Sends the test message to the linked group. */
export async function testTelegramAction(input: unknown): Promise<SettingsResult> {
  const parsed = OnVenue.safeParse(input)
  if (!parsed.success) return INVALID
  return ask(parsed.data.venueId, { action: 'test' })
}

async function linkOf(
  result: SettingsResult<{ url?: string; expiresAt?: string }>,
  withQr: boolean,
): Promise<LinkResult> {
  if (!result.ok) return { ok: false, error: result.error }
  if (result.url === undefined || result.expiresAt === undefined) {
    return { ok: false, error: 'telegram_failed' }
  }
  return {
    ok: true,
    url: result.url,
    expiresAt: result.expiresAt,
    svg: withQr ? await qrSvg(result.url) : null,
  }
}
