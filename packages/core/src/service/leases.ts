// Leases ("turns", D117; design §2.3): a server-side record that one sent order or payment holds
// something for a while, never a phone. One row of `locks` per thing that can be held, reused all
// night and never deleted:
// - `order_slot` per table: one sent order in flight (D115);
// - `payment_table` per payment table (D122 §8).
//
// A take is the service path's one conditional statement: it either wins or changes nothing. It
// wins when the row is free, or when the holder's deadline has passed by the database's clock (an
// expired lease is taken over). Each take raises the row's fence, so a holder that lost its lease
// can tell, under the row lock, that its fence is stale. Release and renewal are D117's short
// pattern: lock the row, compare the holder and fence in memory, write without a condition.

import { locks } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq, sql } from 'drizzle-orm'

import type { Provenance } from './context'
import type { RowLocks } from './rows'

/** What a lease holds. */
export const LEASE_SCOPES = ['order_slot', 'payment_table'] as const

/** One lease scope. */
export type LeaseScope = (typeof LEASE_SCOPES)[number]

/** Which lease: its scope and our id of what it holds (a `tb_` or `st_` id). */
export interface LeaseKey {
  readonly scope: LeaseScope
  readonly key: string
}

/** What a holder shows to release, renew or act under its lease. */
export interface LeaseClaim extends LeaseKey {
  /** The `so_` or `py_` id holding it. */
  readonly holder: string
  /** The fence its take returned. */
  readonly fence: number
}

/** The outcome of a take. */
export type TakeResult =
  | {
      readonly taken: true
      readonly fence: number
      /** The holder whose expired lease this take took over, or null. */
      readonly tookOverFrom: string | null
    }
  | {
      readonly taken: false
      /**
       * Who holds it, and for how many more seconds (by the database's clock); null when it was
       * released between the take and this read (try again).
       */
      readonly holder: string | null
      readonly secondsLeft: number
    }

/** Why a release or a renewal was refused. */
export type LeaseRefusal = 'not_held' | 'fenced' | 'expired'

/** The row-lock key of a lease in the ledger. */
function ledgerKey(lease: LeaseKey): string {
  return `${lease.scope}:${lease.key}`
}

/** What one lease operation needs from the transaction. */
export interface LeaseTx {
  readonly tx: WriteTx
  readonly tenantId: string
  readonly venueId: string
  readonly provenance: Provenance
  readonly rows: RowLocks
}

/**
 * Takes a lease for `holder` for `seconds`, in one statement: an insert of a new row, or an update
 * of the existing one only where it is free or past its deadline. Wins or changes nothing.
 */
export async function takeLease(
  stx: LeaseTx,
  lease: LeaseKey & { readonly holder: string; readonly seconds: number },
): Promise<TakeResult> {
  if (!Number.isInteger(lease.seconds) || lease.seconds < 1 || lease.seconds > 3600) {
    throw new RangeError('a lease lasts 1 to 3600 seconds')
  }
  stx.rows.claim('lease', [ledgerKey(lease)])
  const { source, actor, jobId } = stx.provenance
  const won = await stx.tx.execute<{ fence: string; previous: string | null }>(sql`
    insert into restro.locks as l
      (tenant_id, venue_id, scope, key, holder, fence, taken_at, deadline, released_at,
       source, actor, job_id, updated_at)
    values
      (${stx.tenantId}, ${stx.venueId}, ${lease.scope}, ${lease.key}, ${lease.holder}, 1, now(),
       now() + make_interval(secs => ${lease.seconds}), null, ${source}, ${actor}, ${jobId}, now())
    on conflict (tenant_id, scope, key) do update
      set holder = excluded.holder, fence = l.fence + 1, taken_at = now(),
          deadline = excluded.deadline, released_at = null, source = excluded.source,
          actor = excluded.actor, job_id = excluded.job_id, updated_at = now()
      where l.holder is null or l.deadline < now()
    returning l.fence::text as fence,
      (select p.holder from restro.locks p
        where p.tenant_id = l.tenant_id and p.scope = l.scope and p.key = l.key) as previous
  `)
  const row = won.rows[0]
  if (row !== undefined) {
    // The sub-select reads the row as it was before this statement: the expired holder, if any.
    return { taken: true, fence: Number(row.fence), tookOverFrom: row.previous ?? null }
  }
  const held = await readLease(stx.tx, lease)
  return { taken: false, holder: held?.holder ?? null, secondsLeft: held?.secondsLeft ?? 0 }
}

