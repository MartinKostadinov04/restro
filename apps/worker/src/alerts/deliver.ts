// Delivery of alerts (#83; D120 "Alerts reach everyone", D122 §7): one pass over every venue.
//
// For each venue the pass keeps its pauses as alerts (`alerts.sync_pauses`), reads its open alerts
// and the ones closed in the last day, asks the planner (`planDelivery`, core) what is due, sends
// it and records each message with `alert.delivered`, so a later pass never repeats it. A message
// is recorded after it went: a crash between the two sends it twice, never loses it.
//
// Receivers: the ticked accounts' installed devices (Web Push), the venue's Telegram group (each
// alert its own message, with a Done button where someone can answer it) and the Restro team's
// chat. A receiver with nobody to reach is left out. Texts carry no note and no guest data.

import { randomUUID } from 'node:crypto'

import { connectorLabel, isIntegrationKind, readOrderingSettings } from '@restro/core'
import {
  type AlertMessage,
  alertMessage,
  applyService,
  type DeliveryStep,
  digestMessage,
  doneLine,
  linkedMessage,
  type MessageContext,
  PAUSED_KIND,
  type PlannedAlert,
  planDelivery,
  readDelivery,
  ruleOf,
  serviceHoursWindow,
} from '@restro/core/service'
import {
  alerts,
  authMember,
  authOrganization,
  authUser,
  type DbPool,
  integrations,
  pauses,
  places,
  pushSubscriptions,
  staffAssignments,
  staffMembers,
  venueRoles,
  venues,
  venueTables,
  withSystem,
  withTenant,
} from '@restro/db'
import { and, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm'

import type { Logger } from '../logger'
import type { DeviceSubscription, PushSender } from './push'
import type { MessageRef, TelegramClient } from './telegram'

/** What a pass needs. */
export interface DeliveryDeps {
  readonly pool: DbPool
  readonly log: Pick<Logger, 'warn' | 'error'>
  readonly now: () => Date
  /** Null without the VAPID keys: nothing is pushed. */
  readonly push: PushSender | null
  /** Null without the bot token: nothing goes to Telegram. */
  readonly telegram: TelegramClient | null
  /** The Restro team's chat, or null. */
  readonly teamChatId: string | null
  /** When a send last failed, so a down service is not asked every pass. Kept between passes. */
  readonly retryAfter?: Map<string, number>
}

/** Closed alerts still looked at: a "back", or an edit to "Done by …", may be due. */
const CLOSED_LOOKBACK_MS = 24 * 3_600_000
/** After a failed send, the same message waits this long. */
const RETRY_AFTER_MS = 30_000

/** The path a tap on a push opens. Tonight (#85) will have its own page; until then, the venue. */
export function pushUrlOf(venueId: string): string {
  return `/venues/${venueId}`
}

/** `Table 7` for a table: our name for it, else its number. */
function tableLabelOf(table: { name: string | null; number: string | null }): string | null {
  if (table.name !== null) return table.name
  return table.number === null ? null : `Table ${table.number}`
}

interface Recipient {
  readonly userId: string
  readonly owner: boolean
  readonly devices: readonly (DeviceSubscription & { readonly endpointHash: string })[]
}

interface VenueForDelivery {
  readonly id: string
  readonly name: string
  readonly timezone: string
  readonly serviceDayEndsAt: string
  readonly settings: Record<string, unknown>
}

/** The alert as the pass reads it: the planner's view, and what the words and the edit need. */
interface LoadedAlert {
  readonly planned: PlannedAlert
  readonly details: Record<string, unknown>
  readonly subjectId: string
  readonly doneAt: Date | null
  readonly doneBy: string | null
  readonly telegramRef: string | null
}

/** Runs one pass; answers how many messages it sent. */
export async function deliverAlerts(deps: DeliveryDeps): Promise<number> {
  if (deps.push === null && deps.telegram === null) return 0
  const organisations = await withSystem(deps.pool, (tx) =>
    tx.select({ id: authOrganization.id }).from(authOrganization),
  )
  let sent = 0
  for (const organisation of organisations) {
    const venueRows = await withTenant(deps.pool, organisation.id, (tx) =>
      tx
        .select({
          id: venues.id,
          name: venues.name,
          timezone: venues.timezone,
          serviceDayEndsAt: venues.serviceDayEndsAt,
          settings: venues.settings,
        })
        .from(venues)
        .where(isNull(venues.archivedAt)),
    )
    for (const venue of venueRows) {
      try {
        sent += await deliverForVenue(deps, organisation.id, venue as VenueForDelivery)
      } catch (error) {
        deps.log.error({ venueId: venue.id, err: error }, 'alerts could not be delivered')
      }
    }
  }
  return sent
}

/**
 * True when the venue may have pause alerts to raise or close: a pause is active anywhere in the
 * organisation (a connection pause names its venues, which the sync works out), or the venue has
 * a pause alert open. Spares a write for every venue on every pass.
 */
async function hasPauseWork(pool: DbPool, tenantId: string, venueId: string): Promise<boolean> {
  return withTenant(pool, tenantId, async (tx) => {
    const [active] = await tx
      .select({ id: pauses.id })
      .from(pauses)
      .where(and(isNull(pauses.liftedAt), ne(pauses.scope, 'table')))
      .limit(1)
    if (active !== undefined) return true
    const [open] = await tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(and(eq(alerts.venueId, venueId), eq(alerts.kind, PAUSED_KIND), isNull(alerts.doneAt)))
      .limit(1)
    return open !== undefined
  })
}

const workerContext = (tenantId: string, venueId: string, job: string) => ({
  tenantId,
  venueId,
  origin: 'worker' as const,
  actor: { kind: 'system' as const },
  jobId: `${job}-${randomUUID()}`,
})

async function deliverForVenue(
  deps: DeliveryDeps,
  tenantId: string,
  venue: VenueForDelivery,
): Promise<number> {
  if (await hasPauseWork(deps.pool, tenantId, venue.id)) {
    await applyService(
      deps.pool,
      { type: 'alerts.sync_pauses' },
      workerContext(tenantId, venue.id, 'alerts-pauses'),
    )
  }

  // Read after the sync, so an alert it just raised is not "from the future".
  const now = deps.now()
  const settings = readOrderingSettings(venue.settings)
  const loaded = await withTenant(deps.pool, tenantId, async (tx) => {
    const since = new Date(now.getTime() - CLOSED_LOOKBACK_MS)
    const rows = await tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.venueId, venue.id), or(isNull(alerts.doneAt), gt(alerts.doneAt, since))))
      .orderBy(alerts.raisedAt, alerts.id)
    const recipientIds = settings.alertRecipientUserIds
    const devices =
      recipientIds.length === 0 || deps.push === null
        ? []
        : await tx
            .select({
              userId: pushSubscriptions.userId,
              endpointHash: pushSubscriptions.endpointHash,
              endpoint: pushSubscriptions.endpoint,
              p256dh: pushSubscriptions.p256dh,
              auth: pushSubscriptions.auth,
            })
            .from(pushSubscriptions)
            .where(
              and(
                inArray(pushSubscriptions.userId, recipientIds),
                isNull(pushSubscriptions.revokedAt),
              ),
            )
    const deviceUserIds = [...new Set(devices.map((device) => device.userId))]
    const ownerIds = new Set<string>()
    if (deviceUserIds.length > 0) {
      const members = await tx
        .select({ userId: authMember.userId, role: authMember.role })
        .from(authMember)
        .where(
          and(eq(authMember.organizationId, tenantId), inArray(authMember.userId, deviceUserIds)),
        )
      for (const member of members) {
        if (/\b(owner|admin)\b/i.test(member.role.replaceAll(',', ' '))) ownerIds.add(member.userId)
      }
      const roleOwners = await tx
        .select({ userId: staffMembers.userId })
        .from(staffMembers)
        .innerJoin(staffAssignments, eq(staffAssignments.staffMemberId, staffMembers.id))
        .innerJoin(venueRoles, eq(venueRoles.id, staffAssignments.roleId))
        .where(
          and(
            inArray(staffMembers.userId, deviceUserIds),
            eq(staffAssignments.venueId, venue.id),
            isNull(staffAssignments.endedAt),
            eq(venueRoles.defaultKind, 'owner'),
          ),
        )
      for (const row of roleOwners) if (row.userId !== null) ownerIds.add(row.userId)
    }
    return { rows, devices, ownerIds }
  })

  const loadedAlerts: LoadedAlert[] = loaded.rows.map((row) => ({
    planned: {
      id: row.id,
      kind: row.kind,
      audience: row.audience as 'venue' | 'restro',
      raisedAt: row.raisedAt,
      doneAt: row.doneAt,
      delivery: readDelivery(row.details),
      telegramRef: row.telegramMessageRef,
    },
    details: row.details,
    subjectId: row.subjectId,
    doneAt: row.doneAt,
    doneBy: row.doneBy,
    telegramRef: row.telegramMessageRef,
  }))
  if (loadedAlerts.length === 0) return 0

  const recipients = new Map<string, Recipient>()
  for (const device of loaded.devices) {
    const before = recipients.get(device.userId)
    recipients.set(device.userId, {
      userId: device.userId,
      owner: loaded.ownerIds.has(device.userId),
      devices: [...(before?.devices ?? []), device],
    })
  }

  const window = serviceHoursWindow(settings, venue.timezone, venue.serviceDayEndsAt, now)
  const venueChatId = settings.telegramChatId
  const plan = planDelivery({
    now,
    window,
    alerts: loadedAlerts.map((alert) => alert.planned),
    reachable: {
      push: deps.push !== null && recipients.size > 0,
      venueTelegram: deps.telegram !== null && venueChatId !== null,
      team: deps.telegram !== null && deps.teamChatId !== null,
    },
  })

  if (plan.suppress.length > 0) {
    await applyService(
      deps.pool,
      { type: 'alert.suppressed', alertIds: [...plan.suppress] },
      workerContext(tenantId, venue.id, 'alerts-suppress'),
    )
  }
  if (plan.steps.length === 0) return 0

  const byId = new Map(loadedAlerts.map((alert) => [alert.planned.id, alert]))
  const words = await wordsFor(deps.pool, tenantId, venue, loadedAlerts)
  let sent = 0
  for (const step of plan.steps) {
    const retryKey = `${venue.id}:${step.receiver}:${step.step}:${step.alertIds.join(',')}`
    if ((deps.retryAfter?.get(retryKey) ?? 0) > now.getTime()) continue
    const carried = step.alertIds.flatMap((id) => byId.get(id) ?? [])
    const ok = await sendStep(deps, {
      tenantId,
      venue,
      step,
      carried,
      words,
      recipients: [...recipients.values()],
      venueChatId,
      window,
    })
    if (ok) {
      sent += 1
      deps.retryAfter?.delete(retryKey)
    } else {
      deps.retryAfter?.set(retryKey, now.getTime() + RETRY_AFTER_MS)
    }
  }
  return sent
}

