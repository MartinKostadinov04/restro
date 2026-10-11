# Decisions index (from `docs/tracker.md`, 2026-10-11)
This file lists every decision in force (D1–D72), the open questions and the open tasks, one line each. Read it instead of the whole tracker.
`docs/tracker.md` holds the full text and wins on any difference. Look up `| D<n> |` or `T<n>.` there when your brief names one.

## Decisions in force
Status: **firm** (tracker: Firm or Agreed), **applied** (done or in force), **pending** (stated, preferred, wanted or at risk; not yet firm), **refined by D<n>**. No decision is superseded; every number D1–D72 has a row.

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
| D10 | Menu languages: all barsy holds plus ones added by hand; BG + EN for the pilot; euro only. | firm (refined 10-08); Q65 |
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
| D47 | Composer: the barsy menu lands pre-mapped (categories → sections); move, reorder, hide, add curated sections, enrich; layout stored apart from the schema (placements + fractional sort keys). | firm |
| D48 | Lead writes briefs and reviews every diff; Sonnet by default, Opus for `apply()`, resolver, snapshot, sync, RLS, money and the nine rules; product questions go to Martin with a recommendation. | firm; refined by D58 |
| D49 | The Synex Platform is the reference for document → view engine, management and navigation; named in every brief. | firm; refined by D51 |
| D50 | Defaults unless vetoed: one menu per venue; barsy credentials AES-256-GCM with the key only in the worker; Railway Hobby; full pull 12:00 local; fetching convention U4. | applied |
| D51 | Platform code and patterns may be reused, ported to TypeScript. | firm |
| D52 | pnpm 10.34.6 and Node 24.21.0 pinned per repo via `use-node-version`; system Node 22 untouched. | applied |
| D53 | Local Postgres without Docker: `embedded-postgres` 17.10 (`pnpm db:local`, port 54329); CI uses the `postgres:17` service. | applied |
| D54 | `restro-staging` is in West EU (Ireland), not Frankfurt; `restro-prod` goes in the same region. | applied |
| D55 | Stage 2 plan approved: barsy demo → document tables + `apply()` → resolver → read methods + mapping → sync jobs → Integration tab → composer; photos in Stage 2 (private R2); sold-out toggle in Stage 3; credentials sealed with the worker's public key. | firm |
| D56 | Read public catalogue data only (`Categories_getalltree` with `only_public=1`); each venue picks its catalogue root. | firm |
| D57 | Menu photos in private R2 bucket `restro-assets-staging`; database backups (personal data) go to a separate EU-jurisdiction bucket. | applied |
| D58 | Haiku for simple exactly specified tasks, Sonnet by default, Opus only for genuinely complex work; avoid several Opus agents at once. | firm |
| D59 | Publishing is a sync setting; every sync setting is adjustable per venue (auto/manual publish, interval, daily pull time, loops, price source, allergen key, default locale); defaults 5 min, 12:00, `actual_price`. | firm |
| D60 | Venue-defined tags and dietary labels are assigned in the composer and shown on the guest menu. | firm |
| D61 | QR links: ours (`/t/<token>`, default) or the venue's own link, both supported with a written guide; the QR base URL is a setting. | firm |
| D62 | Stage 3 plan approved: fix Copilot's PR #2 findings, then publish → shell → guest face → settings → Publish tab → tags → tables/QR → sold out; local, acceptance on staging; merge PR #1 then #2. | firm |
| D63 | Guest menu design comes from Martin's Lovable shell; we do not design or restyle guest faces; `qr-phone` stays the reference face; agents stop and the lead waits when work needs the shell. | firm |
| D64 | Restro is not barsy-only: barsy logic applies only to barsy venues; each guest-serving barsy venue maps to one Restro venue; shape in T68. | firm (direction); shape pending |
| D65 | Spreadsheet import dropped: no `import` layer or sources; layers are till + manual + override + edition. | firm |
| D66 | In a venue with a till, the till is the only source of items; hand-made items only without a till; sections and enrichment stay ours; one gate (`venueHasTill`), never a code fork. | firm |
| D67 | Guardrails only tighten: never weaken, delete or skip a guardrail test, dependency rule or vendor-word baseline; stop and ask. | applied |
| D68 | Public address `<base>/m/<slug>-<code>`: a random permanent 12-character code finds the venue; slug cosmetic, editable, not unique; QR stickers keep `/t/<token>`. | firm |
| D69 | Template gallery: a venue picks a face in the Design tab (snapshot `presentation`); Editorial Market is the default; `qr-phone` hidden, kept for tests; every template passes the face contract on every fixture. | firm |
| D70 | Venue colours: Primary ~60%, Secondary ~30%, Tertiary ~10%; the rest derived in OKLCH, text-on-colour at least 4.5:1; six self-hosted Cyrillic fonts; rounding, shadow, light/dark per venue. | firm |
| D71 | Guest features are venue settings in the composer; a guest sees a service only if the venue switched it on, the platform supports it, the channel is interactive and a confirmed table token is present; allergen information can never be switched off; no ordering, payment or barsy-write backend before Stage 4/5. | firm |
| D72 | Faces stay pure: a face draws the host's service state and sends commands with an `actionId`, showing pending, then accepted or rejected; it never adds bill rounds, confirms a waiter or reports a payment itself; totals, tips, VAT and splits come from the platform's quote. | firm |
| D73 | Organisation-wide (Settings → Integrations): the barsy connection, the barsy venues found (Add as venue / Link to an existing venue / Not used), the allergen field and text language, the sync schedule, "sync everything" and run history. Per venue: identity, Menu source (its barsy venue, menu category, which barsy price), publishing rules, composer, Design, tables, publishing. Price per venue because barsy prices by venue; reading and deletions per catalogue because venues share catalogues. | firm |
| D74 | The sidebar lists the venues and the organisation's Settings; a venue's sections stay as the tabs on its page (nothing shown twice). | firm |
| D75 | When barsy has no public name for an item, option or category, Restro shows barsy's own name (`article_name`, `cat_name`) and the composer warns that the menu name is missing; no other internal field ever reaches a snapshot. | firm |
| D76 | Deleting a venue (owners, after typing its name) archives it: gone from the admin, guest page and table codes say "not available", till link released, sync and publishing stop; nothing is erased, and owners restore it from Settings › Deleted venues (no till link, unpublished). Owners and admins rename. Every page, action, core writer and job checks the venue is live; `proxy.ts` stays a cookie check. | firm |

