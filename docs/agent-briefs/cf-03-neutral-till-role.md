# Brief CF-03: the neutral till role (and the `import` layer goes)

- **Model:** Opus 5.5. This changes core rules 2, 5 and 6 and stored data. **Branch:** your worktree branch, from `cf/foundation` after CF-01 and CF-02 are merged.
- **Read first:**
  - `CLAUDE.md` (the nine rules);
  - `docs/tracker.md` → D64, D65, T68, T70;
  - `docs/reviews/connector-architecture/readiness.md` ("Decisions taken by the lead" 1, 2 and 8);
  - `A1-core.md` (whole: findings F1–F5, F11–F13; proposals P1, P3, P9; the P1 migration plan);
  - `A2-data-layer.md` (F13, P1, migration step 1);
  - `A4-admin-app.md` (F4, F12, P4).
- **Why:** the till's role (the authority for price, sale and existence, and the only source that makes an item orderable) is named `barsy` throughout:
  - core types, validators and the resolver;
  - the database checks;
  - the stored values;
  - the admin.

  A second till could not be added without lying about provenance. Make the role neutral: **`till`**. The vendor stays only on the connection row (`integrations.kind`). In the same migration remove the `import` layer and `import:<profile>` sources: spreadsheet import is dropped (D65), and no `import` rows exist.
- **Scope:** a rename of a *role* plus the removal of a dead layer.

  **Not here:**
  - the connector manifest or kit;
  - job names (`barsy-*` stay);
  - package moves;
  - the location and table tables;
  - publish-policy moves;
  - any UI redesign.

  The `@restro/barsy` package keeps its name and keeps talking about barsy; only what it *writes* changes (layer `till`, source `till:<in_>`).

## Target model

```ts
export type Source = 'manual' | `till:${string}`              // till:in_…
export type Layer  = 'till' | 'manual' | 'override' | `edition:${string}`
export const OWNERS = ['till', 'builder'] as const             // field-definition.ts
```

- **Rule 5:**
  - only the `till` layer may write `true` to `all_true` flags (`visible`, `for_sale`);
  - every other layer writes `false` or clears the value;
  - venue scope (`venue:<vn_>`) is allowed only on the `till` layer;
  - `till` writes must carry `sourceRecordId` and `mappingVersion`.
- **Resolver facts:**
  - `linkedToTill` replaces `linkedToBarsy`: the node has any till link (source starts with `till:`), whatever its state;
  - `tillItem` replaces `barsyArticle`: the node is an item with an **active** till link. Remove the `externalType === 'article'` condition; the link type is checked at write time, below;
  - `orderable` keeps its other conditions (priced by the till here, for sale by the till), with "barsy" read as "till".
- **Link types:** `BARSY_LINK_TYPES` becomes `TILL_LINK_TYPES: Record<IntegrationKind, Record<NodeType, readonly string[]>>`, today only `{ barsy: { item: ['article'], section: ['category'], option_group: [...], option: [...] } }`. Keep the current values. `apply()` checks the link type for **every** integration kind (today it checks only barsy, `apply.ts:1337`); an unknown kind is refused. A later brief moves this map into connector manifests.
- **One till link per node:** `apply()` refuses a `linkSource` from a till source when the node already has a till link from a different integration (A1-F4).
- **Combinators:**
  - `source_first` = override → till → manual → default;
  - `builder_first` = manual → till → default;
  - everything else as today, with `barsy` read as `till`.
- **Names in core:**
  - `BARSY_DISPLAY`/`BARSY_STRICT` become `TILL_DISPLAY`/`TILL_STRICT`;
  - `OffSaleBy` `'barsy'` becomes `'till'` (`sale-state.ts`);
  - `Provenance` says `'till'`;
  - `ASSET_ORIGINS` becomes `upload | connector` (`assets.ts`, plus the `assets_origin` check).
- **Connector label for the UI:** add `CONNECTOR_LABELS: Record<IntegrationKind, string>` in core (`{ barsy: 'barsy' }`) and a helper `connectorLabel(kind)`. The admin fills `{source}` in messages from it. A later brief replaces it with the manifest label.

## Where (start from these; let the compiler find the rest)

- **Core:**
  - `packages/core/src/change-set.ts` (Source, Layer, `isLayer`/`isSource`, the scope and provenance rules, `layerAllowedForSource`, messages);
  - `validate-write.ts` (`WriteContext`, the less-cautious check around lines 13–25 and 114–119, the import rules at 52–62);
  - `field-definition.ts:17`;
  - `templates/venue-menu.ts`;
  - `resolve/{layers,combine,resolve,types,fixtures}.ts`;
  - `sale-state.ts`, `assets.ts`;
  - `apply/apply.ts` (around 116–127, 371–377, 1337–1347, 1769–1777 and the `import` handling);
  - `apply/unlink.ts`;
  - `snapshot/leak-guard.ts` (comments only, if any).
- **Database:**
  - `packages/db/src/schema.ts`, the checks around lines 616–645 and 716–722;
  - `SOURCE_PATTERN` at 266 becomes `'^till:…'`;
  - the `assets_origin` check;
  - the comment above `events` (lines 666–682) mentions `import`.
