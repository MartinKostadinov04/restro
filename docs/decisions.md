# Decisions index
Every decision in force, one line each. `docs/tracker.md` holds the full text and wins on any difference.

## Decisions in force
Status: **firm** (agreed), **applied** (done or in force), **pending** (stated or wanted, not yet firm), **refined by D<n>**, **superseded by D<n>**.

| ID | Decision | Status |
|---|---|---|
| D1 | Target segment: nightclubs in Bulgaria. | pending (unvalidated) |
| D2 | MVP lean enough for one person to hold in their head. | firm |
| D3 | No extra friction against walk-outs; per-guest action log as evidence. | pending (stated) |
| D4 | Order-first MVP: self-ordering, multi-tenant online payments, receipts; build order per D39. | firm |
| D5 | An order holds many items and is paid when placed; the app shows the table's orders like a tab; several payers per order. | firm (refined 10-08); barsy mapping open (Q21, Q47) |
| D6 | Pilot clubs all run barsy; barsy handles as many processes as possible; no staff re-keying from our tablet. | firm |
| D7 | Pilot: our software free; venue pays QR materials and payment fees. At risk from barsy's "software resource" fee (P10). | pending (at risk) |
| D8 | Tips: optional line on payment, paid out to the venue, which distributes them. | firm |
| D9 | Guests need no app and no account (first name at checkout). | firm |
| D10 | Menu languages: all barsy holds plus ones added by hand; BG + EN for the pilot; euro only. | firm (refined 10-08); refined by D77 (only languages with filled texts); Q65 |
| D11 | No in-app age check; the door handles it. | firm; Q66 |
| D12 | Own waiter view only for venues without barsy, billed separately; pending as the pilot runs on barsy. | firm |
| D13 | Paid orders go to barsy without our own staff-confirmation step. | firm; see D18, Q38, Q49 |
| D14 | Guests can split the bill in the web app. | firm |
| D15 | Config-driven app: venue data rendered by a visual shell changeable per customer. | applied |
| D16 | Sync a copy of barsy's data into our own model; never render from barsy live. | applied |
| D17 | Architecture = the Menu Engine doc including its nine rules (CLAUDE.md). | applied |
| D18 | The waiter must learn of every app order inside the venue's existing barsy setup, never on a separate device of ours. | firm |
| D19 | Payment route: barsy's payment link if it supports Apple/Google Pay, split payments and one fiscal receipt, else Stripe Connect; build only the confirmed route. | pending (Q39, Q55, Q58) |
| D20 | Our own section map, generated from barsy's category tree, editable per venue; a new barsy item lands at the end of its category's section. | firm; see D47 |
| D21 | New barsy items publish automatically (V11 still blocks mass changes). | firm; see D50 |
| D22 | Sold-out items are greyed out with no order button. | firm; source is D46 |
| D23 | TypeScript end to end; AI agents write the code; Martin manages and decides. | firm |
| D24 | A missing language is added by hand in the translations tab (per-locale manual layer); when barsy's name changes, our translations are flagged for review and stay live. | firm |
| D25 | Legal checks per country: Bulgarian law first; re-check in each new country before expanding. | firm |
| D26 | A venue may opt in to push our translations into barsy, only if the API allows it (T23); an explicit exception to "sync never writes into barsy". | pending (wanted) |
| D27 | Table access in v0: the QR token only (orders prepaid); holds only if no bill reaches barsy before payment (B2). | firm |
| D28 | Delivery in v0: to the table only. | firm |
| D29 | Ordering mode per item, set by the owner: orderable, "ask your waiter" (shown with price) or hidden. | firm |
| D30 | Time for other guests to pay their share of a split order: a venue setting (default 3 min), never longer than barsy's payment-link lifetime. | firm; P42 |
| D31 | Venue stats: first research what barsy exposes, then ask owners; Restro's own data is used freely. | firm |
| D32 | Store every payment at the finest grain so any disaggregation is possible. | firm |
| D33 | A barsy test installation (ideally with a test fiscal printer) is required before any call that writes to barsy; no test orders on a live venue. | firm |
| D34 | No loyalty accounts in v0. | firm |
| D35 | Traffic is low: choose the cheapest effective option. | firm |
| D36 | Stack per the doc's Stack tab (Node 24, pnpm monorepo, Next.js 16.4, Postgres 17, Drizzle, pg-boss 12, R2, Better Auth, Biome, dependency-cruiser); hourly backups during service; no deploys Thu–Sun 18:00–08:00; barsy writes only through an allowlist. | refined by D38, D41, D43 |
| D37 | The architecture doc stands alone: passport equivalents removed. | applied |
| D38 | Channel: QR to phone only; kiosk, TV, print and delivery faces dropped; the face contract stays so several phone shells can plug in. | firm |
| D39 | Staged proof of concept on one venue: S1 ground, S2 barsy → document → composer, S3 phone menu + tables/QR, S4 phone ordering (mock API; barsy writes on the test installation only), S5 payments. | firm |
| D40 | Build the doc's document model plus a generic shell/face contract; defer template-version migrations and matching/relink screens. | firm |
| D41 | barsy freshness by polling: incremental every 5 min per venue plus a nightly full pull; no webhooks and no barsy writes until the test installation exists. | firm |
| D42 | Allergens are a plain EU-14 `enum_set` attribute; V4 and V5 are warnings, not publish gates, until the legal answer (Q42). | firm |
| D43 | Supabase Postgres only, free plan, `restro-staging` and `restro-prod`, Data API off; Railway runs web + worker; Pro before money flows. | refined by D54 |
| D44 | `E:\Restro` is the repo (private GitHub `MartinKostadinov04/restro`); `C:\Platform` is reference only, never edited, branched or committed. | firm |
| D45 | Service day ends 07:00 local, per venue; sold-out resets, stats and table tabs use it. | firm |
| D46 | Sold out: barsy's for-sale flag is the source; managers can also mark items sold out tonight in our admin; waiters never use it. | firm |
| D47 | Composer: the barsy menu lands pre-mapped (categories → sections); move, reorder, hide, add curated sections, enrich; layout stored apart from the schema (placements + fractional sort keys). | firm; refined by D90 (POS venues: reorder, rename, hide; no own sections) |
| D48 | Lead writes briefs and reviews every diff; Sonnet by default, Opus for `apply()`, resolver, snapshot, sync, RLS, money and the nine rules; product questions go to Martin with a recommendation. | firm; refined by D58 |
| D49 | The Synex Platform is the reference for document → view engine, management and navigation; named in every brief. | firm; refined by D51 |
| D50 | Defaults unless vetoed: one menu per venue; barsy credentials AES-256-GCM with the key only in the worker; Railway Hobby; full pull 12:00 local; fetching convention U4. | applied; refined by D88 (several menus per venue) |
| D51 | Platform code and patterns may be reused, ported to TypeScript. | firm |
| D52 | pnpm 10.34.6 and Node 24.21.0 pinned per repo via `use-node-version`; system Node 22 untouched. | applied |
| D53 | Local Postgres without Docker: `embedded-postgres` 17.10 (`pnpm db:local`, port 54329); CI uses the `postgres:17` service. | applied |
| D54 | `restro-staging` is in West EU (Ireland), not Frankfurt; `restro-prod` goes in the same region. | applied |
| D55 | Stage 2 plan approved: barsy demo → document tables + `apply()` → resolver → read methods + mapping → sync jobs → Integration tab → composer; photos in Stage 2 (private R2); sold-out toggle in Stage 3; credentials sealed with the worker's public key. | firm |
| D56 | Read public catalogue data only (`Categories_getalltree` with `only_public=1`); each venue picks its catalogue root. | firm; refined by D88 (a venue's menus are barsy's designated roots) |
| D57 | Menu photos in private R2 bucket `restro-assets-staging`; database backups (personal data) go to a separate EU-jurisdiction bucket. | applied |
| D58 | Haiku for simple exactly specified tasks, Sonnet by default, Opus only for genuinely complex work; avoid several Opus agents at once. | firm |
| D59 | Publishing is a sync setting; every sync setting is adjustable per venue (auto/manual publish, interval, daily pull time, loops, price source, allergen key, default locale); defaults 5 min, 12:00, `actual_price`. | firm; refined by D82 (allergen key per instance) and D77 (languages) |
| D60 | Venue-defined tags and dietary labels are assigned in the composer and shown on the guest menu. | firm |
| D61 | QR links: ours (`/t/<token>`, default) or the venue's own link, both supported with a written guide; the QR base URL is a setting. | firm; refined by D80 (custom domains) |
| D62 | Stage 3 plan approved: fix Copilot's PR #2 findings, then publish → shell → guest face → settings → Publish tab → tags → tables/QR → sold out; local, acceptance on staging; merge PR #1 then #2. | firm |
| D63 | Guest menu design comes from Martin's Lovable shell; we do not design or restyle guest faces; `qr-phone` stays the reference face; agents stop and the lead waits when work needs the shell. | firm |
| D64 | Restro is not barsy-only: barsy logic applies only to barsy venues; each guest-serving barsy venue maps to one Restro venue; shape in T68. | firm (direction); shape pending |
| D65 | Spreadsheet import dropped: no `import` layer or sources; layers are till + manual + override + edition. | firm |
| D66 | In a venue with a till, the till is the only source of items; hand-made items only without a till; sections and enrichment stay ours; one gate (`venueHasTill`), never a code fork. | firm |
| D67 | Guardrails only tighten: never weaken, delete or skip a guardrail test, dependency rule or vendor-word baseline; stop and ask. | applied |
| D68 | Public address `<base>/m/<slug>-<code>`: a random permanent 12-character code finds the venue; slug cosmetic, editable, not unique; QR stickers keep `/t/<token>`. | refined by D84 (clean addresses; the code is internal only) |
| D69 | Template gallery: a venue picks a face in the Design tab (snapshot `presentation`); Editorial Market is the default; `qr-phone` hidden, kept for tests; every template passes the face contract on every fixture. | firm |
| D70 | Venue colours: Primary ~60%, Secondary ~30%, Tertiary ~10%; the rest derived in OKLCH, text-on-colour at least 4.5:1; six self-hosted Cyrillic fonts; rounding, shadow, light/dark per venue. | firm |
| D71 | Guest features are venue settings in the composer; a guest sees a service only if the venue switched it on, the platform supports it, the channel is interactive and a confirmed table token is present; allergen information can never be switched off; no ordering, payment or barsy-write backend before Stage 4/5. | firm |
| D72 | Faces stay pure: a face draws the host's service state and sends commands with an `actionId`, showing pending, then accepted or rejected; it never adds bill rounds, confirms a waiter or reports a payment itself; totals, tips, VAT and splits come from the platform's quote. | firm |
| D73 | (Refined by D81, D82, D87.) Organisation-wide (Settings → Integrations): the barsy connection, the barsy venues found (Add as venue / Link to an existing venue / Not used), the allergen field and text language, the sync schedule, "sync everything" and run history. Per venue: identity, Menu source (its barsy venue, menu category, which barsy price), publishing rules, composer, Design, tables, publishing. Price per venue because barsy prices by venue; reading and deletions per catalogue because venues share catalogues. | firm |
| D74 | The sidebar lists the venues and the organisation's Settings; a venue's sections stay as the tabs on its page (nothing shown twice). | firm |
| D75 | When barsy has no public name for an item, option or category, Restro shows barsy's own name (`article_name`, `cat_name`) and the composer warns that the menu name is missing; no other internal field ever reaches a snapshot. | firm |
| D77 | A venue's menu languages come from one core function every workflow calls: connectors report which languages the till offers and how many guest-facing texts each fills; a language counts from ~20% coverage, owner-enabled languages are never removed; one main language per venue, on the venue; the language of untagged till text stays a barsy instance setting (corrected 10-12). | firm |
| D78 | Superseded by D87: a venue's source never changes. | superseded |
| D79 | The pilot's till is Mistral / Zamboo; the pilot waits for that connector. Parked: the current phase is platform functionality, data structure and UI on clean connector data; the connector foundation (CF-06, 05, 07, 08) and Mistral come after. D66 stays; one Postgres database. | firm |
| D97 | Venue page tabs: Composer (Structure, Design), Tables & QR, Settings (General, Publish, Versioning). No Publishing tab; the Publish button stays in the header; action warnings show under the header on every tab. | firm |
| D96 | Versions: live + up to 2 restorable, non-live purged after 30 days, change log 2 months. Publish button top right on every tab (both modes), change count, confirmation; a dropdown per menu (areas in brackets, change counts) when several. Publishing tab: no "On guests' phones", no "Changes waiting"; Automation settings (POS only: sync mode + publish after sync); no new-items hold rule; banners only when relevant. | firm |
| D95 | Areas and tables: barsy's halls and tables (rename, reorder, hide; non-public hidden; keyed by hall id); other POS open; Restro venues make their own. Menu routing for all venues: venue (live menu) → area → table, one menu per level, most specific wins, unpublished falls back. Tables shown as a grid per area; name field labelled with the barsy number beside it. Refines D88. | firm |
| D94 | Tables & QR shows the codes' address read-only (domain from Organisation › Domains, else ours) with a test link; no base address or own-link pattern per venue; the installation address is developer config. Refines D61. | firm |
| D93 | Colour upgrades with D92: engine roles for status, disabled, selected, focus, backdrop and strong border (faces stop improvising; decorative mixes in OKLab; rendered-pair contrast test); 3:1 for controls; brand-first colour card. Then: softer dark accents, APCA second check, increase-contrast variant. | firm |
| D92 | Composer has Structure and Design subtabs. POS venues may create own sections through the mapper (amends D90). Sections are vertical or horizontal. Menu layout (default + guest switch) is a composer setting. Design: template chooser with phone preview pop-up; cards: logo and header name, guest functions, font (dropdown)/corners/shadow/screen, colours (no presets, no swatch palette, Primary/Secondary/Tertiary only); sticky phone preview. | firm |
| D91 | Organisation › General (name, address name); purge also clears removed instances' data and unused items; QR menus fall back to the live menu, auto-publish covers QR-used menus; hand-made venues' languages are the owner's; domains on deleted venues say "not available", detached on purge; T78 answered by D90; deleted menus go to a 30-day bin in the venue's settings; POS mapper may move items between sections; RBAC deferred. | firm |
| D90 | Restore re-links a POS venue's till venue if still free, else refused. POS venue structure = our mapper (order) + dictionary (names) over a copy of the till's structure: reorder, rename, hide; no own sections (narrows D47); syncs touch only the till layer. Each menu has its own draft/published version; venue Live = live menu published; one shell and design per venue for all menus. | firm |
| D89 | Hand-made venues: full create/edit/delete of menus, sections and items. POS venues: hide, sold out, reorder, own texts and photos over the till's, tags; never delete or create items or change prices (the POS is the source; its deletions arrive by full read). | firm |
| D88 | A venue holds several menus, exactly one live (chosen in Settings › Menus or the composer). barsy venue menus = barsy's designated roots (public menu live by default, till tree). Several menus at once is per QR code/hall. Import menu: hand-made venue to hand-made venue only, one-time copy. Replaces one-menu-per-venue (P47). | firm; refined by D95 (one menu per code: venue → area → table) |
| D87 | A venue's source is fixed at creation (no "Change"; new source = new venue, delete the old). A POS venue's menus: D88; sections and items are the composer's job. Supersedes D78. | firm |
| D86 | Venue states: Draft (never published or unpublished), Live, Archived (bin, D83). All venues card: display name, state, POS instance (or By hand), the POS's venue name, link to the full menu preview (not a table's view; its design comes later). | firm |
| D85 | New venue: from a POS, pick instance and venue, nothing typed (name, address, languages derived, editable later); by hand, name and languages, address generated as an editable preview. | firm |
| D84 | Guest address = `<our domain>/m/<organisation>/<venue>`: organisation slug unique platform-wide, venue name unique in its organisation, both generated from names and editable, old names redirect; the random code is internal only; custom domains (D80) drop the path parts they cover. Supersedes D68's visible code. | firm |
| D83 | A deleted venue is restorable 30 days, then purged by a worker job (or at once via "Delete permanently", owners); its own data is erased, shared items stay, public and table codes are tombstoned never reused. The app role deletes only placements, field values and source links through `apply()` (plus auth sessions and verification rows); erasing venue data or anything in bulk is the purge job's alone, through `restro_purge` (made precise 10-12). Amends D76. | firm |
| D82 | Instance settings = the whole connection (connection, allergen characteristic, sync everything, all runs); venue settings = that venue (main language, menu source, sync mode automatic/manual with interval and full-read time in its time zone, own history, publishing rules, rollback pause). Neither edits the other's. Settings texts name the POS by `{source}`, never "barsy". | firm |
| D81 | Settings › Integrations is source-agnostic now: chosen systems (saved) each get a tab of named instances (connection, status, system settings, sync, history; "Add {system}"); New venue picks an active instance and its venue, or "By hand". Removing an instance is refused while venues link to it; unselecting a system while it has instances. | firm |
| D80 | Custom domains (owner self-service, subdomains only, guest menu and table codes only): each domain serves one venue or the whole organisation (`<domain>/<venue>`); verified by DNS, HTTPS automatic; routed from a published domain file, never the database (rule 4). | firm |
| D76 | Deleting a venue (owners, after typing its name) archives it: gone from the admin, guest page and table codes say "not available", till link released, sync and publishing stop; owners restore it from Settings › Deleted venues (refined: purge after 30 days, D83; restore re-links the till venue if free, D90). Owners and admins rename. Every page, action, core writer and job checks the venue is live; `proxy.ts` stays a cookie check. | firm |

## Not repeated here
`CLAUDE.md` holds the nine rules, the import boundaries, the testing rules and the report format; `docs/agents/lead.md` the lead workflow; `docs/open-items.md` the open questions and tasks. Proposals (P…), engineering notes, research facts and acceptance runs stay in the tracker.
