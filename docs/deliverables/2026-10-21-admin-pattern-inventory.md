> Filed 2026-10-21. Made by: a Sonnet agent session, for the lead. For: D123, the Patterns section of `docs/guides/operational-screens.md`. Status: see `docs/deliverables.md`.

# Inventory of the UI patterns the owner's admin uses today

Read from the code under `apps/web/src/` on 2026-10-21, one row per job. "Two" or more in the last column means the admin uses that many different patterns for the same kind of job; the Patterns section of the operational-screens guide picks one per job from these and lists the rest as divergences.

| Job | Pattern today (component) | Patterns for one job |
|---|---|---|
| Hide or show | Item: switch, saves at once (`composer/item-row.tsx`). Section: switch in the header plus a "…" item (`item-pane.tsx`, `row-menus.tsx`). Table or area: "…" item with a toast (`tables/table-card.tsx`) | two |
| Sold out tonight | "…" item (`row-menus.tsx`); chip opening a dialog list (`sold-out-chip.tsx`); button in the item sheet (`item-sheet-sale.tsx`) | three |
| Rename | Pencil to an inline field (`rename-field.tsx`); pencil to an inline form with Save (`components/admin/menus-card.tsx`); always-open input saved on blur (`tables/area-section.tsx`); input plus Save (`venue-name.tsx`, `design/header-name-field.tsx`); a POS item through the field-editor side sheet | five |
| Reorder | Drag handle with keyboard (`section-tree.tsx`, `tags-panel.tsx`); up and down arrow buttons (`menus-card.tsx`); "…" → Move up / Move down (`tables/area-section.tsx`) | three |
| Move an item elsewhere | Drag onto a tree row, or "…" then a "Move to…" submenu (`row-menus.tsx`); a table uses flat "…" items | two |
| Add a section | Dialog (`composer/new-section-dialog.tsx`) | one |
| Add a menu | Button reveals an inline form (`menus-card.tsx`); items and sections use dialogs | two |
| Delete a menu | Row button, no confirmation; a bin with Restore in a collapsible; an inline note (`menus-card.tsx`) | one |
| Publish | Button, or a dropdown of menus, then a confirm dialog, then a dismissible inline banner (`publish/publish-bar.tsx`, `publish-confirm.tsx`, `outcome-note.tsx`) | one |
| Unpublish | Card button, a dialog listing the effects, a toast (`unpublish-venue-dialog.tsx`) | one |
| Delete a venue | Danger-zone section, typed-name dialog, toast with a link (`venue-danger-zone.tsx`, `delete-venue-dialog.tsx`) | one |
| Restore a venue | Row button, toast (`deleted-venues-list.tsx`) | one |
| Pick a template | Collapsible card gallery with "Use", or a phone-preview dialog with Use (`design/template-gallery.tsx`) | one |
| Switch a guest feature | Switches plus a Save button (`composer/guest-features-panel.tsx`); the layout switch and the look options save at once (`menu-bar.tsx`, `design/look-options.tsx`) | two |
| Venue languages | Checkboxes and a Select at creation only (`new-venue-dialog.tsx`); read-only afterwards | one |
| Filter the composer | "Filter by tag" dropdown with checkbox items, plus removable chips (`composer/item-toolbar.tsx`) | one |
| Error after a write | Toast with rollback (`composer.tsx`, `tables/use-run.ts`); inline red text in cards, dialogs and the save bar; a banner for publish | many |
| Empty list | Empty-state block (`venues/page.tsx`, `item-pane.tsx`); a plain sentence (`menus-card.tsx`, `area-section.tsx`) | two |
| Unsaved edits | Save disabled until something changed; Design shows "Unsaved" in a sticky bar; no leave-page guard anywhere | one |
| Pick one of a few | Segmented (`design/segmented.tsx`); Select (font, route picker); radio cards (`publish/automation-settings.tsx`); range slider (radius, shadow) | four |
| Confirm a destructive action | Red-button dialog (`composer/delete-dialog.tsx`, `tables/confirm-dialog.tsx`); typed name (venue delete, purge); none (menu delete, hide) | three |

Patterns on screens the list above does not name: a side sheet (the item sheet, Tags, the field editor; only the field editor becomes a bottom drawer on a phone); a floating bulk-selection bar (`selection-bar.tsx`); collapsibles, in four places; page-wide warning banners (held, paused, address off); radio items inside a dropdown (`user-menu.tsx`); the help line of the name and conflict badges in a hover card (`composer/badges.tsx`).

No toast with undo exists anywhere, although D107 prefers undo to confirmation.
