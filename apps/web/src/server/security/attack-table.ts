// Every server action, as data: the call a person of organisation `a` makes against the ids of
// organisation `v` (the victim). Two tables:
//
// - `ATTACKS`: every action with all the victim's ids. The action must refuse.
// - `MIXED`: the attacker's own venue with the victim's child ids (the way past a venue check).
//
// `pin` is left out: the caller is a signed-in person on their own phone.
import { newId, THEME_PRESETS } from '@restro/core'

import * as composer from '@/composer/actions'
import * as paymentMode from '@/composer/payment-mode-actions'
import * as soldOut from '@/composer/sold-out-actions'
import * as tags from '@/composer/tag-actions'
import * as i18n from '@/i18n/actions'
import * as switching from '@/server/actions'
import * as guestFeatures from '@/server/composer/guest-features-actions'
import * as design from '@/server/design/actions'
import * as integration from '@/server/integration/actions'
import * as sheet from '@/server/item-sheet/actions'
import * as menus from '@/server/menus-actions'
import * as organization from '@/server/organization-actions'
import * as publish from '@/server/publish/actions'
import * as alerts from '@/server/settings/alerts-actions'
import * as ordering from '@/server/settings/ordering-actions'
import * as paying from '@/server/settings/paying-actions'
import * as staff from '@/server/settings/staff-actions'
import * as tables from '@/server/tables/actions'
import * as tonight from '@/server/tonight/actions'
import * as night from '@/server/tonight/night-actions'
import * as paymentsRead from '@/server/tonight/payment-actions'
import * as venues from '@/server/venues-actions'

import type { SeededOrg } from './tests/attack-world'

export interface Attack {
  /** The exported name of the action. */
  readonly action: string
  /** A label when one action is attacked more than one way. */
  readonly how?: string
  readonly call: (v: SeededOrg, a: SeededOrg) => Promise<unknown>
  /**
   * The action takes nothing of a venue: it works on the caller's own organisation, so an answer
   * of ok is right and the check is only that the victim did not move.
   */
  readonly ownOrganisation?: boolean
}

const midnight = THEME_PRESETS.find((preset) => preset.id === 'midnight')
if (midnight === undefined) throw new Error('the Midnight preset is missing')
const WHOLE_THEME = {
  logo_asset_id: null,
  preset: 'midnight',
  colors: midnight.colours,
  overrides: midnight.overrides,
  font: 'lora',
  radius: midnight.radius,
  shadow: 3,
  scheme: 'dark',
}
const KEYS = (id: string) => [{ id, key: 'a1' }]

