// The lifecycle of an alert (D120 "Alerts reach everyone"; D122 §7; ticket #83). Raising lives
// with what raises it (an Unconfirmed order, a guard's trip, a pause); this file holds what comes
// after: staff press Done (in Tonight or from the venue's Telegram group), the worker records what
// it sent and to whom, and a venue-level pause is kept as an alert that closes when the pause
// lifts, so "paused" and "back" travel like every other alert.
//
// Locks, in the fixed order (lock-order.ts): the pauses are only read, then the alert rows.

import { createHash } from 'node:crypto'

import { alerts, bars, pauses, pushSubscriptions } from '@restro/db'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '../ids'
import { RECEIVERS, readDelivery, recordStep, STEPS, withDelivery } from './alert-delivery'
import { PAUSED_KIND, ruleOf } from './alert-rules'
import type { ServiceTx } from './definition'
import { pausesOfVenue } from './pause-scope'
import type { Permission } from './permissions'
import { accepted, refused, type ServiceResult } from './results'

/** A pause that returns within this long of lifting is the same pause (D120). */
export const PAUSE_RETURN_MS = 10 * 60_000

/** The scopes of a pause that is an alert: a venue, a bar or the POS connection (not a table). */
const PAUSE_ALERT_SCOPES = ['venue', 'bar', 'connection'] as const

/**
 * The push services a browser's subscription really names (RR-86). The worker POSTs to the endpoint a
 * staff account gave, so anything else would let that account aim the worker at any address.
 */
const PUSH_SERVICE_HOSTS: readonly string[] = [
  // Chrome, and the browsers built on it that use Google's service (Samsung Internet, Opera).
  'fcm.googleapis.com',
]
// Chromium builds outside branded stable Chrome, and some Chrome versions: Google's push service on
// numbered hosts (seen as jmt17.google.com, not documented by Google). Exact shape only: a wider
// `.google.com` would let an account aim the worker at any Google host.
const GOOGLE_NUMBERED_HOST = /^jmt[0-9]{1,3}[.]google[.]com$/
const PUSH_SERVICE_SUFFIXES = [
  // Firefox.
  '.push.services.mozilla.com',
  // Safari, and an app added to an iPhone's Home Screen.
  '.push.apple.com',
  // Edge.
  '.notify.windows.com',
]

/**
 * True for https to one of those hosts, with no port and no user or password. The address must start
 * exactly as its parsed host says, so a port, a user, capitals or a backslash, which parsers can read
 * differently, are refused rather than interpreted.
 */
function isPushServiceEndpoint(endpoint: string): boolean {
  let host: string
  try {
    host = new URL(endpoint).hostname
  } catch {
    return false
  }
  return (
    endpoint.startsWith(`https://${host}/`) &&
    (PUSH_SERVICE_HOSTS.includes(host) ||
      GOOGLE_NUMBERED_HOST.test(host) ||
      PUSH_SERVICE_SUFFIXES.some((suffix) => host.endsWith(suffix)))
  )
}

const SubscriptionKeys = {
  endpoint: z.string().max(1024).refine(isPushServiceEndpoint),
  p256dh: z.string().regex(/^[A-Za-z0-9_-]{40,200}$/),
  auth: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
}

/** `push.subscribe`'s payload. */
export const PushSubscribeSchema = z.strictObject({
  type: z.literal('push.subscribe'),
  ...SubscriptionKeys,
})

const EndpointHash = z.string().regex(/^[0-9a-f]{64}$/)

/** `push.revoke`: an account ends one of its own devices. */
export const PushRevokeSchema = z.strictObject({
  type: z.literal('push.revoke'),
  endpointHash: EndpointHash,
})

/** `push.expire`: the worker ends a device the push service no longer knows. */
export const PushExpireSchema = z.strictObject({
  type: z.literal('push.expire'),
  endpointHash: EndpointHash,
})

/** The key of a push subscription: SHA-256 of its endpoint. */
export function endpointHashOf(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex')
}

/**
 * `alert.done`: staff mark an alert Done, in Tonight or from the venue's Telegram group (`via`
 * says which). Needs `alerts.answer` and the alert's own permission; an alert for Restro's admin
 * team only an operator answers; one that closes by itself (a pause) has no Done, nor has a card
 * payment's question, which only its answer closes (#112). A repeat finds it done and changes
 * nothing.
 */
