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
  alertLocale,
  alertMessage,
  applyService,
  CLEARED_AT_DAY_CLOSE,
  clearedLine,
  DEFAULT_ROLE_PERMISSIONS,
  type DeliveryStep,
  digestMessage,
  doneButtonText,
  doneLine,
  linkedMessage,
  type MessageContext,
  PAUSED_KIND,
  type PlannedAlert,
  planDelivery,
  readDelivery,
  reminderMessage,
  ruleOf,
  serviceHoursWindow,
  tableLabel,
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
import { and, eq, gt, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'

import type { Logger } from '../logger'
import type { DeviceSubscription, PushSender } from './push'
import { type PushRecipient, pushTargets } from './push-targets'
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

interface Recipient extends PushRecipient {
  readonly devices: readonly (DeviceSubscription & { readonly endpointHash: string })[]
}

interface VenueForDelivery {
  readonly id: string
  readonly name: string
  readonly timezone: string
  readonly serviceDayEndsAt: string
  readonly defaultLocale: string
  readonly settings: Record<string, unknown>
}

/** The alert as the pass reads it: the planner's view, and what the words and the edit need. */
interface LoadedAlert {
  readonly planned: PlannedAlert
  /** The permission the alert was raised with: only people who hold it are pushed to. */
  readonly permission: string | null
  readonly details: Record<string, unknown>
  readonly subjectId: string
  readonly doneAt: Date | null
  readonly doneBy: string | null
  readonly telegramRef: string | null
}

/** True for an organisation's owner or admin (Better Auth may join several roles with commas). */
function isOwnerRole(role: string): boolean {
  return /\b(owner|admin)\b/i.test(role.replaceAll(',', ' '))
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
          defaultLocale: venues.defaultLocale,
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
    const deviceColumns = {
      userId: pushSubscriptions.userId,
      endpointHash: pushSubscriptions.endpointHash,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    }
    const switchedOn =
      recipientIds.length === 0 || deps.push === null
        ? []
        : await tx
            .select(deviceColumns)
            .from(pushSubscriptions)
            .where(
              and(
                inArray(pushSubscriptions.userId, recipientIds),
                isNull(pushSubscriptions.revokedAt),
              ),
            )

    // Everyone who holds the permission of an alert raised with one: their role's permissions at
    // this venue, and the organisation's owners and admins (who hold all). Read only when an alert
    // needs it; their devices ring only when no switched-on person holds it (push-targets.ts).
    const needed = new Set(rows.flatMap((row) => (row.permission === null ? [] : [row.permission])))
    const holds = new Map<string, Set<string>>()
    const organisationOwners = new Set<string>()
    if (deps.push !== null) {
      const members = await tx
        .select({ userId: authMember.userId, role: authMember.role })
        .from(authMember)
        .where(eq(authMember.organizationId, tenantId))
      for (const member of members) {
        if (isOwnerRole(member.role)) organisationOwners.add(member.userId)
      }
      const staff = await tx
        .select({
          userId: staffMembers.userId,
          defaultKind: venueRoles.defaultKind,
          permissions: venueRoles.permissions,
        })
        .from(staffMembers)
        .innerJoin(staffAssignments, eq(staffAssignments.staffMemberId, staffMembers.id))
        .innerJoin(venueRoles, eq(venueRoles.id, staffAssignments.roleId))
        .where(
          and(
            eq(staffAssignments.venueId, venue.id),
            isNull(staffAssignments.endedAt),
            isNull(staffMembers.archivedAt),
            isNotNull(staffMembers.userId),
          ),
        )
      for (const row of staff) {
        if (row.userId === null) continue
        const list =
          row.defaultKind === 'staff' ||
          row.defaultKind === 'manager' ||
          row.defaultKind === 'owner'
            ? DEFAULT_ROLE_PERMISSIONS[row.defaultKind]
            : Array.isArray(row.permissions)
              ? (row.permissions as string[])
              : []
        holds.set(row.userId, new Set([...(holds.get(row.userId) ?? []), ...list]))
        if (row.defaultKind === 'owner') organisationOwners.add(row.userId)
      }
    }
    const holderIds =
      needed.size === 0 ? [] : [...new Set([...holds.keys(), ...organisationOwners])]
    const holderDevices =
      holderIds.length === 0
        ? []
        : await tx
            .select(deviceColumns)
            .from(pushSubscriptions)
            .where(
              and(
                inArray(pushSubscriptions.userId, holderIds),
                isNull(pushSubscriptions.revokedAt),
              ),
            )
    const seen = new Set<string>()
    const devices = [...switchedOn, ...holderDevices].filter((device) => {
      if (seen.has(device.endpointHash)) return false
      seen.add(device.endpointHash)
      return true
    })
    const ownerIds = new Set<string>(
      [...organisationOwners].filter((id) => devices.some((device) => device.userId === id)),
    )
    const switchedOnIds = new Set(recipientIds)
    return { rows, devices, ownerIds, holds, switchedOnIds }
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
      captureBefore: instantOf(row.details.captureBefore),
    },
    permission: row.permission,
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
      switchedOn: loaded.switchedOnIds.has(device.userId),
      holds: loaded.holds.get(device.userId) ?? new Set<string>(),
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
      // A person switched on, or (for an alert with a permission) a holder who has a device.
      push:
        deps.push !== null &&
        ([...recipients.values()].some((recipient) => recipient.switchedOn) ||
          (loadedAlerts.some((alert) => alert.permission !== null) && recipients.size > 0)),
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
        const label = tableLabel(alertLocale(venue.defaultLocale), table)
        if (label !== null) tableLabels.set(table.id, label)
      }
    }
    let source = alertLocale(venue.defaultLocale) === 'bg' ? 'POS системата' : 'the POS'
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
    locale: alertLocale(venue.defaultLocale),
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
    ? reminderMessage(base, alertLocale(venue.defaultLocale))
    : base
}

