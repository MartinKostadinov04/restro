# Brief S2-01: document tables + `apply()`

- **Model:** Opus 5.5 · **Branch:** your worktree branch from `s2/composer`
- **Read first:** `CLAUDE.md`; `docs/architecture/data-architecture.md` → "The internal data source", "One write path", "Identity and linking", "Layers, ownership and resolution", "Validation and quality gates"; `docs/tracker.md` → D40–D47, D55–D56 and **"Engineering notes for Stage 2"** (binding); the code of `packages/core` (change sets, `validateWrite`, ids, sort keys, `apply/provision.ts`) and `packages/db` (RLS helper, `table-access.ts`, tests)

## Goal
The tables that hold the menu document, and the one function that writes them. After this, every collection path (barsy sync now, the composer's manual edits, imports later) produces a change set and calls `apply()`; nothing else writes these tables.

## Tables (migration 0003+, schema `restro`, every one tenant-scoped with FORCE RLS via `restro.enable_tenant_rls`, declared in `table-access.ts` with the fewest privileges)
Add `unique (tenant_id, id)` to `venues` (and every new parent table) and use **composite foreign keys `(tenant_id, …)`** everywhere (FK checks bypass RLS).
| Table | Purpose / key columns |
|---|---|
| `integrations` | `in_` id; `kind` ('barsy'); `host`; `credentials_sealed` (text, written by the web, readable only by the worker — S2-03 fills it); `status` (new/connected/error) + `status_detail`, `last_checked_at`; `config` jsonb (`price_source`, `allergen_detail_key`, `mapping_version`) |
| `barsy_venues` | integration + barsy `bid` (int) + name + optional link to our `venue_id` + `catalogue_root_cat_id` (int, nullable) |
| `menus` | one per venue (P47): `venue_id`, `template_key`, `template_version`, `root_node_id` |
| `nodes` | `nd_` id; `node_type`; `parent_id` (sections under menu/section, groups under item, options under group; items have no parent — they appear through placements); `status` (active/hidden/archived); `revision` int |
| `placements` | `item_id`, `section_id`, `sort_key text COLLATE "C"`; unique (section, item) |
| `field_values` | node, `field_key`, `layer`, `scope`, `value` jsonb, `value_hash` (SHA-256 hex, 64), `source`, `job_id`, `actor`, `observed_at`, `source_record_id` null, `mapping_version` null, `basis` jsonb null (override basis), `valid` bool + `reject_reason`; unique (node, field_key, layer, scope); layer/source/job NOT NULL (rule 2). Overrides are rows in layer `override` with `basis` — no separate overrides table |
| `source_records` | `sr_` id; integration; `external_type`; `external_id` (text); `scope` (`venue:<id>` or `master`); `content_hash`; `raw` text (exact body slice, lossless) + `payload` jsonb; `fetched_at`; a new row only when the hash changes |
| `source_links` | integration + `external_type` + `external_id` → `node_id`; `state` (active/missing/deleted); `first_seen_at`, `last_seen_at`, `last_hash`; unique (integration, type, external id) |
| `events` | append-only (app role: SELECT, INSERT only): `seq` bigserial, node, field_key, layer, scope, `old_value`, `new_value`, source, actor, job_id, change_set_id, `at` |
| `job_runs` | `jb_` id; integration; `kind`; `status`; started/finished; `counters` jsonb; `error_summary` (never query parameters) |
| `places` | `tb_` id; integration + `bid` + barsy `place_id`/`place_num`, `salon_name`, `is_public`, `state`; `qr_token` null (Stage 3) |
| `assets` | `as_` id; `origin` (upload/barsy); `origin_ref`; `checksum`; `content_type`; `width`, `height`; `storage_key`; `status` (pending/stored/failed) |
External ids (barsy ids) live only in `source_*`, `barsy_venues`, `places`, `integrations` — never in `nodes`/`field_values` (rule 3).

## `@restro/core/apply` (server-only subpath, the only importer of `@restro/db/write`)
- `apply(pool, tenantId, changeSet, opts?) → ApplyResult { applied, unchanged, rejected: {opIndex, code, reason}[], createdNodeIds, eventsWritten }` — one transaction (`withTenantWrite`), the doc's steps: validate each write against its field definition with **node context** (`validateWrite` gains `{ linkedToBarsy }`: manual/import prices only on unlinked items); resolve identity through `source_links` (create node + link when new); skip writes whose `value_hash` equals the current row (no-op, no event); upsert `field_values` and append one `events` row per change; structural ops (`createNode`, `setPlacement` with position hint `'end'` computed inside apply, `removePlacement`, `setNodeStatus`, `linkSource`, `unlinkSource` — unlink copies barsy values into `manual`), and the new **`clearField {node, fieldKey, layer, scope}`**. Invalid writes are stored as rejected rows only when the doc says so; they never replace the last good value.
- `loadMenuDocument(pool, tenantId, menuId) → MenuDocument` (read side) with **exactly this type, defined in pure `packages/core/src/document/types.ts` and exported from `@restro/core`** (S2-04 codes the resolver against it in parallel):
```ts
export interface MenuDocument {
  menu: { id: NodeId; venueId: string; templateKey: string; templateVersion: number; rootNodeId: NodeId }
  nodes: ReadonlyArray<{ id: NodeId; type: NodeType; parentId: NodeId | null; status: NodeStatus; revision: number }>
  placements: ReadonlyArray<{ itemId: NodeId; sectionId: NodeId; sortKey: string }>
  values: ReadonlyArray<{ nodeId: NodeId; fieldKey: string; layer: Layer; scope: Scope; value: unknown; valueHash: string; source: Source; observedAt: string; basis: unknown | null; valid: boolean }>
  links: ReadonlyArray<{ nodeId: NodeId; source: Source; externalType: string; state: 'active' | 'missing' | 'deleted' }> // no external ids
}
```
- `provisionMenu(pool, tenantId, venueId)` creating the venue's menu + root node from `VENUE_MENU_TEMPLATE` (idempotent).
- Add id kinds `jb`, `in`, `us`, `sr` to core `newId`.

## Tests
Integration (real Postgres, required in CI) and property tests: isolation for every new table (the RLS guard must pass); apply idempotency (same change set twice → second is all no-ops, no events); hash no-op; identity: same external id twice → one node; rule 5 property test (builder/manual layers can never set `visible`/`for_sale` true or write price on a linked item, whatever the input); rule 2 (no row without layer/source/job); `clearField`; `'end'` placement appends after the current last; unlink copies values; events append-only (app role cannot UPDATE/DELETE); `loadMenuDocument` returns no external ids.

## Never / out of scope
No barsy calls, no resolver (S2-04), no UI, no jobs. Do not edit CLAUDE.md/tracker/docs. Local DB: `pnpm db:local` (if 54329 is busy, reuse with your own database; stop only yours). Commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push. Stop-and-ask triggers and report format as in `docs/agent-briefs/_template.md`.