## Open questions
Owner is the group heading. None blocks the current stages unless a brief says so.

**Lukanet / pilot owners (T9, T13)**
- Q47: `Accounts_place` with payment and close: exactly one fiscal receipt, and bar printing of the rows?
- Q55: can an unpaid bill be kept from printing and "For confirmation" until paid, and auto-cancelled?
- Q58: payment link: provider, Apple/Google Pay, several payers, capture, refunds, webhook, tips, fees, one receipt.
- Q49 / Q38: popup or sound for "For confirmation" accounts; can confirmation be off or auto-accepted?
- Q48: does `Messages_create` reach the hall team's tablet?
- Q52: what prints on the bar ticket (`account_alias`, `description`)?
- Q56: look up an account by our `uuid`?
- Q57: barsy's price for a cart without creating an account?
- Q59: what `Poses_register` affects; can it disturb the venue's own POS?
- Q60: are `last_update` times venue-local without offset (DST ends 25 Oct 2026)?
- Q71: checksum parameter on `Categories_getalltree`?
- Q21: one barsy account per paid order, or rounds on one table account (P41)?
- Q40: order-level dedup for later rounds.
- Q26: test installation with a test fiscal printer (D33, T39).
- Q41 / Q28: is the "software resource" the registered POS; does read-only API access need it?
- Q25 (pilot owner, T13): monthly price of the "software resource".
- Q24: partial refund via API with a fiscal storno receipt?
- Q29: resource price vs barsy's own QR ordering add-on.
- Q46: write translations into barsy (`ml_data`); rights and cost (D26)?
- Q53: which sales/report data the API returns ("Справки"); cost (D31)?
- Q6-remainder / Q3-fallback: contract limits on integrators; plan if the price kills the pilot or Lukanet declines.

**Lawyer / accountant (T33)**
- Q8: fiscal receipt for online-paid orders via barsy; electronic delivery.
- Q62: who issues the fiscal receipt on each payment route, and when (Н-18)?
- Q63: does Restro count as sales software under Н-18?
- Q64: paper receipt required, or is an electronic one enough?
- Q65: does dual BGN/EUR display still apply (we read: ended 8 Aug 2026)?
- Q66: duty to check age for alcohol ordered in the app (D11)?
- Q67: GDPR roles (venue vs Restro), data processing agreement, retention, privacy notice and terms.
- Q42: allergen rules for food and drinks in catering and online menus; do pilots hold allergens in barsy?
- Q10: accounting treatment of online tips.
- Q70: may a Bulgarian fiscal receipt carry English item names (`lang_id`)? Default: always `bg_BG`.

**Pilot venues (T3)**
- Q43: time-based price lists (happy hour)? Q45: EN names in barsy? Q54: which stats do owners want (after T21)?
- Q68: how do staff mark items sold out today, and where?
- Q69: who on the venue side answers an alert at night?
- Q12: Wi-Fi and mobile signal on the floor.
- Q73: which pilot venue goes first, and who is its barsy admin?

**Product design (Martin)**
- Q22: barsy post retry window before voiding (only if Stripe holds).
- Q11: disputes ("drink never arrived", unauthorised use).
- Q15: effect of a fixed per-transaction fee on small tickets.

**Field (Martin)**
- Q1–Q4: why barsy clubs skip barsy's QR add-on; lost orders; owner and waiter appetite; table vs bar revenue share.