/** All the victim's ids. */
export const ATTACKS: readonly Attack[] = [
  // The composer.
  {
    action: 'placeItemAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.placeItemAction({
        venueId: x.id,
        menuId: x.menu,
        itemId: x.item,
        fromSectionId: x.section,
        toSectionId: null,
        keys: [],
      })
    },
  },
  {
    action: 'moveSectionAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.moveSectionAction({
        venueId: x.id,
        menuId: x.menu,
        sectionId: x.section,
        parentId: null,
        keys: KEYS(x.section),
      })
    },
  },
  {
    action: 'createSectionAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.createSectionAction({
        venueId: x.id,
        menuId: x.menu,
        id: newId('nd'),
        parentId: null,
        title: { bg_BG: 'attack' },
        sortKey: 'a5',
      })
    },
  },
  {
    action: 'createItemAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.createItemAction({
        venueId: x.id,
        menuId: x.menu,
        id: newId('nd'),
        sectionId: x.section,
        name: { bg_BG: 'attack' },
        sortKey: 'a5',
      })
    },
  },
  {
    action: 'setItemHiddenAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.setItemHiddenAction({
        venueId: x.id,
        menuId: x.menu,
        itemId: x.item,
        hidden: true,
      })
    },
  },
  {
    action: 'setSectionHiddenAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.setSectionHiddenAction({
        venueId: x.id,
        menuId: x.menu,
        sectionId: x.section,
        hidden: true,
      })
    },
  },
  {
    action: 'setSectionLayoutAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.setSectionLayoutAction({
        venueId: x.id,
        menuId: x.menu,
        sectionId: x.section,
        layout: 'horizontal',
      })
    },
  },
  {
    action: 'renameSectionAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.renameSectionAction({
        venueId: x.id,
        menuId: x.menu,
        sectionId: x.section,
        title: { bg_BG: 'attack' },
      })
    },
  },
  {
    action: 'deleteSectionAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.deleteSectionAction({ venueId: x.id, menuId: x.menu, sectionId: x.section })
    },
  },
  {
    action: 'renameItemAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.renameItemAction({
        venueId: x.id,
        menuId: x.menu,
        itemId: x.item,
        name: { bg_BG: 'attack' },
      })
    },
  },
  {
    action: 'deleteItemAction',
    call: (v) => {
      const x = v.venues[0]
      return composer.deleteItemAction({ venueId: x.id, menuId: x.menu, itemId: x.item })
    },
  },
  {
    action: 'setItemPaymentModeAction',
    call: (v) => {
      const x = v.venues[0]
      return paymentMode.setItemPaymentModeAction({ venueId: x.id, itemIds: [x.item], mode: null })
    },
  },
  {
    action: 'setItemsSoldOutAction',
    call: (v) => {
      const x = v.venues[0]
      return soldOut.setItemsSoldOutAction({ venueId: x.id, itemIds: [x.item], soldOut: true })
    },
  },
  {
    action: 'createTagAction',
    call: (v) =>
      tags.createTagAction({
        venueId: v.venues[0].id,
        id: newId('tg'),
        label: { bg_BG: 'attack' },
        color: 'accent',
      }),
  },
  {
    action: 'updateTagAction',
    call: (v) => {
      const x = v.venues[0]
      return tags.updateTagAction({ venueId: x.id, id: x.tag, label: { bg_BG: 'attack' } })
    },
  },
  {
    action: 'moveTagAction',
    call: (v) => {
      const x = v.venues[0]
      return tags.moveTagAction({ venueId: x.id, id: x.tag, beforeId: null })
    },
  },
  {
    action: 'setTagArchivedAction',
    call: (v) => {
      const x = v.venues[0]
      return tags.setTagArchivedAction({ venueId: x.id, id: x.tag, archived: true })
    },
  },
  {
    action: 'setItemTagsAction',
    call: (v) => {
      const x = v.venues[0]
      return tags.setItemTagsAction({ venueId: x.id, itemIds: [x.item], add: [x.tag], remove: [] })
    },
  },

  // Language and organisation: they work on the caller's own session.
  { action: 'setAdminLocale', ownOrganisation: true, call: () => i18n.setAdminLocale('en') },
  {
    action: 'switchOrganization',
    how: 'to the victim',
    call: (v) => switching.switchOrganization(v.tenantId),
  },

  // Guest features and design.
  {
    action: 'saveGuestFeaturesAction',
    call: (v) =>
      guestFeatures.saveGuestFeaturesAction({
        venueId: v.venues[0].id,
        features: {
          filters: false,
          call_waiter: { enabled: false, kinds: [] },
          bill: false,
          ordering: false,
          pay: false,
        },
      }),
  },
  {
    action: 'saveFeatureOptionsAction',
    call: (v) =>
      guestFeatures.saveFeatureOptionsAction({
        venueId: v.venues[0].id,
        options: { attack: true },
      }),
  },
  {
    action: 'saveLookAction',
    call: (v) => design.saveLookAction({ venueId: v.venues[0].id, theme: WHOLE_THEME }),
  },
  {
    action: 'chooseTemplateAction',
    call: (v) =>
      design.chooseTemplateAction({ venueId: v.venues[0].id, face: 'basic', lookOptions: {} }),
  },

  // Integrations.
  {
    action: 'saveSystemsAction',
    ownOrganisation: true,
    call: () => integration.saveSystemsAction({ systems: [] }),
  },
  {
    action: 'addInstanceAction',
    ownOrganisation: true,
    call: () =>
      integration.addInstanceAction({ kind: 'sim', host: 'attack.test', user: 'u', password: 'p' }),
  },
  {
    action: 'saveConnectionAction',
    call: (v) =>
      integration.saveConnectionAction({
        integrationId: v.integration,
        host: 'attack.test',
        user: 'u',
        password: 'p',
      }),
  },
  {
    action: 'renameInstanceAction',
    call: (v) => integration.renameInstanceAction({ integrationId: v.integration, name: 'attack' }),
  },
  {
    action: 'removeInstanceAction',
    call: (v) => integration.removeInstanceAction({ integrationId: v.integration }),
  },
  {
    action: 'checkConnectionAction',
    call: (v) => integration.checkConnectionAction({ integrationId: v.integration }),
  },
  {
    action: 'saveInstanceSettingsAction',
    call: (v) =>
      integration.saveInstanceSettingsAction({ integrationId: v.integration, settings: {} }),
  },
  {
    action: 'syncAllAction',
    call: (v) => integration.syncAllAction({ integrationId: v.integration }),
  },
  {
    action: 'saveVenueSourceAction',
    call: (v) => integration.saveVenueSourceAction({ venueId: v.venues[0].id, settings: {} }),
  },
  { action: 'syncNowAction', call: (v) => integration.syncNowAction({ venueId: v.venues[0].id }) },

  // The item sheet.
  {
    action: 'loadItemSheetAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.loadItemSheetAction({ venueId: x.id, menuId: x.menu }, x.item)
    },
  },
  {
    action: 'loadItemHistoryAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.loadItemHistoryAction({ venueId: x.id, menuId: x.menu }, x.item)
    },
  },
  {
    action: 'saveItemFieldAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.saveItemFieldAction({ venueId: x.id, menuId: x.menu }, x.item, 'name', {
        bg_BG: 'attack',
      })
    },
  },
  {
    action: 'revertItemFieldAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.revertItemFieldAction({ venueId: x.id, menuId: x.menu }, x.item, 'name')
    },
  },
  {
    action: 'keepItemOverrideAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.keepItemOverrideAction({ venueId: x.id, menuId: x.menu }, x.item, 'name')
    },
  },
  {
    action: 'saveItemTranslationAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.saveItemTranslationAction(
        { venueId: x.id, menuId: x.menu },
        x.item,
        'name',
        'en_US',
        'attack',
      )
    },
  },
  {
    action: 'setItemImageAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.setItemImageAction(
        { venueId: x.id, menuId: x.menu },
        x.item,
        v.asset,
        null,
        null,
      )
    },
  },
  {
    action: 'setItemSoldOutAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.setItemSoldOutAction({ venueId: x.id, menuId: x.menu }, x.item, true)
    },
  },
  {
    action: 'removeItemImageAction',
    call: (v) => {
      const x = v.venues[0]
      return sheet.removeItemImageAction({ venueId: x.id, menuId: x.menu }, x.item)
    },
  },

  // Menus.
  {
    action: 'createMenuAction',
    call: (v) => menus.createMenuAction({ venueId: v.venues[0].id, name: 'attack' }),
  },
  {
    action: 'renameMenuAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.renameMenuAction({ venueId: x.id, menuId: x.menu, name: 'attack' })
    },
  },
  {
    action: 'moveMenuAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.moveMenuAction({ venueId: x.id, menuId: x.menu, position: 'end' })
    },
  },
  {
    action: 'setMenuSettingsAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.setMenuSettingsAction({ venueId: x.id, menuId: x.menu, settings: {} })
    },
  },
  {
    action: 'deleteMenuAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.deleteMenuAction({ venueId: x.id, menuId: x.menu })
    },
  },
  {
    action: 'restoreMenuAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.restoreMenuAction({ venueId: x.id, menuId: x.menu })
    },
  },
  {
    action: 'setLiveMenuAction',
    call: (v) => {
      const x = v.venues[0]
      return menus.setLiveMenuAction({ venueId: x.id, menuId: x.menu })
    },
  },
  {
    action: 'importMenuAction',
    how: 'victim to victim',
    call: (v) => {
      const x = v.venues[0]
      return menus.importMenuAction({
        fromVenueId: x.id,
        fromMenuId: x.menu,
        toVenueId: x.id,
        name: 'attack',
      })
    },
  },
  {
    action: 'listImportSourcesAction',
    ownOrganisation: true,
    call: (v) => menus.listImportSourcesAction(v.venues[0].id),
  },

  // The caller's own organisation: the slug of the victim is the one thing to try.
  {
    action: 'updateOrganizationAction',
    how: "the victim's name",
    ownOrganisation: true,
    call: () => organization.updateOrganizationAction({ name: 'attack' }),
  },

  // Publishing.
  {
    action: 'publishNowAction',
    call: (v) => {
      const x = v.venues[0]
      return publish.publishNowAction(x.id, x.menu)
    },
  },
  {
    action: 'approveHeldAction',
    call: (v) => {
      const x = v.venues[0]
      return publish.approveHeldAction(x.id, x.heldSnapshot)
    },
  },
  {
    action: 'rejectHeldAction',
    call: (v) => {
      const x = v.venues[0]
      return publish.rejectHeldAction(x.id, x.heldSnapshot)
    },
  },
  {
    action: 'rollbackAction',
    call: (v) => {
      const x = v.venues[0]
      return publish.rollbackAction(x.id, x.publishedSnapshot)
    },
  },
  {
    action: 'saveAutomationAction',
    call: (v) =>
      publish.saveAutomationAction({
        venueId: v.venues[0].id,
        sync: { mode: 'manual', incremental_minutes: 5, full_pull_time: '05:00' },
        afterSync: 'manual',
      }),
  },
  {
    action: 'resumeAutoPublishAction',
    call: (v) => publish.resumeAutoPublishAction(v.venues[0].id),
  },
  {
    action: 'previewDraftAction',
    call: (v) => {
      const x = v.venues[0]
      return publish.previewDraftAction(x.id, x.menu)
    },
  },

  // Alerts settings.
  {
    action: 'setRecipientsAction',
    call: (v) => alerts.setRecipientsAction({ venueId: v.venues[0].id, userIds: [] }),
  },
  {
    action: 'unlinkGroupAction',
    call: (v) => alerts.unlinkGroupAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'unlinkPersonAction',
    call: (v) => {
      const x = v.venues[0]
      return alerts.unlinkPersonAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  { action: 'linkGroupAction', call: (v) => alerts.linkGroupAction({ venueId: v.venues[0].id }) },
  {
    action: 'linkPersonAction',
    call: (v) => {
      const x = v.venues[0]
      return alerts.linkPersonAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  {
    action: 'testTelegramAction',
    call: (v) => alerts.testTelegramAction({ venueId: v.venues[0].id }),
  },

  // Ordering and paying settings.
  {
    action: 'saveOrderingAction',
    call: (v) =>
      ordering.saveOrderingAction({ venueId: v.venues[0].id, changes: { locationCheck: false } }),
  },
  {
    action: 'startConnectionAction',
    call: (v) => paying.startConnectionAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'finishConnectionAction',
    call: (v) => paying.finishConnectionAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'disconnectPayingAction',
    call: (v) => paying.disconnectPayingAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'tickPayingCheckAction',
    call: (v) =>
      paying.tickPayingCheckAction({
        venueId: v.venues[0].id,
        check: 'cardTypeInTill',
        done: true,
      }),
  },
  {
    action: 'savePayingAction',
    call: (v) =>
      paying.savePayingAction({ venueId: v.venues[0].id, changes: { minCardMinor: 100 } }),
  },
  {
    action: 'savePayFirstAction',
    call: (v) => paying.savePayFirstAction({ venueId: v.venues[0].id, change: { applies: true } }),
  },

  // People, roles, devices.
  {
    action: 'addPersonAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.addPersonAction({ venueId: x.id, displayName: 'attack', roleId: x.role })
    },
  },
  {
    action: 'revealPinAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.revealPinAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  {
    action: 'newPinAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.newPinAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  {
    action: 'renamePersonAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.renamePersonAction({
        venueId: x.id,
        staffMemberId: x.staff,
        displayName: 'attack',
      })
    },
  },
  {
    action: 'assignRoleAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.assignRoleAction({ venueId: x.id, staffMemberId: x.staff, roleId: x.role })
    },
  },
  {
    action: 'removeFromVenueAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.removeFromVenueAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  {
    action: 'removeForGoodAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.removeForGoodAction({ venueId: x.id, staffMemberId: x.staff })
    },
  },
  {
    action: 'linkAccountAction',
    call: (v, a) => {
      const x = v.venues[0]
      return staff.linkAccountAction({ venueId: x.id, staffMemberId: x.staff, userId: a.ownerId })
    },
  },
  {
    action: 'copyRoleAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.copyRoleAction({ venueId: x.id, fromRoleId: x.role, name: 'attack' })
    },
  },
  {
    action: 'updateRoleAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.updateRoleAction({ venueId: x.id, roleId: x.role, name: 'attack' })
    },
  },
  {
    action: 'archiveRoleAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.archiveRoleAction({ venueId: x.id, roleId: x.role })
    },
  },
  {
    action: 'markSharedDeviceAction',
    call: (v) => staff.markSharedDeviceAction({ venueId: v.venues[0].id, name: 'attack' }),
  },
  {
    action: 'revokeSharedDeviceAction',
    call: (v) => {
      const x = v.venues[0]
      return staff.revokeSharedDeviceAction({ venueId: x.id, deviceId: x.device })
    },
  },

  // Tables.
  {
    action: 'revealCodesAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.revealCodesAction({ venueId: x.id, tableIds: [x.table] })
    },
  },
  {
    action: 'createAllCodesAction',
    call: (v) => tables.createAllCodesAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'issueCodeAction',
    call: (v) => tables.issueCodeAction({ tableId: v.venues[0].table }),
  },
  {
    action: 'turnOffCodeAction',
    call: (v) => tables.turnOffCodeAction({ tableId: v.venues[0].table }),
  },
  {
    action: 'renameTableAction',
    call: (v) => tables.renameTableAction({ tableId: v.venues[0].table, label: 'attack' }),
  },
  {
    action: 'createAreaAction',
    call: (v) => tables.createAreaAction({ venueId: v.venues[0].id, name: 'attack' }),
  },
  {
    action: 'renameAreaAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.renameAreaAction({ venueId: x.id, areaId: x.area, name: 'attack' })
    },
  },
  {
    action: 'setAreaHiddenAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.setAreaHiddenAction({ venueId: x.id, areaId: x.area, hidden: true })
    },
  },
  {
    action: 'moveAreaAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.moveAreaAction({ venueId: x.id, areaId: x.area, position: 0 })
    },
  },
  {
    action: 'deleteAreaAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.deleteAreaAction({ venueId: x.id, areaId: x.area })
    },
  },
  {
    action: 'createTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.createTableAction({ venueId: x.id, areaId: x.area, number: '77' })
    },
  },
  {
    action: 'setTableNumberAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.setTableNumberAction({ venueId: x.id, tableId: x.table, number: '78' })
    },
  },
  {
    action: 'setTableHiddenAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.setTableHiddenAction({ venueId: x.id, tableId: x.table, hidden: true })
    },
  },
  {
    action: 'moveTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.moveTableAction({ venueId: x.id, tableId: x.table, position: 0 })
    },
  },
  {
    action: 'deleteTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.deleteTableAction({ venueId: x.id, tableId: x.table2 })
    },
  },
  {
    action: 'setMenuRouteAction',
    call: (v) => {
      const x = v.venues[0]
      return tables.setMenuRouteAction({
        venueId: x.id,
        target: { tableId: x.table },
        menuId: x.menu,
      })
    },
  },

  // Tonight.
  {
    action: 'openTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.openTableAction({ venueId: x.id, tableId: x.table2 })
    },
  },
  {
    action: 'closeTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.closeTableAction({ venueId: x.id, tableId: x.table })
    },
  },
  {
    action: 'newGuestsAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.newGuestsAction({ venueId: x.id, tableId: x.table, sittingId: x.sitting })
    },
  },
  {
    action: 'openAllTablesAction',
    call: (v) => tonight.openAllTablesAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'closeAllTablesAction',
    call: (v) => tonight.closeAllTablesAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'markPaymentTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.markPaymentTableAction({
        venueId: x.id,
        tableId: x.table,
        isPaymentTable: true,
      })
    },
  },
  {
    action: 'handleWaiterCallAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.handleWaiterCallAction({ venueId: x.id, waiterCallId: x.waiterCall })
    },
  },
  {
    action: 'undoWaiterCallAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.undoWaiterCallAction({
        venueId: x.id,
        waiterCallId: x.waiterCall,
        undo: { entry: 1 },
      })
    },
  },
  {
    action: 'receiptBroughtAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.receiptBroughtAction({ venueId: x.id, paymentId: x.payment })
    },
  },
  {
    action: 'receiptUnbroughtAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.receiptUnbroughtAction({ venueId: x.id, paymentId: x.payment })
    },
  },
  {
    action: 'pauseOrderingAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.pauseOrderingAction({ venueId: x.id, barId: x.bar })
    },
  },
  {
    action: 'liftOrderingAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.liftOrderingAction({ venueId: x.id, pauseId: x.pause })
    },
  },
  {
    action: 'liftRestroPauseAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.liftRestroPauseAction({ venueId: x.id, pauseId: x.pause })
    },
  },
  {
    action: 'undoPauseAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.undoPauseAction({ venueId: x.id, pauseId: x.pause, undo: { entry: 1 } })
    },
  },
  {
    action: 'resumeTableAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.resumeTableAction({ venueId: x.id, tableId: x.table })
    },
  },
  {
    action: 'answerSentOrderAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.answerSentOrderAction({
        venueId: x.id,
        sentOrderId: x.sentOrder,
        answer: 'found',
      })
    },
  },
  {
    action: 'undoOpenAllAction',
    call: (v) => tonight.undoOpenAllAction({ venueId: v.venues[0].id, undo: { entry: 1 } }),
  },
  {
    action: 'tableBillAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.tableBillAction({ venueId: x.id, tableId: x.table })
    },
  },
  {
    action: 'stornoDoneAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.stornoDoneAction({ venueId: x.id, refundId: x.refund })
    },
  },
  {
    action: 'stornoUndoAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.stornoUndoAction({ venueId: x.id, refundId: x.refund, undo: { entry: 1 } })
    },
  },
  {
    action: 'refundFailedSeenAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.refundFailedSeenAction({ venueId: x.id, refundId: x.refund })
    },
  },
  {
    action: 'refundFailedUnseenAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.refundFailedUnseenAction({
        venueId: x.id,
        refundId: x.refund,
        undo: { entry: 1 },
      })
    },
  },
  {
    action: 'doneAlertAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.doneAlertAction({ venueId: x.id, alertId: x.alert })
    },
  },
  {
    action: 'answerPaymentAction',
    call: (v) => {
      const x = v.venues[0]
      return tonight.answerPaymentAction({
        venueId: x.id,
        paymentId: x.payment,
        answering: 'close',
        answer: 'receipt_printed',
      })
    },
  },

  // Night reads.
  { action: 'sentOrdersAction', call: (v) => night.sentOrdersAction({ venueId: v.venues[0].id }) },
  {
    action: 'sentOrderDetailAction',
    call: (v) => {
      const x = v.venues[0]
      return night.sentOrderDetailAction({ venueId: x.id, sentOrderId: x.sentOrder })
    },
  },
  { action: 'logAction', call: (v) => night.logAction({ venueId: v.venues[0].id }) },
  {
    action: 'nightPaymentsAction',
    call: (v) => paymentsRead.nightPaymentsAction({ venueId: v.venues[0].id, all: 10 }),
  },
  {
    action: 'paymentDetailAction',
    call: (v) => {
      const x = v.venues[0]
      return paymentsRead.paymentDetailAction({ venueId: x.id, paymentId: x.payment })
    },
  },
  {
    action: 'paymentEvidenceAction',
    call: (v) => {
      const x = v.venues[0]
      return paymentsRead.paymentEvidenceAction({
        venueId: x.id,
        paymentId: x.payment,
        pin: '1234',
      })
    },
  },

  // Venues.
  {
    action: 'createVenueAction',
    how: "the victim's POS venue",
    ownOrganisation: true,
    call: (v) =>
      venues.createVenueAction({
        source: { kind: 'instance', integrationId: v.integration, bid: 1 },
      }),
  },
  {
    action: 'loadNewVenueSourcesAction',
    ownOrganisation: true,
    call: () => venues.loadNewVenueSourcesAction(),
  },
  {
    action: 'renameVenueSlugAction',
    call: (v) =>
      venues.renameVenueSlugAction({
        venueId: v.venues[0].id,
        slug: `attack-${newId('us').slice(3, 11).toLowerCase()}`,
      }),
  },
  {
    action: 'renameVenueAction',
    call: (v) => venues.renameVenueAction({ venueId: v.venues[0].id, name: 'attack' }),
  },
  {
    action: 'deleteVenueAction',
    call: (v) => {
      const x = v.venues[0]
      return venues.deleteVenueAction({ venueId: x.id, confirmName: x.name })
    },
  },
  {
    action: 'restoreVenueAction',
    call: (v) => venues.restoreVenueAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'unpublishVenueAction',
    call: (v) => venues.unpublishVenueAction({ venueId: v.venues[0].id }),
  },
  {
    action: 'purgeVenueAction',
    call: (v) => {
      const x = v.venues[0]
      return venues.purgeVenueAction({ venueId: x.id, confirmName: x.name })
    },
  },
]