interface Words {
  readonly source: string
  readonly tableLabels: ReadonlyMap<string, string>
}

/** The table labels and the POS's name the texts of this venue's alerts need. */
async function wordsFor(
  pool: DbPool,
  tenantId: string,
  venue: VenueForDelivery,
  loaded: readonly LoadedAlert[],
): Promise<Words> {
  const tableIds = [
    ...new Set(
      loaded.flatMap((alert) => {
        const fromDetails = alert.details.tableId
        return [
          ...(alert.subjectId.startsWith('tb_') ? [alert.subjectId] : []),
          ...(typeof fromDetails === 'string' ? [fromDetails] : []),
        ]
      }),
    ),
  ]
  return withTenant(pool, tenantId, async (tx) => {
    const tableLabels = new Map<string, string>()
    if (tableIds.length > 0) {
      const tables = await tx
        .select({ id: venueTables.id, name: venueTables.name, number: venueTables.number })
        .from(venueTables)
        .where(and(eq(venueTables.venueId, venue.id), inArray(venueTables.id, tableIds)))
      for (const table of tables) {
        const label = tableLabelOf(table)
        if (label !== null) tableLabels.set(table.id, label)
      }
    }
    let source = 'the POS'
    if (tableIds.length > 0) {
      const [served] = await tx
        .select({ kind: integrations.kind })
        .from(places)
        .innerJoin(integrations, eq(integrations.id, places.integrationId))
        .where(inArray(places.tableId, tableIds))
        .limit(1)
      if (served !== undefined && isIntegrationKind(served.kind))
        source = connectorLabel(served.kind)
    }
    return { source, tableLabels }
  })
}

