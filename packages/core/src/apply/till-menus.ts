// A till venue's menus (D88, D87; adjustments B3): the integration layer's writer that keeps one
// menu per root the till designates for the venue (its public menu, its till tree). The sync
// calls it with the roots as the venue list reports them, before it maps each root into its
// menu. Which roots a till has is the connector's knowledge; here they are opaque keys.
//
// A menu is tied to its root by a till link on its root node (`menu_root`, external id
// `<root>@<vn_ id>`: qualified by the venue, since till venues share catalogues), written
// through apply() like every link (rule 1). The `menus` row is a side table, written here like
// the other menu writers (./menus.ts). Rules:
// - a venue's menu that has no root, or whose root the till no longer names (the one
//   `provisionMenu` made before D88; a public menu whose category barsy changed), is adopted for
//   the root the caller names (`adoptFor`), else for the first root without a menu: the menu
//   follows the root, its old sections go missing through the usual absence rules, and a
//   venue mapped before keeps its menu and its live menu;
// - a venue with no live menu gets the first root's menu as its live one (the public menu is
//   live by default, D88); a venue that chose one keeps it;
// - nothing is deleted here.

import { type DbPool, menus, sourceLinks, withTenant } from '@restro/db'
import { withTenantWrite } from '@restro/db/write'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { type ChangeSet, type SourceLink, tillSource } from '../change-set'
import { type IntegrationId, isId, type NodeId, newId } from '../ids'
import { sortKeyBetween } from '../sort-keys'
import { applyInTransaction } from './apply'
import { lockTenantDocument } from './lock'
import { adoptLiveMenu, insertMenuRow, venueMenuOrder } from './menus'
import { ProvisionError } from './provision'
import { lockLiveVenue, venueRefusalText } from './venue-lock'

/** The link type of a menu's root node to the till root it mirrors. */
export const MENU_ROOT_LINK_TYPE = 'menu_root'

/** One root the till designates, as an opaque key (`<root>@<vn_ id>`, never a venue-free id). */
export interface TillMenuRoot {
  readonly externalId: string
}

/** A venue's menu for one till root. */
export interface TillMenu {
  readonly externalId: string
  readonly menuId: NodeId
  /** True when this call created the menu (false: it existed, or an older menu was adopted). */
  readonly created: boolean
  /** True when a menu without a current root was adopted for this root. */
  readonly adopted: boolean
}

/** What `ensureTillMenus` takes. */
export interface EnsureTillMenusInput {
  readonly venueId: string
  readonly integrationId: string
  /** The roots in order: the first one becomes the live menu of a venue that has none. */
  readonly roots: readonly TillMenuRoot[]
  /** The root a menu without a current root is adopted for; default: the first root without a menu. */
  readonly adoptFor?: string | undefined
  /** The job the links are written under (a `jb_` run id). */
  readonly jobId: string
  readonly now?: Date | undefined
}

/** What `ensureTillMenus` answers: the venue's menu per root, in the roots' order. */
export interface TillMenus {
  readonly menus: readonly TillMenu[]
  readonly liveMenuId: NodeId | null
}

/** The key the till's root link carries for one venue. */
export function tillMenuRootId(root: string | number, venueId: string): string {
  return `${root}@${venueId}`
}

/**
 * Keeps the venue's menus in step with the till's roots (see the header). Idempotent: a second
 * call with the same roots changes nothing. Throws `ProvisionError` for a bad input, a venue the
 * tenant does not have (`venue_missing`) and a deleted one (`venue_archived`).
 */