- **barsy package:** `packages/barsy/src/mapping/*` writes `layer: 'till'` and source `till:${integrationId}`.
- **Worker:** `apps/worker/src/sync/*` builds the change-set source and reads layers; `photos.ts` writes the asset origin.
- **Seeds and fixtures:** `apps/web/scripts/lib/demo-menu.ts` and other seeds; `packages/core/src/resolve/fixtures.ts` (`barsyItem` becomes `tillItem`); test fixtures across packages.
- **Web:**
  - `apps/web/src/composer/{view-model,badges,item-row,composer,reducer,item-sheet-support}.ts(x)`;
  - `apps/web/src/server/item-sheet/{service,plan,layers,types}.ts`;
  - `apps/web/src/fields/{types,provenance-badge}.tsx`;
  - remove the three `import` references (`server/item-sheet/layers.ts:24`, `plan.ts:187`, `composer/item-sheet-support.ts:55`);
  - "linked to the till" = source starts with `till:`, never `barsy:` (A4-F4);
  - composer types `ComposerOrigin`, `ItemHiddenBy` (`'barsy'` becomes `'till'`, `'new_from_barsy'` becomes `'new_from_till'`) and every `data-origin` / `data-hidden-by` attribute value.
- **Messages:**
  - in `apps/web/messages/{bg,en}.json`, strings that state a fact about the till ("Hidden by barsy", "From barsy", "Not on sale in barsy", "New from barsy", item-sheet provenance) take `{source}` and are filled with `connectorLabel(kind)`;
  - leave strings about *configuring barsy* (Integration tab) as they are;
  - keep BG wording natural ("Скрито в {source}"); Martin reviews BG later (T44).

## Migration `0014`

Generate the schema part with `pnpm db:generate`, then add the data part by hand **in the same migration file**, in one transaction:

1. **Pre-check:** raise an exception if any `field_values` or `events` row has layer `import` or a source like `import:%`.
2. **Drop** the checks:
   - `field_values_layer`, `field_values_source`, `field_values_layer_matches_source`, `field_values_venue_scope_barsy_only`, `field_values_barsy_provenance`;
   - `events_layer`, `events_source`;
   - `assets_origin`.
3. **Rewrite stored values:**
   - `field_values.layer` `barsy` becomes `till`;
   - `field_values.source` `barsy:<x>` becomes `till:<x>`;
   - the same for `events.layer` and `events.source`;
   - in `events.old_value` / `new_value`, the JSON key `source` of link events (`{source, external_type[, state]}`) gets `barsy:<x>` replaced by `till:<x>` (`jsonb_set`);
   - `assets.origin` `barsy` becomes `connector`.
4. **Re-add** the checks with the new rules:
   - `field_values_layer` = till | manual | override | edition pattern;
   - `field_values_source` = `manual` or `^till:` pattern;
   - `field_values_layer_matches_source` = `(layer = 'till') = (source like 'till:%')`;
   - **renamed** `field_values_venue_scope_till_only` and `field_values_till_provenance`;
   - `events_layer` and `events_source` the same way;
   - `assets_origin in ('upload','connector')`.
5. **Post-check:** raise an exception if any `barsy` layer or `barsy:` source remains anywhere above.

Notes:
- `events` is append-only for the app role by privileges, not a trigger; this owner-role migration may rewrite it once.
- **Snapshots** hold no layer names: don't touch them.
- **Leave alone:** `integrations.kind`, `job_runs.kind`, actors (`integration:<in_>`) and `source_links`.
- **Reverse script:** write `packages/db/migrations-reverse/0014_till_role.down.sql`. It is not run by `db:migrate`. It restores the old checks and values, minus `import`. Add a DB test that applies 0014 to a seeded database, then the reverse script, then compares row counts and values.

## Verification you must automate

- **Snapshot hash unchanged:** seed the demo menu (the seed scripts write through `apply()`) on the pre-migration schema and publish, then migrate, re-publish and assert `publishMenu` returns `unchanged` (same snapshot hash). If you can't run the old code against the old schema in a test, publish before and after in a script under your scratchpad and say so in the report.
- **Rule 5 property tests** (`packages/core/src/resolve/properties.test.ts`, `validate-write.test.ts`) run on a `TILL` constant over two venue shapes, a till-linked menu and a no-till (manual-only) menu. They stay green with the same number of runs.
- **New tests:**
  - a second integration kind added in a test-only `TILL_LINK_TYPES` entry is checked like barsy;
  - a node already linked to one till refuses a link from another;
  - `till` provenance is enforced by the database check;
  - an `import` layer or source is refused by Zod and by the database.
- **Vendor words:**
  - Don't write your own test. CF-08a adds the repo's single vendor-word test (`scripts/vendor-words.test.ts`, zones plus a shrink-only baseline, D67) before you start.
  - After the rename, regenerate the baseline with the command CF-08a provides and **lower** the `core`, `db/src`, `web` and `worker` entries. They must only go down.
  - Put `TILL_LINK_TYPES` and `CONNECTOR_LABELS` in `packages/core/src/connectors/`, the zone's allowed folder.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests on your own database `restro_cf_03` (on the running 54329 instance), plus the full Playwright suite. The composer specs use `data-hidden-by` / `data-origin`; update them.
- **Report:**
  - in the CLAUDE.md format;
  - the exact list of renamed message keys;
  - the migration's row counts on the demo seed (before and after);
  - anything you left named `barsy` on purpose, and why.

## Never / scope

- Never loosen a check while renaming it: same strength, new name.
- Never run a migration against staging or production.
- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Barsy:** don't call it.
- **Git:** commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.
- **Stop and ask:** if a test can only pass by weakening rule 5 or 6, stop and ask in your report.
