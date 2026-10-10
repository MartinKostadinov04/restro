# Brief S2-04: the resolver (pure)

- **Model:** Opus 5.5 · **Branch:** your worktree branch from `s2/composer`
- **Read first:** `CLAUDE.md`; `docs/architecture/data-architecture.md` → "Layers, ownership and resolution" (layer stack, combinators, ownership matrix, overrides and staleness, computed fields, resolution pseudo-code), "Validation and quality gates" (V3–V12), "The visualization shell" (only to know what consumes the output later); `docs/tracker.md` → D20, D22, D24, D29, D42, D46, D52–D56 and "Engineering notes for Stage 2"; `packages/core` (template, field definitions, combinators enum, `FIELD_TYPES`, money)

## Goal
`resolve(template, document, context) → ResolvedMenu`: the deterministic function that turns the layered document into one value per field per node, with the provenance the composer shows and the issues the publish gate (Stage 3) will use. Pure: no I/O, same inputs → same output. S2-01 is building the tables and the loader in parallel; code against this input type, which S2-01 defines in `packages/core/src/document/types.ts` — if it does not exist yet in your worktree, create exactly this file yourself (identical text) and note it in your report:
```ts
export interface MenuDocument {
  menu: { id: NodeId; venueId: string; templateKey: string; templateVersion: number; rootNodeId: NodeId }
  nodes: ReadonlyArray<{ id: NodeId; type: NodeType; parentId: NodeId | null; status: NodeStatus; revision: number }>
  placements: ReadonlyArray<{ itemId: NodeId; sectionId: NodeId; sortKey: string }>
  values: ReadonlyArray<{ nodeId: NodeId; fieldKey: string; layer: Layer; scope: Scope; value: unknown; valueHash: string; source: Source; observedAt: string; basis: unknown | null; valid: boolean }>
  links: ReadonlyArray<{ nodeId: NodeId; source: Source; externalType: string; state: 'active' | 'missing' | 'deleted' }>
}
```

## Interfaces (in `packages/core/src/resolve/`, exported from `@restro/core`)
- `resolve(template, doc, { venueScope: \`venue:${string}\`, edition?: string[], locales: Locale[], now: string }) → ResolvedMenu`
- `ResolvedMenu = { menuId, sections: ResolvedSection[] /* tree, ordered by placement/sort */, items: Record<NodeId, ResolvedItem>, issues: Issue[] }`; each `ResolvedSection` = `{ id, fields, children, itemIds }`; each `ResolvedItem` = `{ id, fields: Record<key, ResolvedField>, computed: { orderable, priceFrom, badges }, visible, issues }`
- `ResolvedField = { value, provenance: 'barsy' | 'owned' | 'overridden' | 'stale' | 'locked' | 'none', layer, conflict?: true }` — `locked` = barsy-owned and not overridable here (price on a linked item), shown as "Change this in barsy"
- `localized_text` resolves **per locale** (barsy's where barsy holds the locale, ours where it doesn't — D24)
- `scope`: a `venue:<id>` row beats `master` for the same layer (price and for-sale differ per venue)
- `Issue = { code: 'V3'…'V12' | 'stale_override' | 'link_missing' …, severity: 'block_node' | 'warning' | 'block_menu', nodeId?, fieldKey? }` — V4 and V5 are **warnings** (D42); V11 needs the previous resolution, so expose `compareVisibility(prev, next) → { hiddenShare }` for Stage 3 instead of failing here
- Nodes whose barsy link is `missing` or `deleted` are hidden whatever their status (rule 6); `visible`/`for_sale` use `all_true` — our layers can only make things more cautious (rule 5)

## Tests
Unit tests per combinator and per ownership-matrix row; staleness (override basis ≠ current barsy value → `stale` + issue); per-locale fallback; venue scope beats master; computed `orderable` (linked + priced + for sale + `order_mode` orderable); `priceFrom` from required modifier groups; **fast-check property tests**: (1) whatever the builder/manual/override/edition layers hold, an item barsy hides or takes off sale is never `visible`+`orderable`; (2) an orderable item's resolved price always equals barsy's venue-scoped price; (3) determinism (same input → deep-equal output, input arrays shuffled except placement order).

## Never / out of scope
No I/O, no DB, no UI, no snapshot building (Stage 3). Work only in `packages/core/src/resolve/**` (+ the types file above if missing, + exports). Do not edit CLAUDE.md/tracker/docs. Commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push. Report format and stop-and-ask triggers as in `docs/agent-briefs/_template.md`; list every place the doc is ambiguous with the choice you made.