/** A lease as stored, with its seconds left by the database's clock. */
export interface LeaseState {
  readonly holder: string | null
  readonly fence: number
  readonly secondsLeft: number
  readonly expired: boolean
}

/** Reads a lease without locking it; null when it was never taken. */
export async function readLease(
  tx: Pick<WriteTx, 'select'>,
  lease: LeaseKey,
): Promise<LeaseState | null> {
  const [row] = await tx
    .select({
      holder: locks.holder,
      fence: locks.fence,
      secondsLeft: sql<string>`greatest(0, extract(epoch from (${locks.deadline} - now())))::text`,
      expired: sql<boolean>`coalesce(${locks.deadline} < now(), false)`,
    })
    .from(locks)
    .where(and(eq(locks.scope, lease.scope), eq(locks.key, lease.key)))
  if (row === undefined) return null
  return {
    holder: row.holder,
    fence: row.fence,
    secondsLeft: row.holder === null ? 0 : Math.ceil(Number(row.secondsLeft)),
    expired: row.holder !== null && row.expired,
  }
}

/** Locks the lease row and checks that `claim` still holds it: same holder, same fence. */
async function lockHeld(
  stx: LeaseTx,
  claim: LeaseClaim,
): Promise<{ readonly refused: LeaseRefusal | null; readonly expired: boolean }> {
  stx.rows.claim('lease', [ledgerKey(claim)])
  const [row] = await stx.tx
    .select({
      holder: locks.holder,
      fence: locks.fence,
      expired: sql<boolean>`coalesce(${locks.deadline} < now(), false)`,
    })
    .from(locks)
    .where(and(eq(locks.scope, claim.scope), eq(locks.key, claim.key)))
    .for('update')
  if (row === undefined || row.holder !== claim.holder)
    return { refused: 'not_held', expired: false }
  if (row.fence !== claim.fence) return { refused: 'fenced', expired: false }
  return { refused: null, expired: row.expired }
}

/**
 * True when `claim` still holds its lease and its deadline has not passed: what a writer acting
 * under a lease checks first (the worker recording a send's outcome). Locks the lease row.
 */
export async function holdsLease(stx: LeaseTx, claim: LeaseClaim): Promise<boolean> {
  const held = await lockHeld(stx, claim)
  return held.refused === null && !held.expired
}

/**
 * Releases a lease its holder still holds. An expired lease nobody took over yet is released too:
 * the holder is done with it either way.
 */
export async function releaseLease(
  stx: LeaseTx,
  claim: LeaseClaim,
): Promise<
  { readonly released: true } | { readonly released: false; readonly reason: LeaseRefusal }
> {
  const held = await lockHeld(stx, claim)
  if (held.refused !== null) return { released: false, reason: held.refused }
  await stx.tx
    .update(locks)
    .set({
      holder: null,
      deadline: null,
      releasedAt: sql`now()`,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(locks.scope, claim.scope), eq(locks.key, claim.key)))
  return { released: true }
}

/**
 * Moves a held lease's deadline to `seconds` from now. Refused once the deadline has passed: an
 * expired lease is anyone's to take, so its holder may not quietly extend it.
 */
export async function renewLease(
  stx: LeaseTx,
  claim: LeaseClaim & { readonly seconds: number },
): Promise<
  { readonly renewed: true } | { readonly renewed: false; readonly reason: LeaseRefusal }
> {
  if (!Number.isInteger(claim.seconds) || claim.seconds < 1 || claim.seconds > 3600) {
    throw new RangeError('a lease lasts 1 to 3600 seconds')
  }
  const held = await lockHeld(stx, claim)
  if (held.refused !== null) return { renewed: false, reason: held.refused }
  if (held.expired) return { renewed: false, reason: 'expired' }
  await stx.tx
    .update(locks)
    .set({
      deadline: sql`now() + make_interval(secs => ${claim.seconds})`,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(locks.scope, claim.scope), eq(locks.key, claim.key)))
  return { renewed: true }
}

