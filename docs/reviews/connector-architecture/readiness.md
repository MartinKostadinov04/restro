# Connector readiness — synthesis and roadmap

Lead synthesis of the 10-11 review: R0 benchmark, A1 core, A2 data, A3 sync, A4 admin, A5 guest/outbound, B1 barsy connector, A6 guardrails. The reports are in this folder.
- **Spot checks:** I read at least 3 cited `path:line` facts per report. All held except one off-by-a-line citation in A3 (`connection.ts:13` is the pool size; the one-lock fact is right).
- **Scope:** spreadsheet import was dropped mid-review (D65), and its proposals are removed below.

## Verdict

**The deep foundations are right and enforced:**
- the own menu model;
- one write path with per-value provenance;
- append-only raw records;
- external ids only in links;
- "absence only after a complete read";
- immutable snapshots;
- a guest side with no vendor words in code;
- RLS on every table.

**Gaps.** The middle layer, where a connector plugs in, was never built: there is only one connector, so barsy's name and shape fill that space. Three gaps decide readiness:
1. **The till's role is named "barsy"** in the core rules, the stored data and the UI (528 mentions in core).
2. **Connections, locations and tables are barsy-shaped tables**, and the admin treats "the" barsy connection as part of a venue.
3. **There is no connector contract:** no manifest, no capabilities, no conformance tests. The generic sync engine lives inside barsy's files.

**Gaps nobody had noticed:**
- The admin cannot create a venue or a menu item (A4).
- Two safety holes caused the hidden menu on 10-10/11 (B1):
  - no floor on empty reads;
  - sync state not keyed by scope.

All three are being fixed now (CF-01, CF-02).

## Scorecard (0 absent · 1 barsy-shaped · 2 generic idea, barsy names · 3 neutral · 4 neutral + enforced)

| Part | Score | Why (reports) |
|---|---|---|
| 1 Own model | 2 | Neutral menu shapes; the till layer and owner are named barsy (A1, A2) |
| 2 Connector plug + capabilities | 1 | No seam, manifest or capabilities; `kind in ('barsy')` (A1, A3, A4) |
| 3 Stages raw → translated → merged | 2–3 | Raw tier, provenance and rejected rows exist. Raw is stored after translate, with no replay or quarantine (A1, A3, B1) |
| 4 Own ids, theirs as links | 3 menu / 1 tables | Links and leak guard are solid; `bid`/`place_id` live in tables (A2, A5) |
| 5 Connections ↔ venues | 1–2 | Org-owned rows, but a barsy-named location table, the UI inside the venue, and no venue creation (A2, A4) |
| 6 One sync engine | 2 | Locks, rule 6, DST-safe schedule and run records exist, inside barsy files; unit = integration (A3, B1) |
| 7 Write-back | 0 | Expected before Stage 4; a full neutral design is ready (A5) |
| 8 Contracts and tests | 1–2 | Recorded fixtures and property tests, barsy-only; no conformance suite (A3, A6) |
| Tenancy / RLS | 4 | `rls-guard`, `TABLE_ACCESS`, composite foreign keys (A2) |
| Secrets per connection | 3 | Sealed envelope bound to tenant, connection and host; credential shape fixed (A1, A4) |
| UI by capabilities | 0–1 | The web branches on "barsy" everywhere (A4) |

## Decisions taken by the lead (where reviewers differed)

1. **One neutral `till` layer, not one layer per connection** (A1, A2; R0 agrees).
   - Source `till:<in_>`, owner `till`.
   - "Orderable" = an active till link (any kind), not a barsy `article`.
   - At most one till link per node.
   - The `import` layer goes in the same migration (D65): layers = till, manual, override, edition.
2. **Keep the table name `integrations`.** "Connection" is UI wording (A1, A2). R0's rename is rejected: it buys nothing and touches the sealed-credential binding.
3. **Publish policy on the venue:** `after_sync`, `new_items` and `auto_paused` all move to `venues.settings` (A1, A2, A4, A5, D59). A3 wanted `new_items` on the connection, which is overruled: one connection can feed several venues.
4. **The manifest is split** (A1 + A3 + A4).
   - A data manifest in core (`core/connectors/<kind>.ts`: label, credential fields, option fields, capabilities, link types, absence policy) is what the web reads.
   - The executable connector (`packages/connectors/<kind>`) is imported only by the worker.
   - The worker writes the granted capabilities to the connection row at connect.
