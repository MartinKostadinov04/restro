# Connector-architecture review — agent prompts

Used on 10-11 for the read-only review (plan approved by Martin 10-11). Each agent got the shared preamble, then its own section; wave-2 agents also got the lead's summary of wave 1, and A6 the summaries of all reports.

| # | Area | Model | Wave |
|---|---|---|---|
| R0 | External benchmark | Sonnet | 1 |
| A1 | Core model and merge engine | Opus | 1 |
| A3 | Connector and sync pipeline | Sonnet | 1 |
| A2 | Data layer | Sonnet | 2 |
| A4 | Admin app | Sonnet | 2 |
| A5 | Guest side and outbound | Sonnet | 2 |
| A6 | Guardrails, tests, docs | Sonnet | 3 |

## Shared preamble (prepended to every prompt)
> You are reviewing **Restro** (`E:\Restro`), a QR-to-phone menu platform for nightclubs. Today it reads one till system, barsy; it must grow to more sources: another till such as Mistral (no docs yet), spreadsheet import, and venues with **no till** (D64).
>
> **Read first:** `CLAUDE.md` and `docs/tracker.md` (D38–D64, T47–T69, especially T50, T62, T66–T69). Then the architecture doc `docs/architecture/data-architecture.md` (its "Collection paths", "Identity and linking", "Layers, ownership and resolution" and "Outbound" sections).
>
> **Your job is a read-only assessment, not a fix.**
> - Never edit, create or delete files, commit, install, or run commands that write (no `pnpm install`/`test`/`build`, no database). Read-only shell commands (`git log`, `git grep`, listing) are fine.
> - Never open `E:\Restro\.env.local` or any `.env*` except `.env.example`.
> - `C:\Platform` is out of scope.
>
> **Reference architecture.** Rate each part 0–4: 0 absent · 1 barsy-shaped · 2 generic idea with barsy names · 3 neutral · 4 neutral and enforced by tests or dependency rules.
> 1. **Own model:** the platform's own shapes for venue, menu, price, availability, table and order; nothing inside speaks a source's language.
> 2. **Connector plug:** one connector per source, behind a fixed contract (connect, discover locations, read full, read changes, translate, optional write), plus declared **capabilities** (menu, prices, tables, availability, orders, payments, push or poll).
> 3. **Stages:** raw copy (replayable) → translated and validated (quarantine for bad records) → merged, with field-level provenance and precedence.
> 4. **Own ids, theirs as links:** external ids only in link tables; switching or adding a source breaks nothing downstream.
> 5. **Connections ↔ venues:**
>    - connections belong to the organisation and own their credentials, status and schedule;
>    - the locations a source reports are linked to venues by a person;
>    - venues exist without any connection.
> 6. **One sync engine:** scheduling, queues, retries, rate limits, locks, cursors, "deletion only after a complete read", health. Written once; connectors plug in; one failing connection is isolated.
> 7. **Write-back as commands:** idempotency key, outbox, retries, confirmation, reconciliation; per connector.
> 8. **Contracts and tests:** a conformance suite every connector passes, recorded fixtures, versioned mappings, an extras field for source quirks.
>
> **Cross-cutting checks:** tenancy and RLS for connection data; secrets per connection; observability per connection; UI driven by capabilities, not by "is barsy"; no over-engineering. We expect about 3–5 connectors, not 500.
>
> **Method.**
> - **Evidence:** every finding cites `path:line` and is marked **Fact** (seen in code) or **Inference**. Never invent barsy or Mistral behaviour.
> - **Two walk-throughs:** list every file and table that would change:
>   - **(a) a second till "X"** with locations, categories, products with modifiers, per-location prices, availability flags, tables, webhooks instead of polling, and an order API;
>   - **(b) a venue with no till.**
> - **Proposals:** prefer reusing existing code and name the functions to reuse.
>
> **Report** (≤ 1,800 words plus tables; code snippets ≤ 10 lines). Sections:
> 1. Scope read
> 2. Scorecard (the parts that apply, rating, one-line evidence)
> 3. Findings: id `<agent>-F<n>`, severity (blocker for a 2nd connector · significant · minor), fact or inference, `path:line`, why it matters
> 4. Walk-throughs (a) and (b)
> 5. Proposed adjustments: id, what, why, size S/M/L, risk, data migration (y/n), depends on, model tier (Haiku/Sonnet/Opus per D58), before or after Stage 4
> 6. Keep as is: what is right and must be preserved
> 7. Open questions, each with a recommendation
> 8. Rules for the future connector guide from your area

## Per-agent prompts (appended after the preamble)