interface StepInput {
  readonly tenantId: string
  readonly venue: VenueForDelivery
  readonly step: DeliveryStep
  readonly carried: readonly LoadedAlert[]
  readonly words: Words
  readonly recipients: readonly Recipient[]
  readonly venueChatId: string | null
  readonly window: { readonly date: string }
}

/** The words of one alert for this step. */
function messageOf(input: StepInput, alert: LoadedAlert): AlertMessage {
  const { venue, words } = input
  const tableId =
    typeof alert.details.tableId === 'string'
      ? alert.details.tableId
      : alert.subjectId.startsWith('tb_')
        ? alert.subjectId
        : null
  const context: MessageContext = {
    venueName: venue.name,
    tableLabel: tableId === null ? null : (words.tableLabels.get(tableId) ?? null),
    source: words.source,
  }
  const base = alertMessage(
    { kind: alert.planned.kind, details: alert.details },
    context,
    input.step.step,
  )
  // A reminder says so, except a pause, whose own words already say "still".
  return input.step.step === 'reminder' && alert.planned.kind !== PAUSED_KIND
    ? { ...base, title: `Reminder: ${base.title}` }
    : base
}

/** Sends one planned message and records it. True when it went (so a later pass need not). */
async function sendStep(deps: DeliveryDeps, input: StepInput): Promise<boolean> {
  const { step, carried, venue, tenantId } = input
  if (carried.length === 0) return true
  const messages = carried.map((alert) => messageOf(input, alert))
  const record = (extra: { telegramRef?: string } = {}) =>
    applyService(
      deps.pool,
      {
        type: 'alert.delivered',
        alertIds: carried.map((alert) => alert.planned.id),
        receiver: step.receiver,
        step: step.step,
        day: input.window.date,
        ...extra,
      },
      workerContext(tenantId, venue.id, 'alerts-delivered'),
    )

  try {
    switch (step.receiver) {
      case 'push': {
        if (deps.push === null) return true
        const targets = input.recipients.filter((recipient) => !step.ownersOnly || recipient.owner)
        const devices = targets.flatMap((recipient) => recipient.devices)
        if (devices.length === 0) return false
        const message = digestMessage(messages, venue.name)
        const payload = {
          title: message.title,
          body: message.body,
          tag: `${venue.id}:${carried[0]?.planned.kind ?? 'alert'}`,
          url: pushUrlOf(venue.id),
        }
        const outcomes = await Promise.all(
          devices.map((device) => deps.push?.send(device, payload)),
        )
        for (const [index, outcome] of outcomes.entries()) {
          const device = devices[index]
          if (outcome === 'gone' && device !== undefined) {
            await applyService(
              deps.pool,
              { type: 'push.expire', endpointHash: device.endpointHash },
              workerContext(tenantId, venue.id, 'alerts-push-expire'),
            )
          }
        }
        if (!outcomes.includes('sent')) return outcomes.every((outcome) => outcome === 'gone')
        await record()
        return true
      }
      case 'venueTelegram': {
        const telegram = deps.telegram
        const chatId = input.venueChatId
        const alert = carried[0]
        const message = messages[0]
        if (telegram === null || chatId === null || alert === undefined || message === undefined) {
          return true
        }
        if (step.step === 'done_edit') {
          const ref = parseRef(alert.telegramRef)
          if (ref === null) return true
          const by = await doneByName(deps.pool, tenantId, alert.doneBy)
          const text = `${linkedMessage(message)}\n\n${doneLine(by, alert.doneAt ?? deps.now(), venue.timezone)}`
          await telegram.editMessage(ref, text)
          await record()
          return true
        }
        // A button only where a person can answer it: not on a pause, nor on "back".
        const answerable =
          step.step === 'new' && !ruleOf(alert.planned.kind, alert.planned.audience).closesItself
        const sentMessage = await telegram.sendMessage(chatId, linkedMessage(message), {
          ...(answerable ? { doneFor: alert.planned.id } : {}),
        })
        await record(
          step.step === 'new'
            ? { telegramRef: `${sentMessage.chatId}:${sentMessage.messageId}` }
            : {},
        )
        return true
      }
      case 'team': {
        const telegram = deps.telegram
        const chatId = deps.teamChatId
        if (telegram === null || chatId === null) return true
        const lines = messages.map((message, index) => {
          const text = linkedMessage(message)
          // The team's alerts for a venue's own kinds name the venue.
          return carried[index]?.planned.audience === 'venue' && !text.includes(venue.name)
            ? `${venue.name}: ${text}`
            : text
        })
        await telegram.sendMessage(chatId, lines.join('\n\n'))
        await record()
        return true
      }
    }
  } catch (error) {
    deps.log.warn(
      { venueId: venue.id, receiver: step.receiver, step: step.step, err: error },
      'an alert message could not be sent',
    )
    return false
  }
}

