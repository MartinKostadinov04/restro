// The row locks of one service transaction (design §2.3, D117): every write that is not a lease
// take locks its rows first with `SELECT … FOR UPDATE` (or `FOR SHARE`), in the fixed order of
// `lock-order.ts`, decides in memory and then writes without a condition.
//
// The table's version lives here too: one counter per table that only rises, kept on the order
// row of the table's open sitting (`table_orders.version`). A new sitting's order row starts one
// above every earlier order of the table, so the counter never goes back when guests change. A
// write that changes what a phone at the table sees touches the table; the engine bumps each
// touched table once, at the end of the command. A table with no open sitting shows phones only
// that it is closed, so touching it changes nothing.

import { sentOrders, sittings, tableOrders } from '@restro/db'
import type { WriteTx } from '@restro/db/write'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import { newId } from '../ids'
import type { Provenance } from './context'
import { LockLedger, LockOrderError, type LockRank } from './lock-order'

/** A sitting row. */
export type Sitting = typeof sittings.$inferSelect
/** A table's order row. */
export type TableOrder = typeof tableOrders.$inferSelect
/** A sent order row. */
export type SentOrder = typeof sentOrders.$inferSelect

/** How hard a sitting is locked: `share` to act inside it, `update` to end it. */
export type SittingLockStrength = 'share' | 'update'

/** The row locks and version bumps of one service transaction. */
export class RowLocks {
  readonly #tx: WriteTx
  readonly #tenantId: string
  readonly #venueId: string
  readonly #provenance: Provenance
  readonly #ledger = new LockLedger()
  readonly #sittingStrength = new Map<string, SittingLockStrength>()
  readonly #openSittings = new Map<string, Sitting | null>()
  readonly #orders = new Map<string, TableOrder>()
  readonly #touched = new Set<string>()

  constructor(tx: WriteTx, tenantId: string, venueId: string, provenance: Provenance) {
    this.#tx = tx
    this.#tenantId = tenantId
    this.#venueId = venueId
    this.#provenance = provenance
  }

  /**
   * Claims rows of a kind this class has no helper for yet (a waiter call, a pause, an alert):
   * checks the order and returns the keys still to lock, sorted. The caller then locks exactly
   * those with `FOR UPDATE`, in that order.
   */
  claim(rank: LockRank, keys: readonly string[]): string[] {
    return this.#ledger.claim(rank, keys)
  }