**R0: External benchmark (Sonnet, web research).**
> Research how established integration platforms define connectors; cite URLs. Covers:
> - **Open connector specs:** Airbyte (connector spec, CDK, streams/catalog, state and cursors, full refresh vs incremental, connector acceptance tests), Singer (tap messages: schema, record, state) and Meltano.
> - **Unified APIs:** Merge, Codat and Chift (common models, remote ids, passthrough, field mapping, coverage/capability matrices).
> - **Hospitality hubs:** Deliverect and HubRise (location mapping, menu pull vs push, availability/snoozing, order injection and status callbacks).
> - **POS partner APIs:** Toast and Square (location model, menus, webhooks).
>
> Extract the recurring patterns for:
> - contract operations;
> - capability declaration;
> - location mapping;
> - sync state;
> - id mapping;
> - write-back (idempotency, status, reconciliation);
> - testing and certification;
> - how their connector-developer guides are structured.
>
> Read only `docs/architecture/data-architecture.md` from the repo, to use its vocabulary. End with:
> - a **"Restro connector contract v1" sketch**, sized for 3–5 connectors;
> - what to deliberately not copy.
>
> Use the report sections where they apply (2–4 can be "n/a").

**A1: Core model and merge engine (Opus).**
> **Scope:**
> - `packages/core/src`: `change-set.ts`, `apply/*`, `resolve/*` (`layers.ts`, `combine.ts`, `resolve.ts`, `types.ts`), `templates/venue-menu.ts`, `field-definition.ts`, `field-types/*`, `validate-write.ts`, `sale-state.ts`, `money.ts`, `ids.ts`, `jobs.ts`, `sync/*`, `sync-settings.ts`, `sync-schedule.ts`, `seal/*`, `snapshot/leak-guard.ts`;
> - their property tests.
>
> **Questions:**
> - Where is "barsy" a role (the till) and where only a name? The lead counted about 436 mentions in `packages/core`.
> - **Layers:** layer `'barsy'`, source `barsy:<in_>`, template `owner: 'barsy'`, `BARSY_DISPLAY`/`BARSY_STRICT`, resolver `linkedToBarsy`/`barsyArticle`, `orderable` = an active barsy `article` link.
>   - Design the neutral form: one `till` layer per venue, or layers per connection.
>   - Handle till + spreadsheet, and no till (the manual layer as base).
> - **Rule 5** ("ours only more cautious than the till") and **rule 6:** state them per source kind, and check the property tests can be parameterised over sources.
> - **Write validation:** venue scope only on the till layer; adapter writes need `sourceRecordId` and `mappingVersion`. Generic for every connector?
> - **`jobs.ts`:** barsy job names and payloads live in core.
> - **Per-source pieces:** money rounding and sale-state as per-connector conversions; the leak guard's forbidden list declared by connectors; per-connection seal.
> - **Migration strategy** for renaming stored values (`field_values.layer`/`source`, `events`, link sources) while only test data exists: one migration, verification, rollback.
>
> **Output:** the minimal set of core changes for neutrality, and what must not change.

**A3: Connector and sync pipeline (Sonnet).**
> **Scope:**
> - `packages/barsy/src` (`read`, `mapping`, `record`, `testing`, `write`);
> - `apps/worker/src` (`sync/*`, `jobs/barsy.ts`, `jobs/index.ts`, `jobs/types.ts`, `config.ts`, `registry.ts`, `publish/after-sync.ts`);
> - `packages/core/src/jobs.ts`, `sync-schedule.ts`, `sync-settings.ts`;
> - the S2-03b and S3-04 briefs in `docs/agent-briefs/`.
>
> **Tasks:**
> 1. **Derive the implicit connector contract** from what barsy does: connect, discover venues, category trees, full pull, incremental, places, photos, detail and allergen keys, languages and currencies.
> 2. **Classify the code.** A table: file → generic / barsy / mixed → where it should live. Known generic code inside the barsy sync: pull lock, chunked apply, paging, limiter, cursor, run recording, absence conclusion.
> 3. **Engine questions:**
>    - scheduling per connection (`barsy-sync-tick`, `dueSyncs`);
>    - the lock and pool cap with many connections;
>    - the error and status-code taxonomy;
>    - host policy and rate limits per connector;
>    - photo fetching as a generic media fetch with per-connector auth;
>    - versioned mapping config;
>    - **push support:** could a webhook-driven connector plug in?
>    - T50 (job key and absence check per integration);
>    - capability declaration;
>    - how the worker discovers connector kinds.
> 4. **Package layout and dependency rules** (e.g. `packages/connectors/<kind>` plus a small connector kit).
>
> **Walk-throughs:** a Mistral-like till, and spreadsheet import as connector #2.

