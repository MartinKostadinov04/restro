# Decisions index
One line per decision, every decision ever made (D-numbers are never reused or renumbered). The full text of each is its own file in `docs/decisions/D<n>.md`, which wins on any difference. Read only the files your ticket names and any D-number cited in the code you change; never all of them.

Status: **firm** (agreed), **applied** (done or in force), **pending** (stated or wanted, not yet firm), **direction** (Martin's decision on where a feature goes; agents build nothing on it until its own grilling, named in the file, has happened), **refined by D<n>**, **superseded by D<n>**. A superseded or refined decision keeps its file; the file says which decision changed it.

| ID | Title | Status |
|---|---|---|
| [D1](decisions/D1.md) | Target segment: nightclubs in Bulgaria | pending (unvalidated) |
| [D2](decisions/D2.md) | MVP lean enough for one person to hold in their head | firm |
| [D3](decisions/D3.md) | No extra friction against walk-outs | pending (stated) |
| [D4](decisions/D4.md) | Order-first MVP: self-ordering, multi-tenant online payments, receipts | firm |
| [D5](decisions/D5.md) | An order holds many items and is paid when placed | superseded by D111, D112 and D113 |
| [D6](decisions/D6.md) | Pilot clubs all run barsy | firm |
| [D7](decisions/D7.md) | Pilot: our software free | pending (at risk) |
| [D8](decisions/D8.md) | Tips: optional line on payment, paid out to the venue, which distributes them | firm |
| [D9](decisions/D9.md) | Guests need no app and no account | firm |
| [D10](decisions/D10.md) | Menu languages: all barsy holds plus ones added by hand | firm (refined 10-08); refined by D77 (only languages with filled texts); Q65 |
| [D11](decisions/D11.md) | No in-app age check; the door handles it | firm; Q66 |
| [D12](decisions/D12.md) | Own waiter view only for venues without barsy, billed separately | firm |
| [D13](decisions/D13.md) | Paid orders go to barsy without our own staff-confirmation step | superseded by D116; see D18, Q38, Q49 |
| [D14](decisions/D14.md) | Guests can split the bill in the web app | firm; refined by D112 |
| [D15](decisions/D15.md) | Config-driven app: venue data rendered by a visual shell changeable per customer | applied |
| [D16](decisions/D16.md) | Sync a copy of barsy's data into our own model | applied |
| [D17](decisions/D17.md) | Architecture = the Menu Engine doc including its nine rules | applied |
| [D18](decisions/D18.md) | The waiter must learn of every app order inside the venue's existing barsy setup,… | firm |
| [D19](decisions/D19.md) | Payment route: barsy's payment link if it supports Apple/Google Pay, split payments… | pending (Q39, Q55, Q58) |
| [D20](decisions/D20.md) | Our own section map, generated from barsy's category tree, editable per venue | firm; see D47 |
| [D21](decisions/D21.md) | New barsy items publish automatically | firm; see D50 |
| [D22](decisions/D22.md) | Sold-out items are greyed out with no order button | firm; source is D46 |
| [D23](decisions/D23.md) | TypeScript end to end | firm |
| [D24](decisions/D24.md) | A missing language is added by hand in the translations tab | firm |
| [D25](decisions/D25.md) | Legal checks per country | firm |
| [D26](decisions/D26.md) | A venue may opt in to push our translations into barsy, only if the API allows it | pending (wanted); back-office write, needs its own decision (D110) |
| [D27](decisions/D27.md) | Table access in v0: the QR token only | superseded by D118 |
| [D28](decisions/D28.md) | Delivery in v0: to the table only | firm |
| [D29](decisions/D29.md) | Ordering mode per item, set by the owner | firm; refined by D113 |
| [D30](decisions/D30.md) | Time for other guests to pay their share of a split order | reopened by D112; decided with the bill screen; P42 |
| [D31](decisions/D31.md) | Venue stats: first research what barsy exposes, then ask owners | firm |
| [D32](decisions/D32.md) | Store every payment at the finest grain so any disaggregation is possible | firm |
| [D33](decisions/D33.md) | A barsy test installation | firm |
| [D34](decisions/D34.md) | No loyalty accounts in v0 | firm |
| [D35](decisions/D35.md) | Traffic is low: choose the cheapest effective option | firm |
| [D36](decisions/D36.md) | Stack per the doc's Stack tab | refined by D38, D41, D43 |
| [D37](decisions/D37.md) | The architecture doc stands alone | applied |
| [D38](decisions/D38.md) | Channel: QR to phone only | firm |
| [D39](decisions/D39.md) | Staged proof of concept on one venue | firm |
| [D40](decisions/D40.md) | Build the doc's document model plus a generic shell/face contract | firm |
| [D41](decisions/D41.md) | barsy freshness by polling | firm; refined by D110 |
| [D42](decisions/D42.md) | Allergens are a plain EU-14 enum_set attribute | firm |
| [D43](decisions/D43.md) | Supabase Postgres only, free plan, restro-staging and restro-prod, Data API off | refined by D54 |
| [D44](decisions/D44.md) | E:\Restro is the repo | firm |
| [D45](decisions/D45.md) | Service day ends 07:00 local, per venue | firm |
| [D46](decisions/D46.md) | Sold out: barsy's for-sale flag is the source | firm |
| [D47](decisions/D47.md) | Composer: the barsy menu lands pre-mapped | firm; refined by D90 (POS venues: reorder, rename, hide; no own sections) |
| [D48](decisions/D48.md) | Lead writes briefs and reviews every diff | firm; refined by D58 |
| [D49](decisions/D49.md) | The Synex Platform is the reference for document → view engine, management and navigation | firm; refined by D51 |
| [D50](decisions/D50.md) | Defaults unless vetoed | applied; refined by D88 (several menus per venue) |
| [D51](decisions/D51.md) | Platform code and patterns may be reused, ported to TypeScript | firm |
| [D52](decisions/D52.md) | pnpm 10.34.6 and Node 24.21.0 pinned per repo via use-node-version | applied |
| [D53](decisions/D53.md) | Local Postgres without Docker | applied |
| [D54](decisions/D54.md) | restro-staging is in West EU | applied |
| [D55](decisions/D55.md) | Stage 2 plan approved | firm |
| [D56](decisions/D56.md) | Read public catalogue data only | firm; refined by D88 (a venue's menus are barsy's designated roots) |
| [D57](decisions/D57.md) | Menu photos in private R2 bucket restro-assets-staging | applied |
| [D58](decisions/D58.md) | Haiku for simple exactly specified tasks, Sonnet by default, Opus only for genuinely… | firm; refined by D104 (planning tiers) |
| [D59](decisions/D59.md) | Publishing is a sync setting | firm; refined by D82 (allergen key per instance) and D77 (languages) |
| [D60](decisions/D60.md) | Venue-defined tags and dietary labels are assigned in the composer and shown on the… | firm |
| [D61](decisions/D61.md) | QR links: ours (/t/<token>, default) or the venue's own link, both supported with a… | firm; refined by D80 (custom domains) |
| [D62](decisions/D62.md) | Stage 3 plan approved | firm |
| [D63](decisions/D63.md) | Guest menu design comes from Martin's Lovable shell | superseded by D105 |
| [D64](decisions/D64.md) | Restro is not barsy-only | firm (direction); shape pending |
| [D65](decisions/D65.md) | Spreadsheet import dropped | firm |
| [D66](decisions/D66.md) | In a venue with a till, the till is the only source of items | firm |
| [D67](decisions/D67.md) | Guardrails only tighten | applied |
| [D68](decisions/D68.md) | Public address <base>/m/<slug>-<code> | refined by D84 (clean addresses; the code is internal only) |
| [D69](decisions/D69.md) | Template gallery: a venue picks a face in the Design tab | firm |
| [D70](decisions/D70.md) | Venue colours: Primary ~60%, Secondary ~30%, Tertiary ~10% | firm |
| [D71](decisions/D71.md) | Guest features are venue settings in the composer | firm; refined by D100 |
| [D72](decisions/D72.md) | Faces stay pure: a face draws the host's service state and sends commands with an… | firm |
| [D73](decisions/D73.md) | What is set once for the organisation and what per venue | firm |
| [D74](decisions/D74.md) | The sidebar lists the venues and the organisation's Settings | firm |
| [D75](decisions/D75.md) | When barsy has no public name for an item, option or category, Restro shows barsy's… | firm |
| [D76](decisions/D76.md) | Deleting a venue (owners, after typing its name) archives it | firm |
| [D77](decisions/D77.md) | A venue's menu languages come from one core function every workflow calls | firm |
| [D78](decisions/D78.md) | Superseded by D87: a venue's source never changes | superseded by D87 |
| [D79](decisions/D79.md) | The pilot's till is Mistral / Zamboo | firm |
| [D80](decisions/D80.md) | Custom domains (owner self-service, subdomains only, guest menu and table codes only) | firm |
| [D81](decisions/D81.md) | Settings › Integrations is source-agnostic now | firm |
| [D82](decisions/D82.md) | Instance settings = the whole connection | firm |
| [D83](decisions/D83.md) | A deleted venue is restorable 30 days, then purged by a worker job | firm |
| [D84](decisions/D84.md) | Guest address = <our domain>/m/<organisation>/<venue> | firm |
| [D85](decisions/D85.md) | New venue: from a POS, pick instance and venue, nothing typed | firm |
| [D86](decisions/D86.md) | Venue states: Draft | firm |
| [D87](decisions/D87.md) | A venue's source is fixed at creation | firm |
| [D88](decisions/D88.md) | A venue holds several menus, exactly one live | firm; refined by D95 (one menu per code: venue → area → table) |
| [D89](decisions/D89.md) | Hand-made venues: full create/edit/delete of menus, sections and items | firm |
| [D90](decisions/D90.md) | Restore re-links a POS venue's till venue if still free, else refused | firm |
| [D91](decisions/D91.md) | Organisation › General | firm |
| [D92](decisions/D92.md) | Composer has Structure and Design subtabs | firm |
| [D93](decisions/D93.md) | Colour upgrades with D92 | firm |
| [D94](decisions/D94.md) | Tables & QR shows the codes' address read-only | firm |
| [D95](decisions/D95.md) | Areas and tables: barsy's halls and tables | firm |
| [D96](decisions/D96.md) | Versions: live + up to 2 restorable, non-live purged after 30 days, change log 2 months | firm |
| [D97](decisions/D97.md) | Venue page tabs: Composer | firm |
| [D98](decisions/D98.md) | Payments are a connector kind; the venue is the merchant; Restro never holds money | firm |
| [D99](decisions/D99.md) | Song requests: a paid priority queue the DJ runs, holds captured on accept | direction; prototype to be ported (T82), access to be grilled (T81) |
| [D100](decisions/D100.md) | A guest feature declares whether it needs a table code | firm; refines D71 |
| [D101](decisions/D101.md) | Reservations become a module of the platform on Areas and Tables, hosted page first | direction; after ordering from the menu (T83) |
| [D102](decisions/D102.md) | The night promise: the menu never goes down; everything else degrades to paused and alerts | firm; refined by D120 (push alerts, the outside watchdog) |
| [D103](decisions/D103.md) | Keep the D43 hosting split through 10 clubs; agent time goes into portability, not moves | firm |
| [D104](decisions/D104.md) | Fable plans the heavy zone; "I don't know" gets a higher model's proposal | firm; refines D58; refined by D108 |
| [D105](decisions/D105.md) | Templates are designed by agents in the repo, from the menu functionality file | firm; supersedes D63; refines D69 |
| [D106](decisions/D106.md) | The design-skill set in force: frontend-design vendored for templates, Vercel rules pinned, UI UX Pro Max rejected | firm; refined by D109 |
| [D107](decisions/D107.md) | Operational screens are for an owner who is not a tech person: plain words, undo, few taps | firm |
| [D108](decisions/D108.md) | Planning climbs one rung at a time; the rung is sticky; the lead switches itself | firm; refines D104 |
| [D109](decisions/D109.md) | What enters from Emil Kowalski's skills, where, and what stays out | firm; refines D106, D105, D107 |
| [D110](decisions/D110.md) | Restro writes into a POS only as a waiter would | firm; rewrites rule 7; refines D41 |
| [D111](decisions/D111.md) | A bill is the table's view of the POS's bills; Restro keeps only its own orders and payments | firm; supersedes D5 with D112 and D113; refined by D115 (no visit, no bar counter) and D120 (table and venue pauses) |
| [D112](decisions/D112.md) | How an order reaches the POS and how a bill is paid | firm; supersedes D5 with D111 and D113; refines D14; reopens D30; refined by D115 (rounds on the table's POS bill), D116 and D117 (the shared bag; a mixed bag no longer waits) |
| [D113](decisions/D113.md) | Payment mode per item, with one switch per table; Restro is the gatekeeper | firm; supersedes D5 with D111 and D112; refines D29 |
| [D114](decisions/D114.md) | Agents' deliverables are filed in docs/deliverables and kept for revisiting | firm |
| [D115](decisions/D115.md) | No table visit: the bill is the table's open POS bills, and a guest's order joins the table's POS bill like a waiter's | firm; refines D111 and D112; refined by D117 and D118 (only at open tables; the location check) |
| [D116](decisions/D116.md) | The life of an order: its states, what the guest sees, no cancelling after Send, and approval at the bar as a venue setting | firm; supersedes D13; refines D112; refined by D120 (Unconfirmed orders, the Log) |
| [D117](decisions/D117.md) | One shared bag per table, guarded by server locks; pay-first lines stay in the bag until someone pays them | firm; refines D112 and D115; refined by D120 (how a table pause lifts) and D121 (bag edits show at once; an order's progress on the sending phone) |
| [D118](decisions/D118.md) | Guards against fake orders on the bill: only at open tables, a location check, a cap per round and a pace limit per table | firm; refines D115; supersedes D27; refined by D119 and D121 (the location pass) |
| [D119](decisions/D119.md) | The location check's consent screen, its proof and paperwork, and Turnstile's settings | firm; refines D118; refined by D121 (a shorter consent screen) |
| [D120](decisions/D120.md) | Failure and pause during service: a table pause and a venue pause, how each starts and lifts, alerts to everyone, and the venue's Log | firm; refines D102, D111, D116 and D117 |
| [D121](decisions/D121.md) | How the guest page talks to the platform: two endpoints, the table code in a header, polling, the guards on each request, and the location pass | firm; refines D117, D118 and D119 |

## Not repeated here
`CLAUDE.md` holds the nine rules, the import boundaries, the testing rules and the report format; `docs/agents/lead.md` the lead workflow; `docs/open-items.md` the open questions and tasks. Proposals (P…), engineering notes, research facts and acceptance runs stay in `docs/tracker.md`.
