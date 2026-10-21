# A1: Core model and merge engine, connector readiness

Reviewer A1 · read-only · 2026-10-11 · `E:\Restro` at commit `8f25e2e` · paths are relative to the repo root

## 1. Scope read

- **Docs:** CLAUDE.md; tracker D38–D64 and T47–T69 (T50, T62, T66–T69, and the lead's audit in T68); in data-architecture, collection paths A–E, "Identity and linking", "Layers, ownership and resolution" and "Outbound".
- **Core, read in full:** `change-set.ts`, `validate-write.ts`, `field-definition.ts`, `templates/venue-menu.ts`, `resolve/{layers,combine,resolve,types,fixtures}.ts`, `resolve/properties.test.ts`, `sale-state.ts`, `money.ts`, `ids.ts`, `locales.ts`, `jobs.ts`, `sync/conclude-full-pull.ts`, `sync-settings.ts`, `sync-schedule.ts`, `seal/{credentials,envelope,index}.ts`, `seal/open/open.ts`, `snapshot/leak-guard.ts`, `document/types.ts`, and `apply/{unlink,sources,sync-config,barsy-venues}.ts`.
- **Core, read in part:** `apply/apply.ts` (the parts about barsy, links and the source), `apply/publish.ts` (leak guard and the no-op path), `apply/tables.ts`, `apply/load-document.ts:102`, and the property block of `validate-write.test.ts`.
- **Database:** `packages/db/migrations/0003_document_tables.sql`, plus 0005 and 0006 for the `events` checks.
- **Outside my scope:** consumers in the web app, the worker and `packages/barsy` were only located with `git grep`.

**Count.** Non-test files in core contain "barsy" 528 times (case-insensitive). About 180 of the matching lines are comments.

**Where barsy is a role and where only a name:**

| Kind | Where (Fact) |
|---|---|
| **Role**: the till as the authority for price, sale and existence, and the only source that can make an item orderable | `Layer 'barsy'` (`change-set.ts:36`), `Source barsy:<in>` (`:17`), the venue scope rule (`:141`), the provenance rule (`:144-149`), `layerAllowedForSource` (`:388-392`), `OWNERS` (`field-definition.ts:17`), `Provenance` (`resolve/types.ts:38`), `readsLayer`/`allTrueOrder`/`overrideState` (`combine.ts:49-59,151-161,245-248`), `linkFacts`/`BARSY_ARTICLE` (`resolve.ts:57,130-141`), `computeItem` (`:696-711`), `WriteContext`/the less-cautious check (`validate-write.ts:13-25,114-119`), `hasBarsyLink`/`BARSY_LINK_TYPES` (`apply.ts:122-127,371-377`), `OffSaleBy` (`sale-state.ts:15,41`) |
| **Name only**: a vendor detail kept in core | the `barsy_venues`/`places` writers, the `barsy-*` jobs, `sealBarsyCredentials`, the category-tree cache keyed by `bid`, `allergen-key.ts`, `ASSET_ORIGINS`, the comment in `locales.ts` |

## 2. Scorecard

| Part | Score | Evidence |
|---|---|---|
| 1. Own model | 2 | Field types, money, nodes and placements are neutral. Layer, owner, provenance and source use the vendor's name, and the locales are barsy's 11 keys (`locales.ts:3-19`). |
| 2. Connector plug | 1 | `IntegrationKind = 'barsy'` (`apply/sources.ts:19`). Link types are checked only for barsy (`apply.ts:1337`). There is no manifest and no capabilities. |
| 3. Stages | 3 | The raw tier is append-only and hashed (`apply/sources.ts:227`). Invalid values are kept as rejected rows (`apply.ts:935-947`). Every value carries layer, source and job. The database enforces record and mapping-version provenance only for barsy (`0003:92`). |
| 4. Own ids, theirs as links | 3 | `source_links` holds the external ids, and the leak guard collects every external id whatever the source (`apply/publish.ts:544-554`). But `bid` and `place_id` sit in barsy-shaped side tables (`0003:25-36,176-194`). |
| 5. Connections ↔ venues | 2 | A venue exists without a connection (`apply/provision.ts:150`). The link from a location to a venue is barsy-named (`apply/barsy-venues.ts:88`). Publish policy is stored on the connection (`apply/sync-config.ts:155-217`). |
| 6. One sync engine (core parts) | 2 | `concludeFullPull`, `dueSyncs` and the settings parser are neutral. Job names and payloads are barsy's (`jobs.ts:36-78`). |
| 7. Write-back as commands | 0 | Absent (expected in Stage 4). |
| 8. Contracts and tests | 2 | Property tests cover rules 5, 6 and 8, and the rule-6 tests mention no source. There is no conformance helper. `mapping_version` exists. Raw `payload` stands in for an extras field. |

**Cross-cutting checks**
- **Tenancy:** integrations are tenant rows under RLS. The sealing AAD binds each secret to tenant, integration and host (`seal/envelope.ts:54-66`).
- **UI:** the core outputs (`Provenance`, `OffSaleBy`) push vendor labels into the UI (`apps/web/src/composer/item-sheet-support.ts:54`).

## 3. Findings

| Id | Severity | F/I | Where | Why it matters |
|---|---|---|---|---|
| A1-F1 | blocker | Fact | `change-set.ts:17,36`; `field-definition.ts:17`; `resolve/types.ts:38`; `0003:54-56,83-92` | Layer, source, owner and provenance are the vendor's name. A second till must either write into the `barsy` layer (false provenance) or into a new layer that no combinator reads. |
| A1-F2 | blocker | Fact | `resolve/resolve.ts:57,131-137` | Orderability needs `source.startsWith('barsy:')` and `externalType === 'article'`. A till whose items are called "product" never locks the price and is never orderable. |
| A1-F3 | blocker | Fact | `apply.ts:371-377,1337-1347,1769-1777`; `apply/sources.ts:19`; `0003:111` | `apply()` recognises the till only through `kind === 'barsy'`. The `integrations_kind` check allows only `'barsy'`. Another kind's links skip the link-type check entirely. |
| A1-F4 | significant | Fact + Inference | `apply.ts:1354-1359`; `0003:81` | Nothing stops a node being linked to two till connections. The `field_values` key (node, field, layer, scope) has no source, so the two connections would overwrite each other's values on every sync. |
| A1-F5 | significant | Fact | `change-set.ts:144-149`; `0003:92` | `sourceRecordId` and `mappingVersion` are required only on the barsy layer. Spreadsheet (import) writes, the planned connector 2, would have no traceable record and could not be replayed. |
| A1-F6 | significant | Fact | `change-set.ts:141,326`; `0003:90` | Venue scope is allowed only on the barsy layer. That is generic for any till once renamed. But a tenant with several venues and no till cannot import a different price per venue. |
| A1-F7 | significant | Fact | `jobs.ts:36-49,60-78,225-226` | Barsy job names and payloads live in core. The asset-fetch payload accepts only barsy's numeric article ids (`:74`). The queue key is per integration, not per venue (T50). |
| A1-F8 | significant | Fact + Inference | `seal/credentials.ts:13-39`; `seal/open/open.ts:126-140` | The envelope itself is generic, but only barsy has typed seal and open functions. Webhook secrets must be checked where webhooks arrive, which clashes with "the web app can never open sealed secrets" (D55). |
| A1-F9 | blocker (tables for till X); significant (venue with no till) | Fact | `0003:176-194`; `apply/tables.ts:118-129`; `apply/barsy-venues.ts:219-236` | `places` needs an integration and a `bid`, with a foreign key to `barsy_venues`. A venue with no till cannot have tables. Another till's locations have no table to go in. |
| A1-F10 | significant | Fact + Inference | `sync-settings.ts:4-5`; `apply/sync-config.ts:155-217` | Publish settings (`after_sync`, `new_items`, `auto_paused`) are stored on the connection. A venue with no till has nowhere to keep them, and venues that share a connection share them. |
| A1-F11 | minor | Fact | `sale-state.ts:15,41` | The admin's sale state answers `'barsy'`, so the UI wording names the vendor. |
| A1-F12 | minor | Fact | `locales.ts:7-19`; `assets.ts:19` with `0003:18`; `allergen-key.ts:1-5` | Barsy's language keys, an asset origin of `'barsy'`, and barsy's allergen naming rule all live in core. |
| A1-F13 | minor | Fact | `resolve/fixtures.ts:27,51-55,113-131`; `resolve/properties.test.ts:105-149` | The rule-5 tests hard-code barsy through the test document builder. The rule-6 tests mention no source at all (`sync/conclude-full-pull.test.ts`). |
| A1-F14 | minor | Fact | `money.ts:1-2,9,89` | Rounding is fixed at half-up "like barsy", and only EUR is accepted. That is fine until a till rounds differently. |
| A1-F15 | minor | Fact | `resolve/resolve.ts:132-139` | Any missing or deleted link hides the node, including an import link. So a spreadsheet re-import that drops a row would hide an item the till still sells. That is cautious, but it must be documented for each source. |
| A1-F16 | minor | Inference | `0003:196-212` | `source_links` has no location column. A till with a separate catalogue per location cannot limit "absent from a complete read" to that location without encoding the location into the external id. |

## 4. Walk-throughs

**(a) A second till "X"**

| Need | Core today | After P1–P3 | Tables |
|---|---|---|---|
| Kind | `IntegrationKind`, the `integrations_kind` check and the kind check in `apply()` (`apply.ts:1769`) | Add a manifest entry and widen the check | `integrations` |
| Locations | `apply/barsy-venues.ts` (`bid` is an integer) | P7 | `barsy_venues` |
| Categories, products, modifiers | `BARSY_LINK_TYPES`; `'article'` in the resolver | Link types come from the manifest; the resolver checks the role | `source_links` (no change) |
| Prices per location | Venue scope only on the barsy layer | The `till` layer, same meaning | `field_values` checks |
| Availability flags | `for_sale`/`visible` use `all_true`; the barsy-layer exception (`validate-write.ts:114`) | `till` | none |
| Tables | `places` with a foreign key to `barsy_venues` | P7 | `places` |
| Webhooks | The job list is closed (`jobs.ts:134-144`). A link can move `active→deleted` on positive evidence (`change-set.ts:271-275`): that already works. | P4 adds `connection-event` | `webhook_inbox` (new, another area) |
| Order API | Nothing in core | A command keyed by the active till link (Stage 4) | `outbox` (new) |
| Credentials | `sealBarsyCredentials` | P5 | none |
| Photos | Barsy id pattern in the asset job; `assets.origin` allows only upload or barsy | P4, P9 | `assets` |
| Money and languages | `decimalToMinor` is generic; the 11 locale keys are fixed | The connector maps to them | none |
| Rule 6 | `concludeFullPull` is neutral | none | none |

- **Today**, about 14 core files would change.
- **After P1–P5**, only the manifest file and one check constraint change; the till-X code itself lives in the worker and its own package.

**(b) A venue with no till**

| Need | Core today | Works? |
|---|---|---|
| A venue without a connection | `provisionVenue` takes no integration (`apply/provision.ts:150`) | Yes (Fact) |
| Hand-made items with prices | A manual price is allowed on a node with no till link (`validate-write.ts:52-61`). A `locked` field then behaves like `source_first` (`combine.ts:238-239`). | Yes |
| Hide or show; sold out tonight | Builder layers can only write `false` to these flags (`validate-write.ts:114-119`); showing again clears that value. "Sold out tonight" is a service-edition mark (`sale-state.ts:35-42`). | Yes |
| Snapshot | "Sold out" comes only from `for_sale` (`snapshot/build.ts:275`); `orderable` is false (`resolve.ts:705-711`) | Yes, as a menu without ordering |
| Spreadsheet as the main source | Needs a connection, which needs `kind 'barsy'` and a `host` (`0003:100-111`) | No: P1/P2, and `host` must become nullable |
| Tables and QR codes | `places` requires a barsy venue | No: P7 |
| Publish policy and the pause after a rollback | Stored on the connection | No: P6 |
| Ordering | Requires an active till link | Blocked on purpose until D12 (Q4) |

## 5. Proposed adjustments

### Neutral form: recommend one `till` layer, not one layer per connection

```ts
export type Role = 'till' | 'import'                    // change-set.ts
export type Source = 'manual' | `${Role}:${string}`     // till:in_…, import:in_…
export type Layer = 'till' | 'import' | 'manual' | 'override' | `edition:${string}`
export const OWNERS = ['till', 'builder'] as const      // field-definition.ts
// resolve.ts linkFacts: check the role, never the vendor or the external type
const till = links.filter((link) => link.source.startsWith('till:'))
tillItem: node.type === 'item' && till.some((link) => link.state === 'active')
```

**Why one `till` layer:**
1. A venue has one till; rule 5 needs one authority, not a precedence list.
2. The combinators stay fixed and checked at compile time (`COMBINATORS_IMPL`, `combine.ts:403`). One layer per connection would turn every precedence chain into runtime configuration and make the property tests unbounded.
3. Each value already records its connection (`source`, `source_record_id`, `job_id`).
4. Switching tills means relinking into the same slots. Snapshots carry no layer names, so nothing downstream changes.
5. The vendor appears only in `integrations.kind`.

**What it costs:** a node may have at most one till link (P3), and one item cannot be shared between two different tills (Q2).

**The three shapes:**
- **Till + spreadsheet:** the `till` layer plus the `import` layer. On till-linked nodes the import layer can write only builder-owned and `must_agree` fields; this is already enforced (`validate-write.ts:52-62`).
- **No till:** the manual layer is the base; manual beats import (data-architecture, collection path B); nothing is orderable.

### Rules 5 and 6 by source kind

| Source | Layer | Rule 5 | Rule 6 |
|---|---|---|---|
| Till, polled | `till` | The authority: price locked, any `false` flag wins | Absence counts only after a complete full read (`pagesOk` all true): missing first, deleted after 7 days |
| Till, webhooks | `till` | Same | A delete event is positive evidence (`deletedSeen` or `setLinkState deleted`); absence still only from the nightly complete read |
| Spreadsheet | `import` | Flags only `false`; price only on nodes with no till link | None by default. In mirror mode, after a complete import (processed + rejected = total), absent rows become missing |
| Manual and editions | `manual` / `override` / `edition:*` | Flags only `false`; showing again = clearing the value | Not applicable |

**Can the property tests be parameterised over sources?**
- **Rule 6:** already source-free; nothing to do.
- **Rule 5:** after P1, write the tests against a `TILL` constant and run them for three venue shapes (till, till + import, no till) rather than per vendor. The resolver never receives a vendor, and the document's links carry a role, not a kind.

### Ordered proposals

| Id | What | Why | Size | Risk | Data migration | Depends on | Model | When |
|---|---|---|---|---|---|---|---|---|
| P1 | Rename to a neutral till role: layer, source, owner, provenance, `linkedToTill`, `TILL_DISPLAY`/`TILL_STRICT`, and orderable from any active till link. Covers database checks, stored values and a new `integrations.role` column. Consumers in the web app, worker and barsy mapping change in the same PR; the compiler finds them. | F1–F3, F11 | L | Medium (rules 2, 5 and 6) | Yes | none | Opus | Before Stage 4, first |
| P2 | A manifest per connector, as plain data in `core/connectors/`: kind, role, link types per node type, capabilities, credential schema, absence policy, rounding. A test fails on any `'barsy'` literal in core code outside `connectors/barsy.ts`. | F3, F12, capability-driven UI | M | Low | Check constraint only | P1 | Sonnet | Before Stage 4 |
| P3 | Rules in `apply()`: at most one till link per node; link types from the manifest for every kind; record id and mapping version required on both the `till` and `import` layers (Zod and a database check) | F4, F5 | S | Medium | Check only | P1, P2 | Opus | Before Stage 4 |
| P4 | Neutral job names (`connection-connect`, `-full-read`, `-changes`, `-sync-tick`; `connection-event` later). Asset fetch takes `{externalType, externalId}`. The queue key becomes connection + venue. Keep `jobs.ts` in core as the contract between web and worker. | F7, T50 | M | Medium (queues must be drained) | No (drain pg-boss) | P2, the worker engine (another reviewer) | Sonnet | Before Stage 4 |
| P5 | Generic `sealCredentials` / `openCredentials` checked against the manifest's schema; the `rs1` envelope and its binding stay unchanged | F8 | S | Low | No | P2 | Sonnet | Before Stage 4 |
| P6 | Move publish policy (`after_sync`, `new_items`, `auto_paused`) to `venues.settings`; the schedule stays on the connection | F10, (b) | M | Medium | Yes | none | Sonnet | With T68 |
| P7 | Neutral locations and places: generalise `barsy_venues` to connection locations with text ids; `places` with an optional connection, so tables can be made by hand | F9, (a), (b) | L | Medium (QR tokens, RLS composite keys) | Yes | P1 | Opus | Before Stage 4; check with the tables reviewer |
| P8 | Tests: a `TILL` constant in the fixtures; rule-5 tests run for till, till + import and no till; `assertConnectorChangeSet(manifest, set)` checked against recorded fixtures | F13, part 8 | S–M | Low | No | P1, P2 | Sonnet | With P1 and P2 |
| P9 | Small renames: `OffSaleBy` becomes `'till'`; asset origin becomes `'connector'`; the allergen-name rule and the category-tree schema move to `connectors/barsy` | F11, F12 | S | Low | Yes (assets check) | P1, P2 | Haiku | After P1 |
| P10 | A rounding-mode parameter in `money.ts`, added only when some connector needs it | F14 | S | Low | No | none | Sonnet | Later |

### P1 data migration: one migration, verification, rollback

**Before the migration**
1. Stop the worker and drain pg-boss (or drop the queued barsy jobs).
2. Publish every menu so its snapshot is current.
3. Take a `pg_dump` (staging needs Martin's OK, per CLAUDE.md).
4. Record a baseline: counts by `layer` and source prefix in `field_values` and `events`, and link events by `new_value->>'source'`.

**Migration `0014`** (owner role, one transaction):

```sql
ALTER TABLE restro.field_values DROP CONSTRAINT field_values_layer, DROP CONSTRAINT field_values_source,
  DROP CONSTRAINT field_values_layer_matches_source, DROP CONSTRAINT field_values_venue_scope_barsy_only,
  DROP CONSTRAINT field_values_barsy_provenance;
ALTER TABLE restro.events DROP CONSTRAINT events_layer, DROP CONSTRAINT events_source;
UPDATE restro.field_values SET layer = 'till' WHERE layer = 'barsy';
UPDATE restro.field_values SET source = 'till:' || substr(source, 7) WHERE source LIKE 'barsy:%';
UPDATE restro.events SET layer = 'till' WHERE layer = 'barsy';  -- likewise source, and old/new_value->'source' of link events
-- re-add the 7 checks with 'till'; add integrations.role ('till' for kind 'barsy');
-- a DO block raises an error if any 'barsy' layer or source row remains
```

**Left untouched:**
- the actor `integration:<in_>` (already neutral);
- `integrations.kind` (the vendor belongs there);
- `job_runs.kind` (history);
- snapshots (they hold no layer names);
- `source_links` and `source_records`.

**After the migration**
1. Counts equal the baseline under the renaming, and no `barsy` rows remain.
2. For every menu and venue, a manual `publishMenu` returns `unchanged` (`apply/publish.ts:653-655`). This proves the resolution is identical.
3. Run the full test suite and the browser tests (the composer's `data-hidden-by` attribute).

**Rollback.** Revert the code, and either run a prepared reverse migration `0015` (tested beforehand on a copy of `restro_accept`) or restore the dump; only test data exists.

**On `events`.** Rewriting them is a one-time, owner-role schema change. The app role still cannot update `events`.

## 6. Keep as is

- **`apply()` as the one write path:** referring to nodes by link; placement only with `'end'`; the link lifecycle (`LINK_TRANSITIONS`); keeping invalid values as rejected rows; the atomic option.
- **Provenance columns and the "rule 2 enforced by database checks" style.** Rename them; do not loosen them.
- **The resolver:** pure and deterministic; venue rows beat master rows within a layer; `all_true` reads the till first; `locked` behaves like `source_first` on nodes with no till link (this is what makes a venue with no till work); allergen conflicts show the union of all claims.
- **`validateWrite` rule 5** (builder layers write only `false` to flags; editions carry only `all_true` flags) and **`unlinkCopy`** for each combinator.
- **`concludeFullPull`** exactly as it is: pure, source-free, already reused for places.
- **Snapshots without provenance, and the leak guard fed from all `source_links`.**
- **The `rs1` envelope and its AAD format**, so existing sealed credentials still open.
- **Money** (`money.ts`), **sync scheduling** (`dueSyncs`) and **sync settings** (forgiving when reading, strict when writing).
- **`in_` ids and the `integrations` table name.** "Connection" is a word for the UI only.

## 7. Open questions

1. **One till layer, or one layer per connection?** Recommend one `till` layer, with at most one till link per node.
2. **One item shared by venues on two different tills?** Not supported; keep separate nodes. If it is ever needed, the till would write its shared values per venue: a mapping change, not a model change.
3. **Rewrite the `events` history or accept the old values?** Rewrite once in the migration (only test data exists). The alternative is a check that accepts both the old and the new values.
4. **Ordering for venues with no till (D12)?** Keep `orderable` false. When D12 is built, add an explicit per-venue `ordering: 'till' | 'own'` to the resolve context; never infer it from the missing till.
5. **Source prefix by role (`till:`) or by vendor (`mistral:`)?** By role; the vendor stays only on the connection row.
6. **Different prices per venue without a till?** Allow venue scope on the `import` layer when the first such tenant appears, not now.
7. **Webhook secrets, given that only the worker opens sealed values (D55)?** Check signatures in the worker: the receiver stores the raw body and headers and answers 200 after the insert, and the worker never processes a payload that fails the check. Decide this with the first webhook connector.
8. **Where do the connector manifests live?** In `core/connectors/`, as plain data; the only place in core with vendor names, enforced by a test.

## 8. Rules for the connector guide (from the core)

1. Emit change sets only. Place items with `'end'`; never compute sort keys.
2. A till writes only the `till` layer, a spreadsheet only `import`. Every write cites a stored raw record (`appendSourceRecords`) and a `mappingVersion`.
3. Values that differ by location use `venue:<vn_>` scope: our venue id, never the source's location id.
4. Only a till may write `true` to the `visible` and `for_sale` flags. Every other source writes `false` or clears the value.
5. Absence is concluded only through `concludeFullPull` with honest `pagesOk`. Deletions the source reports go into `deletedSeen`. Incremental and webhook reads never conclude absence.
6. Money goes through `decimalToMinor` from an exact decimal string, or as integer minor units validated by `MoneySchema`. Declare the rounding. Never use floats.
7. Map languages to our locale keys. Drop unknown languages with a counted warning.
8. External ids live only in `source_links`, `source_records` and the connection's side tables. Declare any other backend-only strings to the leak guard.
9. Declare link types per node type in the manifest. A node has at most one till link.
10. Credentials go through the generic seal, bound to tenant, connection and host. Never put them in config, logs or job payloads.
11. Job payloads carry `tenantId`, the connection id and our `venueId`. Only asset fetches carry an external type and id.
12. Pass `assertConnectorChangeSet` on recorded fixtures.

### Critical files for implementation
- E:\Restro\packages\core\src\change-set.ts
- E:\Restro\packages\core\src\resolve\combine.ts
- E:\Restro\packages\core\src\resolve\resolve.ts
- E:\Restro\packages\core\src\apply\apply.ts
- E:\Restro\packages\db\migrations\0003_document_tables.sql