/**
 * Takes a payment table for a payment (D122 §8, #111): held with no deadline, so nothing takes it
 * over; only its own payment frees it (`freePaymentTable`), once the payment is final and a read
 * shows the table empty. Wins where the row is free or this payment holds it already (a retry).
 * The caller holds the row's lock (it compared the queue under it).
 */
export async function takePaymentTable(
  stx: LeaseTx,
  lease: { readonly key: string; readonly holder: string },
): Promise<{ readonly taken: true; readonly fence: number } | { readonly taken: false }> {
  const scope = 'payment_table'
  stx.rows.claim('lease', [ledgerKey({ scope, key: lease.key })])
  const { source, actor, jobId } = stx.provenance
  const won = await stx.tx.execute<{ fence: string }>(sql`
    insert into restro.locks as l
      (tenant_id, venue_id, scope, key, holder, fence, taken_at, deadline, released_at,
       source, actor, job_id, updated_at)
    values
      (${stx.tenantId}, ${stx.venueId}, ${scope}, ${lease.key}, ${lease.holder}, 1, now(), null,
       null, ${source}, ${actor}, ${jobId}, now())
    on conflict (tenant_id, scope, key) do update
      set holder = excluded.holder,
          fence = case when l.holder = excluded.holder then l.fence else l.fence + 1 end,
          taken_at = case when l.holder = excluded.holder then l.taken_at else now() end,
          deadline = null, released_at = null, source = excluded.source, actor = excluded.actor,
          job_id = excluded.job_id, updated_at = now()
      where l.holder is null or l.holder = excluded.holder
    returning l.fence::text as fence
  `)
  const row = won.rows[0]
  return row === undefined ? { taken: false } : { taken: true, fence: Number(row.fence) }
}

/** Frees a payment table its payment holds; false when another (or nobody) holds it. */
export async function freePaymentTable(
  stx: LeaseTx,
  lease: { readonly key: string; readonly holder: string },
): Promise<boolean> {
  const key: LeaseKey = { scope: 'payment_table', key: lease.key }
  stx.rows.claim('lease', [ledgerKey(key)])
  const [row] = await stx.tx
    .select({ holder: locks.holder })
    .from(locks)
    .where(and(eq(locks.scope, key.scope), eq(locks.key, key.key)))
    .for('update')
  if (row === undefined || row.holder !== lease.holder) return false
  await stx.tx
    .update(locks)
    .set({
      holder: null,
      deadline: null,
      releasedAt: sql`now()`,
      ...stx.provenance,
      updatedAt: sql`now()`,
    })
    .where(and(eq(locks.scope, key.scope), eq(locks.key, key.key)))
  return true
}

/** Locks these lease rows in the ledger's order (one call), so a command can decide under them. */
export async function lockLeases(
  stx: LeaseTx,
  leases: readonly LeaseKey[],
): Promise<Map<string, { readonly holder: string | null; readonly fence: number }>> {
  const keys = leases.map(ledgerKey)
  stx.rows.claim('lease', keys)
  const held = new Map<string, { readonly holder: string | null; readonly fence: number }>()
  // In key order, as the ledger claimed them; a row this transaction holds already locks again.
  for (const ledger of [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    const split = ledger.indexOf(':')
    const scope = ledger.slice(0, split)
    const key = ledger.slice(split + 1)
    const [row] = await stx.tx
      .select({ holder: locks.holder, fence: locks.fence })
      .from(locks)
      .where(and(eq(locks.scope, scope), eq(locks.key, key)))
      .for('update')
    held.set(ledger, { holder: row?.holder ?? null, fence: row?.fence ?? 0 })
  }
  return held
}

/** The ledger key of a lease, as `lockLeases` returns its rows. */
export function leaseLedgerKey(lease: LeaseKey): string {
  return ledgerKey(lease)
}