/** The attacker's own venue and menu, the victim's child ids. */
export const MIXED: readonly Attack[] = [
  {
    action: 'placeItemAction',
    how: "victim's item into my section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.placeItemAction({
        venueId: m.id,
        menuId: m.menu,
        itemId: x.item,
        fromSectionId: null,
        toSectionId: m.section,
        keys: KEYS(x.item),
      })
    },
  },
  {
    action: 'placeItemAction',
    how: "my item into victim's section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.placeItemAction({
        venueId: m.id,
        menuId: m.menu,
        itemId: m.item,
        fromSectionId: null,
        toSectionId: x.section,
        keys: KEYS(m.item),
      })
    },
  },
  {
    action: 'placeItemAction',
    how: "victim's item out of victim's section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.placeItemAction({
        venueId: m.id,
        menuId: m.menu,
        itemId: x.item,
        fromSectionId: x.section,
        toSectionId: null,
        keys: [],
      })
    },
  },
  {
    action: 'moveSectionAction',
    how: "victim's section under my menu",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.moveSectionAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: x.section,
        parentId: null,
        keys: KEYS(x.section),
      })
    },
  },
  {
    action: 'moveSectionAction',
    how: "my section under victim's section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.moveSectionAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: m.section,
        parentId: x.section,
        keys: KEYS(m.section),
      })
    },
  },
  {
    action: 'createSectionAction',
    how: "under victim's section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.createSectionAction({
        venueId: m.id,
        menuId: m.menu,
        id: newId('nd'),
        parentId: x.section,
        title: { bg_BG: 'attack' },
        sortKey: 'a7',
      })
    },
  },
  {
    action: 'createItemAction',
    how: "in victim's section",
    call: (v, a) => {
      const x = v.venues[0]
      const m = a.venues[0]
      return composer.createItemAction({
        venueId: m.id,
        menuId: m.menu,
        id: newId('nd'),
        sectionId: x.section,
        name: { bg_BG: 'attack' },
        sortKey: 'a7',
      })
    },
  },
  {
    action: 'setItemHiddenAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.setItemHiddenAction({
        venueId: m.id,
        menuId: m.menu,
        itemId: v.venues[0].item,
        hidden: true,
      })
    },
  },
  {
    action: 'setSectionHiddenAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.setSectionHiddenAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: v.venues[0].section,
        hidden: true,
      })
    },
  },
  {
    action: 'setSectionLayoutAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.setSectionLayoutAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: v.venues[0].section,
        layout: 'horizontal',
      })
    },
  },
  {
    action: 'renameSectionAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.renameSectionAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: v.venues[0].section,
        title: { bg_BG: 'attack' },
      })
    },
  },
  {
    action: 'deleteSectionAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.deleteSectionAction({
        venueId: m.id,
        menuId: m.menu,
        sectionId: v.venues[0].section,
      })
    },
  },
  {
    action: 'renameItemAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.renameItemAction({
        venueId: m.id,
        menuId: m.menu,
        itemId: v.venues[0].item,
        name: { bg_BG: 'attack' },
      })
    },
  },
  {
    action: 'deleteItemAction',
    call: (v, a) => {
      const m = a.venues[0]
      return composer.deleteItemAction({ venueId: m.id, menuId: m.menu, itemId: v.venues[0].item })
    },
  },
  {
    action: 'composer on the victim menu',
    how: 'my venue, victim menu',
    call: (v, a) => {
      const m = a.venues[0]
      const x = v.venues[0]
      return composer.setItemHiddenAction({
        venueId: m.id,
        menuId: x.menu,
        itemId: x.item,
        hidden: true,
      })
    },
  },
  {
    action: 'setItemPaymentModeAction',
    call: (v, a) =>
      paymentMode.setItemPaymentModeAction({
        venueId: a.venues[0].id,
        itemIds: [v.venues[0].item],
        mode: null,
      }),
  },
  {
    action: 'setItemsSoldOutAction',
    call: (v, a) =>
      soldOut.setItemsSoldOutAction({
        venueId: a.venues[0].id,
        itemIds: [v.venues[0].item],
        soldOut: true,
      }),
  },
  {
    action: 'setItemTagsAction',
    how: "victim's item, my tag",
    call: (v, a) => {
      const m = a.venues[0]
      return tags.setItemTagsAction({
        venueId: m.id,
        itemIds: [v.venues[0].item],
        add: [m.tag],
        remove: [],
      })
    },
  },
  {
    action: 'setItemTagsAction',
    how: "my item, victim's tag",
    call: (v, a) => {
      const m = a.venues[0]
      return tags.setItemTagsAction({
        venueId: m.id,
        itemIds: [m.item],
        add: [v.venues[0].tag],
        remove: [],
      })
    },
  },
  {
    action: 'updateTagAction',
    call: (v, a) =>
      tags.updateTagAction({
        venueId: a.venues[0].id,
        id: v.venues[0].tag,
        label: { bg_BG: 'attack' },
      }),
  },
  {
    action: 'moveTagAction',
    call: (v, a) => {
      const m = a.venues[0]
      return tags.moveTagAction({ venueId: m.id, id: m.tag, beforeId: v.venues[0].tag })
    },
  },
  {
    action: 'setTagArchivedAction',
    call: (v, a) =>
      tags.setTagArchivedAction({ venueId: a.venues[0].id, id: v.venues[0].tag, archived: true }),
  },
  {
    action: 'createTagAction',
    how: "with the victim's tag id",
    call: (v, a) =>
      tags.createTagAction({
        venueId: a.venues[0].id,
        id: v.venues[0].tag,
        label: { bg_BG: 'attack' },
        color: 'accent',
      }),
  },
  {
    action: 'loadItemSheetAction',
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.loadItemSheetAction({ venueId: m.id, menuId: m.menu }, v.venues[0].item)
    },
  },
  {
    action: 'loadItemHistoryAction',
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.loadItemHistoryAction({ venueId: m.id, menuId: m.menu }, v.venues[0].item)
    },
  },
  {
    action: 'saveItemFieldAction',
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.saveItemFieldAction(
        { venueId: m.id, menuId: m.menu },
        v.venues[0].item,
        'name',
        { bg_BG: 'attack' },
      )
    },
  },
  {
    action: 'saveItemTranslationAction',
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.saveItemTranslationAction(
        { venueId: m.id, menuId: m.menu },
        v.venues[0].item,
        'name',
        'en_US',
        'attack',
      )
    },
  },
  {
    action: 'setItemImageAction',
    how: "my item, victim's asset",
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.setItemImageAction(
        { venueId: m.id, menuId: m.menu },
        m.item,
        v.asset,
        null,
        null,
      )
    },
  },
  {
    action: 'setItemSoldOutAction',
    call: (v, a) => {
      const m = a.venues[0]
      return sheet.setItemSoldOutAction({ venueId: m.id, menuId: m.menu }, v.venues[0].item, true)
    },
  },
  {
    action: 'renameMenuAction',
    call: (v, a) =>
      menus.renameMenuAction({ venueId: a.venues[0].id, menuId: v.venues[0].menu, name: 'attack' }),
  },
  {
    action: 'moveMenuAction',
    how: "before the victim's menu",
    call: (v, a) => {
      const m = a.venues[0]
      return menus.moveMenuAction({
        venueId: m.id,
        menuId: m.menu,
        position: { before: v.venues[0].menu },
      })
    },
  },
  {
    action: 'setMenuSettingsAction',
    call: (v, a) =>
      menus.setMenuSettingsAction({
        venueId: a.venues[0].id,
        menuId: v.venues[0].menu,
        settings: {},
      }),
  },
  {
    action: 'deleteMenuAction',
    call: (v, a) => menus.deleteMenuAction({ venueId: a.venues[0].id, menuId: v.venues[0].menu }),
  },
  {
    action: 'restoreMenuAction',
    call: (v, a) => menus.restoreMenuAction({ venueId: a.venues[0].id, menuId: v.venues[0].menu }),
  },
  {
    action: 'setLiveMenuAction',
    call: (v, a) => menus.setLiveMenuAction({ venueId: a.venues[0].id, menuId: v.venues[0].menu }),
  },
  {
    action: 'importMenuAction',
    how: 'victim into me',
    call: (v, a) => {
      const x = v.venues[0]
      return menus.importMenuAction({
        fromVenueId: x.id,
        fromMenuId: x.menu,
        toVenueId: a.venues[0].id,
        name: 'attack',
      })
    },
  },
  {
    action: 'importMenuAction',
    how: 'my venue, victim menu',
    call: (v, a) => {
      const m = a.venues[0]
      return menus.importMenuAction({
        fromVenueId: m.id,
        fromMenuId: v.venues[0].menu,
        toVenueId: m.id,
        name: 'attack',
      })
    },
  },
  {
    action: 'importMenuAction',
    how: 'me into the victim',
    call: (v, a) => {
      const m = a.venues[0]
      return menus.importMenuAction({
        fromVenueId: m.id,
        fromMenuId: m.menu,
        toVenueId: v.venues[0].id,
        name: 'attack',
      })
    },
  },
  {
    action: 'publishNowAction',
    how: 'my venue, victim menu',
    call: (v, a) => publish.publishNowAction(a.venues[0].id, v.venues[0].menu),
  },
  {
    action: 'previewDraftAction',
    how: 'my venue, victim menu',
    call: (v, a) => publish.previewDraftAction(a.venues[0].id, v.venues[0].menu),
  },
  {
    action: 'approveHeldAction',
    call: (v, a) => publish.approveHeldAction(a.venues[0].id, v.venues[0].heldSnapshot),
  },
  {
    action: 'rejectHeldAction',
    call: (v, a) => publish.rejectHeldAction(a.venues[0].id, v.venues[0].heldSnapshot),
  },
  {
    action: 'rollbackAction',
    call: (v, a) => publish.rollbackAction(a.venues[0].id, v.venues[0].publishedSnapshot),
  },
  {
    action: 'setRecipientsAction',
    how: "the victim's owner as my recipient",
    call: (v, a) => alerts.setRecipientsAction({ venueId: a.venues[0].id, userIds: [v.ownerId] }),
  },
  {
    action: 'unlinkPersonAction',
    call: (v, a) =>
      alerts.unlinkPersonAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'linkPersonAction',
    call: (v, a) =>
      alerts.linkPersonAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'revealPinAction',
    call: (v, a) =>
      staff.revealPinAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'newPinAction',
    call: (v, a) =>
      staff.newPinAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'renamePersonAction',
    call: (v, a) =>
      staff.renamePersonAction({
        venueId: a.venues[0].id,
        staffMemberId: v.venues[0].staff,
        displayName: 'attack',
      }),
  },
  {
    action: 'assignRoleAction',
    how: "victim's person, my role",
    call: (v, a) => {
      const m = a.venues[0]
      return staff.assignRoleAction({
        venueId: m.id,
        staffMemberId: v.venues[0].staff,
        roleId: m.role,
      })
    },
  },
  {
    action: 'assignRoleAction',
    how: "my person, victim's role",
    call: (v, a) => {
      const m = a.venues[0]
      return staff.assignRoleAction({
        venueId: m.id,
        staffMemberId: m.staff,
        roleId: v.venues[0].role,
      })
    },
  },
  {
    action: 'removeFromVenueAction',
    call: (v, a) =>
      staff.removeFromVenueAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'removeForGoodAction',
    call: (v, a) =>
      staff.removeForGoodAction({ venueId: a.venues[0].id, staffMemberId: v.venues[0].staff }),
  },
  {
    action: 'linkAccountAction',
    how: "my person, the victim's owner",
    call: (v, a) => {
      const m = a.venues[0]
      return staff.linkAccountAction({ venueId: m.id, staffMemberId: m.staff, userId: v.ownerId })
    },
  },
  {
    action: 'copyRoleAction',
    how: "from the victim's role",
    call: (v, a) =>
      staff.copyRoleAction({
        venueId: a.venues[0].id,
        fromRoleId: v.venues[0].role,
        name: 'attack',
      }),
  },
  {
    action: 'updateRoleAction',
    call: (v, a) =>
      staff.updateRoleAction({ venueId: a.venues[0].id, roleId: v.venues[0].role, name: 'attack' }),
  },
  {
    action: 'archiveRoleAction',
    call: (v, a) => staff.archiveRoleAction({ venueId: a.venues[0].id, roleId: v.venues[0].role }),
  },
  {
    action: 'revokeSharedDeviceAction',
    call: (v, a) =>
      staff.revokeSharedDeviceAction({ venueId: a.venues[0].id, deviceId: v.venues[0].device }),
  },
  {
    action: 'revealCodesAction',
    call: (v, a) =>
      tables.revealCodesAction({ venueId: a.venues[0].id, tableIds: [v.venues[0].table] }),
  },
  {
    action: 'renameAreaAction',
    call: (v, a) =>
      tables.renameAreaAction({
        venueId: a.venues[0].id,
        areaId: v.venues[0].area,
        name: 'attack',
      }),
  },
  {
    action: 'setAreaHiddenAction',
    call: (v, a) =>
      tables.setAreaHiddenAction({
        venueId: a.venues[0].id,
        areaId: v.venues[0].area,
        hidden: true,
      }),
  },
  {
    action: 'moveAreaAction',
    call: (v, a) =>
      tables.moveAreaAction({ venueId: a.venues[0].id, areaId: v.venues[0].area, position: 0 }),
  },
  {
    action: 'deleteAreaAction',
    call: (v, a) => tables.deleteAreaAction({ venueId: a.venues[0].id, areaId: v.venues[0].area }),
  },
  {
    action: 'createTableAction',
    how: "in the victim's area",
    call: (v, a) =>
      tables.createTableAction({ venueId: a.venues[0].id, areaId: v.venues[0].area, number: '79' }),
  },
  {
    action: 'setTableNumberAction',
    call: (v, a) =>
      tables.setTableNumberAction({
        venueId: a.venues[0].id,
        tableId: v.venues[0].table,
        number: '80',
      }),
  },
  {
    action: 'setTableHiddenAction',
    call: (v, a) =>
      tables.setTableHiddenAction({
        venueId: a.venues[0].id,
        tableId: v.venues[0].table,
        hidden: true,
      }),
  },
  {
    action: 'moveTableAction',
    how: "the victim's table to my area",
    call: (v, a) => {
      const m = a.venues[0]
      return tables.moveTableAction({
        venueId: m.id,
        tableId: v.venues[0].table,
        areaId: m.area,
        position: 0,
      })
    },
  },
  {
    action: 'moveTableAction',
    how: "my table to the victim's area",
    call: (v, a) => {
      const m = a.venues[0]
      return tables.moveTableAction({
        venueId: m.id,
        tableId: m.table,
        areaId: v.venues[0].area,
        position: 0,
      })
    },
  },
  {
    action: 'deleteTableAction',
    call: (v, a) =>
      tables.deleteTableAction({ venueId: a.venues[0].id, tableId: v.venues[0].table2 }),
  },
  {
    action: 'setMenuRouteAction',
    how: "my table, the victim's menu",
    call: (v, a) => {
      const m = a.venues[0]
      return tables.setMenuRouteAction({
        venueId: m.id,
        target: { tableId: m.table },
        menuId: v.venues[0].menu,
      })
    },
  },
  {
    action: 'setMenuRouteAction',
    how: "the victim's table, my menu",
    call: (v, a) => {
      const m = a.venues[0]
      return tables.setMenuRouteAction({
        venueId: m.id,
        target: { tableId: v.venues[0].table },
        menuId: m.menu,
      })
    },
  },
  {
    action: 'setMenuRouteAction',
    how: "the victim's area, my menu",
    call: (v, a) => {
      const m = a.venues[0]
      return tables.setMenuRouteAction({
        venueId: m.id,
        target: { areaId: v.venues[0].area },
        menuId: m.menu,
      })
    },
  },
  {
    action: 'savePayFirstAction',
    how: "the victim's table",
    call: (v, a) =>
      paying.savePayFirstAction({
        venueId: a.venues[0].id,
        change: { table: v.venues[0].table, value: true },
      }),
  },
  {
    action: 'savePayFirstAction',
    how: "the victim's area",
    call: (v, a) =>
      paying.savePayFirstAction({
        venueId: a.venues[0].id,
        change: { group: v.venues[0].area, value: true },
      }),
  },
  {
    action: 'openTableAction',
    call: (v, a) =>
      tonight.openTableAction({ venueId: a.venues[0].id, tableId: v.venues[0].table2 }),
  },
  {
    action: 'closeTableAction',
    call: (v, a) =>
      tonight.closeTableAction({ venueId: a.venues[0].id, tableId: v.venues[0].table }),
  },
  {
    action: 'newGuestsAction',
    how: "my table, the victim's sitting",
    call: (v, a) => {
      const m = a.venues[0]
      return tonight.newGuestsAction({
        venueId: m.id,
        tableId: m.table,
        sittingId: v.venues[0].sitting,
      })
    },
  },
  {
    action: 'markPaymentTableAction',
    call: (v, a) =>
      tonight.markPaymentTableAction({
        venueId: a.venues[0].id,
        tableId: v.venues[0].table,
        isPaymentTable: true,
      }),
  },
  {
    action: 'handleWaiterCallAction',
    call: (v, a) =>
      tonight.handleWaiterCallAction({
        venueId: a.venues[0].id,
        waiterCallId: v.venues[0].waiterCall,
      }),
  },
  {
    action: 'undoWaiterCallAction',
    call: (v, a) =>
      tonight.undoWaiterCallAction({
        venueId: a.venues[0].id,
        waiterCallId: v.venues[0].waiterCall,
        undo: { entry: 1 },
      }),
  },
  {
    action: 'receiptBroughtAction',
    call: (v, a) =>
      tonight.receiptBroughtAction({ venueId: a.venues[0].id, paymentId: v.venues[0].payment }),
  },
  {
    action: 'pauseOrderingAction',
    how: "the victim's bar",
    call: (v, a) =>
      tonight.pauseOrderingAction({ venueId: a.venues[0].id, barId: v.venues[0].bar }),
  },
  {
    action: 'liftOrderingAction',
    call: (v, a) =>
      tonight.liftOrderingAction({ venueId: a.venues[0].id, pauseId: v.venues[0].pause }),
  },
  {
    action: 'liftRestroPauseAction',
    call: (v, a) =>
      tonight.liftRestroPauseAction({ venueId: a.venues[0].id, pauseId: v.venues[0].pause }),
  },
  {
    action: 'undoPauseAction',
    call: (v, a) =>
      tonight.undoPauseAction({
        venueId: a.venues[0].id,
        pauseId: v.venues[0].pause,
        undo: { entry: 1 },
      }),
  },
  {
    action: 'resumeTableAction',
    call: (v, a) =>
      tonight.resumeTableAction({ venueId: a.venues[0].id, tableId: v.venues[0].table }),
  },
  {
    action: 'answerSentOrderAction',
    call: (v, a) =>
      tonight.answerSentOrderAction({
        venueId: a.venues[0].id,
        sentOrderId: v.venues[0].sentOrder,
        answer: 'found',
      }),
  },
  {
    action: 'tableBillAction',
    call: (v, a) =>
      tonight.tableBillAction({ venueId: a.venues[0].id, tableId: v.venues[0].table }),
  },
  {
    action: 'stornoDoneAction',
    call: (v, a) =>
      tonight.stornoDoneAction({ venueId: a.venues[0].id, refundId: v.venues[0].refund }),
  },
  {
    action: 'refundFailedSeenAction',
    call: (v, a) =>
      tonight.refundFailedSeenAction({ venueId: a.venues[0].id, refundId: v.venues[0].refund }),
  },
  {
    action: 'doneAlertAction',
    call: (v, a) =>
      tonight.doneAlertAction({ venueId: a.venues[0].id, alertId: v.venues[0].alert }),
  },
  {
    action: 'answerPaymentAction',
    call: (v, a) =>
      tonight.answerPaymentAction({
        venueId: a.venues[0].id,
        paymentId: v.venues[0].payment,
        answering: 'close',
        answer: 'receipt_printed',
      }),
  },
  {
    action: 'sentOrderDetailAction',
    call: (v, a) =>
      night.sentOrderDetailAction({ venueId: a.venues[0].id, sentOrderId: v.venues[0].sentOrder }),
  },
  {
    action: 'paymentDetailAction',
    call: (v, a) =>
      paymentsRead.paymentDetailAction({ venueId: a.venues[0].id, paymentId: v.venues[0].payment }),
  },
]
