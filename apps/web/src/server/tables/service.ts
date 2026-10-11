// The Tables & QR tab's server side (brief S3-07): what the tab shows, and the actions behind its
// buttons. The writes are core/apply's (`tables.ts`); this file decides who may ask (owners and
// admins, like the Integration tab), shapes the answers, and queues the worker's
// `publish-table-tokens` job after every change to a code or a name. The web app never writes the
// publish store: the job is the one writer of the `t/<token>.json` files.
//
// Nothing here fetches an address a venue typed. The venue's own link is only ever drawn as text
// and opened by the manager's browser.
import {
  JOB_NAMES,
  type JobPayload,
  type ProducedJobName,
  qrAddress,
  readVenueQr,
  type TenantId,
  type VenueId,
} from '@restro/core'
import {
  issueAllTableTokens,
  issueTableToken,
  listVenueTables,
  retireTableToken,
  setTableLabel,
  setVenueQrSettings,
  type TableWriteRefusal,
  type VenueTable,
} from '@restro/core/apply'
import type { DbPool, Venue } from '@restro/db'

import { logError } from '../log'
import { qrSvg } from './qr-image'
import type {
  HallView,
  TableRowView,
  TablesActionResult,
  TablesErrorCode,
  TablesView,
} from './view'

/** Who is asking about which venue. */
export interface TablesScope {
  readonly pool: DbPool
  /** The person's organisation: never taken from the request. */
  readonly tenantId: string
  readonly venue: Pick<Venue, 'id' | 'name' | 'settings'>
  /** An owner or admin of the organisation. */
  readonly canManage: boolean
}

/** What the actions need besides the database: the queue (`enqueueJob`; a fake in tests). */
export interface TablesServices {
  readonly enqueue: <N extends ProducedJobName>(
    name: N,
    data: JobPayload<N>,
  ) => Promise<string | null>
}

// --- reading ------------------------------------------------------------------------------------

const collator = new Intl.Collator(['bg', 'en'], { numeric: true, sensitivity: 'base' })

async function toRow(
  table: VenueTable,
  address: (token: string) => string | null,
  render: (text: string) => Promise<string>,
): Promise<TableRowView> {
  const text = table.token === null ? null : address(table.token)
  return {
    id: table.id,
    number: table.placeNum,
    label: table.label,
    shownAs: table.label?.trim() || table.placeNum?.trim() || null,
    isPublic: table.isPublic,
    state: table.state,
    token: table.token,
    address: text,
    qrSvg: text === null ? null : await render(text),
  }
}

/** A table row with the hall it is grouped under (the hall is the group's name, not a field). */
type Row = TableRowView & { readonly salonName: string | null }

/** Halls by name (no hall last), tables in a hall by their number or name, numbers in order. */
function sortedHalls(rows: readonly Row[]): { name: string | null; tables: Row[] }[] {
  const halls = new Map<string | null, Row[]>()
  for (const row of rows) {
    const name = row.salonName
    const list = halls.get(name) ?? []
    list.push(row)
    halls.set(name, list)
  }
  return [...halls.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0
      if (a === null) return 1
      if (b === null) return -1
      return collator.compare(a, b)
    })
    .map(([name, tables]) => ({
      name,
      // A table with neither a number nor a name is last in its hall.
      tables: tables.sort((a, b) => {
        if (a.shownAs === null || b.shownAs === null) {
          return Number(a.shownAs === null) - Number(b.shownAs === null) || a.id.localeCompare(b.id)
        }
        return collator.compare(a.shownAs, b.shownAs) || a.id.localeCompare(b.id)
      }),
    }))
}

/**
 * Reads the tab: the venue's tables by hall with their codes drawn, and the address setting with
 * its defaults. `defaultBaseUrl` is the app's own address from the environment; `render` makes the
 * SVG of a code (tests pass a plain function).
 */
