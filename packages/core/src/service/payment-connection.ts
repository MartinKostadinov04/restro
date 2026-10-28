// Connecting a venue's payment account on the service write path (#109; D125 §The venue's side,
// D127). `payment_accounts` holds one row per venue: which provider, the provider's account (backend
// only, rule 3), the state and the checks as last read. The provider calls (a hosted onboarding
// link, reading the account back, registering the guest domain) are the worker's, outside any
// transaction; the commands here decide who may ask and record what the provider answered.
//
// - `payment_account.connect` / `.disconnect` / `.tick`: staff, with `settings.connect_payments` and
//   a sign-in of the last 15 minutes (D125 2.2). Connecting makes the row `connecting`; the worker
//   then asks the provider for the hosted link and records the account (`.started`).
// - `payment_account.return`: staff with the permission, no fresh sign-in (the hosted form can take
//   longer than 15 minutes, and the worker only reads the account back): it checks the right and
//   writes nothing; the worker reads the provider and records it (`.observed`).
// - `payment_account.observed` / `.lost` / `.domain`: the worker's, after a provider reading or an
//   account notice (D125 3.8: the notice is a nudge, the reading is the fact).
//
// Paying is paused by the account's state, not by a pause row: a venue pause would stop ordering to
// the bill too, and D125 2.4 keeps that going. `pay.start` refuses `paying_paused` in `lost_access`,
// and a held, unfinished payment is never charged because the provider refuses its capture. Losing
// access raises one alert to owners and managers (it closes when paying comes back).
//
// Locks: the account row is locked `FOR UPDATE` by every writer here and `FOR SHARE` by `pay.start`,
// so a disconnect and a payment starting at the same moment cannot both win. It is taken after the
// rows of the fixed order (`lock-order.ts`) and never before them.

import { alerts, type DbPool, paymentAccounts, payments, venueTables, withTenant } from '@restro/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { newId } from '../ids'
import {
  type AccountChecks,
  type AccountState,
  type LostReason,
  NO_CHECKS,
  OWNER_TICKS,
  type PayingReadiness,
  type PaymentTableFacts,
  payingReadiness,
  readAccountChecks,
} from '../payment-connection'
import { PAYMENT_ACCOUNT_LOST_KIND } from './alert-rules'
import type { ServiceTx } from './definition'
import { accepted, refused, type ServiceResult } from './results'

/** The permission every account action needs (D125 2.2). */
export const CONNECT_PERMISSION = 'settings.connect_payments' as const

/** Who is told about a lost account: owners and managers (they hold this, D125 2.4). */
const ALERT_PERMISSION = 'money.follow_up' as const

const ProviderKindSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
const AccountRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/)

type AccountRow = typeof paymentAccounts.$inferSelect

/** The account row, locked as asked, or null when the venue has none. */
async function lockAccount(stx: ServiceTx, lock: 'update' | 'share'): Promise<AccountRow | null> {
  const [row] = await stx.tx
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.venueId, stx.venueId))
    .for(lock)
  return row ?? null
}

/** The venue's own tables' side of "payment tables are marked" (D125 2.3). */
export async function paymentTableFacts(
  tx: Pick<ServiceTx['tx'], 'select'>,
  venueId: string,
): Promise<PaymentTableFacts> {
  const tables = await tx
    .select({
      barId: venueTables.barId,
      isPaymentTable: venueTables.isPaymentTable,
      hidden: venueTables.hidden,
    })
    .from(venueTables)
    .where(and(eq(venueTables.venueId, venueId), isNull(venueTables.archivedAt)))
  // A payment table serves its bar's queue; tables with no bar share the venue's own queue.
  const queueOf = (barId: string | null) => barId ?? '-'
  const served = new Set(tables.filter((t) => t.isPaymentTable).map((t) => queueOf(t.barId)))
  const needing = new Set(
    tables.filter((t) => !t.isPaymentTable && !t.hidden).map((t) => queueOf(t.barId)),
  )
  return {
    paymentTables: tables.filter((t) => t.isPaymentTable).length,
    queuesWithoutOne: [...needing].filter((queue) => !served.has(queue)).length,
  }
}

/** A venue's account as the settings and `pay.start` read it. */
export interface PayingConnection {
  /** Null when the venue never started connecting. */
  readonly state: AccountState | null
  readonly providerKind: string | null
  readonly checks: AccountChecks
  readonly checkedAt: Date | null
  readonly connectedAt: Date | null
  readonly accountName: string | null
  readonly readiness: PayingReadiness
}

