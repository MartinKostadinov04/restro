// Test helper: how many statements wrote a set of rows. For a test that must prove "one batch is
// one insert" on a real Postgres without leaning on a sequence.
import { type SQL, sql } from 'drizzle-orm'

/**
 * What the helper needs of a transaction: to run one read. Typed by shape, so the helper does not
 * import the write side of the db package (only the write paths may, by the dependency rules);
 * the `tx` of `withTenantWrite` fits.
 */
export interface ReadingTx {
  execute(query: SQL): Promise<{ readonly rows: readonly unknown[] }>
}

/**
 * How many separate statements wrote the rows of `table` whose `keyColumn` is one of `keys`, read
 * inside the transaction that wrote them.
 *
 * Every row carries two system columns that name the writer: `xmin`, the transaction, and `cmin`,
 * the command within it (Postgres counts one command per statement). Rows written by one
 * statement share both; a second statement in the same transaction has a different `cmin`; a
 * second transaction a different `xmin`. So the count is the number of distinct pairs.
 *
 * This replaces asking a shared identity sequence for a gapless run of values. That check passes
 * on a quiet machine and fails on a busy one, and not because the batch was split: a sequence
 * hands numbers out to every session that draws from it, so another connection (another test file
 * in the same run, here) can take numbers in the middle of ONE multi-row insert. Measured on a
 * local Postgres: 19 of 300 single 50-row inserts had a gap with one other session drawing
 * numbers, none without. Loosening the check to "within a few" or retrying was refused (D67) for
 * the same reason: both hide whether the batch was one statement instead of showing it.
 *
 * `cmin` is only meaningful to the transaction that wrote the row, so call this before the
 * transaction ends.
 */
export async function statementsThatWrote(
  tx: ReadingTx,
  table: { readonly schema: string; readonly name: string },
  keyColumn: string,
  keys: readonly (number | string)[],
): Promise<number> {
  // Names are quoted, but only plain lower-case names are accepted: a test helper has no use for more.
  for (const name of [table.schema, table.name, keyColumn]) {
    if (!/^[a-z_][a-z0-9_]*$/.test(name))
      throw new Error(`not a plain table or column name: ${name}`)
  }
  if (keys.length === 0) return 0
  const wanted = sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )
  const result = await tx.execute(
    sql`select count(*)::int as statements from (
          select distinct xmin::text as transaction_id, cmin::text as command_id
          from ${sql.identifier(table.schema)}.${sql.identifier(table.name)}
          where ${sql.identifier(keyColumn)} in (${wanted})
        ) as writers`,
  )
  return (result.rows[0] as { statements: number }).statements
}
