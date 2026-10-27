# The owner's admin map

This is the map of every screen the owner's admin has today, and the baseline each new or changed operational screen is placed on (D107, D123). A ticket that adds, moves or renames a screen updates this file in the same change.

Taps are counted from the venues list to the screen with its content visible: a tab is one tap, typing is none; counted for an owner. "Taps" is a wide screen; "Taps (phone)" is the manager's phone (D123): +1 for every tab or subtab switch (the tab bars become a dropdown below 1024 px) and +1 when the path goes through the sidebar (it sits behind a trigger below 768 px). "Open" on a venue card is tap 1 for everything inside a venue; the sidebar lists every venue and opens it from any page.

## 1. Screens

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Вход / Sign in | `/login` | Sign in with email and password. | Opens by itself when signed out. | before the list | before the list |
| Още няма организация / No organisation yet | `/no-organization` | Tells a signed-in person who belongs to no organisation that there is nothing to do yet. | Opens by itself. | before the list | before the list |
| Заведения / Venues (sidebar: Всички заведения / All venues) | `/venues` | The home screen: one card per venue with its state (Чернова / Draft or На живо / Live), address, menu source, and the buttons Отвори / Open, Преглед на менюто / Preview menu and Свали от публикация… / Unpublish… (live venues only). | Sign-in lands here; "All venues" in the sidebar or the breadcrumb from anywhere. | 0 | 0 |
| Ново заведение / New venue (dialog) | over any admin page | Make a venue in two steps: where its menu comes from (a POS, or by hand), then its name (by hand: also its languages). | "New venue" on the list; also in the sidebar. Owners and admins. | 1 | 1 |
| Композитор › Структура / Composer › Structure | `/venues/{venue}` (`?tab=composer&sub=structure`) | Arrange the menu: sections on the left (a picker on a phone), items on the right; hide, rename, reorder, move, mark sold out, add sections and items, filter by tag, tick items. Menu and layout picker on top. Unsorted holds loose items. | Open on the card; the venue's name in the sidebar. | 1 | 1 |
| Артикул (Детайли / Преводи / Медия / История) / Item sheet (Details / Translations / Media / History) | same page, `?item={item}` | Everything about one item: name, price, allergens, sold out tonight, translations, photo, what changed. | Tap an item's name in Structure (Details). Other tabs: one more tap. | 2 (other tabs 3) | 2 (3) |
| Тагове / Tags (side panel) | same page | The venue's own labels: create, edit, reorder, archive and restore. | "Tags" button in Structure. | 2 | 2 |
| Изчерпано тази вечер / Sold out tonight (dialog) | same page | The items marked sold out tonight, each with "Back on sale". | "Sold out (N)" chip in Structure; it only exists once something is marked. | 2 | 2 |
| Композитор › Дизайн / Composer › Design | `/venues/{venue}?tab=composer&sub=design` | Pick the template and its look, logo and header name, guest features, font, corners, shadow, colours, beside a phone preview. | Open, then the Design subtab. | 2 | 3 |
| Маси и QR / Tables & QR | `/venues/{venue}?tab=tables` | Areas and tables, a QR code for each, the menu each area or table shows, create all codes, print. | Open, then the tab. | 2 | 3 |
| Тази вечер › Действия и маси / Tonight › Actions and tables | `/venues/{venue}?tab=tonight` | What needs a person during service (a sent order to check, an approval, a paused table, a waiter call; the out-of-stock notice apart) and the tables, open or closed for phones, by bar, with Pause ordering. The bar tablet stays here all night. Money rows join in part 2 (#115). | Open on the venue's card, then the "Tonight" tab (after "Tables & QR"). **A staff-only sign-in lands here: 0.** | 2 (0 for staff) | 3 (0 for staff) |
| Тази вечер › Поръчки / Tonight › Sent orders | `/venues/{venue}?tab=tonight&view=sent` | Every sent order of the service day, newest first; find one by reference or table; "All · Not added"; one sent order's details in a sheet, where an Unconfirmed one is answered. | Tonight, the "Sent orders" tab. | 3 (1 from Tonight) | 4 (2 from Tonight) |
| Тази вечер › Дневник / Tonight › Log | `/venues/{venue}?tab=tonight&view=log` (`&day=YYYY-MM-DD` for an earlier night) | Everything that happened in service, newest first, by day; find by reference or table; filter by kind. | Tonight, the "Log" tab; only for roles holding `log.view` (managers and owners by default). | 3 (1 from Tonight) | 4 (2 from Tonight) |
| Тази вечер › Край на вечерта / Tonight › End of night | `/venues/{venue}?tab=tonight&view=night` (`&day=YYYY-MM-DD`) | One service day: what still needs fixing, the sent orders and the totals (part 2 adds the payments and the money follow-ups); also as CSV. | Tonight, the "End of night" tab; roles holding `night.view` (staff: sections 1–3 without tips) or `night.view_full` (managers and owners: all, and the CSV). | 3 (1 from Tonight) | 4 (2 from Tonight) |
| QR код на маса / QR code of a table (dialog) | same page | One table's code, enlarged. | Tap the code on a table card in Tables & QR. | 3 | 4 |
| Лист за печат / Print sheet | `/venues/{venue}/tables/print` | The codes on A4 pages, six to a page, to print or save as PDF. Opens in a new browser tab, without the sidebar. | "Print sheet" in Tables & QR (needs at least one code). | 3 | 4 |
| Настройки › Общи / Settings › General (of a venue) | `/venues/{venue}?tab=settings&section=general` | The venue's name and address, languages (read-only), its menus (add, rename, order, set live, delete, restore), the menu source and Sync this venue (POS venues), and for owners "Delete venue…". | Open, then Settings. Shorter: the "Manage menus" link in Structure (2 taps, also on a phone). | 2 | 3 |
| Настройки › Публикуване / Settings › Publish | `…?tab=settings&section=publish` | How a POS venue syncs its menu and whether a sync goes live by itself. Only venues with a POS. | Open, Settings, then the section. | 3 | 5 |
| Настройки › Версии / Settings › Versioning | `…?tab=settings&section=versioning` | The live version and earlier ones, with "Return to this version". | Open, Settings, then the section. | 3 | 5 |
| Публикуване / Publish (confirmation dialog, with Преглед на чернова / Preview of the draft) | any tab of the venue | See what will change for guests, preview it on a phone, publish. The Publish button and "Open the guest page" sit top right on every tab. | Publish button (with several menus: pick the menu first, one more tap). | 2 (preview 3) | 2 (3) |
| Организация › Общи / Organisation › General | `/settings/general` | The organisation's name and its address name (the part after /m/). | "Settings" in the sidebar (opens this). | 1 | 2 |
| Организация › Интеграции / Organisation › Integrations | `/settings/integrations` | The POS systems the organisation uses, a tab for each, its named connections, credentials, status and sync history. | Sidebar Settings, then the section. | 2 | 3 |
| Организация › Изтрити заведения / Organisation › Deleted venues | `/settings/deleted-venues` | Venues an owner deleted: Restore, or delete permanently. Owners only. | Sidebar Settings, then the section; also the link in the toast after deleting a venue. | 2 | 3 |
| Как да използвам собствен линк? / How do I use my own link? | `/guides/qr-links` | A written guide on the two kinds of address on a table's QR code. | Nothing in the app links to it. | ? | ? |
| Език, Тема, Изход / Language, Theme, Sign out (user menu); Организация / Organisation (switcher) | sidebar footer, every admin page | Switch the admin's language and light or dark theme, sign out; switch organisation (shown only with more than one). | Tap your name in the sidebar footer. | 1 | 2 |

Settings is two different things: the sidebar's Settings is the organisation's; the venue's Settings is a tab inside the venue.

## 2. Common stories and their taps today

The baseline rows are D107's, copied from the acceptance walk (`docs/deliverables/2026-10-18-adjustments-01-acceptance-walk.md`, line 35, "Tap counts (D107 baseline)"). Those counts start at the screen that shows the control, not at the venues list. The other rows are counted from the code, from the same starting point (the venue's tab already open). The phone count differs only where the story's own path switches a tab or goes through the sidebar.