/**
 * The venue's connection and whether paying is on (D125 2.3). `lock` takes the account row `FOR
 * SHARE` (`pay.start`), so a disconnect cannot land between the check and the payment.
 */
export async function loadPayingConnection(
  tx: Pick<ServiceTx['tx'], 'select'>,
  venueId: string,
  lock: 'share' | null = null,
): Promise<PayingConnection> {
  const query = tx.select().from(paymentAccounts).where(eq(paymentAccounts.venueId, venueId))
  const [row] = await (lock === null ? query : query.for(lock))
  const checks = readAccountChecks(row?.checks)
  const state = (row?.state ?? null) as AccountState | null
  const tables = await paymentTableFacts(tx, venueId)
  return {
    state,
    providerKind: row?.providerKind ?? null,
    checks,
    checkedAt: row?.checkedAt ?? null,
    connectedAt: row?.connectedAt ?? null,
    accountName: row?.accountName ?? null,
    readiness: payingReadiness({ state, checks, tables }),
  }
}

/** The venue's connection for a screen: its own transaction, as the signed-in person's tenant. */
export async function readPayingConnection(
  pool: DbPool,
  tenantId: string,
  venueId: string,
): Promise<PayingConnection> {
  return withTenant(pool, tenantId, (tx) => loadPayingConnection(tx, venueId))
}

// ---------------------------------------------------------------------------------------------
// The lost-access alert

/** The open alert about a lost account, locked, or null. */
async function openLostAlert(stx: ServiceTx): Promise<{ readonly id: string } | null> {
  stx.rows.claim('alert', [`${PAYMENT_ACCOUNT_LOST_KIND}:${stx.venueId}`])
  const [open] = await stx.tx
    .select({ id: alerts.id })
    .from(alerts)
    .where(
      and(
        eq(alerts.venueId, stx.venueId),
        eq(alerts.kind, PAYMENT_ACCOUNT_LOST_KIND),
        isNull(alerts.doneAt),
      ),
    )
    .for('update')
  return open ?? null
}

/** One alert for owners and managers, once while it stays open. No amount, no guest data. */
async function raiseLostAlert(stx: ServiceTx, reason: LostReason): Promise<void> {
  const open = await openLostAlert(stx)
  if (open !== null) {
    await stx.tx
      .update(alerts)
      .set({ details: { reason }, ...stx.provenance, updatedAt: sql`now()` })
      .where(eq(alerts.id, open.id))
    return
  }
  const id = newId('al')
  await stx.tx.insert(alerts).values({
    id,
    tenantId: stx.tenantId,
    venueId: stx.venueId,
    serviceDate: stx.serviceDate,
    kind: PAYMENT_ACCOUNT_LOST_KIND,
    audience: 'venue',
    subjectId: stx.venueId,
    permission: ALERT_PERMISSION,
    details: { reason },
    ...stx.provenance,
    updatedAt: sql`now()`,
  })
  await stx.log({
    kind: 'alert.raised',
    reason: PAYMENT_ACCOUNT_LOST_KIND,
    details: { alertId: id },
  })
}

/** Closes the alert once paying is back or the owner disconnected on purpose. */
async function closeLostAlert(stx: ServiceTx): Promise<void> {
  const open = await openLostAlert(stx)
  if (open === null) return
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
    .where(eq(alerts.id, open.id))
  await stx.log({
    kind: 'alert.done',
    reason: PAYMENT_ACCOUNT_LOST_KIND,
    details: { alertId: open.id, resolved: true },
  })
}

// ---------------------------------------------------------------------------------------------
// Staff: connect, return, disconnect, tick

/** `payment_account.connect`'s payload. */
export const ConnectSchema = z.strictObject({
  type: z.literal('payment_account.connect'),
  providerKind: ProviderKindSchema,
})

/**
 * `payment_account.connect`: makes the venue's account `connecting`, to start the provider's hosted
 * form or to come back to it (refresh, or "Reconnect" after lost access). A venue that already
 * takes card payments is refused. An account that is still there keeps its reference, so a refresh
 * continues the same account; one the venue took Restro's access from is left behind and the next
 * link makes a new account (D125 2.5).
 */
