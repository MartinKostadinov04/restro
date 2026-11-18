# Functionality by POS dependence — menu, admin and reservations

**Asked for:** Martin, 2026-11-10, through the connector-architecture session: every function Restro
supports, classified by what happens when a POS cannot exchange the data it needs. This file is one
part of four (ordering/Tonight/tables, paying, and the designer/Log/roles/backups parts are other
leads'). The merged list goes to an independent Fable reviewer.

**The question answered here is capability only:** can the POS send or receive this data at all.
Whether the data can be *trusted* once it flows is a later pass and is left out.

**Levels** (Martin's definitions of 11-10): **DEAL BREAKER** — the POS cannot exchange what a key
function needs, so the function cannot run; also a gap staff can only fill per order or per payment.
**SURVIVABLE** — the key functions still run and staff fill the gap a few times a night with little
effort. **COVERED** — the owner fills it once at setup, no night effort. **NOT POS-RELATED** — the
function exchanges nothing with the POS.

**Two reading notes.** (1) Reservations decisions 134–141 live on the `rv/foundation` branch, so
their numbers are written here without the `D`: the repository's citation guard fails a `D<n>` whose
file is not on the branch this file sits on. (2) Rows marked *(not built)* are specified and
ticketed but not merged; their "if the POS can't" column says what the specification says, not what
runs today. The capability matrix in
`docs/deliverables/2026-11-10-connector-architecture-review.md` §3.2 is the source for the menu
rows' vendor facts; counts for a typical club night are rough and marked unknown where I have none.

## Menu import and sync (POS → Restro)

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Read the venue's sellable items with their prices | Menu | item id, name, price for this venue | POS→Restro | setup, then every scheduled sync; 1–4 full reads a night plus a daily one | nothing (no menu capability exists at all — review §3.2 gap 1) | nothing: the venue has no POS menu, and its source cannot be changed afterwards | **DEAL BREAKER** — key function 1 is this row | D87; `packages/core/src/sync/`, `packages/barsy/src/read/reader.ts` |
| 2 | Public item name, per language | Menu | a public name field distinct from the till name | POS→Restro | every sync | nothing (gap) | the till's own name is shown and the composer warns (D75); no name at all → the item is hidden | **COVERED** — the owner renames over it once in the composer; nothing to do during a night | D75, D92; review §3.2 |
| 3 | Price per venue (base, and the price in force now) | Menu, Order | price, per venue where the POS has several | POS→Restro | every sync | nothing (gap) | an item with no locked price is never orderable | **DEAL BREAKER** — a menu with no prices is not a menu, and nothing may be ordered | D91; review §3.2 |
| 4 | Sections and the venue's menu root | Menu | category tree, and which root belongs to this venue | POS→Restro | every sync | nothing (gap) | everything lands in Unsorted | **COVERED** — the owner builds his own sections once (D92); items keep arriving into them | D88, D92, D95 |
| 5 | Options and modifiers **with their rules** (required, min, max, default) | Order | option groups linked to items, and each group's rule | POS→Restro | every sync | `modifiers` is proposed; today the rules ride on `notesReachTicket` | an item is orderable without the options it needs, or by D122 §4 it goes waiter-only | **DEAL BREAKER** for items that have options — the gap is filled per order, which is the definition; the rest of the menu is unaffected | D122 §4; review §3.2 |
| 6 | Allergens | Menu | an allergen code per item | POS→Restro | setup, then every sync | nothing (gap) | nothing is shown unless the owner enters it | **COVERED** — the owner's own allergens (D89), with a composer notice that the POS gives none | D82, D89; review §3.2 |
| 7 | Item images | Menu | a picture per item, or a URL | POS→Restro | setup, then every sync | nothing (gap) | the owner uploads his own | **COVERED** | D89; review §3.2 |
| 8 | Sold out / availability of an item | Menu | an on-sale flag per item (per venue) | POS→Restro | every sync, and ideally before a Send | `itemAvailability` on the service side; the menu side is a gap | **undefined today: nobody can mark an item sold out on a POS venue** (D124 §6) — the owner's switch is hidden where a POS source is declared | **SURVIVABLE**, but only once the owner's switch returns: a handful of taps a night. Left as it is, the bar refuses drinks per order, which is a deal breaker | D46, D124 §6; `packages/core/src/apply/sold-out.ts`; review §3.2 |
| 9 | Time-based prices (happy hour, a late-night tariff) | Menu | the price rule, or the price in force at the read | POS→Restro | every sync; boundaries can be missed by up to one sync interval | nothing (gap) | the base price is shown; the POS prices the round when it rings it | **SURVIVABLE** — the guest may see yesterday's tariff for minutes; Restro must never compute a POS's time rule itself | review §3.2 (Prices); D122 |
| 10 | An item that disappeared from the POS is taken off the menu | Menu | either a delete flag, a tombstone, or a complete full read | POS→Restro | at every complete full read | the engine's rule 6 | absence after a **complete** full read concludes deletion; a read with any failed page concludes nothing | **SURVIVABLE** — works from absence alone where no flag exists; a delete flag only makes it faster | rule 6 (CLAUDE.md); `packages/core/src/sync/conclude-full-pull.ts` |
| 11 | Hold an item that vanished mid-sync instead of deleting it | Menu | none — Restro's own caution | none | per sync | the engine | n/a | **NOT POS-RELATED** — this is how Restro reacts to a POS, not something it asks of one | `packages/core/src/sync/absence-hold.ts` |
| 12 | Sync scheduling: full reads, their window, and what a connector reports back | Admin | a list endpoint it can call repeatedly | POS→Restro | per venue, per night | integration layer | no sync at all (row 1) | **DEAL BREAKER** with row 1; on its own the schedule is Restro's | D41; `packages/core/src/sync-schedule.ts`, `packages/core/src/jobs.ts` |
| 13 | Instance settings: one connection's host, API user and what it covers | Admin | the POS must have an API, and an account model for one | both | once at setup, re-checked on change | D82; rule 9 | nothing connects, so no key function runs | **DEAL BREAKER** — this is the door all three key functions come through | D82, rule 9 |

## The composer and enrichment (Restro's own layer)

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 14 | Hide an item or a section from the guest menu | Menu | none | none | setup, and a few times a season | rule 5 (we only ever make the menu more cautious) | n/a | **NOT POS-RELATED** | rule 5; D64 |
| 15 | Rename over the POS's text, reorder, move an item to another section | Menu | none | none | setup | D92 (Structure subtab) | n/a | **NOT POS-RELATED** — and it is the fallback for rows 2 and 4 | D92, D75 |
| 16 | Add Restro's own sections and enrichment on a POS venue (never create, delete or re-price the POS's items) | Menu | none | none | setup | D64, D87, D89 | n/a | **NOT POS-RELATED** | D64, D87, D89 |
| 17 | A hand-made venue: full create, edit and delete of menus, sections and items | Menu, Admin | none | none | setup, then whenever the owner likes | D89 | n/a | **NOT POS-RELATED** — and the only answer for a POS with no readable menu at all (row 1), chosen at creation | D87, D89 |
| 18 | Design: template choice, theme, the look of the guest page | Admin | none | none | setup | D92 (Design subtab), D105 | n/a | **NOT POS-RELATED** | D92, D105 |
| 19 | Guest features switched on per venue (the service screens the template carries) | Admin | none, per se — each feature's own row says what it needs | none | setup | D71, D100 | n/a | **NOT POS-RELATED** at this level; the features themselves are other parts' rows | D71, D100; `packages/core/src/apply/guest-features.ts` |
| 20 | Languages a venue publishes in | Menu, Admin | none (POS names arrive in whatever it has — row 2) | none | setup | nothing | n/a | **NOT POS-RELATED** | `packages/core/src/apply/languages.ts` |

## Publishing, snapshots and the live overlay

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 21 | Publish a venue: build the snapshot and the indexes and write the files | Menu | none | none | on every publish; several a day at setup, rarely afterwards | nothing | n/a | **NOT POS-RELATED** | `packages/core/src/apply/publish.ts:684`, `packages/core/src/snapshot/build.ts` |
| 22 | The leak guard: no POS id, internal name, cost price or internal field reaches a published file | Menu | none | none | every publish | rule 3, D75's one exception | n/a | **NOT POS-RELATED** — a rule about what must *not* travel | rule 3, D75; `packages/core/src/snapshot/leak-guard.ts` |
| 23 | The live overlay: what changes between publishes (sold out above all) | Menu | the data in it comes from row 8 | POS→Restro for its contents | continuously during a night | as row 8 | the overlay runs with nothing in it | **NOT POS-RELATED** as a mechanism; its usefulness is row 8's | `packages/core/src/snapshot/overlay.ts` |
| 24 | Publish pause, and the rules that decide a venue may publish | Admin | none | none | rare | nothing | n/a | **NOT POS-RELATED** | `packages/core/src/apply/publish-pause.test.ts`, `packages/core/src/apply/venue-publish-rules.ts` |

## The guest menu page

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 25 | The guest page reads only published files, never the database | Menu | none | none | every guest; hundreds a night | rule 4 | n/a | **NOT POS-RELATED** | rule 4 |
| 26 | A scanned code resolves to the right menu: venue → area → table | Menu | the POS's tables, on a POS venue (a place needs its POS id) | POS→Restro | setup, and when the floor changes | D95; `readsFloor(kind)` | a POS venue gets no tables from the POS; hand-made tables are allowed for the menu and Call a waiter, but ordering onto a bill needs the POS's own table | **SURVIVABLE** for the menu — the owner makes the tables once; ordering is the ordering part's row | D95, D88; review §3.2 (Tables and bars) |
| 27 | Language choice, allergen filter, search and the rest of the guest's reading | Menu | none | none | every guest | nothing | n/a | **NOT POS-RELATED** | D38, D105 |

## Venues, integrations and the venue's source

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 28 | List the POS's own venues so the owner can link one | Admin | a venue or installation list | POS→Restro | once at setup | the connector | unknown whether every POS can list them; a connector could take a venue id typed by hand instead | **COVERED** where an id can be typed in; **DEAL BREAKER** where neither a list nor an id identifies the venue. *Unknown per POS* | D82, D90; `packages/core/src/connectors/till-venues.ts`, `packages/core/src/apply/barsy-venues.ts` |
| 29 | A venue's source is fixed when it is created | Admin | none | none | once | D87 | n/a | **NOT POS-RELATED** — but it is why rows 1 and 13 are deal breakers rather than degradations: the choice cannot be revisited later | D87 |
| 30 | Unlink a POS venue, and re-link it on restore if its till venue is still free | Admin | the POS venue must still exist and be unclaimed | POS→Restro | rare | D90, D83 | the restore is refused and the owner is told why | **SURVIVABLE** — rare, and it fails loudly rather than silently | D83, D90; `packages/core/src/apply/unlink.ts`, `packages/core/src/apply/venue-lifecycle.ts` |
| 31 | Read the POS's floor: areas (halls) and tables | Admin | a place list with ids, and which area each one is in | POS→Restro | setup, and when the floor changes | `readsFloor(kind)`, implicit in which kinds have a connector (review §3.2 gap 2) | hand-made tables, menu and Call a waiter only | **SURVIVABLE** for the menu tier; see the ordering part for the bill | D95; `packages/core/src/floor-source.ts`, `packages/core/src/apply/till-tables.ts` |
| 32 | Which bar serves which table | Order, Staff | a bar per place | POS→Restro | setup | `tableBar` | no bar: tickets per bar, per-bar pauses and payment tables per bar do not apply | **SURVIVABLE** — built, and the venue runs as one bar | D124 §1; review §3.2 |
| 33 | What a connector declares it can do (the capability flags themselves) | Admin | none | none | per connector release | the capability config | n/a | **NOT POS-RELATED** — this is where the answer to every other row is recorded | D122 §10; `packages/core/src/service-capabilities-config.ts`, `packages/barsy/src/service/capabilities.ts` |
| 34 | What a sync job reports: counts, warnings, and what failed | Admin | error and page information from the read | POS→Restro | every job | rule 6 | a job that cannot say what failed concludes nothing | **SURVIVABLE** — the cost is a slower, more cautious sync | rule 6; `packages/core/src/jobs.ts` |

## Reservations (`rv/*`)

Reservations are Restro's own data end to end: no reservation command calls a POS, and a POS bill
closing changes nothing about a reservation (134; `packages/core/src/service/reservations/book.ts:1`).
The two places they meet a POS are the door (row 39) and the table's bill (row 40), and both of
those belong to ordering's seam rather than to reservations'.

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 35 | The venue's reservation settings: hours, turn time, whether a phone is required | Staff, Admin | none | none | setup | 135 | n/a | **NOT POS-RELATED** | 135; `#325` |
| 36 | The night's list and the reservation sheet | Staff | none | none | continuously through a night | 135, 137 | n/a | **NOT POS-RELATED** | 135, 137; `#326` |
| 37 | The floor plan: spots, their kinds, shapes, and blocking a spot | Staff | the spots may be the POS's tables on a POS venue (row 31) | POS→Restro for the tables only | setup; blocks a few times a night | 137 | the owner draws the plan on hand-made spots | **SURVIVABLE** — one setup job, and the plan then runs with no POS at all | 137; `packages/core/src/spot-shapes.ts`; `#327` |
| 38 | Taking and changing a booking: create, edit, cancel, no-show, delete, restore, copy | Staff | none | none | 20–80 bookings a night; unknown for the pilot | 135, 141 | n/a | **NOT POS-RELATED** | 135, 140, 141; `packages/core/src/service/reservations/book.ts`; `#328` |
| 39 | Arrivals and seating: marking a party present, which also opens their tables for phones | Staff, Order | nothing to mark them present; opening the table for ordering needs the POS's table and a readable bill | POS→Restro | 20–60 arrivals a night | ordering's own open path | *(not built, `#329`)* the party is still marked Seated and one line says the table stayed closed for phones; the menu still works | **SURVIVABLE** for the door; **DEAL BREAKER** for the ordering half, which is the ordering part's row | 137, D122 §1; `#329` |
| 40 | The open-bill warning at arrival and at freeing a table | Staff, Order | the table's bill with its lines | POS→Restro | once per arrival and per freeing where there is a bill | the readable-bill seam (review §3.2 gap 2) | *(not built, `#329`)* the warning cannot fire; where ordering is hidden there is also no Restro order to land wrongly | **SURVIVABLE** — the warning exists to protect ordering, which is itself hidden when the bill cannot be read | D122 §1, 134; `#329` |
| 41 | Freeing a party's spots, waiting for a payment still in flight | Staff, Pay | none from the POS — the payment state is the provider's | none | per departure | D125, D127 | n/a | **NOT POS-RELATED** at this seam; closing the bill in the POS is the paying part's row | D125, D127; `#329` |
| 42 | The waiting list, and changing a party's tables | Staff | none | none | a few to a dozen a night | 137 | n/a | **NOT POS-RELATED** | 137; `#330`, `#331` |
| 43 | Ending the night: the preview, and what it closes | Staff | none | none | once a night | 138 | n/a | **NOT POS-RELATED** | 138; `#332` |
| 44 | Guest records and regulars: the venue's list, a manager's own private notes, erasing a guest | Staff, Admin | none — a phone number lives only in Restro's own record | none | per booking; erasure is rare | 140, D83 | n/a | **NOT POS-RELATED** — and deliberately so: no guest detail is ever sent to a POS | 140, D83; `packages/core/src/service/reservations/guests.ts`; `#333` |
| 45 | The pay rule a reservation carries (what the guest meets when he orders) | Pay, Staff | none to store it; what it then allows is the paying seam's | none | per booking | D122 §5 | n/a | **NOT POS-RELATED** at this level | D122 §5; `#334` |

## Organisation level

| # | Function | Tier | POS data needed | Direction | When / how often | Gated today by | If the POS can't | Proposed level + reason | Sources |
|---|---|---|---|---|---|---|---|---|---|
| 46 | Organisation › General: the organisation, its venues and its details | Admin | none | none | setup | D91 | n/a | **NOT POS-RELATED** | D91; `packages/core/src/apply/organization.ts` |
| 47 | A venue's legal details and address | Admin | none | none | setup | nothing | n/a | **NOT POS-RELATED** | `packages/core/src/legal-details.ts`, `packages/core/src/apply/venue-address.test.ts` |
| 48 | Deleting a venue: restorable for 30 days, then purged | Admin | none (the re-link on restore is row 30) | none | rare | D83 | n/a | **NOT POS-RELATED**; the purge job itself belongs to the auditing part | D83 |

## What I was unsure belongs to my area

1. **Rows 26, 31 and 32 (tables, areas, the bar)** sit between my area and the ordering lead's. I
   have written them from the *menu* side only — a code resolving to a menu, and a plan with spots —
   and left the bill and the ordering half to that part. They need merging, not stacking.
2. **Row 19, guest features as venue settings,** is mine as a setting, but each individual feature
   (bag, bill, call a waiter, pay, receipt) is another part's row.
3. **Row 44, guest records,** is in my reservations area but also in the auditing lead's brief
   (guest events, the Log, personal data). The row here is the capability answer only; the
   no-personal-data rule for events is theirs.
4. **Row 8, sold out,** is the one row in my area whose level depends on a decision nobody has
   taken: today nothing can be marked sold out on a POS venue. I have proposed SURVIVABLE on the
   assumption the owner's switch returns, and said plainly what it is without it.
5. **Rows 39 to 43 and 45 are specified but not merged.** Their columns describe the specification.
   If the reviewer wants only what runs today, those rows should be read as "undefined".
