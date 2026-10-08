# Brief S1-02: document-model foundation in `packages/core`

- **Model:** Opus 5.5 (touches rules 1, 2, 5 and 8)
- **Branch:** your worktree branch, based on `s1/ground` after the scaffold (S1-01) is merged
- **Read first:** `CLAUDE.md`; `docs/architecture/data-architecture.md` → "Vocabulary", "Schema layer" (all subsections), "The internal data source" → "One write path", "Layers, ownership and resolution" → "Combinators" and "Ownership matrix", "Validation and quality gates"; `docs/tracker.md` → D20, D24, D29, D40, D42, D47; `docs/platform-reference.md` → "Template as data"

## Goal
The typed, data-driven heart of the document model, with no database and no React: field types and their canonical value shapes, field definitions, the template-as-data schema with the default venue-menu template, the change-set contract every collection path will produce, write-level validation (V1, V2), money, ids and fractional sort keys. Everything later (apply, resolver, composer, faces) builds on these types, so correctness and clarity beat breadth.

## Platform files to study first (read-only, `C:\Platform`)
- `resources/js/Pages/Ontology/Show.jsx` lines 402-570 (property shape `{id,name,type,value:{required…},visibility}`) and 1052-1082 (type catalogue for the add-field dialog)
- `app/Http/Controllers/OntologyController.php` lines 17-136 (how a node tree is flattened and typed singular/series/many)
- `app/Models/Ontology.php` lines 84-193 (copying a template into a team's schema with fresh ids)
Report how our model differs from theirs and why (layout separate from schema; owner/combinator on fields; templates editable).

## Done when
- [ ] Every item in "Interfaces" exists, is exported from `@restro/core`, and is documented with a one-line TSDoc
- [ ] The default template `venue-menu@1` validates against the template schema in a test, and contains every standard field from the doc tables plus the additions below
- [ ] Unit + property tests listed below pass; `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass
- [ ] `packages/core` has zero runtime dependencies except `zod`, `fractional-indexing` (and nothing with I/O)

## Interfaces to implement (module layout is yours; keep it navigable)
1. **Locales:** `LOCALES` = the 11 barsy keys `bg_BG, en_US, de_DE, es_ES, fr_FR, it_IT, ro_RO, ru_RU, sr_RS, el_GR, tr_TR`; `Locale` type.
2. **Allergens:** `ALLERGENS` = the 14 EU codes `gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs`. Dietary labels: `vegan, vegetarian, gluten_free, lactose_free, halal, kosher` (mark this list as provisional in a comment).
3. **Field types** — exactly the doc's "Type vocabulary" table: `short_text, long_text, localized_text, number, boolean, date, datetime, money, measurement, range, tags, enum, enum_set, image, file, availability, reference`. For each: a Zod schema of the canonical value (money = `{amount_minor: int ≥ 0, currency: 'EUR'}`; measurement units `g, kg, ml, l, cl, pcs`; datetime always with offset; availability with `to` earlier than `from` meaning past midnight; image/file hold an `asset_id`, never a URL).
4. **Field-type specs (the registry contract, no UI):** `FieldTypeSpec<T> = { type, valueSchema, constraintsSchema, isEmpty(value), hash(value) /* stable, order-insensitive for sets */, validate(value, definition) → Ok | Rejected(reason) }` and `FIELD_TYPES: { [K in FieldType]: FieldTypeSpec }` built so that adding a type without a spec is a compile error. The web app will later add `{Display, Editor, DefinitionEditor}` keyed by the same union.
5. **Field definition** schema, extending the doc's example: `key, type, label (localized), required: boolean | 'when_orderable', localizable, constraints, owner: 'barsy' | 'builder', overridable: 'never' | 'never_when_orderable' | 'always', combinator: 'source_first' | 'builder_first' | 'locked' | 'all_true' | 'union' | 'must_agree', visibility: 'public' | 'internal', critical, stalePolicy: 'review' | 'keep' | 'drop', options? (for enum/enum_set), unit? (number)`.
6. **Node types and nesting:** `menu, section, item, modifier_group, option, special` with cardinality (`singular | many | series`) and allowed parents per the doc's "Node types" table; `canNest(parentType, childType, depth)` enforcing: series never under many; item never contains item; option is a leaf; sections nest at most 3 deep; items are not children of sections (they appear through placements).
7. **Template schema** (template as data, JSON-serialisable): `{ key, version, name (localized), nodeTypes: { [nodeType]: { fields: FieldDefinition[] } } }` + `parseTemplate(json)`; field keys unique per node type; reserved keys for computed fields (`orderable`, `price_from`, `badges`) rejected.
8. **Default template `venue-menu@1`** (exported constant): the doc's "Standard Item fields" table with the doc's owners/combinators/visibility, plus `order_mode` (`enum` `orderable | ask_waiter | hidden`, owner builder, default `orderable`, D29), `abv`, `internal_note` (internal), `for_sale` (boolean, `all_true`) and `visible` (boolean, `all_true`); allergens `enum_set` with combinator `must_agree` but **not critical** (D42: warnings only); Section (`title`, `description`, `image`, `hints`), Menu (`title`, `intro`, `availability`), Modifier group (`name`, `min`, `max`), Option (`name`, `price_delta` money, may be 0). Prices: owner barsy, combinator `locked` when orderable.
9. **Change set** (the only input `apply()` will ever accept; `apply()` itself comes in Stage 2):
   - `Source = 'manual' | \`import:${string}\` | \`barsy:${string}\``; `Layer = 'barsy' | 'import' | 'manual' | 'override' | \`edition:${string}\``; `Scope = 'master' | \`venue:${string}\``.
   - `FieldWrite = { node: NodeRef, fieldKey, layer, scope, value, sourceRecordId?, mappingVersion?, basis? /* override's source value */ }` where `NodeRef = { id } | { link: { integration, externalType, externalId } }`.
   - Structural ops: `createNode`, `setPlacement {itemId, sectionId, sortKey}`, `removePlacement`, `setNodeStatus`, `linkSource`, `unlinkSource`.
   - `ChangeSet = { id, source, jobId, actor, observedAt (offset datetime), ops: (FieldWrite | StructuralOp)[] }` — Zod schema; every write carries layer, source and job (rule 2).
   - `validateWrite(template, nodeType, write) → Ok | Rejected(reason)` implementing V1 and V2; `layerAllowed(definition, layer)` (a barsy-owned locked field accepts only the `barsy` layer; builder can only make things more cautious per the ownership matrix — e.g. `visible`/`for_sale` overrides may only be `false`).
10. **Money:** `decimalToMinor(decimalString, scale = 2)` with half-up rounding using BigInt (no floats anywhere; accepts `"2.4"`, `"2.405"`, `"12"`, `"-0"` → reject negatives for prices), `minorToDecimal`, `formatMoney(minor, currency, locale)` via `Intl.NumberFormat` (BG: `12,50 €`; EN: `€12.50` — assert what Intl actually produces and document it).
11. **Ids:** `newId(kind)` for kinds `nd, as, sn, tb, tn, vn, tp, cs, ev` → `kind_` + 22 base62 chars from 16 random bytes (`crypto.getRandomValues`); `isId(kind, value)`.
12. **Sort keys:** `sortKeyBetween(a | null, b | null)` and `sortKeysBetween(a, b, n)` wrapping `fractional-indexing`.

## Tests that must exist
- Each field type: valid and invalid samples; `isEmpty`; `hash` equality for equal values (sets in different order hash the same).
- Template: default template parses; duplicate key rejected; reserved key rejected; unknown type rejected.
- Nesting: every rule in item 6, including depth 4 section rejected.
- Change set: valid set parses; write without job/source/layer rejected; `validateWrite` rejects a price float, a negative price, an unknown allergen, a builder write that would un-hide or put back on sale, a non-barsy layer on a locked field.
- **Property tests (fast-check):** `decimalToMinor` equals a BigInt reference implementation for random decimals with up to 6 places; `decimalToMinor(minorToDecimal(n)) === n` for integers 0…10^9; `sortKeyBetween(a, b)` is strictly between `a` and `b` for random ordered pairs; `hash` is order-insensitive for `enum_set`/`tags`.

## Out of scope / never do
- No database access, no `apply()` implementation, no resolver, no React/UI, no barsy calls.
- Do not edit CLAUDE.md, the tracker or architecture docs — propose changes in your report.
- Nothing from CLAUDE.md "Never". Commit on your branch only (end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- a doc table and the ownership matrix disagree on a field's owner or combinator
- a field in the doc does not fit any type in the vocabulary
- you think the change-set shape cannot express something the doc's collection paths need

## Report back
CLAUDE.md report format, plus: a short table "Platform concept → our concept → difference" and any doc inconsistencies you found.