export async function connectAccount(
  stx: ServiceTx,
  command: z.infer<typeof ConnectSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null) {
    await stx.tx.insert(paymentAccounts).values({
      tenantId: stx.tenantId,
      venueId: stx.venueId,
      providerKind: command.providerKind,
      accountRef: null,
      state: 'connecting',
      checks: NO_CHECKS,
      ...stx.provenance,
    })
    await stx.log({
      kind: 'settings.changed',
      reason: 'payments_connect',
      toState: 'connecting',
    })
    return accepted(null, { details: { state: 'connecting', changed: true } })
  }

  const checks = readAccountChecks(row.checks)
  if (row.state === 'connected' && checks.cardPayments) {
    return refused(null, 'already_connected')
  }
  if (row.state === 'connected') {
    // Connected but the provider still asks for something: a fresh link for the same account.
    return accepted(null, { details: { state: 'connected', changed: false } })
  }
  if (row.state === 'connecting' && row.providerKind === command.providerKind) {
    return accepted(null, { details: { state: 'connecting', changed: false } })
  }

  const sameProvider = row.providerKind === command.providerKind
  // An account the venue took Restro's access from is never used again, whatever state the row has
  // reached since (a disconnect keeps the mark): the next link makes a new account (D125 2.5).
  const abandoned = checks.lostReason === 'access_removed'
  const keepRef = sameProvider && !abandoned
  await stx.tx
    .update(paymentAccounts)
    .set({
      providerKind: command.providerKind,
      accountRef: keepRef ? row.accountRef : null,
      accountName: keepRef ? row.accountName : null,
      state: 'connecting',
      // The till's tick belongs to the venue; the account's own checks start again. The guest host
      // is the web app's, not the account's, and a registration stays with the account it was made
      // for: both are kept on the same account, and only the registration goes with a new one.
      checks: {
        ...NO_CHECKS,
        guestHost: checks.guestHost,
        domainHost: keepRef ? checks.domainHost : null,
        ticks: { cardTypeInTill: checks.ticks.cardTypeInTill, receiptEmailsOff: null },
      },
      checkedAt: null,
      connectedAt: null,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  await stx.log({
    kind: 'settings.changed',
    reason: 'payments_connect',
    fromState: row.state,
    toState: 'connecting',
  })
  return accepted(null, { details: { state: 'connecting', changed: true } })
}

/** `payment_account.return`'s payload. */
export const ReturnSchema = z.strictObject({ type: z.literal('payment_account.return') })

/**
 * `payment_account.return`: the owner came back from the provider's form. It only checks that
 * there is an account to read; the worker reads it and records what it finds.
 */
export async function returnFromProvider(stx: ServiceTx): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'share')
  if (
    row === null ||
    row.accountRef === null ||
    (row.state !== 'connecting' && row.state !== 'connected')
  ) {
    return refused(null, 'not_connecting')
  }
  return accepted(null, { details: { state: row.state, changed: false } })
}

/** `payment_account.disconnect`'s payload. */
export const DisconnectSchema = z.strictObject({ type: z.literal('payment_account.disconnect') })

/**
 * `payment_account.disconnect`: the owner stops Restro using the account. Refused while any
 * payment of the venue is not final (D125 2.4: wait until no guest is mid-payment). The account
 * stays the venue's own at the provider; Restro keeps its reference so a later refund or dispute
 * notice still finds the venue.
 */
export async function disconnectAccount(stx: ServiceTx): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null || row.state === 'disconnected') {
    return accepted(null, { details: { state: 'disconnected', changed: false } })
  }
  const [open] = await stx.tx
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.venueId, stx.venueId), isNull(payments.settledAt)))
    .limit(1)
  if (open !== undefined) return refused(null, 'payment_in_flight')
  await stx.tx
    .update(paymentAccounts)
    .set({ state: 'disconnected', ...stx.provenance, updatedAt: sql`now()` })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  await closeLostAlert(stx)
  await stx.log({
    kind: 'settings.changed',
    reason: 'payments_disconnect',
    fromState: row.state,
    toState: 'disconnected',
  })
  return accepted(null, { details: { state: 'disconnected', changed: true } })
}

/** `payment_account.tick`'s payload. */
export const TickCheckSchema = z.strictObject({
  type: z.literal('payment_account.tick'),
  check: z.enum(OWNER_TICKS),
  done: z.boolean(),
})

