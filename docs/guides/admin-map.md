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
| Студио › Структура / Studio › Structure | `/venues/{venue}` (`?tab=studio`; old `?tab=composer` links redirect) | Arrange the menu: sections on the left (a picker on a phone), items on the right; hide, rename, reorder, move, mark sold out, add sections and items, filter by tag, tick items. Menu picker on top. Unsorted holds loose items. The Guest functions card sits under it. | Open on the card; the venue's name in the sidebar. | 1 | 1 |
| Артикул (Детайли / Преводи / Медия / История) / Item sheet (Details / Translations / Media / History) | same page, `?item={item}` | Everything about one item: name, price, allergens, sold out tonight, payment mode (where pay first can take effect), translations, photo, what changed. | Tap an item's name in Structure (Details). Other tabs: one more tap. | 2 (other tabs 3) | 2 (3) |
| Тагове / Tags (side panel) | same page | The venue's own labels: create, edit, reorder, archive and restore. | "Tags" button in Structure. | 2 | 2 |
| Изчерпано тази вечер / Sold out tonight (dialog) | same page | The items marked sold out tonight, each with "Back on sale". | "Sold out (N)" chip in Structure; it only exists once something is marked. | 2 | 2 |
| Студио › Дизайн / Studio › Design | `/venues/{venue}/design` (a page of its own; old `?tab=design` and `?tab=composer&sub=design` links redirect) | The venue's one design (D129), in a draft: Style tiles, the three colours and Advanced roles, body and heading fonts, logo, the layout for all menus; the live preview beside it (under it on a phone) with Phone, Tablet and PC widths; Undo, Done, Cancel. Read-only for a member who may not manage the venue. | Open, then the Design subtab. | 2 | 3 |
| Маси и QR / Tables & QR | `/venues/{venue}?tab=tables` | Areas and tables, a QR code for each, the menu each area or table shows, create all codes, print, and payment tables (a bar's table that only Restro uses to take card payments; a banner names the bars still without one; only where the POS can take payments), and pay first (one row under the menu picker of each area and table whose POS can open a bill for the first items, shown once card payments are on; never on a payment table). | Open, then the tab. | 2 | 3 |
| Тази вечер › Действия и маси / Tonight › Actions and tables | `/venues/{venue}?tab=tonight` | What needs a person during service (a sent order to check, an approval, a paused table, a waiter call, a paper receipt to bring, and for managers the storno of a refund the venue made at its provider and an open card dispute; the out-of-stock notice apart) and the tables, open or closed for phones, by bar, with Pause ordering. The bar tablet stays here all night. The money rows (a payment question, a card not charged after the bill closed, items stuck on a payment table) stand at the top of "Needs you", the paying banner stands above them and a table with a question waiting reads "Payment" in red (#115). | Open on the venue's card, then the "Tonight" tab (after "Tables & QR"). **A staff-only sign-in lands here: 0.** | 2 (0 for staff) | 3 (0 for staff) |
| Тази вечер › Поръчки / Tonight › Sent orders | `/venues/{venue}?tab=tonight&view=sent` | Every sent order of the service day, newest first; find one by reference or table; "All · Not added"; one sent order's details in a sheet, where an Unconfirmed one is answered. | Tonight, the "Sent orders" tab. | 3 (1 from Tonight) | 4 (2 from Tonight) |
| Тази вечер › Дневник / Tonight › Log | `/venues/{venue}?tab=tonight&view=log` (`&day=YYYY-MM-DD` for an earlier night) | Everything that happened in service, newest first, by day; find by reference or table; filter by kind. | Tonight, the "Log" tab; only for roles holding `log.view` (managers and owners by default). "Export" (two CSV files for a date range: sent orders, the Log) beside the day button, with `night.view_full` too. | 3 (1 from Tonight) | 4 (2 from Tonight) |
| Тази вечер › Край на вечерта / Tonight › End of night | `/venues/{venue}?tab=tonight&view=night` (`&day=YYYY-MM-DD`) | One service day: what still needs fixing, the sent orders, the payments, the money follow-ups, the refunds with their stornos, the disputes and the totals; also as CSV. A payment's sheet holds its refunds, its dispute and, for managers, the "Dispute evidence" text to copy or print (#222). | Tonight, the "End of night" tab; roles holding `night.view` (staff: sections 1–3 without tips) or `night.view_full` (managers and owners: all, and the CSV). | 3 (1 from Tonight) | 4 (2 from Tonight) |
| QR код на маса / QR code of a table (dialog) | same page | One table's code, enlarged. | Tap the code on a table card in Tables & QR. | 3 | 4 |
| Лист за печат / Print sheet | `/venues/{venue}/tables/print` | The codes on A4 pages, six to a page, to print or save as PDF. Opens in a new browser tab, without the sidebar. | "Print sheet" in Tables & QR (needs at least one code). | 3 | 4 |
| Настройки › Общи / Settings › General (of a venue) | `/venues/{venue}?tab=settings&section=general` | The venue's name and address, languages (read-only), its menus (add, rename, order, set live, delete, restore), the menu source and Sync this venue (POS venues), and for owners "Delete venue…". | Open, then Settings. Shorter: the "Manage menus" link in Structure (2 taps, also on a phone). | 2 | 3 |
| Настройки › Работно време / Settings › Hours | `…?tab=settings&section=hours` | The nights phones can order: each weekday's opening, last orders and closing; the check before opening (POS venues). Read-only without `settings.guards`. | Open, Settings, then the section. | 3 | 5 |
| Настройки › Поръчки / Settings › Ordering | `…?tab=settings&section=ordering` | The rules for ordering on the bill: open tables only, the cap per sent order, the venue's spot ("I'm at the venue"), the location check, the pace, waiter calls. Read-only without `settings.guards`. | Open, Settings, then the section. | 3 | 5 |
| Настройки › Плащане / Settings › Paying | `…?tab=settings&section=paying` (back from the provider's form: `&connection=return`, or `&connection=refresh` when its link ran out) | Connecting the venue's own card-provider account (Connect, Continue, Reconnect, Disconnect…), what is still missing before card payments can start with a fix beside each item, the smallest card payment, whether guests can tip, pay first (the item default and where it applies, shown only once card payments are on and the POS can open a bill for the first items), and the venue's legal details for the pay screen. Listed only where the venue's POS can take card payments, never at a hand-made venue; read-only without `settings.connect_payments`. | Open, Settings, then the section. Also from Tonight's lost-access banner (#115). | 3 | 5 |
| Настройки › Персонал и роли / Settings › Staff and roles | `…?tab=settings&section=staff` | The venue's people (role, PIN behind an eye, remove), its roles and what each may do, and its shared devices. Only with `settings.roles`. | Open, Settings, then the section. | 3 | 5 |
| Настройки › Известия / Settings › Alerts | `…?tab=settings&section=alerts` | Whose phones ring, the venue's Telegram group (linked from a button), and who may press Done in it. Only with `settings.alerts`. | Open, Settings, then the section. | 3 | 5 |
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
| PF6. Make one item pay first (an item without its own choice takes the venue's); saves at once with Undo, and reaches guests at the menu's next Publish | 2 (the item's name, the "Pay first" card) | 2 | Structure | `composer/item-sheet-payment-mode.tsx` |
| PF7. Make one item follow the venue's choice again ("Same as the venue"); saves at once with Undo | 2 (the item's name, the "Same as the venue" card) | 2 | Structure | `composer/item-sheet-payment-mode.tsx` |
| PF8. Set the payment mode of several items at once (one change for all of them) | 3 (tick, "Payment mode…", the mode); +1 for each further tick | 3; +1 | Structure | `composer/selection-bar.tsx` |
| Filter by tag | 2 | 2 | Structure | `composer/item-toolbar.tsx` |
| Switch to another menu | 2 | 2 | Structure | `composer/menu-bar.tsx` |
| Change the layout for all menus | 3 (Design, the layout, Done) | 3 | Studio | `design/design-page.tsx` |
| Pick a Style | 3 (Design, the tile, Done) | 3 | Studio | `design/style-tiles.tsx` |
| Change a colour | 3 plus typing (Design, the picker, Done) | 3 plus typing | Studio | `design/colour-panel.tsx` |
| Change a font | 3 (Design, the dropdown and the font, Done) | 3 | Studio | `design/design-page.tsx` |
| See the design as a tablet or a PC | 2 (Design, the width) | 2 | Studio | `design/design-preview.tsx` |
| Take back the last design step, or all of them | 1 (Undo), 1 (Cancel) | 1, 1 | Design page | `design/design-page.tsx` |
| Switch a guest feature | 2: switch, then Save | 2 | Structure (the Guest functions card under it) | `composer/guest-features-panel.tsx` |
| Add a menu | 2 plus typing (3 from Structure, via Manage menus) | same | Settings › General | `components/admin/menus-card.tsx` |
| Set a menu live | 2 | 2 | Settings › General | `components/admin/menus-card.tsx` |
| Restore a menu | 2 (open the bin, then Restore) | 2 | Settings › General | `components/admin/menus-card.tsx` |
| Return to an earlier version | 2 | 2 | Settings › Versioning | `publish/versioning-card.tsx` |
| Create codes for all tables | 1 | 1 | Tables & QR | `tables/tables-panel.tsx` |
| Move a table to another area | 2 | 2 | Tables & QR | `tables/table-card.tsx` |
| Turn a table's code off | 3 | 3 | Tables & QR | `tables/table-card.tsx` |
| PT1. Use a table as its bar's payment table (it asks first: hidden, its code stops for good), plus the password if the last sign-in is older than 15 minutes | 3 ("…", "Use as payment table", "Use as payment table" in the dialog) | 3 | Tables & QR | `tables/table-card.tsx`, `tables/use-payment-table.tsx` |
| PT2. Stop using a table as a payment table (Undo marks it again; it stays hidden and without a code) | 2 ("…", "Stop using as payment table") | 2 | Tables & QR | `tables/table-card.tsx` |
| PT3. See which bars still need a payment table | 0 (the banner at the top) | 0 | Tables & QR | `tables/tables-panel.tsx` |
| PT4. See which tables are payment tables, without the right to mark them | 0 (the badge on the card) | 0 | Tables & QR | `tables/table-card.tsx` |
| PF4. Make one area pay first, or not (or follow the venue again), from its header; saves at once with Undo, plus the password if the last sign-in is older than 15 minutes | 2 (the row's Select, the option) | 2 | Tables & QR | `tables/pay-first-picker.tsx`, `tables/area-section.tsx` |
| PF5. Make one table differ from its area, or follow it again, from its card; saves at once with Undo | 2 (the row's Select, the option) | 2 | Tables & QR | `tables/pay-first-picker.tsx`, `tables/table-card.tsx` |
| PF9. See whether an area or a table pays first, without the right to change it | 0 (the line on the header and the card, as text) | 0 | Tables & QR | `tables/pay-first-picker.tsx` |
| Change the admin's language | 2 | 3 | any page | `components/admin/user-menu.tsx` |
| Take a waiter call (Handled) | 1, no PIN | 1 | Tonight | `tonight/action-rows.tsx` |
| Mark a paper receipt Brought ("Bring the receipt", "Brought") | 1, no PIN even on the shared tablet (Undo toast) | 1 | Tonight | `tonight/action-rows.tsx` |
| Say the storno of a refund is made ("Storno done") | 1 on a manager's session, + a manager's PIN on the shared tablet (Undo toast) | 1 | Tonight | `tonight/action-rows.tsx` |
| Copy or print a card dispute's evidence ("See the evidence", "Copy as text") | 2 (the row, then the button) | 2 | Tonight, a payment's sheet | `tonight/dispute-evidence.tsx` |
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
| Open a night for phones to order (Hours) | 6 + typing (the section, the day's switch, three times, Save) | 8 + typing | Settings › Hours | `settings/hours-panel.tsx` |
| Set the venue's spot | 3 (the section, "I'm at the venue – use this spot") | 5 | Settings › Ordering | `settings/ordering-panel.tsx` |
| Connect the card-provider account (then the provider's form) | 2 (the section, "Connect {provider}"), plus the password if the last sign-in is older than 15 minutes | 4 | Settings › Paying | `settings/paying-panel.tsx` |
| See what is still missing for card payments and fix an item | 1 to read; +1 for each fix (a tick that saves with Undo, "Go to Tables & QR", "Continue in {provider}") | 3; +1 | Settings › Paying | `settings/paying-panel.tsx` |
| Reconnect after lost access | 2 (the section, "Reconnect"), then the provider's form | 4 | Settings › Paying | `settings/paying-panel.tsx` |
| Disconnect the card-provider account | 3 (the section, "Disconnect…", "Disconnect" in the dialog); refused while a guest is paying | 5 | Settings › Paying | `settings/paying-panel.tsx` |
| Raise the smallest card payment | 3 + typing (the section, the pencil, Enter) | 5 + typing | Settings › Paying | `settings/paying-panel.tsx` |
| See whether guests can tip, and why not | 1 (a line) | 3 | Settings › Paying | `settings/paying-panel.tsx` |
| Enter the venue's legal details for the pay screen | 6 + typing (the section, four fields, Save) | 8 + typing | Settings › Paying | `settings/paying-legal.tsx` |
| PF1. Make the whole menu pay first (the item default; an item's own choice still wins) | 2 (the section, the "Pay first" card's choice); saves at once with Undo, plus the password if the last sign-in is older than 15 minutes | 4 | Settings › Paying | `settings/paying-pay-first.tsx` |
| PF2. Put everything on the bill at every table, without unmarking items (the switch "Pay first at every table") | 2 (the section, the switch); saves at once with Undo | 4 | Settings › Paying | `settings/paying-pay-first.tsx` |
| PF3. See where pay first applies and how many areas and tables differ, then go to them | 1 to read (a line); +1 for "Go to Tables & QR" | 3; +1 | Settings › Paying | `settings/paying-pay-first.tsx` |
| Add a bartender with a PIN | 4 + typing (the section, Add person, the name, Add) | 6 + typing | Settings › Staff and roles | `settings/staff-people.tsx` |
| Link the venue's Telegram group | 4 (the section, the button, pick the group in Telegram, Add) | 6 | Settings › Alerts | `settings/alerts-panel.tsx` |
| Export a date range of sent orders or the Log | 3 + dates (the tab, Export, Download) | 4 + dates | Tonight › Log | `tonight/log-export.tsx` |
| See what still needs fixing tonight | 1 (the tab; the problems are first) | 2 | Tonight › End of night | `tonight/night-page.tsx` |
| Fix a problem from the end-of-night page | 2 + own PIN on the shared tablet (the tab, the answer) | 3 | Tonight › End of night | `tonight/night-page.tsx` |
| Download the night as a CSV | 2 (the tab, "Download CSV") | 3 | Tonight › End of night | `tonight/night-page.tsx` |
| Answer "Payment not confirmed" ("Receipt printed" / "No receipt"), or a pay-first round ("On the till" / "Not on the till"), or "Items not back on the table" | 1 (+ a manager's PIN on the shared tablet; no button on a waiter's own phone) | 1 | Tonight | `tonight/money-rows.tsx` |
| See that a payment is waiting on a manager | 0 | 0 | Tonight | `tonight/money-rows.tsx` |
| Mark items stuck on a payment table as moved back, or a payment stopped before closing as seen | 1 (+ own PIN on the shared tablet) | 1 | Tonight | `tonight/money-rows.tsx` |
| Mark a card not charged after the bill closed (or a hold that ran out, or one not released) as sorted | 1 (+ a manager's PIN on the shared tablet) | 1 | Tonight | `tonight/money-rows.tsx` |
| See that card payments in the app are paused | 0 (the banner) | 0 | Tonight | `tonight/pause-banners.tsx` |
| Reconnect the payment account after lost access | 2 to the provider's form (the banner's "Reconnect", then "Reconnect" on Settings › Paying), plus the password if the last sign-in is older than 15 minutes | 2 | Tonight, Settings › Paying | `tonight/pause-banners.tsx` |
| See the paper receipts never brought at closing (table and payment number, no amount) | 1 (the tab; they join the problems at the top) | 2 | Tonight › End of night | `tonight/night-payments.tsx` |
| Find the payments that still need fixing at closing | 1 (the tab; they join the problems at the top) | 2 | Tonight › End of night | `tonight/night-payments.tsx` |
| Read the night's payments, money alerts and answers, refunds and disputes | 1 (the tab; the totals are last) | 2 (+1 for the "Totals" link) | Tonight › End of night | `tonight/night-payments.tsx` |
| Find what happened to one payment (Log, Kind: Money; its sheet) | 3 (4 with the sheet) | 4 | Tonight › Log | `tonight/payment-sheet.tsx` |

## Unknowns

- Where the D107 baseline starts: the walk's counts (delete a venue 3, delete a menu 1, set a menu for an area 2) match the control's own screen, not the venues list. I read it that way; the walk does not say it.
- `/guides/qr-links` is reachable only by typing the address: no link to it is left in the app, so its taps are "?".
- Renaming an item that comes from the POS: the path through the item sheet is traced, but whether the name row is editable depends on the sheet's per-field access rule, which I did not trace.
- Left out as not the owner's admin: the guest pages (`/m/...`, `/t/...`) and the developer pages (`/dev/fields`, `/dev/item-sheet`). Whether the developer pages are closed in production was not checked.
- Counts are for an owner; an admin loses Delete venue and Deleted venues, a member sees most screens read-only.