export async function alertDone(
  stx: ServiceTx,
  command: { readonly alertId: string },
): Promise<ServiceResult> {
  stx.rows.claim('alert', [command.alertId])
  const [alert] = await stx.tx
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, command.alertId), eq(alerts.venueId, stx.venueId)))
    .for('update')
  if (alert === undefined) return refused(null, 'alert_missing')
  if (alert.audience === 'restro' && stx.actor.kind !== 'operator') {
    return refused(null, 'alert_missing')
  }
  if (alert.permission !== null && !stx.permissions.has(alert.permission as Permission)) {
    return refused(null, 'permission_denied')
  }
  const rule = ruleOf(alert.kind, alert.audience as 'venue' | 'restro')
  if (rule.closesItself) return refused(null, 'alert_closes_itself')
  // A card payment's question closes only by its answer (#112), never by Done.
  if (rule.closesByAnswer) return refused(null, 'alert_needs_answer')
  if (alert.doneAt !== null) {
    return accepted(null, { details: { state: 'done', changed: false, kind: alert.kind } })
  }
  await stx.tx
    .update(alerts)
    .set({
      doneAt: sql`now()`,
      doneBy: stx.provenance.actor,
      via: stx.via,
      nextRepeatAt: null,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(alerts.id, alert.id))
  await stx.log({
    kind: 'alert.done',
    reason: alert.kind,
    details: { alertId: alert.id },
  })
  return accepted(null, { details: { state: 'done', changed: true, kind: alert.kind } })
}