/** `chat:message` as the alert keeps a Telegram message. */
function parseRef(text: string | null): MessageRef | null {
  const match = text === null ? null : /^(-?\d+):(\d+)$/.exec(text)
  return match === null ? null : { chatId: match[1] as string, messageId: Number(match[2]) }
}

/** The name to put after "Done by": the staff member, the account, or Restro itself. */
export async function doneByName(
  pool: DbPool,
  tenantId: string,
  actor: string | null,
): Promise<string> {
  if (actor === null || actor === 'system') return 'Restro'
  const [kind, id] = actor.split(':', 2) as [string, string | undefined]
  if (id === undefined) return 'Restro'
  return withTenant(pool, tenantId, async (tx) => {
    if (kind === 'staff') {
      const [member] = await tx
        .select({ name: staffMembers.displayName })
        .from(staffMembers)
        .where(eq(staffMembers.id, id))
      return member?.name ?? 'staff'
    }
    if (kind === 'user' || kind === 'operator') {
      const [member] = await tx
        .select({ name: staffMembers.displayName })
        .from(staffMembers)
        .where(and(eq(staffMembers.userId, id), isNull(staffMembers.archivedAt)))
      if (member !== undefined) return member.name
      const [user] = await tx
        .select({ name: authUser.name })
        .from(authUser)
        .where(eq(authUser.id, id))
      return user?.name ?? 'staff'
    }
    return 'Restro'
  })
}