export async function loadTablesView(
  scope: TablesScope,
  defaultBaseUrl: string | null,
  render: (text: string) => Promise<string> = qrSvg,
): Promise<TablesView> {
  const tables = await listVenueTables(scope.pool, scope.tenantId, scope.venue.id)
  const qr = readVenueQr(scope.venue.settings, defaultBaseUrl)
  const address = (token: string) => qrAddress(qr, token)
  const rows: Row[] = await Promise.all(
    tables.map(async (table) => ({
      ...(await toRow(table, address, render)),
      salonName: table.salonName,
    })),
  )
  const halls: HallView[] = sortedHalls(rows).map((hall) => ({
    name: hall.name,
    tables: hall.tables.map(({ salonName: _hall, ...row }): TableRowView => row),
  }))
  const coded = rows.filter((row) => row.token !== null).length
  const first = halls.flatMap((hall) => hall.tables).find((row) => row.token !== null)
  return {
    venueId: scope.venue.id,
    venueName: scope.venue.name,
    canManage: scope.canManage,
    qr: {
      mode: qr.mode,
      baseUrl: qr.baseUrl,
      baseIsDefault: qr.baseIsDefault,
      defaultBaseUrl,
      ownPattern: qr.ownPattern,
    },
    halls,
    total: rows.length,
    coded,
    sample:
      first?.token === undefined || first.token === null
        ? null
        : { token: first.token, shownAs: first.shownAs },
  }
}

// --- the actions ---------------------------------------------------------------------------------

const FORBIDDEN: TablesActionResult = { ok: false, error: 'forbidden' }

const REFUSALS: Record<TableWriteRefusal['error'], TablesErrorCode> = {
  invalid_input: 'invalid',
  unknown_venue: 'not_found',
  // A deleted venue (D76) is gone to this screen; its page is a 404 already.
  venue_archived: 'not_found',
  unknown_table: 'not_found',
  no_label: 'no_label',
}

function refused(refusal: TableWriteRefusal): TablesActionResult {
  return {
    ok: false,
    error: REFUSALS[refusal.error],
    ...(refusal.field === undefined ? {} : { field: refusal.field }),
    ...(refusal.problem === undefined ? {} : { problem: refusal.problem }),
  }
}

/**
 * Queues the worker's job that writes the venue's `t/<token>.json` files and removes the retired
 * ones. A failure is logged and reported as `queued: false` (the change is saved; the public file
 * is late): the next change to any code of the venue writes every file again.
 */
async function queueTokenFiles(
  scope: TablesScope,
  services: TablesServices,
  venueId: string,
  retired: readonly string[],
): Promise<boolean> {
  try {
    await services.enqueue(JOB_NAMES.publishTableTokens, {
      tenantId: scope.tenantId as TenantId,
      venueId: venueId as VenueId,
      retired: [...retired],
    })
    return true
  } catch (error) {
    logError('table_token_job_not_queued', error)
    return false
  }
}

/** Gives a table a code, or a new one (the old sticker stops working). */
export async function issueCode(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await issueTableToken(scope.pool, scope.tenantId, tableId)
  if (!result.ok) return refused(result)
  const queued = await queueTokenFiles(
    scope,
    services,
    result.venueId,
    result.retired === null ? [] : [result.retired],
  )
  return { ok: true, queued }
}

/** Turns a table's code off: `/t/<token>` says "code not active" from then on. */
export async function turnOffCode(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await retireTableToken(scope.pool, scope.tenantId, tableId)
  if (!result.ok) return refused(result)
  if (result.retired === null) return { ok: true, queued: true }
  return {
    ok: true,
    queued: await queueTokenFiles(scope, services, result.venueId, [result.retired]),
  }
}

/** Names a table for the guest page, or clears the name (`null`). */
export async function renameTable(
  scope: TablesScope,
  services: TablesServices,
  tableId: string,
  label: string | null,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await setTableLabel(scope.pool, scope.tenantId, tableId, label)
  if (!result.ok) return refused(result)
  // Only a table with a code has a file that says its name.
  if (result.table.token === null) return { ok: true, queued: true }
  return { ok: true, queued: await queueTokenFiles(scope, services, result.venueId, []) }
}

/** Gives every active table that has none a code. */
export async function createAllCodes(
  scope: TablesScope,
  services: TablesServices,
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await issueAllTableTokens(scope.pool, scope.tenantId, scope.venue.id)
  if (!result.ok) return refused(result)
  const queued =
    result.issued === 0 ? true : await queueTokenFiles(scope, services, result.venueId, [])
  return { ok: true, queued, issued: result.issued, skippedNoLabel: result.skippedNoLabel }
}

/** Saves which address the venue's codes carry. */
export async function saveQrSettings(
  scope: TablesScope,
  input: {
    readonly mode: 'ours' | 'own'
    readonly baseUrl: string | null
    readonly ownPattern: string | null
  },
): Promise<TablesActionResult> {
  if (!scope.canManage) return FORBIDDEN
  const result = await setVenueQrSettings(scope.pool, scope.tenantId, {
    venueId: scope.venue.id as VenueId,
    ...input,
  })
  if (!result.ok) return refused(result)
  return { ok: true, queued: true }
}