/**
 * `payment_account.tick`: the owner says a check the platform cannot read is done, or takes it
 * back (D125 2.3). Stored with who and when, and logged as a record. The default is not done.
 */
export async function tickCheck(
  stx: ServiceTx,
  command: z.infer<typeof TickCheckSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null) return refused(null, 'account_missing')
  const checks = readAccountChecks(row.checks)
  const before = checks.ticks[command.check]
  if ((before !== null) === command.done) {
    return accepted(null, { details: { check: command.check, done: command.done, changed: false } })
  }
  const tick = command.done
    ? { at: (await stx.dbNow()).toISOString(), by: stx.provenance.actor }
    : null
  await stx.tx
    .update(paymentAccounts)
    .set({
      checks: { ...checks, ticks: { ...checks.ticks, [command.check]: tick } },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  await stx.log({
    kind: 'settings.changed',
    reason: 'payments_check',
    details: { check: command.check, done: command.done },
  })
  return accepted(null, { details: { check: command.check, done: command.done, changed: true } })
}

// ---------------------------------------------------------------------------------------------
// Worker: what the provider answered

/** `payment_account.started`'s payload: the provider made, or continued, this account. */
export const StartedSchema = z.strictObject({
  type: z.literal('payment_account.started'),
  accountRef: AccountRefSchema,
  /** The guest page's host, for wallets (D125 3.6); null when the web app named none. */
  guestHost: z.hostname().nullable(),
})

/** `payment_account.started`: records the provider's account on the `connecting` row. */
export async function accountStarted(
  stx: ServiceTx,
  command: z.infer<typeof StartedSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null || (row.state !== 'connecting' && row.state !== 'connected')) {
    return refused(null, 'not_connecting')
  }
  if (row.accountRef !== null && row.accountRef !== command.accountRef) {
    return refused(null, 'account_mismatch')
  }
  const checks = readAccountChecks(row.checks)
  if (row.accountRef === command.accountRef && checks.guestHost === command.guestHost) {
    return accepted(null, { details: { state: row.state, changed: false } })
  }
  await stx.tx
    .update(paymentAccounts)
    .set({
      accountRef: command.accountRef,
      checks: { ...checks, guestHost: command.guestHost },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  return accepted(null, { details: { state: row.state, changed: true } })
}

/** `payment_account.observed`'s payload: one complete reading of the provider's account. */
export const ObservedSchema = z.strictObject({
  type: z.literal('payment_account.observed'),
  accountRef: AccountRefSchema,
  canTakePayments: z.boolean(),
  missing: z.array(z.string().min(1).max(200)).max(100),
  /** The owner came back from the hosted form (not a notice): the account is then `connected`. */
  afterReturn: z.boolean(),
  /** The guest page's host the web app named on this return, or null (a notice names none). */
  guestHost: z.hostname().nullable(),
  /** The account's name as the provider shows it, or null when it has none (D125 2.1). */
  displayName: z.string().min(1).max(200).nullable(),
})

/**
 * `payment_account.observed`: the account as the provider says it is now (D125 3.8). A reading
 * after the owner's return connects the account; a later reading that shows card payments gone
 * from an account that had them pauses paying and tells owners and managers (D125 2.4); one that
 * shows them back lifts that pause. A venue that disconnected is only kept up to date.
 */
export async function accountObserved(
  stx: ServiceTx,
  command: z.infer<typeof ObservedSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null || row.accountRef !== command.accountRef) {
    return refused(null, 'account_unknown')
  }
  const checks = readAccountChecks(row.checks)
  const read = { cardPayments: command.canTakePayments, missing: command.missing }
  let state = row.state as AccountState
  let lostReason: LostReason | null = checks.lostReason

  if (state === 'connecting') {
    if (command.afterReturn || command.canTakePayments) state = 'connected'
  } else if (state === 'connected') {
    if (checks.cardPayments && !command.canTakePayments) {
      state = 'lost_access'
      lostReason = 'account_restricted'
    }
  } else if (state === 'lost_access') {
    if (lostReason === 'account_restricted' && command.canTakePayments) {
      state = 'connected'
      lostReason = null
    }
  }

  const next: AccountChecks = {
    ...checks,
    ...read,
    guestHost: command.guestHost ?? checks.guestHost,
    // "Access removed" is kept through every later reading and any state: only a new account ends it.
    lostReason:
      checks.lostReason === 'access_removed'
        ? 'access_removed'
        : state === 'lost_access'
          ? lostReason
          : null,
  }
  const accountName = command.displayName ?? row.accountName
  const changed =
    state !== row.state ||
    JSON.stringify(next) !== JSON.stringify(checks) ||
    accountName !== row.accountName ||
    (state === 'connected' && row.connectedAt === null)
  if (changed) {
    await stx.tx
      .update(paymentAccounts)
      .set({
        state,
        checks: next,
        accountName,
        checkedAt: sql`now()`,
        connectedAt:
          state === 'connected' && row.connectedAt === null ? sql`now()` : row.connectedAt,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(paymentAccounts.venueId, stx.venueId))
  }
  if (state !== row.state) {
    await stx.log({
      kind: 'settings.changed',
      reason: state === 'lost_access' ? 'payments_lost' : 'payments_connected',
      fromState: row.state,
      toState: state,
    })
    if (state === 'lost_access') await raiseLostAlert(stx, 'account_restricted')
    // Paying is back, whether the account recovered by itself or the owner reconnected.
    if (state === 'connected') await closeLostAlert(stx)
  }
  return accepted(null, { details: { state, changed, cardPayments: command.canTakePayments } })
}

/** `payment_account.lost`'s payload. */
export const LostSchema = z.strictObject({
  type: z.literal('payment_account.lost'),
  accountRef: AccountRefSchema,
})

/**
 * `payment_account.lost`: the venue took Restro's access away at the provider (D125 2.4). Paying
 * pauses at once and owners and managers are alerted, offering "Reconnect". It is not undone by a
 * later reading: only a new connection brings it back.
 */
export async function accountLost(
  stx: ServiceTx,
  command: z.infer<typeof LostSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null || row.accountRef !== command.accountRef) {
    return refused(null, 'account_unknown')
  }
  const checks = readAccountChecks(row.checks)
  // Already marked: nothing more to record, pause or tell.
  if (checks.lostReason === 'access_removed') {
    return accepted(null, { details: { state: row.state, changed: false } })
  }
  // The venue disconnected first: nothing to pause or alert, but the account is abandoned all the
  // same, so a later Connect makes a new one.
  if (row.state === 'disconnected') {
    await stx.tx
      .update(paymentAccounts)
      .set({
        checks: { ...checks, cardPayments: false, lostReason: 'access_removed' },
        checkedAt: sql`now()`,
        ...stx.provenance,
        updatedAt: sql`now()`,
      })
      .where(eq(paymentAccounts.venueId, stx.venueId))
    return accepted(null, { details: { state: row.state, changed: true } })
  }
  await stx.tx
    .update(paymentAccounts)
    .set({
      state: 'lost_access',
      checks: { ...checks, cardPayments: false, lostReason: 'access_removed' },
      checkedAt: sql`now()`,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  await stx.log({
    kind: 'settings.changed',
    reason: 'payments_lost',
    fromState: row.state,
    toState: 'lost_access',
  })
  // Paying was never on for an account still being connected: nothing was paused, so nobody is
  // told "card payments are paused". The account is still abandoned (the mark above).
  if (row.state === 'connected' || row.state === 'lost_access') {
    await raiseLostAlert(stx, 'access_removed')
  }
  return accepted(null, { details: { state: 'lost_access', changed: true } })
}

/** `payment_account.domain`'s payload: the guest page's host was registered for wallets. */
export const DomainSchema = z.strictObject({
  type: z.literal('payment_account.domain'),
  accountRef: AccountRefSchema,
  host: z.hostname(),
})

/** `payment_account.domain`: remembers which host is registered, so it is not asked again. */
export async function domainRegistered(
  stx: ServiceTx,
  command: z.infer<typeof DomainSchema>,
): Promise<ServiceResult> {
  const row = await lockAccount(stx, 'update')
  if (row === null || row.accountRef !== command.accountRef) {
    return refused(null, 'account_unknown')
  }
  const checks = readAccountChecks(row.checks)
  if (checks.domainHost === command.host) {
    return accepted(null, { details: { changed: false } })
  }
  await stx.tx
    .update(paymentAccounts)
    .set({
      checks: { ...checks, domainHost: command.host },
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(eq(paymentAccounts.venueId, stx.venueId))
  return accepted(null, { details: { changed: true } })
}
