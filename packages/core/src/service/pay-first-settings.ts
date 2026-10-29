// The owner's pay-first choices on the service write path (#216; D113, D122 §5): the venue's item
// default and whether pay-first applies at every table (Settings › Paying), and an area's or a table's
// own choice (Tables & QR). One command, patch-shaped: it changes exactly one thing and merges it
// into the saved settings under the venue's row lock (core/apply's `patchPayFirstSettingsIn`), so two
// saves of different tables both stay and a deleted table never blocks one. A settings change: the
// person's own sign-in of the last 15 minutes. The venue's choices need `settings.connect_payments`
// (Paying), an area's or a table's `settings.payment_tables` (Tables & QR). One `settings.changed`
// `record` Log entry per change. Undo calls the same command with the previous value.

import { areas, type DbPool, venueTables, withTenant } from '@restro/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { PayFirstSettingsError, patchPayFirstSettingsIn } from '../apply/pay-first-settings'
import { idSchema } from '../ids'
import {
  PayFirstGroupIdSchema,
  type PayFirstSettings,
  readPayFirstSettings,
} from '../pay-first-settings'
import { PAYMENT_MODES } from '../templates/venue-menu'
import type { ServiceTx } from './definition'
import { payFirstPossibleAt } from './pay-first'
import type { Permission } from './permissions'
import { accepted, refused, type ServiceResult } from './results'

/** What `pay_first.set` changes: exactly one of these. `value: null` takes the choice away. */
export const PayFirstChangeSchema = z.union([
  z.strictObject({ itemMode: z.enum(PAYMENT_MODES) }),
  z.strictObject({ applies: z.boolean() }),
  z.strictObject({ group: PayFirstGroupIdSchema, value: z.boolean().nullable() }),
  z.strictObject({ table: idSchema('tb'), value: z.boolean().nullable() }),
])

/** `pay_first.set`'s payload. */
export const SetPayFirstSchema = z.strictObject({
  type: z.literal('pay_first.set'),
  change: PayFirstChangeSchema,
})

type SetPayFirst = z.infer<typeof SetPayFirstSchema>

/** A change read once: where it sits (the Log's `level`), the value it sets, the group it names. */
function describe(change: SetPayFirst['change']): {
  readonly level: 'item_mode' | 'venue' | 'group' | 'table'
  readonly value: string | boolean | null
  readonly group?: string
} {
  if ('itemMode' in change) return { level: 'item_mode', value: change.itemMode }
  if ('applies' in change) return { level: 'venue', value: change.applies }
  if ('group' in change) return { level: 'group', value: change.value, group: change.group }
  return { level: 'table', value: change.value }
}

/** The permission a change needs: the venue's choices by paying, an area's or a table's by tables. */
export function payFirstPermissionOf(command: SetPayFirst): Permission {
  const { level } = describe(command.change)
  return level === 'item_mode' || level === 'venue'
    ? 'settings.connect_payments'
    : 'settings.payment_tables'
}

/** The Log's words for a value: `on`, `off`, `follow` (none), or a payment mode's code. */
function logValue(value: unknown): string {
  return value === null ? 'follow' : value === true ? 'on' : value === false ? 'off' : String(value)
}

/** `pay_first.set`. */
export async function setPayFirst(stx: ServiceTx, command: SetPayFirst): Promise<ServiceResult> {
  const { change } = command
  try {
    const done = await patchPayFirstSettingsIn(stx.tx, stx.venueId, change)
    if (done.changed) {
      const { level, value, group } = describe(change)
      await stx.log({
        kind: 'settings.changed',
        reason: 'pay_first',
        ...('table' in change ? { tableId: change.table } : {}),
        details: {
          level,
          ...(group === undefined ? {} : { group }),
          value: logValue(value),
          previous: logValue(done.previous),
        },
      })
    }
    return accepted(null, { details: { changed: done.changed } })
  } catch (error) {
    if (error instanceof PayFirstSettingsError) {
      if (error.code === 'table_missing' || error.code === 'group_missing') {
        return refused(null, error.code)
      }
    }
    throw error
  }
}

/** What Settings › Paying shows of the venue's pay first (#216). */
export interface PayFirstOverview {
  /** Pay first can take effect at the venue: card payments are on and a POS of it declares what it needs. */
  readonly possible: boolean
  /** What applies: the venue's item default and whether pay first applies at every table. */
  readonly settings: Pick<PayFirstSettings, 'itemMode' | 'applies'>
  /** How many live areas and tables have a choice of their own (a bar's is not counted: no screen sets one). */
  readonly overrides: number
}

/** The venue's pay first as the Paying card draws it. Reads only. */
export async function readPayFirstOverview(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  venueSettings: Readonly<Record<string, unknown>>,
): Promise<PayFirstOverview> {
  const settings = readPayFirstSettings(venueSettings)
  return withTenant(pool, tenantId, async (tx) => {
    const possible = await payFirstPossibleAt(tx, venueId)
    const areaIds = Object.keys(settings.groups).filter((id) => id.startsWith('ar_'))
    const tableIds = Object.keys(settings.tables)
    const [liveAreas, liveTables] = await Promise.all([
      areaIds.length === 0
        ? []
        : tx
            .select({ id: areas.id })
            .from(areas)
            .where(
              and(eq(areas.venueId, venueId), inArray(areas.id, areaIds), isNull(areas.archivedAt)),
            ),
      tableIds.length === 0
        ? []
        : tx
            .select({ id: venueTables.id })
            .from(venueTables)
            .where(
              and(
                eq(venueTables.venueId, venueId),
                inArray(venueTables.id, tableIds),
                isNull(venueTables.archivedAt),
              ),
            ),
    ])
    return {
      possible,
      settings: { itemMode: settings.itemMode, applies: settings.applies },
      overrides: liveAreas.length + liveTables.length,
    }
  })
}
