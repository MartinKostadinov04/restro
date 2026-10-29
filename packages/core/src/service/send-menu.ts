// What a Send prices its lines with (#77): the table's menu as the guest sees it, the published
// snapshot plus the live overlay's sold-out marks (rule 4's files, read here from the database
// they are made from). Read by the guest API before the Send's transaction, never inside it, so
// the transaction stays short; the handler then checks every line against it (`priceSentLines`).
//
// A line's name for the bar and the alerts is the POS's own name where the item came from a POS
// (its till-layer `name`), else the menu's name in its default language: staff read it against
// the POS (D116's alert "items by the POS's names"). Never shown to a guest.

import { type DbPool, fieldValues, withTenant } from '@restro/db'
import { and, eq, inArray } from 'drizzle-orm'

import { resolveRoutes } from '../apply/menu-routes'
import { loadCurrentSnapshot, loadLiveOverlay } from '../apply/publish'
import type { LocalizedText } from '../locales'
import { addMinor, type Currency, multiplyMinor } from '../money'
import type { PaymentMode } from '../templates/venue-menu'

/** One option of an item, as a Send prices it. */
export interface SendMenuOption {
  readonly deltaMinor: number
  readonly name: string
}

/** One item of the table's menu, as a Send prices it. */
export interface SendMenuItem {
  /** Null for an item without a price (never orderable). */
  readonly priceMinor: number | null
  readonly orderable: boolean
  readonly soldOut: boolean
  readonly name: string
  /** The item's public name in every language of the menu: what a guest's pay screen shows (#197). */
  readonly publicName?: LocalizedText
  readonly options: ReadonlyMap<string, SendMenuOption>
  /** A modifier group of the item asks for at least one choice (`min` 1 or more). */
  readonly requiredOptions?: boolean
  /** The item's own payment mode (D113), or null where it takes the venue's default. */
  readonly paymentMode?: PaymentMode | null
}

/** The table's menu for a Send. */
export interface SendMenu {
  readonly currency: Currency
  readonly items: ReadonlyMap<string, SendMenuItem>
}

/** The first text of a name: its default language, else any. */
function textOf(text: LocalizedText | undefined, locale: string): string {
  if (text === undefined) return ''
  const record = text as Readonly<Record<string, string | undefined>>
  return record[locale] ?? Object.values(record).find((value) => value !== undefined) ?? ''
}

/**
 * The menu the table's phones show (its route, else the venue's live menu), with tonight's
 * sold-out marks; null when nothing is published for it.
 */
export async function loadSendMenu(
  pool: DbPool,
  target: { readonly tenantId: string; readonly venueId: string; readonly tableId: string },
): Promise<SendMenu | null> {
  const routes = await resolveRoutes(pool, target.tenantId, target.venueId)
  const menuId = routes.tables.get(target.tableId as never) ?? routes.live
  if (menuId === null) return null
  const scope = { menuId, venueId: target.venueId }
  const snapshot = await loadCurrentSnapshot(pool, target.tenantId, scope)
  if (snapshot === null || snapshot.body === null) return null
  const live = await loadLiveOverlay(pool, target.tenantId, scope)
  const soldOut = new Set(Object.keys(live?.overlay.items ?? {}))
  const body = snapshot.body
  const locale = body.locales.default

  const nodeIds = [...Object.keys(body.items), ...Object.keys(body.options)]
  const tillNames = new Map<string, string>()
  if (nodeIds.length > 0) {
    const rows = await withTenant(pool, target.tenantId, (tx) =>
      tx
        .select({ nodeId: fieldValues.nodeId, value: fieldValues.value })
        .from(fieldValues)
        .where(
          and(
            inArray(fieldValues.nodeId, nodeIds),
            eq(fieldValues.fieldKey, 'name'),
            eq(fieldValues.layer, 'till'),
            eq(fieldValues.scope, 'master'),
          ),
        ),
    )
    for (const row of rows) {
      const name = typeof row.value === 'object' ? textOf(row.value as LocalizedText, locale) : ''
      if (name !== '') tillNames.set(row.nodeId, name)
    }
  }
  const nameOf = (id: string, text: LocalizedText) =>
    (tillNames.get(id) ?? textOf(text, locale)).slice(0, 200)

  const items = new Map<string, SendMenuItem>()
  for (const [id, item] of Object.entries(body.items)) {
    const options = new Map<string, SendMenuOption>()
    for (const groupId of item.modifier_groups) {
      for (const optionId of body.modifier_groups[groupId]?.options ?? []) {
        const option = body.options[optionId]
        if (option === undefined) continue
        options.set(optionId, {
          deltaMinor: option.price_delta?.amount_minor ?? 0,
          name: nameOf(optionId, option.name),
        })
      }
    }
    items.set(id, {
      requiredOptions: requiresOptions(item.modifier_groups, body.modifier_groups),
      priceMinor: item.price?.amount_minor ?? null,
      orderable: item.orderable,
      soldOut: soldOut.has(id) || item.availability.state === 'sold_out',
      name: nameOf(id, item.name),
      publicName: item.name,
      options,
      paymentMode: item.payment_mode ?? null,
    })
  }
  return { currency: body.currency, items }
}