export async function ensureTillMenus(
  pool: DbPool,
  tenantId: string,
  input: EnsureTillMenusInput,
): Promise<TillMenus> {
  if (!isId('tn', tenantId)) throw new ProvisionError('invalid_input', 'tenantId must be a tn_ id')
  if (!isId('vn', input.venueId)) {
    throw new ProvisionError('invalid_input', 'venueId must be a vn_ id')
  }
  if (!isId('in', input.integrationId)) {
    throw new ProvisionError('invalid_input', 'integrationId must be an in_ id')
  }
  const roots = [...new Map(input.roots.map((root) => [root.externalId, root])).values()]
  for (const root of roots) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/.test(root.externalId)) {
      throw new ProvisionError('invalid_input', 'a root key is a short safe string')
    }
  }
  const { venueId } = input
  const integrationId = input.integrationId as IntegrationId
  return withTenantWrite(pool, tenantId, async (tx) => {
    await lockTenantDocument(tx, tenantId)
    const locked = await lockLiveVenue(tx, venueId, 'update')
    if (locked.refused !== null) {
      throw new ProvisionError(locked.refused, venueRefusalText(venueId, locked.refused))
    }
    let liveMenuId = locked.venue.liveMenuId as NodeId | null
    const ordered = await venueMenuOrder(tx, venueId)
    const menuIds = ordered.map((menu) => menu.id)
    const links =
      menuIds.length === 0
        ? []
        : await tx
            .select({ externalId: sourceLinks.externalId, nodeId: sourceLinks.nodeId })
            .from(sourceLinks)
            .where(
              and(
                eq(sourceLinks.integrationId, integrationId),
                eq(sourceLinks.externalType, MENU_ROOT_LINK_TYPE),
                inArray(sourceLinks.nodeId, menuIds),
              ),
            )
    const current = new Set(roots.map((root) => root.externalId))
    const menuOfRoot = new Map<string, NodeId>()
    const linkedToCurrent = new Set<string>()
    // A menu's link to a root the till no longer names: replaced when the menu is adopted.
    const staleLinkOf = new Map<string, string>()
    for (const link of links) {
      if (current.has(link.externalId)) {
        menuOfRoot.set(link.externalId, link.nodeId as NodeId)
        linkedToCurrent.add(link.nodeId)
      } else {
        staleLinkOf.set(link.nodeId, link.externalId)
      }
    }
    // Menus without a current root, the live one first: `provisionMenu`'s menu from before
    // D88, or a menu whose root barsy changed.
    const unlinked = menuIds
      .filter((id) => !linkedToCurrent.has(id))
      .sort((a, b) => (a === liveMenuId ? -1 : b === liveMenuId ? 1 : 0))
    const adoptFor =
      input.adoptFor !== undefined && current.has(input.adoptFor) && !menuOfRoot.has(input.adoptFor)
        ? input.adoptFor
        : (roots.find((root) => !menuOfRoot.has(root.externalId))?.externalId ?? null)

    const result: TillMenu[] = []
    const linkOps: ChangeSet['ops'] = []
    // A till never unlinks (apply() refuses it: absence is concluded, never dropped). Pointing a
    // menu at its new root is the integration layer's own bookkeeping, so the old root's link
    // goes in a manual change set by the system, before the till link is written.
    const unlinkOps: ChangeSet['ops'] = []
    const linkTo = (externalId: string): SourceLink => ({
      integration: integrationId,
      externalType: MENU_ROOT_LINK_TYPE,
      externalId,
    })
    let lastKey = ordered.at(-1)?.sortKey ?? null
    for (const root of roots) {
      const existing = menuOfRoot.get(root.externalId)
      if (existing !== undefined) {
        result.push({
          externalId: root.externalId,
          menuId: existing,
          created: false,
          adopted: false,
        })
        continue
      }
      let menuId: NodeId
      let adopted = false
      let created = false
      const candidate = root.externalId === adoptFor ? unlinked.shift() : undefined
      if (candidate !== undefined) {
        menuId = candidate as NodeId
        adopted = true
        const stale = staleLinkOf.get(candidate)
        if (stale !== undefined) {
          unlinkOps.push({ op: 'unlinkSource', node: { id: menuId }, link: linkTo(stale) })
        }
      } else {
        lastKey = sortKeyBetween(lastKey, null)
        const row = await insertMenuRow(tx, tenantId, venueId, null, lastKey)
        menuId = row.id as NodeId
        created = true
      }
      linkOps.push({ op: 'linkSource', node: { id: menuId }, link: linkTo(root.externalId) })
      menuOfRoot.set(root.externalId, menuId)
      result.push({ externalId: root.externalId, menuId, created, adopted })
    }
    const observedAt = (input.now ?? new Date()).toISOString()
    const changeSets: ChangeSet[] = []
    if (unlinkOps.length > 0) {
      changeSets.push({
        id: newId('cs'),
        source: 'manual',
        jobId: input.jobId,
        actor: 'system',
        observedAt,
        ops: unlinkOps,
      })
    }
    if (linkOps.length > 0) {
      changeSets.push({
        id: newId('cs'),
        source: tillSource(integrationId),
        jobId: input.jobId,
        actor: `integration:${integrationId}`,
        observedAt,
        ops: linkOps,
      })
    }
    for (const changeSet of changeSets) {
      const applied = await applyInTransaction(tx, tenantId, changeSet, { atomic: true })
      if (applied.rejected.length > 0) {
        throw new ProvisionError(
          'invalid_input',
          `the till roots could not be linked: ${applied.rejected[0]?.code ?? 'rejected'}`,
        )
      }
    }
    const first = result[0]
    if (liveMenuId === null && first !== undefined) {
      liveMenuId = (await adoptLiveMenu(tx, venueId, first.menuId)) as NodeId
    }
    return { menus: result, liveMenuId }
  })
}

/** The venue's menus with their till roots, in the venue's order (binned menus left out). */
export async function listTillMenus(
  pool: DbPool,
  tenantId: string,
  venueId: string,
  integrationId: string,
): Promise<{ menuId: NodeId; externalId: string }[]> {
  if (!isId('vn', venueId) || !isId('in', integrationId)) return []
  return withTenant(pool, tenantId, async (tx) => {
    const rows = await tx
      .select({ menuId: menus.id, externalId: sourceLinks.externalId })
      .from(menus)
      .innerJoin(
        sourceLinks,
        and(
          eq(sourceLinks.nodeId, menus.id),
          eq(sourceLinks.integrationId, integrationId),
          eq(sourceLinks.externalType, MENU_ROOT_LINK_TYPE),
        ),
      )
      .where(and(eq(menus.venueId, venueId), isNull(menus.deletedAt)))
      .orderBy(menus.sortKey, menus.id)
    return rows.map((row) => ({ menuId: row.menuId as NodeId, externalId: row.externalId }))
  })
}