## Open tasks
Owner, then state. "Claude" is the lead agent and its subagents.
- T45 Claude: deploy pipeline re-runs the freeze-window check; at the Stage 3 deploy.
- T44 Martin: review Bulgarian wording in `apps/web/messages/bg.json` (S3 namespaces listed in the tracker).
- T47 Claude: "dismissed link" marker so sync does not re-link or re-place after unlink or unplace; before the unlink UI.
- T48 Claude: record a demo article with allergen text; confirm `order_by` `cat_weight_deep`.
- T49 Claude: map `portion` and `cat_picture`; Stage 3.
- T51 Claude: "acknowledge" op for the D24 translation review; with the review queue.
- T52 Claude: refuse stale saves (expected revision); before two managers edit at once.
- T53 Claude: worker job to clean abandoned uploads.
- T54 Martin: decide on dragging a section into another (needs `@dnd-kit`) after trying the composer.
- T55 Claude: `next dev` evaluates packages more than once; font loading fails in worktrees; watch.
- T60 Claude: photo variants: EXIF width/height, `variants:backfill --force`, CORS on the real CDN.
- T62 Claude: catalogue-root safety (warn on root or venue change, hold above 30% missing); sync side partly in CF-02; before the pilot.
- T67 Claude: read `Places_getlist` once a barsy venue is mapped; with T66 (CF-10).
- T68 Claude: built 10-11 (CF-09a, CF-16, CF-09b merged into `sh/foundation`); left: Martin's acceptance.
- T77 Claude: rename and delete venues (D76), CF-18 running.
- T76 Claude: the rollback pause (`publish.auto_paused`) moves from the integration to the venue, like `after_sync`.
- T70 Claude: connector foundation; merged CF-01, 02, 03, 08a, 12, 14; remaining CF-04 to 07, rest of 08, 09, 10, 11, 13; staging migration 0014 needs Martin's OK.
- T74 Claude: Editorial Market template (D69–D72), plan approved 10-11; SH-01 to SH-08 all merged into `sh/foundation` on 10-11; left: acceptance with Martin, then the PRs; open points per step in the tracker.
- T73 Claude: one role rule for composer writes (recommend owner/admin); with CF-09.
- T71 Claude: barsy shares items by catalogue; follow it (sync unit = catalogue); decides CF-05/CF-07 (Opus).
- T69 Martin: ask Mistral (office@mistral.bg) for API docs, a test installation and terms; second till.
- T63 Claude: tag colour and order to the face; colour required at `menu-snapshot/2`.
- T65 Claude (Haiku): `/t/<token>` keeps `lang` on redirect.
- T66 Claude (CF-10): Tables tab by `salon_id`; per-venue place types; hide place 0; no code for non-public places.
- T50 Claude: one section per barsy category per integration; job key and absence check per venue; when a second venue joins.
- T57 Claude: photos on non-barsy hosts are refused; recommended `BARSY_PHOTO_HOSTS` allowlist, anonymous fetch; after checking real data.
- T58 Claude: worker housekeeping (README env table, start-up sweep, `places.state_changed_at`, AWS SDK, date-fns vs `Intl`).
- T59 Claude: verify on the demo `files_get` auth and multi-calls; photos done 10-10.
- T40 Claude: architecture doc updates (Core rules, scope, polling, Supabase, Stage plan tab).
- T39 Martin: send Lukanet the test-environment request (draft by Claude; Q41, Q60, Q71); before T9.
- T25 Martin: platform accounts by stage (Railway, domain, Cloudflare, Sentry, Resend, Telegram, Supabase prod); guide from Claude.
- T9 Martin: send Lukanet the consolidated questions, after T39.
- T13 Martin: ask a pilot owner for the "software resource" price (Q25, Q29, Q41).
- T33 Martin: send the lawyer/accountant questions.
- T29 Claude: orders and payments spec; skeleton before Stage 4, details after T9 and T33.
- T31 Martin + lawyer: privacy notice, terms, data processing agreement; before the first guest.
- T17 Martin: remaining decisions P41–P43, P46, P48–P50, P52, P53, P10; veto window on D50.
- T20 Claude: read the 2021 food-information ordinance, or ask the lawyer (Q42).
- T21 Claude + Martin: research what data barsy gives for venue stats.
- T23 Claude: research writing translations into barsy (D26, Q46); with T21.
- T24: `Accounts_place` note fields found; what prints on bar tickets is open (P37, Q52).
- T3 Martin: pilot-club interviews.
- T34 Martin: visual design for the guest flow and admin (guest design: D63, D69).
- T27: monthly restore drill; once live.
- T4: test barsy's QR menu and one other BG QR app live.
- T6: accountant check; folded into T33.
- T10: group checkout and split flow, inside T29 after P42.
- T12 Martin: delete the 3 superseded v1 FigJam boards.
- T2 (marked `[~]`, partly done): Lukanet contact; next T39, then T9.

## Not repeated here
`CLAUDE.md` holds the nine rules, the import boundaries, commands, the report format and the lead workflow. Proposals (P…), engineering notes, research facts and acceptance runs stay in the tracker.