/** Sends one planned message and records it. True when it went (so a later pass need not). */
async function sendStep(deps: DeliveryDeps, input: StepInput): Promise<boolean> {
  const { step, carried, venue, tenantId } = input
  const locale = alertLocale(venue.defaultLocale)
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
        // Each person gets the alerts they may see: one without a permission goes to the switched-on
        // people, one with a permission to the switched-on people who hold it (every holder when none
        // is switched on); people who see the same alerts share one message.
        const groups = new Map<string, { indexes: number[]; recipients: Recipient[] }>()
        const seenBy = new Map<Recipient, number[]>()
        for (const [index, alert] of carried.entries()) {
          for (const recipient of pushTargets(
            input.recipients,
            alert.permission,
            step.ownersOnly,
          )) {
            seenBy.set(recipient, [...(seenBy.get(recipient) ?? []), index])
          }
        }
        for (const [recipient, indexes] of seenBy) {
          const key = indexes.join(',')
          const group = groups.get(key) ?? { indexes, recipients: [] }
          group.recipients.push(recipient)
          groups.set(key, group)
        }
        const sends = [...groups.values()].flatMap((group) => {
          const message = digestMessage(
            group.indexes.flatMap((index) => messages[index] ?? []),
            venue.name,
            locale,
          )
          const payload = {
            title: message.title,
            body: message.body,
            tag: `${venue.id}:${carried[group.indexes[0] ?? 0]?.planned.kind ?? 'alert'}`,
            url: pushUrlOf(venue.id),
          }
          return group.recipients.flatMap((recipient) =>
            recipient.devices.map((device) => ({ device, payload })),
          )
        })
        const devices = sends.map((send) => send.device)
        if (devices.length === 0) return false
        const outcomes = await Promise.all(
          sends.map((send) => deps.push?.send(send.device, send.payload)),
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
          // The day's close cleared it (#162): the words say so and no person is named.
          const ending =
            alert.details.clearedAt === CLEARED_AT_DAY_CLOSE
              ? clearedLine(locale)
              : doneLine(
                  await doneByName(deps.pool, tenantId, alert.doneBy),
                  alert.doneAt ?? deps.now(),
                  venue.timezone,
                  locale,
                )
          const text = `${linkedMessage(message)}\n\n${ending}`
          await telegram.editMessage(ref, text)
          await record()
          return true
        }
        // A button only where a person can answer it: not on a pause, nor on "back", nor on a card
        // payment's question, which is answered in Restro (#112).
        const rule = ruleOf(alert.planned.kind, alert.planned.audience)
        const answerable = step.step === 'new' && !rule.closesItself && rule.needsAnswer !== true
        const sentMessage = await telegram.sendMessage(chatId, linkedMessage(message), {
          ...(answerable ? { doneFor: alert.planned.id, doneLabel: doneButtonText(locale) } : {}),
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
/** An instant kept in an alert's details (a card's `captureBefore`, #112), or null. */
function instantOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? null : at
}

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