**A2: Data layer (Sonnet; gets the wave-1 summary).**
> **Scope:**
> - `packages/db/src/schema.ts` and `migrations/0000–0013`;
> - RLS policies and roles, `packages/db/src/write`;
> - `packages/core/src/apply/{barsy-venues,tables,sources,sync-config}.ts`.
>
> **Tasks:**
> - Classify every table: neutral, barsy-shaped or mixed.
> - **`integrations`:** the `kind in ('barsy')` check; a `config` jsonb per kind (where is it validated?).
> - **`barsy_venues`:** propose a neutral connection-locations table (one location → one venue; settings such as a catalogue root as per-kind data).
> - **`places`:**
>   - propose our own areas and tables, with links (hand-made tables possible; the QR token on our table);
>   - a migration path that keeps the `tb_` ids and tokens, so no sticker is reprinted.
> - **`source_links` / `source_records` keys:** are they enough for several connections?
> - **Other tables:** `job_runs.kind` values; RLS and composite foreign keys for the new tables.
> - **T50 at the data level.**
> - **Typed columns vs jsonb.**
>
> **Output:** a neutral schema sketch (tables and columns, no SQL) and a reversible migration plan.

**A4: Admin app (Sonnet; gets the wave-1 summary).**
> **Scope:**
> - `apps/web/src` (`integration`, `tables`, `composer`, `publish`, `appearance`, `server/*`, `components/admin`, `i18n`) and `apps/web/messages`;
> - `apps/web/app/(admin)` and `api/tables`.
>
> **Questions:**
> - **Navigation:** today the Integration tab sits inside a venue (`app/(admin)/venues/[venueId]/page.tsx`). Propose Settings → Integrations for the organisation, plus a venue "source" card (T68).
> - **barsy coupling** in server services and actions (`server/integration/service.ts`, `server/tables`), composer badges ("From barsy", "Hidden by barsy"), messages.
> - **Capabilities:** what should decide which tabs and controls appear.
> - **Connection forms:** a form per connector kind driven by the connector's credential schema.
> - **Source-switch safety (T62)**, the table fixes (T66/T67), and multi-venue UI (T50).
>
> **Walk-through (b), in detail:** can a venue with no till build a full menu, get tables and QR codes, and publish today? Where does it break?

**A5: Guest side and outbound (Sonnet; gets the wave-1 summary).**
> **Scope:**
> - `packages/core/src/snapshot/*`, `packages/shell`, `packages/faces/qr-phone`;
> - `apps/worker/src/publish/*`;
> - `apps/web/app/{m,t,cdn}` and `apps/web/src/guest`;
> - `packages/barsy/src/write` (empty by rule);
> - the architecture doc "Outbound: orders and tables" and "Publishing and the snapshot contract";
> - tracker D12, D18, D19, D29, D33, P43, T29.
>
> **Tasks:**
> 1. **Verify the guest side is source-neutral.** For every snapshot field (`orderable`, `order_mode`, prices, modifiers, sold-out from `live.json`, table context), does its meaning silently assume barsy?
> 2. **Design the Stage 4 write-back architecture, connector-neutral:**
>    - an order command with our id and an idempotency key;
>    - an outbox;
>    - per-connector writers;
>    - status by callback or poll;
>    - reconciliation;
>    - a guest fallback ("ask your waiter");
>    - capability flags (accepts orders, payment link);
>    - venues without a till as an internal writer (own waiter view, D12).
> 3. **Snapshot and shell changes** needed to support that, e.g. an "orderable" reason per channel.
>
> **Limits:** design no barsy calls; barsy writes are forbidden (rule 7).

**A6: Guardrails, tests and docs (Sonnet; gets all report summaries).**
> **Scope:**
> - `.dependency-cruiser.cjs`, `vitest.config.ts`, `.github/workflows/`;
> - `packages/barsy/src/{testing,record}` and `packages/barsy/fixtures`;
> - the face contract tests (`packages/shell`, `packages/faces/qr-phone`) and the property tests in `packages/core`;
> - `CLAUDE.md`, `docs/architecture/*`, the `docs/agent-briefs/` patterns and `docs/tracker.md` conventions.
>
> **Questions:**
> - Which guardrails would automatically keep a new connector honest?
> - **Propose:**
>   1. a **connector conformance kit**: a shared suite every connector runs, covering contract shape, mapping determinism, provenance, no leaked ids, rule 5/6 properties, idempotency and fixture replay;
>   2. **dependency rules for connectors**: only the worker imports connectors, and connectors import only core types plus the kit;
>   3. a **fixture and recorder standard** per connector;
>   4. **neutral wording** for the barsy-worded CLAUDE.md rules (rules 3, 7, 9 and the import boundaries), drafted only.
> - **Outline** (outline only) the future "How to add a connection" agent guide: sections, checklists, a brief template, and acceptance criteria. It is written after the improvements land.
