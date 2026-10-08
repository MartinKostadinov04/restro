# Platform reference map

The Synex Platform (`C:\Platform`, Laravel + Inertia + React 18 + Tailwind + shadcn) is Restro's reference for how a schema-driven document is managed, navigated and rendered. **It is read-only**: study it, port patterns into Restro (TypeScript, Next.js), never edit, branch or commit there.

Every agent brief names the Platform files to read first. Every agent report says what was ported and what was changed.

## What the Platform is (and isn't)
- **Schema = ontology.** A tree of nodes (A, B, C… in breadth-first order), each `singular`, `series` or `many`, each with an ordered `properties` list (typed fields). Templates are copied into a team's ontology.
- **Document = passport.** One record per node instance, `data: {property_id: {value}}`, located by a materialised path (`tppmp`, e.g. `C:pass_parent/pass_self`).
- **View engine = `Passport/Render.jsx`.** Walks the ontology's `discoverable` chain, renders one card per node, fields in property order, skips empty values, picks a component per field type.
- **Design = team theme tokens only** (palette from one brand colour, rounding, shadow, logo, font). There is **no composer or layout document**: the ontology *is* the layout, and it cannot be edited after creation.
- **No QR generation, no draft/publish, no snapshots.**

## Port map
| Restro piece | Platform source | Port | Fix while porting |
|---|---|---|---|
| Admin shell | `resources/js/Layouts/SidebarLayout.jsx` (134-224 menu, 226-277 team switcher, 337-371 breadcrumbs) | Icon-collapse shadcn sidebar, switcher in footer, user menu, breadcrumbs passed as props | Venue switcher instead of team switcher; next-intl BG/EN for every admin string (Platform's admin is hard-coded English); one Toaster at the root, not per page |
| Workspace tabs | `Pages/Passport/Internal/Partials/PassportEdit.jsx` 27-75, 157-179 | Tabs mirrored to `?tab=` with `history.replaceState`; Select instead of the tab bar on mobile | Declare tabs once and render both variants from that list; no setState during render (`defaultTab()` bug) |
| Item field rows | `Components/ValueField.jsx` 43-165; `Components/DrawerInput.jsx` 108-305 | 5-column row: label (with hover card), value, edit button; `category` divider pill; Drawer/Sheet editor; Cmd/Ctrl+Enter saves | **One field-type registry** `{Display, Editor, DefinitionEditor, schema}` replaces the type switch that Platform copies in 4+ places; provenance badge per field (From barsy / Owned here / Overridden / Stale); no global window keydown listener |
| Template as data | `Pages/Ontology/Show.jsx` 402-570 (property shape), 1052-1082 (add-field type cards), 951-1049 (reorder with `@hello-pangea/dnd`) | Property shape, type-card dialog, drag-to-reorder fields | Our field-definition shape: `key, type, required, localizable, constraints, owner, overridable, visibility, critical`; templates stay editable after creation (Platform has no update route) |
| **Composer** (new in Restro) | Interaction pattern of `Pages/Ontology/Show.jsx` + `RenderGraph.jsx` Sheet (538-611) | Tree on the left, side Sheet with tabs on the right, drag-and-drop lists | Layout lives **apart from the schema**: `placements(item_id, section_id, sort_key)` with fractional sort keys. Pre-mapped from barsy's category tree (D20); move items between sections, reorder, add curated sections, hide items |
| View engine | `Pages/Passport/Render.jsx` 152-341; `PassportController::retrievePublicPassport` 379-548 | Sections in order → fields in definition order → empty skipped → component per type | One denormalised **snapshot on the CDN** instead of a per-request walk (Platform caps `many` lists at 5 and presigns per child); visibility enforced server-side when the snapshot is built (Platform's `view.*` ignores it, `api.*` lets the caller choose); shell rules R1–R14 + face contract |
| Theme | `Pages/Design/Index.jsx` 26-46, 120-130; `DesignController.php` 52-76 | Brand colour → 11-step palette (chroma-js), rounding, shadow, logo, font | Semantic tokens (background, surface, accent, on-accent…) instead of palette slots by magic index; no runtime-built Tailwind class names; self-hosted Cyrillic-capable fonts, only those in use |
| Media | `Components/FileBrowser.jsx` 194-350; `Components/FieldTypes/image.jsx` | Upload UX, image card with fullscreen | Stable public CDN URLs with variants (`/a/<asset>/<variant>.webp`), not 24 h presigned downloads; store an asset id, not the whole file record |
| History | Changelog timeline in `PassportEdit.jsx` 201-258 | Vertical "X changed from A to B" timeline | Read from the append-only `events` table, not an array inside the record |
| Status/empty states | `Components/ui/badge.jsx` 18-22; `Components/ui/empty.jsx` | Status badge variants, Empty block with CTA | — |
| Settings pages | `Components/FormSection.jsx` | Title/description column + card | — |
| Import mapping (later) | `Passport/Internal/Partials/ImportDesigner.jsx`; `Pages/.../DataPulling.jsx` 79-256 | Pick file → preview → map columns → job → status | Header auto-match and saved mapping profiles; a job is complete only when processed + rejected = total (Platform marks it complete at dispatch) |

## Pitfalls seen in the Platform (do not repeat)
1. Type → component switch duplicated in Render.jsx, ValueField, DrawerInput, View.jsx.
2. Layout frozen inside the schema; no update route.
3. Public lists capped at 5 items, N+1 fetches and presigns per request.
4. Visibility not enforced on the public page.
5. No draft/publish; changelog grows inside the record.
6. Runtime-built Tailwind classes; magic palette indexes; missing `break` in a switch.
7. Font keys that don't match CSS family names; 20 Google font families loaded globally.
8. 24 h presigned image links served as downloads.
9. Custom domains hard-coded in JSX.
10. Import mapping by column index only; "complete" set at dispatch time; required-field check reading the wrong key.