/** `alert.delivered`'s payload: what the worker sent, and to whom. */
export const AlertDeliveredSchema = z.strictObject({
  type: z.literal('alert.delivered'),
  alertIds: z
    .array(z.string().regex(/^al_[0-9A-Za-z]+$/))
    .min(1)
    .max(100),
  receiver: z.enum(RECEIVERS),
  step: z.enum(STEPS),
  /** The venue group's message (`chat:message`), kept to edit it to "Done by …". */
  telegramRef: z
    .string()
    .regex(/^-?[0-9]{1,20}:[0-9]{1,20}$/)
    .optional(),
  /** The service day, for "still paused". */
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

/** `alert.delivered`: the worker records one message it sent, on each alert it carried. */
export async function alertDelivered(
  stx: ServiceTx,
  command: z.infer<typeof AlertDeliveredSchema>,
): Promise<ServiceResult> {
  const ids = [...new Set(command.alertIds)].sort()
  stx.rows.claim('alert', ids)
  const rows = await stx.tx
    .select()
    .from(alerts)
    .where(and(inArray(alerts.id, ids), eq(alerts.venueId, stx.venueId)))
    .orderBy(alerts.id)
    .for('update')
  const at = await stx.dbNow()
  for (const row of rows) {
    const state = recordStep(readDelivery(row.details), command.receiver, command.step, at, {
      ...(command.day === undefined ? {} : { day: command.day }),
    })
    await stx.tx
      .update(alerts)
      .set({
        details: withDelivery(row.details, state),
        ...(command.receiver === 'venueTelegram' &&
        command.step === 'new' &&
        command.telegramRef !== undefined
          ? { telegramMessageRef: command.telegramRef }
          : {}),
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, row.id))
  }
  return accepted(null, { details: { recorded: rows.length } })
}

/** `alert.suppressed`'s payload. */
export const AlertSuppressedSchema = z.strictObject({
  type: z.literal('alert.suppressed'),
  alertIds: z
    .array(z.string().regex(/^al_[0-9A-Za-z]+$/))
    .min(1)
    .max(100),
})

/** `alert.suppressed`: alerts raised while the venue was closed are never sent (D120). */
export async function alertSuppressed(
  stx: ServiceTx,
  command: z.infer<typeof AlertSuppressedSchema>,
): Promise<ServiceResult> {
  const ids = [...new Set(command.alertIds)].sort()
  stx.rows.claim('alert', ids)
  const rows = await stx.tx
    .select()
    .from(alerts)
    .where(and(inArray(alerts.id, ids), eq(alerts.venueId, stx.venueId)))
    .orderBy(alerts.id)
    .for('update')
  for (const row of rows) {
    await stx.tx
      .update(alerts)
      .set({
        details: withDelivery(row.details, { ...readDelivery(row.details), suppressed: true }),
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, row.id))
  }
  return accepted(null, { details: { recorded: rows.length } })
}

/** The pause's words for an alert: its scope, its cause and, for a bar, its name. */
async function pauseDetails(
  stx: ServiceTx,
  pause: {
    readonly id: string
    readonly scope: string
    readonly targetId: string
    readonly cause: string
  },
): Promise<Record<string, unknown>> {
  let barName: string | null = null
  if (pause.scope === 'bar') {
    const [bar] = await stx.tx
      .select({ name: bars.name })
      .from(bars)
      .where(eq(bars.id, pause.targetId))
    barName = bar?.name ?? null
  }
  return {
    pauseId: pause.id,
    scope: pause.scope,
    cause: pause.cause,
    ...(barName === null ? {} : { barName }),
  }
}

/**
 * `alerts.sync_pauses`: keeps one open alert per active venue-level pause covering this venue
 * (subject: the venue, the bar or the POS connection it pauses) and closes the alert of one that
 * lifted. A pause that returns within 10 minutes of lifting, before anyone was told "back",
 * reopens the same alert: it stays the same pause (D120).
 */
export async function syncPauseAlerts(stx: ServiceTx): Promise<ServiceResult> {
  const active = await stx.tx
    .select({
      id: pauses.id,
      scope: pauses.scope,
      targetId: pauses.targetId,
      cause: pauses.cause,
    })
    .from(pauses)
    .where(
      and(
        isNull(pauses.liftedAt),
        inArray(pauses.scope, [...PAUSE_ALERT_SCOPES]),
        pausesOfVenue(stx.venueId),
      ),
    )
  const now = await stx.dbNow()
  const recentSince = new Date(now.getTime() - PAUSE_RETURN_MS)
  stx.rows.claim('alert', ['pauses'])
  const rows = await stx.tx
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, PAUSED_KIND),
        sql`(${alerts.doneAt} is null or ${alerts.doneAt} > ${recentSince.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(alerts.raisedAt, alerts.id)
    .for('update')

  const activeTargets = new Set(active.map((pause) => pause.targetId))
  let raised = 0
  let reopened = 0
  let closed = 0

  for (const pause of active) {
    const same = rows.filter((row) => row.subjectId === pause.targetId)
    if (same.some((row) => row.doneAt === null)) continue
    // Closed a moment ago and nobody has heard "back": the pause has returned, not begun anew.
    const returning = same.find((row) => {
      const delivery = readDelivery(row.details)
      return RECEIVERS.every((receiver) => delivery[receiver]?.backAt === undefined)
    })
    if (returning !== undefined) {
      await stx.tx
        .update(alerts)
        .set({
          doneAt: null,
          doneBy: null,
          via: null,
          details: { ...returning.details, ...(await pauseDetails(stx, pause)) },
          ...stx.provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(alerts.id, returning.id))
      await stx.log({
        kind: 'alert.raised',
        reason: PAUSED_KIND,
        details: { alertId: returning.id, pauseId: pause.id, returned: true },
      })
      reopened += 1
      continue
    }
    const id = newId('al')
    await stx.tx.insert(alerts).values({
      id,
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      serviceDate: stx.serviceDate,
      kind: PAUSED_KIND,
      audience: 'venue',
      subjectId: pause.targetId,
      permission: null,
      details: await pauseDetails(stx, pause),
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    await stx.log({
      kind: 'alert.raised',
      reason: PAUSED_KIND,
      details: { alertId: id, pauseId: pause.id },
    })
    raised += 1
  }

  for (const row of rows) {
    if (row.doneAt !== null || activeTargets.has(row.subjectId)) continue
    await stx.tx
      .update(alerts)
      .set({
        doneAt: sql`now()`,
        doneBy: stx.provenance.actor,
        via: stx.via,
        nextRepeatAt: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(alerts.id, row.id))
    await stx.log({
      kind: 'alert.done',
      reason: PAUSED_KIND,
      details: { alertId: row.id, lifted: true },
    })
    closed += 1
  }
  return accepted(null, { details: { raised, reopened, closed } })
}

/**
 * `push.subscribe`: a signed-in account registers an installed device for Web Push (D122 §7).
 * Staff devices only: the endpoint and keys are the browser's, never a guest's. The same endpoint
 * from another account moves to it; one that was revoked comes back.
 */
export async function pushSubscribe(
  stx: ServiceTx,
  command: z.infer<typeof PushSubscribeSchema>,
): Promise<ServiceResult> {
  if (stx.actor.kind !== 'user') return refused(null, 'account_required')
  const endpointHash = endpointHashOf(command.endpoint)
  await stx.tx
    .insert(pushSubscriptions)
    .values({
      tenantId: stx.tenantId,
      userId: stx.actor.userId,
      endpointHash,
      endpoint: command.endpoint,
      p256dh: command.p256dh,
      auth: command.auth,
      ...stx.provenance,
    })
    .onConflictDoUpdate({
      target: [pushSubscriptions.tenantId, pushSubscriptions.endpointHash],
      set: {
        userId: stx.actor.userId,
        p256dh: command.p256dh,
        auth: command.auth,
        revokedAt: null,
        ...stx.provenance,
        updatedAt: sql`now()`,
      },
    })
  return accepted(null, { details: { endpointHash } })
}

/** `push.revoke`: an account ends one of its own devices; another's is left alone. */
export async function pushRevoke(
  stx: ServiceTx,
  command: z.infer<typeof PushRevokeSchema>,
): Promise<ServiceResult> {
  if (stx.actor.kind !== 'user') return refused(null, 'account_required')
  return endDevice(stx, command.endpointHash, stx.actor.userId)
}

/** `push.expire`: ends a device the push service answered 404 or 410 to. */
export async function pushExpire(
  stx: ServiceTx,
  command: z.infer<typeof PushExpireSchema>,
): Promise<ServiceResult> {
  return endDevice(stx, command.endpointHash, null)
}

async function endDevice(
  stx: ServiceTx,
  endpointHash: string,
  userId: string | null,
): Promise<ServiceResult> {
  const ended = await stx.tx
    .update(pushSubscriptions)
    .set({ revokedAt: sql`now()`, ...stx.provenance, updatedAt: sql`now()` })
    .where(
      and(
        eq(pushSubscriptions.endpointHash, endpointHash),
        isNull(pushSubscriptions.revokedAt),
        ...(userId === null ? [] : [eq(pushSubscriptions.userId, userId)]),
      ),
    )
    .returning({ endpointHash: pushSubscriptions.endpointHash })
  return accepted(null, { details: { revoked: ended.length } })
}