/** True when one of the item's modifier groups asks for at least one choice. */
export function requiresOptions(
  groupIds: readonly string[],
  groups: Readonly<Record<string, { readonly min: number } | undefined>>,
): boolean {
  return groupIds.some((groupId) => (groups[groupId]?.min ?? 0) > 0)
}

/** One line a Send names. */
export interface SendLineInput {
  readonly itemId: string
  readonly optionIds: readonly string[]
  readonly qty: number
}

/** One priced line: the unit price is the item's plus its options' (rule 8, minor units). */
export interface PricedLine {
  readonly unitMinor: number
  readonly totalMinor: number
  readonly name: string
  /** The item's public name per language (#197); absent where the menu has none. */
  readonly publicName?: LocalizedText
  readonly optionNames: readonly string[]
}

/**
 * True when the menu can take the line tonight: its item is on the menu, priced, orderable and not
 * sold out, and every option is one the item has. A line that isn't stays on the order at Send,
 * greyed, and Send offers the others (#78).
 */
export function lineAvailable(
  menu: SendMenu,
  line: Pick<SendLineInput, 'itemId' | 'optionIds'>,
): boolean {
  const item = menu.items.get(line.itemId)
  if (item === undefined || !item.orderable || item.soldOut || item.priceMinor === null) {
    return false
  }
  return line.optionIds.every((optionId) => item.options.has(optionId))
}

/**
 * Prices the lines against the menu. A line whose item is not on the menu, not orderable, sold
 * out tonight, or names an option the item does not have is `item_unavailable` (rule 5: Restro
 * never sends what the guest could not order).
 */
export function priceSentLines(
  menu: SendMenu,
  lines: readonly SendLineInput[],
):
  | {
      readonly ok: true
      readonly lines: readonly PricedLine[]
      readonly totalMinor: number
    }
  | { readonly ok: false; readonly code: 'item_unavailable'; readonly itemId: string } {
  const priced: PricedLine[] = []
  let total = 0
  for (const line of lines) {
    const item = menu.items.get(line.itemId)
    if (item === undefined || item.priceMinor === null || !lineAvailable(menu, line)) {
      return { ok: false, code: 'item_unavailable', itemId: line.itemId }
    }
    let unit = item.priceMinor
    const optionNames: string[] = []
    for (const optionId of line.optionIds) {
      const option = item.options.get(optionId)
      if (option === undefined) return { ok: false, code: 'item_unavailable', itemId: line.itemId }
      unit = addMinor(unit, option.deltaMinor)
      optionNames.push(option.name)
    }
    const lineTotal = multiplyMinor(unit, line.qty)
    total = addMinor(total, lineTotal)
    priced.push({
      unitMinor: unit,
      totalMinor: lineTotal,
      name: item.name,
      ...(item.publicName === undefined ? {} : { publicName: item.publicName }),
      optionNames,
    })
  }
  return { ok: true, lines: priced, totalMinor: total }
}