  /**
   * Locks the open sittings of these tables, in table order, and returns them by table id (null
   * where the table has none). A sitting locked `share` can't be upgraded later: lock it `update`
   * the first time when the command may end it.
   */
  async openSittings(
    tableIds: readonly string[],
    strength: SittingLockStrength = 'share',
  ): Promise<Map<string, Sitting | null>> {
    for (const tableId of tableIds) {
      if (strength === 'update' && this.#sittingStrength.get(tableId) === 'share') {
        throw new LockOrderError(
          `the sitting of ${tableId} is held for share; lock it for update the first time`,
        )
      }
    }
    const fresh = this.#ledger.claim('sitting', tableIds)
    if (fresh.length > 0) {
      const rows = await this.#tx
        .select()
        .from(sittings)
        .where(and(inArray(sittings.tableId, fresh), isNull(sittings.endedAt)))
        .orderBy(sittings.tableId)
        .for(strength)
      for (const tableId of fresh) {
        this.#sittingStrength.set(tableId, strength)
        this.#openSittings.set(tableId, rows.find((row) => row.tableId === tableId) ?? null)
      }
    }
    return new Map(tableIds.map((tableId) => [tableId, this.#openSittings.get(tableId) ?? null]))
  }

  /** The open sitting of one table, locked; null when the table is not open for phones. */
  async openSitting(
    tableId: string,
    strength: SittingLockStrength = 'share',
  ): Promise<Sitting | null> {
    return (await this.openSittings([tableId], strength)).get(tableId) ?? null
  }

  /**
   * Locks the order row of each table's open sitting, creating it where the sitting has none yet
   * (inserted with the table's next version). Locks the sittings first (`share`) where this
   * transaction doesn't hold them. Returns the rows by table id; null where the table has no open
   * sitting.
   */
  async tableOrders(tableIds: readonly string[]): Promise<Map<string, TableOrder | null>> {
    const open = await this.openSittings(
      tableIds.filter((tableId) => !this.#ledger.holds('sitting', tableId)),
    )
    for (const tableId of tableIds) {
      if (!open.has(tableId)) open.set(tableId, this.#openSittings.get(tableId) ?? null)
    }
    const fresh = this.#ledger.claim('table_order', tableIds)
    for (const tableId of fresh) {
      const sitting = open.get(tableId) ?? null
      if (sitting === null) continue
      const row = (await this.#lockOrderOf(sitting)) ?? (await this.#createOrderOf(sitting))
      this.#orders.set(tableId, row)
    }
    return new Map(tableIds.map((tableId) => [tableId, this.#orders.get(tableId) ?? null]))
  }

  /** The order row of one table's open sitting, locked; null when the table is not open. */
  async tableOrder(tableId: string): Promise<TableOrder | null> {
    return (await this.tableOrders([tableId])).get(tableId) ?? null
  }

  /** Locks these sent orders, in id order; returns the ones that exist, by id. */
  async sentOrders(ids: readonly string[]): Promise<Map<string, SentOrder>> {
    const fresh = this.#ledger.claim('sent_order', ids)
    const rows =
      fresh.length === 0
        ? []
        : await this.#tx
            .select()
            .from(sentOrders)
            .where(inArray(sentOrders.id, fresh))
            .orderBy(sentOrders.id)
            .for('update')
    return new Map(rows.map((row) => [row.id, row]))
  }

  /**
   * Marks a table's state as changed: its version rises once when the command ends. The table's
   * order row must be locked already (`tableOrder`), since bumping it later could break the lock
   * order. A table with no open sitting is skipped.
   */
  touch(tableId: string): void {
    if (!this.#ledger.holds('table_order', tableId)) {
      throw new LockOrderError(`touch ${tableId} only after locking its order (tableOrder)`)
    }
    this.#touched.add(tableId)
  }

  /** Forgets every touch: the handler refused and its writes were rolled back. */
  discardTouches(): void {
    this.#touched.clear()
  }

  /** The row the transaction holds for a table's order, as last read or written. */
  heldOrder(tableId: string): TableOrder | null {
    return this.#orders.get(tableId) ?? null
  }

  /** Records a write the command made to a held order row, so later reads see it. */
  rememberOrder(row: TableOrder): void {
    this.#orders.set(row.tableId, row)
  }

  /**
   * Bumps the version of every touched table with an open sitting, once, and returns the new
   * versions by table id. The engine calls it at the end of the command.
   */
  async bumpTouched(): Promise<Map<string, number>> {
    const versions = new Map<string, number>()
    for (const tableId of [...this.#touched].sort()) {
      const order = this.#orders.get(tableId)
      if (order === undefined) continue
      const [row] = await this.#tx
        .update(tableOrders)
        .set({
          version: sql`${tableOrders.version} + 1`,
          ...this.#provenance,
          updatedAt: sql`now()`,
        })
        .where(eq(tableOrders.id, order.id))
        .returning()
      if (row !== undefined) {
        this.#orders.set(tableId, row)
        versions.set(tableId, row.version)
      }
    }
    this.#touched.clear()
    return versions
  }

  async #lockOrderOf(sitting: Sitting): Promise<TableOrder | null> {
    const [row] = await this.#tx
      .select()
      .from(tableOrders)
      .where(eq(tableOrders.sittingId, sitting.id))
      .for('update')
    return row ?? null
  }

  /**
   * Inserts the sitting's order row with the table's next version, one above every earlier order
   * of the table. Two writers creating it at once: one inserts, the other finds it and waits for
   * its lock.
   */
  async #createOrderOf(sitting: Sitting): Promise<TableOrder> {
    await this.#tx
      .insert(tableOrders)
      .values({
        id: newId('to'),
        tenantId: this.#tenantId,
        venueId: this.#venueId,
        tableId: sitting.tableId,
        sittingId: sitting.id,
        version: sql`(select coalesce(max(${tableOrders.version}), 0) + 1 from ${tableOrders} where ${tableOrders.tableId} = ${sitting.tableId})`,
        ...this.#provenance,
      })
      .onConflictDoNothing({ target: [tableOrders.tenantId, tableOrders.sittingId] })
    const row = await this.#lockOrderOf(sitting)
    if (row === null) throw new Error(`the order of sitting ${sitting.id} could not be created`)
    return row
  }
}