5. **Capabilities never change `orderable` in a snapshot** (A5 over R0). Granted or health state lives only in the live overlay, so a reconnect never re-hashes snapshots.
6. **The sync unit is (connection, location)** (A3, A2).
   - Location table with text external ids, plus per-location sync state.
   - **Link scope in v1:** every till link type is location-wide (A2's correction of A3). It is the simplest correct rule 6. Decision for Martin (below), because it costs duplicated enrichment between venues on one installation.
7. **Webhook signatures are verified in the worker** (A1). The web stores the raw body and answers 200, which respects D55 (the web never opens secrets). Decided with the first webhook connector; nothing is built now.
8. **Absence safety:** no conclusion from an empty read, or from one that would hide more than 30% (5 or more items), until a person confirms (B1, T62). This ships now in CF-02. The person's "confirm" comes with the switch preview (CF-11).

## Roadmap: the connector foundation (before Stage 4)

**Order:** strictly sequential where files overlap, with at most 3 agents at once (D58). Sizes: S < half a day of agent time, M ≈ a day, L = several sessions.

| # | Work item | From | Size | Tier | Migration | Depends |
|---|---|---|---|---|---|---|
| **CF-01** | New venue and new item in the admin (running) | A4-P1, P2 | M | Sonnet | n | — |
| **CF-02** | Barsy sync safety: empty/30% hold, scope fingerprint, option names, host change refused (running) | B1-Q1, Q2, Q3, Q5 | M | Sonnet | n | — |
| **CF-03** | **Neutral till role**: layer, source, owner, provenance and orderable become `till`; drop `import`; 7 database checks and constraint names; rewrite stored values and `events`; web and worker consumers; `OffSaleBy`/badges `'till'`, messages take `{source}`; one till link per node | A1-P1, P3, P9; A2-P1; A4-P4 | L | **Opus** | y (0014, reversible) | CF-01, CF-02 merged |
| **CF-04** | Publish policy on the venue: `after-sync.ts`, the Publish tab and pause read `venues.settings.publish`; key copy | A2-P6, A4-P13, A5-P12 (policy part) | M | Sonnet | y (copy) | CF-03 |
| **CF-05** | **Connections, locations, areas, tables (data):** `integrations` gains kind pattern, `disabled`, name, capabilities, schedule; `connection_locations` + `location_sync_state`; `areas`; `places.venue_id`, area, kind, external id; backfill; writers rewritten; `tb_` ids and tokens kept | A2-P2, P3, P4, P7; A1-P7 | L | **Opus** (migration) + Sonnet | y (0015 expand, 0017 contract later) | CF-04 |
| **CF-06** | **Connector contract and kit:** data manifest in core, `packages/connector-kit` (contract, capabilities, error kinds incl. `rate_limited`/`Retry-After`, `deriveId`/`describeSource`, host policy), generic seal and open, neutral job names | A1-P2, P4, P5; A3-P1, P6, P14 | M | **Opus** design | n (queue drain) | CF-03 |
| **CF-07** | **Engine extraction:** barsy moves to `packages/connectors/barsy`; worker `engine/` (tick, sync, lock, chunk, limiter, runs); unit (connection, location); location-wide links (T50); raw stored before translate | A3-P2, P4; A2-P5; B1-L4 | L | **Opus** design, Sonnet moves | y (re-sync of test data) | CF-05, CF-06 |
| **CF-08** | **Guardrails:** connector conformance suite with a fixture transport; bid-aware barsy test kit using all 5 recordings; dependency rules for `connectors/*` pinned by tests; one vendor-word test; request-equals-recording test | A3-P10, B1-L7, A4-P15, A5-P13, A6 | M | Sonnet | n | CF-07 |
| **CF-09** | **Settings → Integrations** (organisation area): connection list and detail, manifest-driven credentials and options forms, locations card (Add as venue / Linked to / Not used), health; the venue Source card replaces the Integration tab; tabs follow capabilities | A4-P3, P5, P6, P7, P9, P10, P14 | L | Sonnet (Opus for `createVenueForLocation`) | y (location state) | CF-05, CF-06 |
| **CF-10** | **Tables done right (T66/T67):** read tables at mapping time, independent of the root; halls by id and weight; place kinds; defaults (tables and bar stools get codes; hide `--` and `--`-only halls; skip non-public); "which places get codes" card; hand-made tables; empty-state reasons | B1-L1, A4-P11, P12, A3-P12 | M | Sonnet | y | CF-05, CF-07 |
| **CF-11** | **Switch preview:** dry-run "plan" stage, then a confirm dialog with exact hide counts for venue or root changes; releases a CF-02 hold | A4-P8, B1-Q7, A3 plan stage | M | Sonnet | n | CF-07, CF-09 |
| **CF-12** | **Small hardening:** live overlay parsed loosely (parser first), `Referrer-Policy: no-referrer` on `/m` and `/t`, picker hints (`public_cat_id`, article counts), EUR check at connect, role check cleanups | A5-P1, P3; B1-Q6, Q10; A4-P16 | S | Haiku/Sonnet | n | any time |
| **CF-13** | **Docs:** neutral "Outbound" command contract (barsy as appendix), stack.md registration state, hand-off guide wording, CLAUDE.md neutral rules (A6 draft) | A5-P14, A6 | S | Sonnet, lead reviews | n | CF-08 |
| — | **Then:** the connector guide `docs/guides/connectors.md` + CLAUDE.md section + brief template (A6 outline) | A6 | M | Sonnet, lead reviews | n | CF-01…13 |

**Later, not blocking Stage 4:**
- per-record quarantine and replay (B1-L2, A3-P3);
- generic media fetch (A3-P7);
- queue isolation per kind (A3-P5, after a pg-boss groups spike);
- fresher deletions (B1-L5);
- mapping completeness: portion, combo flags (B1-L6);
- barsy item order (B1-L8);
- readiness report for a club's barsy data (B1-L3, before the pilot).

**Stage 4 (ordering)** builds on A5's neutral design:
- tenant seam;
- `orders`, `commands` and attempts;
- the command engine;
- the in-memory writer first;
- `live.json` ordering state;
- the shell's ask-your-waiter rule.

## Decisions for Martin

1. **Several venues on one barsy account:** *on hold (T71).* Martin: follow barsy's own structure. The demo data shows barsy keeps items in catalogues, with a per-venue "for sale" map on each item. New proposal: one Restro item per barsy item, with per-venue sale state and price, checked per catalogue. Confirm with barsy's docs first.
2. **A venue's public address `/m/<slug>` is fixed once created.** QR codes don't use it; links people share do. **Recommend fixed for now**, with an editor later if needed.
3. ~~Hand-made items on a venue with a till~~: **decided 10-11 (D66).** In a till venue the till is the only source of items, because nothing made here can reach the POS. Hand-made items exist only in venues without a till; sections and enrichment stay ours. Keep it one gate for future use cases.
4. **Staging database:** allow a wipe and re-sync for the location-wide link change (test data only). **Recommend yes**; asked again at deploy.
5. **Recording session with barsy admin rights** (demo admin login, or the read-only user from Lukanet, T39/Q73). Needed to confirm:
   - the shape of per-venue "not for sale";
   - how a missing right answers;
   - whether deleted items can be listed;
   - the time zone of `last_update`.
6. **Later, with the shell discussion (D63):** whether a non-orderable item shows "Ask your waiter" while ordering is on.

## Guardrails (A6) and the changed order

**A6's verdict.** Today the repo would stop an agent writing connector #2 only by accident:
- the `kind in ('barsy')` check and the barsy-only layer rule refuse it outright;
- the easy way out would be to relabel it "barsy" (false provenance).

**Barsy-only guardrails that would not cover connector #2:**
- the dependency rules (`barsy-only-from-worker`, `web-no-barsy`);
- the write allowlist test;
- the recorder and replay harness.

**A real hole:** a package at `packages/connectors/<kind>` would not be a workspace member or a Vitest project, so its tests would never run.

**Adopted (D67):** guardrails are pinned by tests and only tighten.

**Plan changes:**
- **CF-08 splits.** The cheap, independent part runs now as **CF-08a**:
  - a workspace guard test (every package is a workspace member, a Vitest project and typechecked);
  - root Biome exclusion for `fixtures/`;
  - **one vendor-word test** (`scripts/vendor-words.test.ts`, TypeScript tokenizer, comments exempt), with zones:
    - the published surface is a wall (0 today);
    - core, web, worker and db are ratchets that may only shrink;
  - a PR template with a "guardrails touched?" list.

  It replaces the bespoke core test in CF-03 and A1-P2, A4-P15 and A5-P13.
- **The conformance kit** (`@restro/connector-kit/testing`):
  - modelled on the face contract;
  - checks K1–K16 (pure, no DB) and E1–E6 (engine, DB);
  - an in-memory reference connector, with ten mutants that must each fail.

  It goes into **CF-06**. Barsy adopts the suite *before* CF-07 moves it, so the move is checked by the suite the next connector will face.
- **Dependency rules** replace the barsy-named ones with CF-06/CF-07: `connectors-only-from-worker`, `connector-kit-only-above-core`, `connectors-isolated`, `connectors-not-each-other`, `connectors-no-io-builtins`, `connector-entry-points-only`. Each is pinned in `scripts/depcruise-rules.test.ts`.
- **Fixture standard** (redaction before write, consent label, facts-to-verify list, a generic recorder that records the request production actually sends) comes with G7. It needs Martin's recording session.
- **The CLAUDE.md rewrite** (A6 §5.5 draft) and the connector guide outline (A6 §8) feed CF-13 and the guide.

## barsy's own item structure (T71, recorded 10-11)

Martin asked that the venue/item question follow barsy's own architecture. The demo data shows:
- items live in **catalogues** (`menu_id`), and each barsy venue points at one catalogue;
- different catalogues hold different items;
- every item carries a per-venue "for sale" map (`is_for_sale_barsys`, e.g. venues 1, 10, 70, 102). That is barsy's "item → venues" shape, and our mapping already reads it correctly.

**Proposal:** follow barsy.
- One Restro item per barsy item, with sale state and price kept per venue (the till layer already does this).
- Read and "deleted" checks run per **catalogue**, not per venue. This removes A2's rule-6 concern without duplicating items.

**Still to confirm with barsy's docs or Lukanet before CF-05/CF-07 fix the sync unit:**
- whether two venues can share a catalogue;
- whether prices differ per venue;
- what the map means for venues on another catalogue.

Decision 1 below is therefore on hold until then.