| Story | Taps today | Taps (phone) | Starts at | Source |
|---|---|---|---|---|
| Hide or show an item | 1 | 1 | Structure | Walk, line 35 |
| Mark an item sold out tonight | 2 | 2 | Structure | Walk, line 35 |
| Rename a section | 2 plus typing | 2 plus typing | Structure | Walk, line 35 |
| Publish | 2 | 2 | any venue tab | Walk, line 35 |
| Unpublish a venue | 2 | 2 | Venues list | Walk, line 35 |
| Delete a venue | 3 | 3 | Settings › General | Walk, line 35 |
| Restore a venue | 1 | 1 | Deleted venues | Walk, line 35 |
| Delete a menu | 1 | 1 | Settings › General | Walk, line 35 |
| Move an item to another section | 3 | 3 | Structure | Walk, line 35 |
| Set a menu for an area | 2 | 2 | Tables & QR | Walk, line 35 |
| Hide or show a section | 1 (switch in its header) | 1 | Structure | `composer/item-pane.tsx` |
| Take an item back on sale | 2 (chip, then Back on sale) | 2 | Structure | `composer/sold-out-chip.tsx` |
| Add a section | 2 plus typing | 2 plus typing | Structure | `composer/new-section-dialog.tsx` |
| Add an item (venue by hand) | 2 plus typing | 2 plus typing | Structure | `composer/new-item-dialog.tsx` |
| Delete an item or a section (made by hand) | 3 | 3 | Structure | `composer/row-menus.tsx`, `composer/delete-dialog.tsx` |
| Rename an item (made by hand) | 2 plus typing ("…", Rename; the pencil on the row is 1) | same | Structure | `composer/row-menus.tsx`, `composer/rename-field.tsx` |
| Rename an item that comes from the POS | 3 plus typing? | 3 plus typing? | Structure | `composer/item-sheet-details-tab.tsx` (tap item, pencil on the row, Save) |
| Add a tag to several items | 3 (tick, Add tag…, the tag) | 3 | Structure | `composer/selection-bar.tsx` |
| Filter by tag | 2 | 2 | Structure | `composer/item-toolbar.tsx` |
| Switch to another menu | 2 | 2 | Structure | `composer/menu-bar.tsx` |
| Change the menu layout | 1 (saves at once) | 1 | Structure | `composer/menu-bar.tsx` |
| Pick a template | 2 (3 from Structure) | 2 (4 from Structure) | Design | `design/template-gallery.tsx` |
| Switch a guest feature | 2 (3 from Structure): switch, then Save | 2 (4 from Structure) | Design | `composer/guest-features-panel.tsx` |
| Add a menu | 2 plus typing (3 from Structure, via Manage menus) | same | Settings › General | `components/admin/menus-card.tsx` |
| Set a menu live | 2 | 2 | Settings › General | `components/admin/menus-card.tsx` |
| Restore a menu | 2 (open the bin, then Restore) | 2 | Settings › General | `components/admin/menus-card.tsx` |
| Return to an earlier version | 2 | 2 | Settings › Versioning | `publish/versioning-card.tsx` |
| Create codes for all tables | 1 | 1 | Tables & QR | `tables/tables-panel.tsx` |
| Move a table to another area | 2 | 2 | Tables & QR | `tables/table-card.tsx` |
| Turn a table's code off | 3 | 3 | Tables & QR | `tables/table-card.tsx` |
| Change the admin's language | 2 | 3 | any page | `components/admin/user-menu.tsx` |
| Take a waiter call (Handled) | 1, no PIN | 1 | Tonight | `tonight/action-rows.tsx` |
| Open a table for phones | 1 (Undo toast) | 1 (2 from Needs you) | Tonight | `tonight/tables-grid.tsx` |
| Open all | 1 (+ PIN on the shared tablet) | 1 | Tonight | `tonight/tonight-panel.tsx` |
| Close one table | 2 (the tile, then Close for phones) | 2 | Tonight | `tonight/table-sheet.tsx` |
| Pause ordering | 2 (the button, then the bar) | 2 | Tonight | `tonight/tonight-panel.tsx` |
| Resume a paused table, or a table with a sent order to check | 1 (+ own PIN on the shared tablet) | 1 | Tonight | `tonight/action-rows.tsx` |
| Lift a staff pause | 1 (+ a manager's PIN on the shared tablet; no button without the right on a personal session) | 1 | Tonight | `tonight/pause-banners.tsx` |
| Find a guest's sent order by its reference | 2 + typing (the tab; the search is focused) | 3 + typing | Tonight › Sent orders | `tonight/sent-orders-tab.tsx` |
| See only the sent orders that did not reach the bill | 2 (the tab, "Not added") | 3 | Tonight › Sent orders | `tonight/sent-orders-tab.tsx` |
| Answer an Unconfirmed sent order from its sheet | 3 + own PIN on the shared tablet (the tab, the row, the answer) | 4 | Tonight › Sent orders | `tonight/sent-sheet.tsx` |
| Find what happened at one table or to one sent order | 2 + typing | 3 + typing | Tonight › Log | `tonight/log-tab.tsx` |
| See only one kind of Log entry | 3 (the tab, Kind, the kind) | 4 | Tonight › Log | `tonight/log-tab.tsx` |
| See an earlier night in the Log or the end of the night | 3 (the tab, the day, the date) | 4 | Tonight › Log, End of night | `tonight/day-picker.tsx` |
| See what still needs fixing tonight | 1 (the tab; the problems are first) | 2 | Tonight › End of night | `tonight/night-page.tsx` |
| Fix a problem from the end-of-night page | 2 + own PIN on the shared tablet (the tab, the answer) | 3 | Tonight › End of night | `tonight/night-page.tsx` |
| Download the night as a CSV | 2 (the tab, "Download CSV") | 3 | Tonight › End of night | `tonight/night-page.tsx` |

## Unknowns

- Where the D107 baseline starts: the walk's counts (delete a venue 3, delete a menu 1, set a menu for an area 2) match the control's own screen, not the venues list. I read it that way; the walk does not say it.
- `/guides/qr-links` is reachable only by typing the address: no link to it is left in the app, so its taps are "?".
- Renaming an item that comes from the POS: the path through the item sheet is traced, but whether the name row is editable depends on the sheet's per-field access rule, which I did not trace.
- Left out as not the owner's admin: the guest pages (`/m/...`, `/t/...`) and the developer pages (`/dev/fields`, `/dev/item-sheet`). Whether the developer pages are closed in production was not checked.
- Counts are for an owner; an admin loses Delete venue and Deleted venues, a member sees most screens read-only.
