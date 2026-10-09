# Restro — MVP tracker
_Last updated: 2026-10-08 (v15, kickoff with the lead coding agent)_

**Architecture source of truth:** [Menu Engine Data Architecture](https://claude.ai/code/artifact/2f2ab8b4-61ce-45a3-986b-bf675d8b472a) (doc) with tabs: **Data architecture** (data model, core rules, Barsy mapping, outbound outline, decisions checklist), **Stack** (runtime design, costs, repo, CI rule enforcement, jobs, environments, monitoring) and **Stage plan**. Repo mirrors: `docs/architecture/`. Precedence: official barsy docs > that doc > this tracker. This tracker (`docs/tracker.md` in the repo `E:\Restro`, GitHub `MartinKostadinov04/restro`, private) keeps decisions, conflicts, open questions and tasks.

## Current scope (10-08, kickoff)
- **Channel: QR → phone only** (D38). Two surfaces: **guest phone app** (menu now, ordering and payment later) and **venue admin** (composer, enrichment, tables & QR, publishing, settings, later stats and money).
- **Proof of concept on one venue**, built in stages (D39). Now: **Stage 1 — set up the ground** (repo, tooling, CLAUDE.md, document-model foundation, DB with RLS, admin shell, worker shell, barsy read client skeleton).
- Own waiter view — pending (only for venues without barsy, billed as a separate feature).

## Kickoff with the lead coding agent, 10-08
- Review of the doc against the **official barsy docs** (signed in): eight corrections, listed under Research facts → "barsy API — verified 10-08". Biggest: per-venue for-sale needs `limits_by_barsys`; full-pull paging must be sorted; deletions never appear in normal lists.
- Martin's direction: QR → phone only; one venue; barsy tables get generated QR codes; the barsy menu lands pre-mapped in a **composer** where things can be moved and enriched (images, description, attributes); basic PoC menu with the model's full flexibility; the Synex Platform repo is the reference for document → view engine, management and navigation; coding by Sonnet 5.5 subagents (Opus 5.5 for complex parts) with detailed briefs, questions flowing back to the lead and then to Martin.
- Platform review: the Platform has **no composer or layout document** (the ontology is the layout, frozen after creation), no QR generation, no draft/publish. Patterns to port and pitfalls to avoid: `docs/platform-reference.md`.

## Final review, 10-08 (independent second-agent review + own check)
- **Verdict:** the menu side is thorough (more than v0 needs); the ordering and money side is only an outline. Stack choices hold, with corrections now applied on the Stack tab (see D36).
- **Blockers before any ordering code:** (B1) no orders/payments data model or state machines → T29; (B2) the preferred payment route (barsy link) creates the bill *before* payment, which contradicts "prepaid" and lets a photographed QR code flood the POS with unpaid bills → Q55, P41; (B3) no live-night safety plan (menu-only fallback, alerts on stuck money, orphaned-order list) → T29, partly in the Stack tab already.
- **Major gaps:** service day past midnight (→ D45); table sessions/tab boundaries (in T29); split rules (P42); writes to live barsy needed for webhooks/POS registration vs rule 7 and D33 (P43, deferred by D41); abuse limits (now in the Stack tab); allergens on drinks and the V4 "food" scope (Q42; V4 now a warning, D42); sold-out source vs "no separate device" (→ D46); privacy roles, notices and retention (T31, Q67).
- Doc fixes applied: `account.uuid` = our server-generated order id (not the client's); `order_mode`/`ask_waiter` added to the snapshot and rule R11; outbound and failure-mode sections marked as outline with a pointer to T29; nine new items on the doc's decisions checklist.

## Decisions
| # | Decision | Status |
|---|---|---|
| D1 | Target segment: nightclubs in Bulgaria | Stated, unvalidated |
| D2 | MVP lean enough for one person to hold in their head | Firm |
| D3 | No extra friction against walk-outs; per-guest action log as evidence | Stated |
| D4 | Order-first MVP: self-ordering + multi-tenant online payments + receipts | Firm — build order decided by D39 |
| D5 | Pay per order: an order can hold many items and is paid when placed; the guest app shows the table's orders together like a tab. Multiple payers per order supported | Firm (refined 10-08). barsy mapping open (Q21, Q47); conflicts with the barsy-link route (B2) |
| D6 | Pilot clubs already chosen; all run barsy. barsy handles as many processes as possible; no staff re-keying from our tablet | Firm |
| D7 | Pilot pricing: our software free; venue pays QR materials + payment-processing fees | **At risk (10-01):** barsy's monthly "software resource" fee — price unknown (C5). Who pays it in the pilot: decide when the price is known (P10) |
| D8 | Tips: optional line on payment, paid out to venue, venue distributes | Agreed |
| D9 | Guests: no app, no account needed (first name at checkout) | Agreed |
| D10 | Languages per menu: every language barsy holds for it + languages added by hand in our translations tab. BG + EN for the pilot. Euro only | Agreed (refined 10-08); dual BGN/EUR display likely ended 8 Aug 2026 — confirm (Q65) |
| D11 | No in-app age check; door handles it | Agreed — lawyer to confirm for in-app alcohol orders (Q66) |
| D12 | Own waiter view only for venues without barsy, billed as a separate feature; pending because the pilot runs on barsy | Changed 10-08 |
| D13 | Paid orders go to barsy without our own staff-confirmation step | Agreed — barsy may still require its own confirmation (Q38, Q49); see D18 |
| D14 | Guests can split the bill in the web app | Firm |
| D15 | Config-driven app: structured venue data rendered by a visual shell changeable per customer | Realised in the Menu Engine doc |
| D16 | Pull barsy's data into Restro's own model (sync a copy) instead of rendering from barsy live | Adopted in the Menu Engine doc |
| D17 | Architecture = Menu Engine doc incl. its 9 non-negotiable rules | Adopted; the nine rules get their own "Core rules" section in the Data architecture tab (T40) |
| D18 | With or without barsy confirmation, the waiter must learn of every app order inside the venue's existing barsy setup (POS, bar printer/screen) — never on a separate device of ours | Firm (10-08) |
| D19 | Payment route: barsy's payment link if it supports Apple/Google Pay, split payments and prints exactly one fiscal receipt; Stripe Connect as fallback. Only the confirmed route gets built | Preferred (10-08); depends on Q39, Q55, Q58 |
| D20 | Sections: our own section map, generated from barsy's category tree as the default composition, editable per venue; a new barsy item lands at the end of the section its category maps to | Firm (10-08); realised in the composer (D47) |
| D21 | New barsy items publish automatically (V11 still blocks mass changes) | Firm (10-08); default order_mode deferred (D50) |
| D22 | Sold-out items shown greyed out, with no order button | Firm (10-08); source of truth → D46 |
| D23 | TypeScript end to end; AI coding agents write the code; Martin manages and decides | Firm (10-08) → detailed in D36, D48 |
| D24 | Translations: a missing language is added by hand in the editor's translations tab, saved per locale (manual layer, not an override); `localized_text` resolves per locale. When barsy's name for an item changes, our translations of it are flagged for review (they stay live) | Firm (10-08) |
| D25 | Legal checks are per country: check Bulgarian law first; re-check in every new country before expanding | Firm (10-08) |
| D26 | A venue may opt in to push our translations into its barsy — only if the API allows it (research first, T23). Would be an explicit, venue-approved exception to "sync never writes into barsy" | Wanted (10-08), pending research |
| D27 | Table access control in v0: the QR token only (orders are prepaid) | Firm (10-08) — holds only if no bill reaches barsy before payment (B2); rate limits + Turnstile in the Stack tab |
| D28 | Delivery in v0: to the table only | Firm (10-08) |
| D29 | Ordering mode per item, set by the venue owner: orderable / "ask your waiter" (shown with price) / hidden. All three supported; in the snapshot and R11 | Firm (10-08) |
| D30 | Time other guests have to pay their share of a split order: a venue setting (proposed default 3 min); must not outlast barsy's payment-link lifetime | Firm (10-08); full split rules open (P42) |
| D31 | Venue-admin stats: first research what data barsy exposes and what could be useful, then ask owners what they want from that set. Restro's own data is ours and used freely | Firm (10-08) |
| D32 | Money collected through the app: store every payment at the finest grain so every disaggregation is possible, later turned into insights | Firm (10-08) |
| D33 | A barsy test installation (ideally with a test fiscal printer) is required before any call that writes to barsy; no test orders on a live venue | Firm (10-08) |
| D34 | No loyalty accounts in v0 | Firm (10-08) |
| D35 | Constraint: traffic is low; choose the cheapest effective option for running the platform | Firm (Martin, 10-08) |
| D36 | Stack as designed in the doc's Stack tab: Node 24 LTS; pnpm monorepo; Next.js 16.4.x; Postgres 17; Drizzle; pg-boss 12; Cloudflare R2 + CDN + proxy; Better Auth; Resend; Sentry (EU); guest analytics in our own Postgres; Telegram alerts + deep health checks; hourly backups during service; no deploys Thu–Sun 18:00–08:00; Vitest, fast-check, Playwright, MSW; Biome + dependency-cruiser + gitleaks; barsy writes only through an allowlist | Designed 10-08; **amended at kickoff:** Postgres on Supabase instead of Railway (D43); no webhooks in the first stages (D41); kiosk/TV/print faces dropped (D38) |
| D37 | Architecture doc stands alone: passport equivalents removed. Provenance line in its Sources kept | Done 10-08 (Martin) |
| D38 | **Channel: QR → phone only.** Kiosk, TV, print and delivery-feed faces dropped from scope. The face contract stays so several phone designs ("shells") can plug in; Martin will bring more shells to test it | Firm (Martin, kickoff 10-08) |
| D39 | **Build order (resolves C1):** staged proof of concept on one venue. Stage 1 set up the ground → Stage 2 barsy → document → composer → Stage 3 phone menu, tables & QR codes → Stage 4 phone ordering interaction (mocked order API, T29 spec, barsy writes on the test installation only) → Stage 5 payments on the confirmed route. Later stages are shaped by Martin's practical questions, translated into technical adjustments | Firm (kickoff 10-08) |
| D40 | **Scope:** build the doc's document model as designed (templates as data, nodes, field definitions, layers, combinators, resolver, snapshots) plus a generic shell/face contract. Deferred: spreadsheet import, template-version migrations, matching and relink screens | Firm (kickoff 10-08) |
| D41 | **barsy freshness: polling** — incremental check every 5 min per venue + nightly full pull. No webhooks and **no writes into barsy** until the test installation exists; the write allowlist (P43) is decided with ordering | Firm (Martin: "the more cost-effective option", 10-08) |
| D42 | **Allergens are a plain data attribute** (EU-14 `enum_set`), shown when present. V4 and V5 are warnings, not publish gates, until the legal answer (Q42) | Firm (kickoff 10-08) |
| D43 | **Database: Supabase Postgres only**, free plan, Central EU (Frankfurt), new organisation "Restro" with projects `restro-staging` and `restro-prod`. Data API switched off; our own backups to R2; Better Auth keeps logins in our database; R2 stays the CDN; Railway (EU West) runs web + worker. Upgrade to Pro ($25/month) before money flows. If Martin resumes his MyFin project (both free slots used), staging moves to Railway Postgres (~$2/month) | Firm (Martin: "best cost to quality", 10-08) |
| D44 | **Repo:** `E:\Restro` is the repository (research moved to `docs/research/`), pushed to private GitHub `MartinKostadinov04/restro`. `C:\Platform` (Synex) is reference only — never edited, branched or committed | Firm (Martin, 10-08) |
| D45 | **Service day** ends at **07:00 local**, a per-venue setting; sold-out resets, stats and later table tabs use it (resolves P40) | Firm (10-08) |
| D46 | **Sold out:** barsy's for-sale flag is the source; managers can also mark items sold out tonight in our admin; waiters never use our admin (resolves P44; trace 4 corrected to managers) | Firm (10-08) |
| D47 | **Composer:** the barsy menu lands pre-mapped (category tree → sections, D20) in a composer modelled on the Platform's builder (tree + side sheet with tabs + drag-and-drop); items can be moved between sections and reordered, curated sections added, items hidden, and enriched with images, description, attributes and translations. Layout is stored apart from the schema (placements + fractional sort keys), unlike the Platform where it is frozen inside the ontology | Firm (Martin, 10-08) |
| D48 | **Agent workflow:** the lead agent (Opus 5.5) writes detailed briefs (`docs/agent-briefs/`), reviews every diff and reports to Martin. Coding by Sonnet 5.5 subagents by default; Opus 5.5 for `apply()`, resolver, snapshot contract, barsy sync and deletion, RLS/tenancy, money and anything touching the nine rules. Subagent questions go to the lead; product questions go to Martin with a recommendation | Firm (Martin, 10-08) |
| D49 | **Platform reference:** the Synex Platform is the reference for document → view engine, management and navigation; reviewed at the start of every stage and named in every brief (`docs/platform-reference.md`) | Firm (Martin, 10-08); code reuse allowed (D51) |
| D51 | **Synex Platform code may be reused** in Restro (code and patterns), ported to TypeScript (answers Q72) | Firm (Martin, 10-08) |
| D52 | **Toolchain pinned per repo, not system-wide:** pnpm 10.34.6 (`packageManager`; pnpm 12 is six weeks old and less known to coding agents) and Node 24.21.0 via pnpm `use-node-version`; the PC's system Node 22 (used by the Platform) stays untouched | Applied 10-08 |
| D55 | **Stage 2 plan approved (10-09):** barsy demo → document tables + `apply()` → resolver → barsy read methods + mapping v1 → sync jobs (full pull, 5-min incremental, deletion rule, photo fetch) → Integration tab → composer v1 with enrichment. **Photos in Stage 2** (Cloudflare R2 set up now, private bucket, no domain yet); **sold-out toggle moves to Stage 3**. barsy credentials sealed with the worker's public key (web can store, never read). Plan: architecture doc → Stage plan tab | Firm (Martin, 10-09) |
| D56 | **Read public catalogue data only:** `Categories_getalltree` with `only_public=0` requires a registered till (a write we don't do); `only_public=1` works. Each venue picks its **catalogue root** (one barsy installation holds several menus in one tree — demo: "Каса Kiosk", "English", "Showx", "Публично меню") | Firm (from demo, 10-09) |
| D54 | **Supabase `restro-staging` is in West EU (Ireland, `eu-west-1`)**, not Frankfurt as D43 planned; session pooler `aws-0-eu-west-1.pooler.supabase.com:5432`. Adds a few ms from Railway Amsterdam; acceptable. Create `restro-prod` in the same region | Recorded 10-09 |
| D53 | **Local Postgres without Docker:** Docker Desktop fails on every start on this PC (Windows 11 Insider build 26300 cannot remove or read unix-socket files: `dockerInference`, `docker-secrets-engine\engine.sock`), so local development and tests use `embedded-postgres` 17.10 (`pnpm db:local`, port 54329). CI keeps the GitHub Actions `postgres:17` service container; `docker-compose.yml` stays as an optional alternative | Applied 10-08 |
| D50 | **Defaults applied unless Martin vetoes:** one menu per venue (P47); default order_mode deferred to ordering (P45); barsy credentials encrypted in the app with AES-256-GCM, key only in the worker's environment (P38); Railway Hobby (P39); nightly full pull at 12:00 local (P31); data fetching convention U4 as written below | Applied 10-08 |

## Engineering notes for Stage 2 (from Stage 1 agent reports, accepted by the lead 10-08)
- `apply()` passes node context to `validateWrite`: manual/import prices allowed only on items **not** linked to barsy (hand-made wine list); unlink copies barsy values into the manual layer.
- Add a `clearField {node, fieldKey, layer, scope}` op (revert override, take barsy's value, undo a builder hide).
- Placement ops accept a position hint `'end'`; adapters never compute sort keys themselves.
- The resolver hides nodes whose barsy link is `missing` or `deleted`, whatever their own status (rules 5, 6).
- Edition layers write only `all_true` flags for now (hide here, sold out tonight = `for_sale = false`).
- Add id kinds `jb` (job), `in` (integration), `us` (user), `sr` (source record).
- Casing: stored values and snapshots use snake_case (`amount_minor`); code-level config objects (field definitions, change sets) use camelCase.
- `placements.sort_key` needs `COLLATE "C"`; `value_hash` is SHA-256 (64 hex chars), not the doc's 8.
- Check real barsy `supplement_price` data for negative option deltas before allowing them.
- Specials: no fields in `venue-menu@1` yet; added when needed. Modifier-group `min ≤ max` checked at node level in the resolver.
- barsy client: record the real wrong-password response to learn the auth-error shape; one failing method inside a multi-method call is undocumented — record a real case.
- Database (from S1-03): the read side is a READ ONLY transaction, so every write goes through `core/apply` by construction; the app role has no DELETE on tenants/venues (archive instead); with the first Stage 2 child table add `unique (tenant_id, id)` and composite foreign keys `(tenant_id, venue_id)` (foreign-key checks bypass RLS).
- Worker (from S1-06): run exactly **one** worker replica until the heartbeat is per replica; Railway shutdown grace ≥ 30 s (pg-boss drains for 20 s); Railway healthcheck must tolerate ~2 s of 503 at start; check on `restro-staging` that the session pooler accepts `statement_timeout`/`idle_in_transaction_session_timeout` as startup parameters (else set them with `ALTER ROLE restro_app SET …` in `db:roles`). Small cleanup: declare `pg`, `@types/pg`, `drizzle-orm` as worker dependencies (drop the tsup `require` shim) and parse worker config with Zod.
- Admin (from S1-05): Inter font (Cyrillic; the Platform's Instrument Sans has none), self-hosted at build time; next-intl wired without its build plugin (its native `@swc/core` fails on this Windows build); sign-up, org create/delete, invite and member removal are disabled (operator tasks); Stage 2: self-heal a missing tenant row in `requireTenant`; later hardening: a separate DB role for the `auth_*` tables (the app role can read password hashes today); add date-fns + @date-fns/tz with the date editors. **Bulgarian interface wording needs Martin's review** (`apps/web/messages/bg.json`: "Композитор", "Заведения", "Начин на поръчка", allergen names such as "Ядки", "Мекотели").
- Staging migrations: run by the deploy pipeline (Railway pre-deploy) once Railway exists; the one-off bootstrap of Supabase `restro-staging` runs from the lead's machine only with Martin's explicit OK (`RESTRO_DB_ALLOW_REMOTE=1`, runbook `docs/runbooks/supabase-setup.md`).
- **Doc fixes to apply in one pass at the end of Stage 1:** specials sit under the menu only (series never under many); Section hints are two fields `hint_color`/`hint_icon`; trace 4 writes `for_sale = false` (no `sold_out` field); price = `locked` + `never_when_orderable`; mapping-only fields (`slug`, Option `description`) to add to the template; scopes use our `vn_` ids, never a barsy `bid`; `value_hash` is SHA-256; refresh `docs/architecture/` mirrors from the live doc.

## Conflicts between the Menu Engine doc and earlier decisions
- **C1. Build order vs D4/D2** — **resolved by D39.**
- **C2. Open-account rounds vs D5** — resolved on the product side (D5). barsy side open (Q21, Q47); recommendation P41.
- **C3. "For confirmation" vs D13** — replaced by D18 + research (Q38, Q49).
- **C4. barsy payment link vs Stripe Connect** — D19 (preference), pending Q39/Q55/Q58. Strategic notes: (a) if confirmation and payment both run through barsy's flows, Restro is a nicer front end on what barsy already sells (Q29); (b) barsy's link presumably pays the venue directly, so Restro could not take a per-transaction fee; only Stripe Connect allows one (P50).
- **C5. Commercial gate missing from the doc** — open (Q25, Q41).
- **C6. Allergen gate vs club menus** — eased by D42 (attribute, warning only) pending the Bulgarian legal check (D25, Q42).

## Proposals (pending Martin)
**Still open**
- P52. **Display price:** barsy's base price (`actual_price`) or the live current price. **Kept open (Martin, 10-08).** Both prices are stored raw; the mapping has a `price_source` switch (default `actual_price`), so deciding later costs a config change and a replay.
- P53. **Permanent QR short domain** (`/t/<token>` on a permanent domain). **Kept open (Martin, 10-08)** — QR codes already resolve through `/t/<token>`; the domain must be chosen before any sticker is printed.
- P41. **Barsy bill model:** one barsy account per paid order (recommended) rather than rounds on one table account (Q21). Docs now show `Accounts_place` can create, pay and close in one call (payments accepted only on close).
- P42. **Split rules:** split by item / equal / custom, leftover cent, window expiry, and whether an order reaches the bar only when fully paid (recommended: yes).
- P43. **Writes to live barsy** allowlist — deferred to ordering by D41.
- P46. **Call waiter / request bill in v0:** only if barsy's API can message staff (Q48). `Messages_create` exists in the API; delivery to the hall team unverified.
- P48. **Deploy freeze:** no production deploys Thu–Sun 18:00–08:00 except fixes Martin approves (applied in the Stack tab; veto possible).
- P49. **What "EU hosting" means:** EU regions with data processing agreements (current: Railway Amsterdam, Supabase Frankfurt, Cloudflare, Sentry EU) or EU-headquartered vendors only.
- P50. **Post-pilot revenue model:** SaaS fee billed to venues (works with barsy's link) or a per-transaction fee (needs Stripe Connect).

**Decided at kickoff:** P40 → D45; P44 → D46; P51/P30 → D39; P45, P47, P38, P39, P31 → D50 defaults (veto possible).

**Waiting on answers**
- P32. Idempotency for later rounds (only if rounds are used, Q21/Q40).
- P33. Price under pay-first with Stripe: authorise → `Accounts_place` → check `Accounts_get` total → capture; void on any failure (only if Stripe — D19).
- P37. Order identification on the bar ticket: `Accounts_place` offers `account_alias` (shown in account lists), `description` (printed on the receipt) and `notes` (not printed) — proposal: alias = "Restro #<short order no> <first name>"; what prints on the bar ticket still to confirm (Q52).
- P10. Pilot: Restro reimburses the barsy resource fee, or negotiates a waiver — once the price is known.

## Superseded / resolved proposals
- P13 → D23/D36. P34 → D33. P35/P36 → D24. P14–P16, P18–P20, P22–P29 → adopted into or replaced by the Menu Engine doc. P21 → P30/P51 → D39. P17 → D36 (pg-boss). P40 → D45. P44 → D46.
- Stack options not adopted: Clerk, Inngest as the main queue, Vercel, Bun runtime (cost, D35); PostHog (replaced by first-party events). Supabase was not adopted on 10-01 but **is adopted as the database only** at kickoff (D43).

## Open proposals carried over
- Payments P4–P9 (09-27): hold → post → capture; saga steps; Stripe Connect direct charges; "you were not charged" copy; nightly reconciliation; capture-on-delivered in reserve. **Apply only if Stripe is used (D19 fallback).** Saga/idempotent steps (P5) and nightly reconciliation (P8) apply either way.
- P11–P12 (10-01): per-venue credentials encrypted server-side (→ D50/P38); docs first, one paid hour last (gap list = T9).

## UI and front-end details (library choices made: Tailwind, shadcn/ui, react-hook-form + Zod, TanStack Table, Recharts, next-intl)
- U1. Visual design: guest phone flow (menu, item, modifiers, cart, checkout, split, order status, ask-your-waiter) and venue admin (composer, item sheet, translations, tables & QR, publishing, settings, later stats and money). Admin follows the Platform patterns (`docs/platform-reference.md`); Martin brings phone shells.
- U2. Font list for venue themes: Cyrillic-capable, self-hosted via next/font (no Google Fonts CDN — EU privacy); load only fonts in use.
- U3. Icons: lucide (ships with shadcn) + a set for the 14 EU allergens.
- U4. **Data fetching convention (D50):** admin = server components for reads, server actions that call `apply()` for writes; guest = static shell reading snapshots from the CDN (no database); TanStack Query only for ordering later (order-status polling).
- U5. QR print sheets (PDF) per table; the domain waits for P53.
- U6. Email templates (React Email with Resend).
- U7. Images: plain `<img>` with our R2 variants; no Next.js image optimizer (saves Railway CPU).
- U8. Optional: service worker caching the guest shell and last snapshot for weak basement signal.
- U9. Theme tokens: semantic tokens mapped onto shadcn's CSS variables (readable text-on-colour pairs, R13); not the Platform's palette-by-index.

## Exploring (not decided)
- E7. Modular pricing: features billed separately (e.g. own waiter view for non-barsy venues)
- E8. Collect-at-bar for standing guests (after v0, D28)
- E9. Loyalty accounts (after v0, D34)

## Diagrams
- **Restro FigJam board** (figma.com/board/16TH17t585SNM9nN16OkGz): v2 of guest order & group checkout flow, system sequence, order lifecycle (09-27). Needs a pass with T29.
- Menu Engine doc: data pipeline diagram (Data architecture tab) and runtime map (Stack tab).
- Superseded v1 boards in "Martin Kostadinov's team" (09-26) — to delete (Martin)

## Research facts
### barsy API — verified against the official docs, 10-08 (signed in; corrects the Menu Engine doc)
- **Test access:** a test environment is requested by email to helpme@lukanet.com describing plans and goals ([Как да започна](https://docs.lukanet.com/barsy.api/integrations/10-begin.html)). A public **demo installation** is used in every example: host `demo.barsyonline.com`, user `demo`, password requested through the form at [barsy.bg/demo](https://www.barsy.bg/demo/) (company, contact, phone, email, anti-bot check — Martin submits).
- **Per-venue for-sale:** `is_for_sale_barsys` is returned only with extra property **`limits_by_barsys`** — the doc's full-pull list lacks it. ([Articles_getlist](https://docs.lukanet.com/barsy.api/methods/articles/getlist.html))
- **Paging:** without `order_by` the list "is not reordered" → offset paging can skip or repeat. Full pull uses `order_by: {article_id: "asc"}`; `ref_date` ordering exists for incremental sync.
- **Deletions:** filter `delete_flag` defaults to 0 → deleted articles never appear in lists; only D-webhooks and the full-pull absence check (rule 6) see them.
- **Tree checksum:** `Categories_getalltree` parameters are `cat_id`, `only_public`, `picture_content`, `articles_lazy_load_mode`; the description mentions checksums but no parameter is documented → we hash the tree ourselves (Q71). The tree also returns modifiers.
- **Prices are JSON floats** (`"actual_price": 2.40`); `actual_price` (base) vs `current_price` (after price rules) vs `original_price` (in currency). Parse losslessly, decimal string → minor units, half-up (rule 8).
- **Timestamps** in examples carry no offset (`"2012-09-27 17:12:29"`) → Q60 likely "no offset"; keep the 65-minute overlap.
- **Languages:** `MultiLanguageData` has 11 keys: bg_BG, en_US, de_DE, es_ES, fr_FR, it_IT, ro_RO, ru_RU, sr_RS, el_GR, tr_TR.
- **Allergens** live in article characteristics ("характеристики (включително алергенти)"); `article_details` extra property; `ArticleDetails_getTree` lists keys.
- Other useful filters: `search_article_ids` (batch refetch), `menu_id` (catalogue), `is_public`, `is_service`, `parent_cat_id`/`cat_id_deep`. Extra properties: `common` (min/common/all/public), `article_name_ml`, `ml_data`, `description_public`, `picture_url`, `categories`, `supplements`, `has_supplements`, `slug`, `current_price`, `actual_price`.
- **Webhooks** (for later): types 1 articles, 2 accounts, 3 client orders, 4 clients, 5 orders, 6 categories, 7 reservations, 8 modifiers; HEAD test accepted on 200–299/401/403/405/500/501; `X-Signature` = sha256 HMAC of body with the subscription secret; `X-Webhook-ID`; retries 1, 2, 4, 8… min up to 1 h; email every 5th failure; deactivated after 14 days; one subscription per user per type; rights: "Абонамент за webhook" + view right per type. ([Webhooks](https://docs.lukanet.com/barsy.api/integrations/40-webhooks.html))
- **Accounts_place** (for T29): `account_id` (continue) or new; `orders` rows with `article_id`, `amount`, optional `original_current_price`, `modificators`, `supplements`; **`payments` accepted only when closing**; `flag_close_account`; `print_receipt` (local print); `account.uuid` dedup; `account_alias` (shown in account lists), `description` (printed on the receipt), `notes` (not printed); `external_source`; **`lang_id` prints item names on the fiscal receipt in that language** (Q70). Recommended by barsy over Accounts_create/close for new integrations. ([Accounts_place](https://docs.lukanet.com/barsy.api/methods/accounts/place.html))
- **Messages:** `Messages_create` exists (Q48 partly answered; delivery to the hall tablet unverified).
- **Reports:** a "Справки" group with 10 methods exists (T21).

### barsy help — public pages, read 10-08 (undated)
- **"For confirmation":** accounts from external systems that need approval appear in POSX under Сметки → За потвърждение, only to the user assigned to the place's zone; if the place has no zone, or that user has no active session, all users see it. Example given: barsy's own QR-menu orders. No popup or sound is described. [Zones](https://docs.lukanet.com/barsy.help/120-posx/110-zones.html)
- **Verification setting:** "Задължителна верификация на поръчки" — mandatory check of orders before an account is created from a client request → configurable at least for client requests. [Settings](https://docs.lukanet.com/barsy.help/extra/settings.html)
- **Web-order scenarios (via API):** (1) client request — staff review, then convert; (2) open account — staff review/edit, close manually; (3) **closed account — created and closed automatically, no staff review**; (4) stock transfer. Option 3 maps naturally to pay per order (D5). [Web orders](https://docs.lukanet.com/barsy.help/220-workflows/90-eshop.html)
- **Account closing:** payments must balance; the fiscal receipt is issued when the account closes; a closed account changes only via storno. [Account](https://docs.lukanet.com/barsy.help/210-dictionary/account.html)
- **Order rows:** each row has a flow (bar/kitchen) and statuses ordered → ready → served; rows with a flow go to bar/kitchen printers or screens. [Account order](https://docs.lukanet.com/barsy.help/210-dictionary/account-order.html), [Order flows](https://docs.lukanet.com/barsy.help/110-admin/180-settings/orderflows/index.html)
- **Order identification:** POSX staff work by table. Client requests carry their own number (example "№ESHOP-2025-1148"). What a bar ticket prints is not in the public help. [Sale](https://docs.lukanet.com/barsy.help/120-posx/020-sale.html), [Client order](https://docs.lukanet.com/barsy.help/210-dictionary/client-order.html)
- **Messages:** barsy's internal mail; in barsy's own QR menu, "call a waiter" makes the POS send an automatic message to the hall team (tablet). [Messages](https://docs.lukanet.com/barsy.help/210-dictionary/message.html)
- **Payment links:** a setting sets how many hours a payment link stays active; invoices can be created and sent automatically after payment. Listed payment integrations: SumUp (card terminal), SelfiPay (biometric) — no online PSP named publicly. [Settings](https://docs.lukanet.com/barsy.help/extra/settings.html), [Integrations](https://docs.lukanet.com/barsy.help/110-admin/180-settings/230-integrations/index.html)
- **Reports barsy has (admin UI):** sales by period, article, category, venue, terminal, flow, user/waiter, client, visitors, bills, orders, reversals, payment method, place/hall, VAT group; order reports: refusals, modifiers used, staff actions, processed. API exposure unknown (T21). [Reports](https://docs.lukanet.com/barsy.help/110-admin/170-reports/index.html)

### Synex Platform review (10-08) — see `docs/platform-reference.md`
- Ontology (schema tree, singular/series/many nodes, ordered typed properties) → passport documents (materialised path) → `Passport/Render.jsx` view engine; Design = team theme tokens only. No composer/layout document, no QR, no draft/publish. Ten pitfalls listed in the reference doc.

### Supabase (checked 10-08)
- Free plan: two active free projects per user (paused ones don't count); paused after low activity over 7 days (our 5-minute polling keeps it active); no downloadable backups on free. Pro: $25/month per organisation incl. $10 compute credits (one Micro project), extra projects ~$10/month each, no pausing, daily backups. Martin's account: org "Personal Finance" (free), project MyFin paused.

### Allergen rules in Bulgaria — first pass 10-08 (full legal text not yet read)
- Ordinance on the provision of food information to consumers, Decree No 97 of 19 March 2021, State Gazette 25/2021. [FAOLEX](https://leap.unep.org/en/countries/bg/national-legislation/decree-no-97-19-march-2021-adoption-ordinance-provision). Full text not fetched (lex.bg blocks automated access).
- bTV (03.04.2024): catering establishments must indicate allergen-causing products **in their menus**; no prescribed format. Dnes.bg (2015, updated 2025): same requirements apply to food offered via websites. Schoenherr (2016): BFSA required allergen information for non-prepacked foods in writing.
- Reading so far: our QR menu likely needs allergens per item; drinks are food under EU law. To confirm (Q42).

### Euro changeover (checked 10-08)
- Dual BGN/EUR price display ran 08.08.2025–08.08.2026 per Счетоводство, данъци и право (3 Jul 2026); a related one-year extension concerns the ban on unjustified price increases (to 09.08.2027), not the display rule. Treat dual display as ended — accountant to confirm (Q65). [trudipravo.bg](https://trudipravo.bg/izbrani-statii/izbrani-statii-ot-epi-schetovodstvo-i-danatsi/otnosno-srokovete-za-bezplatna-obmyana-na-levovete-v-evro-i-dvojnoto-oboznachavane-na-tsenite/)

### Platform prices and versions — checked 10-08 (details in the Stack tab)
- Railway: Hobby $5/month incl. $5 usage; Pro $20/month incl. $20 usage; RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month, egress $0.05/GB; Hobby volume cap 5 GB; EU West = Amsterdam; volume backups daily/weekly/monthly (lost with the volume).
- Cloudflare R2 free tier: 10 GB-month, 1M Class A, 10M Class B ops/month; egress free.
- pg-boss 12 (12.37.0): Node 22.12+, Postgres 13+; cron/RRULE, retries with backoff, dead-letter queues, debounce, send inside an existing transaction (Drizzle adapter), dashboard.
- Next.js: 16.x is Active LTS for the whole major (support policy); 16.4 released 2026-10-06; the 2026-09-30 security release patched the then-newest minor (16.3.8). Node 24 LTS; Node 26 Current.
- Free tiers: Sentry 5k errors/1 user; Resend 3,000 emails/month, 100/day.
- GitHub Free: branch protection is not enforced on private repositories (needs GitHub Pro, $4/month) → protection by convention + CLAUDE.md.

### Lukanet (barsy) written reply (by 10-01)
- Docs need a free account (Martin has one). Paid consultations €130/h excl. VAT. Per-venue access: host + username + password. Writes need a "software resource" billed to the venue's barsy subscription; price only via the venue. barsy also sells its own QR ordering add-on.

### Payments, failures, refunds (09-27)
- Uber Eats / Uber rides / Wolt hold-then-capture patterns; DoorDash state machine of idempotent steps (~1% of orders saved daily); Stripe manual capture (holds ~7 days, partial capture releases the rest); Stripe Connect direct vs separate charges; saga pattern; idempotency keys + reconciliation. Sources: help.uber.com, uber.com blog, explore.wolt.com, careersatdoordash.com, docs.stripe.com, microservices.io, temporal.io.

### Earlier
- N-18: card payments are not an exemption from fiscal receipt → receipt from the venue's barsy/fiscal device, delivered electronically. Confirm with accountant. The review notes that taking money without a fiscal receipt can lead to sanctions up to sealing the venue (ЗДДС art. 186) — accountant to confirm.
- Stripe Connect available in Bulgaria (stripe.com/en-bg/connect/pricing); Stripe balances treated like a bank account (t8gconsulting.com).
- sunday: layers on POS + processor, split by item/seat/people/custom. me&u Pay: ~50% guest adoption, ~15 min faster turns, more tips.

## Open questions
**Answered 10-08:** Q5/Q7 read side, Q18 (→ D29), Q19 (→ D30), Q20 (→ D27), Q23 (account level), Q30, Q31, Q32 (→ D23/D36), Q34–Q37, Q44 (→ D24), Q50 approach (→ D31), Q51 (→ D32). **Partly answered from the official docs (10-08):** Q26 (test env is requested via helpme@lukanet.com), Q47 (one call can create, pay and close), Q48 (`Messages_create` exists), Q52 (alias/description/notes fields exist), Q60 (examples carry no offset).

**Ask Lukanet / pilot owners before building ordering (T9, T13)**
- Q47. Does an `Accounts_place` call with payments and `flag_close_account = 1` issue exactly one fiscal receipt, and do the order rows still go to bar printers/screens when the account closes automatically?
- Q55. If the payment link needs the bill first: can an unpaid bill be kept from printing and from "For confirmation" until it is paid, and cancelled automatically if it is not?
- Q58. Payment link: which provider; Apple/Google Pay; partial amounts / several payers; authorise-then-capture; refunds through the API; a payment webhook or callback; tips; fees; exactly one fiscal receipt. (extends Q39)
- Q49 / Q38. Popup or sound for new "For confirmation" accounts; can confirmation be switched off or auto-accepted for paid API accounts?
- Q48. Does a message created with `Messages_create` reach the hall team's tablet (call waiter, request bill, ask-your-waiter items)?
- Q52. What prints on the bar ticket for an API account — does `account_alias` or `description` appear?
- Q56. Can an account be looked up by our `uuid` (needed after barsy refuses a retry as a duplicate)?
- Q57. Can we get barsy's price for a cart without creating an account?
- Q59. What exactly does `Poses_register` affect — can it disturb the venue's own POS?
- Q60. Confirm: `last_update` timestamps are venue-local without offset? (DST ends 25 Oct 2026)
- Q71. `Categories_getalltree` mentions checksum support but documents no parameter — is there one?
- Q21. Each paid order = its own barsy account, or rounds on one table account? (recommendation P41)
- Q40. Order-level dedup for later rounds (only if rounds)
- Q26. Test installation, ideally with a test fiscal printer (D33) — request per the docs (T39)
- Q41 / Q28. Is the "software resource" the registered POS; **does read-only API access need it?**
- Q25. Monthly price of the "software resource" — flat or per volume/device?
- Q24. Partial refund (storno of one item) via API, with fiscal storno receipt?
- Q29. Resource price vs barsy's own QR ordering add-on.
- Q46. Can translations be written into barsy articles via the API (`ml_data`); rights/cost? (D26)
- Q53. Which sales/report data can the API return ("Справки" methods); extra rights or cost? (D31)
- Q6-remainder. Contractual restrictions on third-party integrators? Q3-fallback: what if the price kills the pilot economics, or Lukanet declines?

**Lawyer / accountant (T33)**
- Q8. Fiscal receipt for online-paid orders via barsy; electronic delivery.
- Q62. Who issues the fiscal receipt on each payment route, and when (Наредба Н-18)?
- Q63. Does Restro count as sales software under Н-18?
- Q64. Must guests get a paper receipt, or is an electronic one enough?
- Q65. Does dual BGN/EUR price display still apply (we read: ended 8 Aug 2026)?
- Q66. Any duty to check age for alcohol ordered in the app inside the venue (D11)?
- Q67. GDPR: who is controller and who is processor (venue vs Restro); the data processing agreement; retention periods; guest privacy notice and terms.
- Q42. Allergen rules for food and drinks in catering and online menus: per item? digital menu enough? Then: do pilots hold allergens in barsy?
- Q10. Online tips accounting treatment.
- Q70. `Accounts_place` `lang_id` prints item names on the fiscal receipt in that language — may a Bulgarian fiscal receipt carry English item names when the guest orders in English? (Default until answered: always `bg_BG`.)

**Martin**
- ~~Q72. Is reusing code and patterns from the Synex Platform in Restro fine IP-wise?~~ Answered 10-08: yes (D51).

**Pilot venues (T3)**
- Q43. Time-based price lists (happy hour)? Q45. EN names in barsy? Q54. Which stats do owners want (after T21)?
- Q68. How do staff mark items sold out today, and where?
- Q69. Who on the venue side answers an alert at night?
- Q12. Wi-Fi and mobile signal on the floor.
- Q73. Which pilot venue goes first, and who is its barsy admin (to create the read-only API users)?

**Product design**
- Q22. barsy post retry window before voiding (only if Stripe holds)
- Q11. Disputes: "drink never arrived" / unauthorised use
- Q15. Fixed per-transaction fee impact on small tickets

**Field**
- Q1–Q4. Why barsy clubs don't use barsy's QR add-on; lost orders; owner/waiter appetite; table vs. bar revenue share

## Tasks
**Stage 1 — set up the ground (in progress)**
- [x] T35. Platform reference map (`docs/platform-reference.md`) — Claude, 10-08
- [x] T36. Repo `E:\Restro` initialised; research moved to `docs/research/`; doc mirrors in `docs/architecture/`; agent brief template — Claude, 10-08
- [x] T26. Scaffold the repo (pnpm monorepo, CLAUDE.md, CI gates, import rules, fixtures harness), document-model foundation, DB with RLS, admin and worker shells, barsy read client skeleton — Claude + subagents, merged on `s1/ground` 10-09 (662 tests + 6 browser tests green); pull request to `main` for Martin
- [x] T42. First real barsy recording (`pnpm barsy:record -- --method Misc_ping_user`, plus a wrong-password recording) — done 10-09: Misc_ping and Misc_ping_user return 1; a wrong password returns HTTP 401 with plain-text body "Проблем с автентикацията: Грешен потребител или парола"
- [x] T43. Bootstrap Supabase `restro-staging` (migrations + `restro_app` role) — done 10-09 with Martin's OK: 3 migrations, `restro_app` safe, RLS forced on tenant tables, `anon`/`authenticated`/`service_role`/`authenticator` have no access to `restro` or `pgboss`, app login through the session pooler with a verified certificate
- [x] T46. (done 10-09: `db:roles` sets the timeouts on the role; verified on restro-staging through the pooler: 30s / 1min. Also: `db:roles` now keeps an existing password unless `DATABASE_APP_PASSWORD_ROTATE=1`, because re-setting it broke pooled logins until Supavisor refreshed its cache) The Supabase session pooler ignores startup `options` (statement_timeout came back as Supabase's 2min default): set `statement_timeout=30s` and `idle_in_transaction_session_timeout=60s` with `ALTER ROLE restro_app SET …` in `db:roles` before the app runs on staging — Claude
- [ ] T45. Production deploy pipeline (Stage 3, with Railway) re-runs `scripts/freeze-window.mjs` at deploy time and refuses to deploy inside the freeze window; the PR check is only an early warning — Claude
- [ ] T44. Review Bulgarian interface wording in `apps/web/messages/bg.json` — Martin
- [ ] T40. Doc updates: "Core rules" section; QR-phone-only scope; polling; Supabase; trace 4 manager-only; barsy corrections; new "Stage plan" tab — Claude
- [x] T37. Supabase organisation "Restro" + project `restro-staging` (created in West EU/Ireland, D54) — Martin, 10-09; Data API toggle not found in his dashboard: not critical (no API role can reach our schemas, verified)
- [x] T38. barsy demo credentials received — Martin, 10-09 (in `.env.local`)
- [ ] T39. Send the Lukanet test-environment request (draft by Claude, includes Q41, Q60, Q71) — Martin
- [x] T41. Answer Q72 (Synex code reuse) — Martin, 10-08: yes

**Before Stage 2 / 3**
- [ ] T25. Platform accounts by stage: before Stage 2 the pilot venue's read-only API users (Q73); before Stage 3 Railway (EU West), main domain, Cloudflare (R2 with EU jurisdiction, `cdn.` domain, token), Sentry (EU region), Resend, Telegram bot, Supabase `restro-prod`; the short QR domain waits for P53 — Martin (click-by-click guide from Claude)

**Carried over**
- [ ] T9. Send Lukanet the consolidated questions (Q47, Q55, Q58, Q49/Q38, Q48, Q52, Q56, Q57, Q59, Q60, Q71, Q21, Q41/Q28, Q24, Q46, Q53) — the test-environment request goes first and separately (T39); one paid hour (€130 + VAT) only for what stays open — Martin
- [ ] T13. Ask one pilot-club owner to request the "software resource" price from Lukanet (Q25, Q29, Q41) — Martin
- [ ] T33. Send the lawyer/accountant questions (Q8, Q62–Q67, Q42, Q10, Q70) — Martin
- [ ] T29. Write the orders and payments spec into the doc: table sessions, orders, order lines (price shown vs billed), shares, payments, refunds, payment inbox, money events, state machines, failure table per route, live-night safety kit, receipt delivery — Claude; skeleton before Stage 4, details after T9/T33
- [ ] T31. Guest privacy notice and terms; data processing agreement with each venue — Martin + lawyer, before the first guest
- [ ] T17. Martin's remaining decisions: P41–P43, P46, P48–P50, P52, P53, fee reimbursement (P10, after Q25); veto window on D50 defaults
- [ ] T20. Read the 2021 food-information ordinance (lex.bg, needs a browser) or ask the lawyer (Q42) — Claude can read it in the built-in browser
- [ ] T21. Research what data barsy can provide for venue stats (logged-in API docs, "Справки") — Claude + Martin
- [ ] T23. Research whether translations can be written into barsy articles (D26, Q46) — with T21
- [ ] T24. `Accounts_place` note/name fields found (alias/description/notes); what prints on bar tickets still open (P37, Q52)
- [ ] T3. Pilot-club interviews: owners + waiters (Q1–Q4, Q12, Q43, Q45, Q54, Q68, Q69, allergens in barsy, reaction to waiter confirmation and the resource fee) — Martin
- [ ] T34. Visual design (U1) for the guest flow and venue admin — Martin brings phone shells; admin follows the Platform patterns
- [ ] T27. Monthly restore drill from the backups — once live
- [ ] T4. Test barsy's QR menu + one other BG QR app live; document UX failures (tests H3)
- [ ] T6. Accountant check (Q8) — folded into T33; ask Happy Bar & Grill / its POS vendor how their phone-payment receipt is issued
- [ ] T10. Design group checkout / split flow in detail — inside T29, after P42
- [ ] T12. Delete the 3 superseded v1 FigJam boards — Martin
- [x] T28. Design the stack and add it to the knowledge base — done 10-08; amended at kickoff (D43)
- [x] T18. Fold Martin's 10-08 decisions into the Menu Engine doc — done 10-08
- [x] T14, T1, T15, T16, T8, T11 — done
- [~] T2. Lukanet contact — written reply 10-01; next contact = T39, then T9

## Hypotheses (unvalidated)
- H1. Clubs lose orders on busy nights waiting for waiters
- H2. Waiting for the bill to pay by card is a major pain
- H3. Most BG ordering apps are badly designed, which may explain low adoption (caveat: owners buy, guests use)
