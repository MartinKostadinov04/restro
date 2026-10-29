# Passport Design studio: how it works (D:\Platform Gitlab, pinned 10-27)

Made by: research subagent (Sonnet) for the menu designer planning, 2026-10-27. Read-only survey; facts only.

# Passport Design studio: verified report on `D:\Platform Gitlab`

Paths are relative to `D:\Platform Gitlab`. I read the four specs, the two API guides and the template-designer spec's head (not relevant here), then the code. I ran nothing.

## 1. The contract

**Shape.** Stored keys are 26 (`DesignService.php:71-74`): 18 non-block keys and 8 blocks. The 21 newer settings are `PassportDesign::KEYS` (`PassportDesign.php:119-122`), beside the legacy `palette`, `rounding`, `shadow`, `logo` and `font`. The studio addresses 77 leaves by my count (`DESIGN_LEAVES`, `passportDesign.js:567-576`).

| Key | Allowed values | Class |
|---|---|---|
| `preset` | standard, editorial, technical, soft | Simple |
| `mode` | simple, advanced | panel setting, its own unit |
| `color_mode` | simple, advanced | Advanced |
| `appearance` | light, dark | Simple, preset-governed |
| `navigation` | chapters, tabs | Simple |
| `hero` | split, banner, compact, centered | Advanced |
| `frames` | open, framed | Advanced |
| `labels` | muted, caps, strong | Advanced |
| `rounding` | integer 1..6 | Simple, governed |
| `shadow` | integer 1..6 | Advanced (legacy) |
| `font`, `font_heading` | 24-family catalogue | Simple (`font_heading` governed) |
| `font_figures` | 24-family catalogue | Advanced and governed |
| `palette` | 1 to 32 steps `{lightness 50..950, hex #rrggbb}`; the renderer reads 11 | Simple |
| `colors` | six roles (background, text, muted, rule, surface, accent), each `#rrggbb` or null | Advanced |
| `logo` | `file_` id | team-only |
| `components` | 7 kinds, each with a style list | Advanced |
| `component_options.image` | aspect (5), fit (2), corners (3), backdrop (4) | Advanced |

- **Component kinds.** image: plain, captioned, framed, file. file: row, card, button, link. figure: figure, inline, meter, ring. boolean: text, badge. tags: chips, outline, list. long_text: paragraph, lead, collapsed. range: track, text.
- **Eight blocks** (`BLOCKS`, `passportDesign.js:83-98`; every leaf is an enum string or null):

| Block | Leaves | `show` parts |
|---|---|---|
| `top_bar` | layout (overlay, solid, floating); logo_size (s, m, l) | logo, qr, language, audience, identity |
| `masthead` | title_size (s, m, l, xl); figures (ruled, plain, tiles); image_side (start, end); image_size (s, m, l); image_frame (bleed, inset); image_corners (square, rounded, extra); image_fit (cover, contain); image_focus (center, top, bottom, left, right); image_backdrop (surface, none, tint, white) | logo, ids, status, figures, image, explore |
| `chapters` | header (numbered, numeral, centered, minimal); size (s, m, l); index (sidebar, strip, hidden); tabs (underline, pills) | number, icon, divider |
| `sections` | header (ruled, plain, bar, kicker); size (s, m); gallery_columns ("2", "3") | description |
| `fields` | rows (split, stacked, grid); dividers (lines, zebra, none); density (compact, comfortable, roomy) | none |
| `figures` | look (grid, tiles, ruled, plain); size (s, m, l); unit (after, below); corners (square, rounded) | none |
| `charts` | colors (accent, multi, mono); grid (lines, none); legend (side, below, hidden); bars (rounded, square) | none |
| `rhythm` | spacing (compact, comfortable, spacious); width (narrow, standard, wide) | none |

- **Per placement, outside the design.** `display` plus `display_options` {aspect, fit, width, max}, a Field List `options.style` (rows, timeline), a chart `chart_type` meter with `meter_max`, and masthead copy (kicker, caption, note). These are in `compositions.md:314-366` and `CompositionDesign.php:47-90`.
- **Null and `show`.**
  - Null means inherit, leaf by leaf (`normalizeBlock`, `passportDesign.js:192-199`). A `show` part is true, false or null, and an unset part shows.
  - The API reads an unset design back as nulls, never defaults (`design.md:307-346`). Null blocks are stored as null when all-unset (`DesignService.php:892-947`).
- **Free values.** The summary's "every setting takes values from a fixed list" is not literally true. Colours are free hex, `rounding`/`shadow` are integers, and `display_options.max` is a free number up to 1e9.
- **Keeping JS and PHP in step.**
  - One fixture, `tests/fixtures/passport-design-contract.json`, is compared by constant equality: JS in `tests/js/passportDesignContract.test.js:15-31`, `passportDesignBlocks.test.js:10-13` and `passportDesignImages.test.js:18-19`; PHP in `tests/Unit/PassportDesignTest.php:20-46`.
  - Behaviour is not shared. Defaults, presets, resolution, `heroImageOf` and normalisation exist only in JS. PHP has validation and a hand-written twin of `hasAdvancedValues` (`PassportDesign.php:407-465`), pinned by example tests (`PassportDesignTest.php:117-150`).
  - `categoryPaths.json` is one file read at runtime by both sides.

## 2. Resolution and the change engine

- **Signature.** `resolveDesign(teamDesign, compositionDesign)` (`passportDesign.js:319-418`). The server never resolves. The public payload ships the raw team blob (`PublicPassportPayload.php:507-519`), and the browser resolves it (`Render.jsx:755`).
- **Layers.** Per scalar key the order is composition, then team, then preset default, then base (`pick`, `:339-344`). Preset is composition, then team, then standard.
  - Heading and figures fonts fall back to the resolved body font.
  - `components` resolve per kind and `component_options` per option, with no preset step.
  - Block leaves and `show` parts resolve per leaf, going from composition to team to base. Presets set none of them except `labels`.
  - A placement's `display` sits above all of it (`resolveComponentStyle`, `:533-542`).
- **Mode gate.**
  - `layerMode(layer) = layer.mode ?? (hasAdvancedValues(layer) ? 'advanced' : null)` (`:302`). The composition's mode beats the team's.
  - Only a winning explicit `simple` gates. It blanks `ADVANCED_KEYS` (`:143`) in both layers via `dormant()`, so they resolve from preset and base only.
  - Simple keeps preset, navigation, rounding, palette, appearance, font, font_heading and logo.
  - `shadow` and `font_figures` do not count as evidence of Advanced.
  - Stored values survive and return when Advanced is chosen.
- **Presets.** `applyPreset(design, preset, {bodyFont})` (`:421-435`) writes only font, font_heading, font_figures, rounding and appearance. Standard writes the body font into heading and figures and leaves `font` alone. Picking Standard writes rounding 4 over a stored rounding (`passportDesignResolve.test.js:79-80`). `GOVERNED_KEYS` (`:273`) is documentation only; `applyPreset` hard-codes the list.
- **Reset.**
  - `resetToPreset` (`:438-443`) also nulls labels, hero, frames, shadow, components, component_options and all blocks.
  - In Simple, Reset to preset is only `applyPreset`. It is offered only when it changes something on show (`presetReset`, `useDesignSettings.js:120-126`).
- **`sources`.** The values are 'composition', 'team', 'preset' or 'base', for scalars, `colors.*`, `components.*`, `component_options.*.*` and every block leaf and `show` part. Block leaves never report 'preset'. Derived defaults (the masthead image leaves, `figures.look`, `figures.corners`) are baked into the resolved value but report 'base' (`:406-413`).
- **Per-control API.** `useDesignSettings({scope, value, inherited, onChange})` returns `design, resolved, setting(path), anyOverridden(paths), set, reset, resetAll, resetToPreset, overrideCount, keepsAdvanced` (`useDesignSettings.js:137-176`). `setting(path)` gives `{value, overridden, dormant, source, overrideLabel, set, reset}`.
- **Override rule.**
  - Composition scope: overridden means the composition stores a non-null value.
  - Team scope: overridden means the stored value differs from what the leaf resolves to with it nulled. `preset` and `mode` never count (`:82-94`).
  - A custom colour role equal to a generated one in either appearance is not a change.
- **Dormant.** A stored value that Simple ignores is shown as the preset's value with no dot. It still counts in the composition's "N changes", because Reset all clears it (`:96-99`).
- **Reset buttons.** "Reset all" exists only in composition scope. "Reset to preset" exists only in team scope (`DesignStudio.jsx:326-339`).

## 3. Categories

The twelve are listed in `categoryPaths.json:2-15`. The mode and the preview parts come from `registry.js:58-179`, and `parts` are the `data-design-part` values.

| id | Mode | Paths | Parts |
|---|---|---|---|
| style | Simple | preset, navigation, rounding | none |
| brand | Simple | palette, appearance, color_mode, colors (+ `logo`, team only) | masthead |
| type | Simple | font, font_heading, font_figures, labels | none |
| top_bar | Advanced | `top_bar` | top_bar |
| masthead | Advanced | hero, masthead.title_size, masthead.show, and the seven `masthead.image_*` leaves | masthead, masthead.image |
| chapters | Advanced | `chapters` | chapter |
| sections | Advanced | sections.header, sections.size, sections.show, frames, shadow | section |
| values | Advanced | components, component_options, sections.gallery_columns | `value:<kind>` ×7 |
| tables | Advanced | `fields` | fields, children |
| figures | Advanced | `figures`, `masthead.figures` | figures, masthead.figures |
| charts | Advanced | `charts` | chart |
| rhythm | Advanced | `rhythm` | none |

- **One owner per leaf.** Every leaf except `mode` has exactly one owning category. The PHP test enforces this (`tests/Unit/Support/DesignCategoriesTest.php:58-93`). `DesignCategories` (`app/Support/DesignCategories.php:62-113`) reads the JSON from `resources/js/...`. The JS test (`designCategoryPaths.test.js`) checks registry paths equal the file's.
- **One list, three uses.**
  - The panel row dot is `anyOverridden(entry.paths)` (`DesignStudio.jsx:306`).
  - The lock and save unit is `category:{id}` for the team and `design:{id}` for a composition. The unit's version is the token of its leaves (`DesignService.php:341-352`, `CompositionUnits.php:229-235`).
  - A save's value may name only that category's paths (`DesignController.php:130-144`).
- **Cross-category edits.** `routeChange(next)` (`DesignStudio.jsx:186-192`) diffs old and new designs per unit with `changedUnits` (`designUnits.js:179-182`).
  - A change touching only the open category's unit goes through `live.edit`.
  - Anything else goes through `live.writeAtOnce(units, next)`. That covers mode, resets, and a preset pick that touches style, type and brand. It is refused client-side when someone else holds one of those units ("{name} is editing {category}.").
- **Simple versus Advanced in the list.** Simple shows three rows. Advanced adds nine after a divider (`DesignStudio.jsx:173, 341-342`).

## 4. Specimens, preview, click-to-edit

- **Specimens.**
  - `SpecimenFrame` (`specimens/SpecimenFrame.jsx:59-129`) puts children in their own `PassportRoot` with a resolved design. The frame is `inert`, `aria-hidden`, pointer-events none, and refuses focus.
  - With `designWidth` it lays the real component out at that width and applies `transform: scale()`, never upscaling. A ResizeObserver tracks the box. `fit="contain"` also scales to the tile's height.
  - A tile is `withSetting(resolved, path, value)` (`:17-23`), so each option tile shows every other setting in effect. `withSetting` re-derives `figures.look` for a frames tile and the unset masthead image leaves (`rederiveHeroImage`).
  - Specimens render the viewer's own `HeaderBarView`, `Masthead`, `ChapterHeader`, `PassportSection`, `PassportValue` and `CompositionChart` on fixed sample data (`specimens.jsx`). Only the open category's page mounts.
  - `OptionTiles` is a `radiogroup` of `div role=radio` (`controls.jsx:103-134`), because specimens contain buttons. Tiles take arrow, Home and End keys.
- **Preview.**
  - `DesignPreview` renders an iframe at `route('design.preview.frame')`. The route is an authenticated Inertia shell with no ability tag (`routes/web.php:198-201`). It posts the payload 150 ms after the last change (`DesignPreview.jsx:133-139`).
  - The Design page uses three example payloads wrapped by `exampleInDesign`. The Composer sheet uses a real passport from a preview endpoint, per the round 1 spec; I did not read that controller.
- **Messages** (`previewMessages.js:6-16`): payload, ready, audience, rendered, inspect, part and focus.
  - Both ends accept a message only if `event.origin === window.location.origin` (`:53-55`) and `event.source` is the expected window (`DesignPreview.jsx:119`, `PreviewFrame.jsx:139, 284`). Outbound `postMessage` targets `window.location.origin`. The iframe has no `sandbox` attribute.
  - The frame says READY on mount. The parent resends payload and inspect state on every READY. A link that navigates the frame gets a fresh frame (`DesignPreview.jsx:156-162`).
- **Click to edit.**
  - `InspectLayer` (`PreviewFrame.jsx:115-267`), while inspecting, captures pointerdown, mousedown, pointerup, mouseup, dblclick, click, keydown and keyup on `document`. It ignores events inside `[role=menu]`/`[role=dialog]`. It posts the closest `[data-design-part]`.
  - It draws one fixed outline with a part-name label, portalled into `[data-passport]` so tokens reach it.
  - A focus request scrolls the part into view and outlines it for 1200 ms. If the part has not rendered yet, the request waits up to 2000 ms.
  - `partToCategory(part, mode)` (`partToCategory.js:11-35`) maps `value:<kind>` to values. In Simple (ruling R44), top_bar and masthead go to brand and chapter goes to style. Other parts show "styled in Advanced" with a Switch button.
  - Inspect starts on in Advanced and off in Simple.
- **Data attribute.** `data-design-part` is emitted on the public viewer too, inert there (for example `Cards.jsx:73`, `Hero.jsx:296`).

## 5. Renderer

- **Tokens.** `designTokens(design)` (`designTokens.js:30-93`) returns CSS variables and `data-*` attributes.
  - Variables: `--pp-bg/text/muted/rule/surface/card/accent/accent-text/accent-fill/on-accent`, three font stacks, radius and inner radius from level maps, `--pp-shadow` (none unless framed), `--pp-content-width`, `--pp-space`, `--pp-chart-1..7`, plus `colorScheme`.
  - `PassportRoot` (`PassportRoot.jsx:31-50`) sets them on the root and provides `usePassportDesign()`. Outside a root it answers with Standard.
  - Tailwind maps them to utilities (`tailwind.config.js:99-178`: `bg-pp-*`, `rounded-pp`, `rounded-pp-inner`, `rounded-pp-extra`, `font-pp-*`, `shadow-pp`). A test forbids fixed greys in the viewer (`tests/js/viewerTokenGuard.js`).
- **What is in CSS and what is in React.**
  - `passport.css` is 176 lines. It handles label case and weight keyed on `data-labels`, the Technical grid and hero border, Soft pill chips, rhythm gaps via `--pp-space`, prose variables and reduced motion.
  - Everything else is React lookup tables of full Tailwind class strings. `Hero.jsx:21-163` is an example, with `FRAME`, `MEDIA`, `SIDE`, `INSET`, `TITLE` and a `wide()` helper for the `narrow` frame. `Cards.jsx` uses the same pattern.
  - `data-density`, `data-dividers`, `data-spacing`, `data-width`, `data-nav`, `data-appearance`, `data-mode` and `data-hero` are set on the root, but grep finds no CSS or code consuming them. Only `data-labels`, `data-preset` and `data-frames` have rules.
- **Colour roles.** Simple mode runs `generateRoles(palette, appearance)` (`designColors.js:151-177`).
  - Text is held at 12:1 or better, and `muted` is the lightest blend of text into background that reads 4.5:1 on page, surface and card.
  - `accentText` is adjusted until it reads 4.5:1 on all three fills (`designTokens.js:41`, R49).
  - Advanced mode uses the tenant's roles verbatim and derives only empty ones (`completeRoles`, `:180-194`). It does not check contrast, but still adjusts `accentText` and derived `muted`.
  - Palettes with fewer than 11 usable steps are completed from the usable step nearest 500 (`paletteSteps`, `:129-149`, R48).
  - Chart colours move to 3:1 on the page (`:223-256`).
  - Hue and saturation sweeps test the invariants (`designColors.test.js:11-30`).
- **Fonts.** `passportFonts.js:24-91` self-hosts each family via lazy `@fontsource` imports. `fontStack` names the variable face, then the family, then a category fallback. `useFonts` loads the root's three families. A test checks catalogue equals the fixture and each loader's CSS declares the stacked family (`passportFonts.test.jsx:17-32`).
- **Normaliser.** `normalizeDesign` (`:201-223`) is the client boundary. Only values passing it reach CSS variables.
- **Parallel path.** A legacy `buildTheme(mergeDesign(raw))` still runs beside it (`Render.jsx:747-757`, `passportTheme.js:23-31, 175-203`) and is passed as `theme` to cards and values. It reads raw palette hexes. Charts use the token path.

## 6. Saving and concurrency

- **Team design save** (`PATCH /api/design`; web `DesignController::save`, `DesignService::save`, `DesignService.php:266-330`).
  - Body: `{tab, units:{unit:{base, value}}, release}`. Units are `category:{id}` (a path-to-value map) or `mode`. `base` is the token last seen, or null.
  - The server runs a transaction with `lockForUpdate` on the team row. It checks Redis locks (another holder's unit goes in `refused`; locks fail open) and compares each unit's token to `base` (mismatch goes in `conflicts`, reason `stale`).
  - Any conflict or refusal throws `SaveRefused`, a 409 `save_refused` with `conflicts` (their value and version), `refused` (holder), `revision` and `versions`. Nothing is written (`SaveRefused.php:26-52`).
  - Otherwise `unitChanges` applies each category's leaves via `DesignCategories::withLeaves`. It validates the settings named (422 keyed by setting) and writes the whole field only if its token moved.
  - Then `write()` bumps `design_revision`, records `design.updated`, and after commit signals `design.changed` with the changed units. Locks are released after the transaction if `release` was set.
- **Tokens.** A token is the first 16 hex digits of xxh128 over key-sorted canonical JSON (`CompositionUnits.php:174-177`).
- **API PATCH.** `PATCH /v1/design` (`Api/V1/DesignController.php:68-147`) runs Laravel rules plus `PassportDesign::validate`. It sends no tokens and ignores locks. A block or `colors` is replaced wholesale, and there is a mode rule (see Section 8). Consul's path can pass `$expected` units (`ensureAsPlanned`, `DesignService.php:384-399`).
- **Composition design.**
  - Units are `design:{id}` and `design:mode`, saved by `CompositionService::save` (`:194-239`). It merges per unit under a write lock, compares tokens, runs the whole-document validator including `CompositionDesign::validate`, and does a conditional put on the revision (`composition_changed`).
  - The composition design is stored inside a DynamoDB document; the team design is a Postgres `teams.design` JSON text column.
- **Locks.** Redis hashes with a 20 s lease renewed every 5 s, a 2-minute idle expiry and a 1 h hash TTL (`LockService.php:45-49`). The unit is the category. `mode` is never locked.
- **Client.** `useUnitEditor` (`Hooks/useUnitEditor.js`, 2252 lines, shared with five other surfaces) saves a unit when its tab leaves it (`saveOn: 'leave'`). It keeps a local copy and offers it back after a crash, and sends a keepalive on page leave. Conflicts offer Keep mine / Use theirs. Design `Index.jsx:196-234` adds `rounding`, `shadow` and `mode` to saves where legacy rules need them.
- **Realtime.** The channel is `presence-design.{team}`. Events are `design.changed`, `lock.changed`, `client-unit.edit` and `client-unit.sync`. Access is browser sessions with `design:read`; API keys are refused (`DesignChannel.php`).
- **Server-validated.** Enums, shapes, hex, levels, fonts, palette bounds, logo-is-your-file, unit names, and which leaves a category may name.

## 7. Adding an option group (round 3 as a recipe)

From `docs/superpowers/plans/2026-10-12-refined-renderer-round-3-images.md` and the code:

1. Choose the home: new leaves on a block, a `component_options` kind, or a new block. Every leaf is nullable.
2. Add the leaves and enums to the fixture, `BLOCKS` and `BLOCK_DEFAULTS` (or `COMPONENT_OPTIONS` and `COMPONENT_OPTION_DEFAULTS`). If the default depends on other settings, write a pure helper like `heroImageOf` (`:460-478`) and fill the resolved value from it. Blocks add themselves to `ADVANCED_KEYS` and `DESIGN_LEAVES`; a new top-level key must be added by hand to `ADVANCED_KEYS`, `hasAdvancedValues`, `resetToPreset` and the PHP twin.
3. PHP: `PassportDesign::BLOCKS` or `COMPONENT_OPTIONS` and `KEYS`; `CompositionDesign::KEYS`; `DesignService::FIELDS` and its shaper; the API controller rules; the OpenAPI schemas and guides.
4. Assign each new leaf to exactly one category in `categoryPaths.json`, and update the registry `parts`.
5. Renderer: add class lookup tables written out in full, data hooks, and Tailwind tokens if needed.
6. Designer: add rows (`TileRow`, `SizeRow`, `ShowRow`), specimens, `LEAF_LABELS` in `designUnits.js`, `PART_NAMES` in `previewMessages.js`, and `partToCategory` entries.
7. Tests.

**Why existing looks do not change.**
- Defaults are derived to equal the old look, and `m` size reuses the old classes. `Hero.jsx` calls `heroImageOf` itself, so a design that never passed `resolveDesign` (marketing, tests) draws the same.
- Equivalence tests compare `outerHTML` of explicit defaults against unset (`passportMastheadRound2.test.jsx:60-90`). The marketing/Kestrel suites and golden chart colours are unchanged.
- Other guards: a legacy design with no blocks (`:84-90`); "every class compiles" through Tailwind (`passportHeroImage.test.jsx:180-189`); and a stylesheet pin (`:191-205`).

## 8. Rulings and invariants to keep

Only these numbered rulings are cited in code or specs; the full ledger is not in this copy.
- **R28:** one final review covers rounds 1 and 2.
- **R34:** an inferred mode never gates.
- **R39:** a single series of bars keeps one colour (`ChartsCategory.jsx:8`).
- **R43:** specimen strips exist only where they show a combination (Top bar, Tables, Figures and Rhythm have none).
- **R44:** inspect on in Advanced and off in Simple, with the Simple-mode part mapping.
- **R46:** Reset to preset follows the mode; the team's `mode` is never a change.
- **R47:** inference is per layer, composition wins. A write that sets an Advanced value with no `mode` stores `mode: advanced` (`DesignService.php:634-641`). Send `mode: simple` to keep it Simple.
- **R48:** short palettes are completed from the usable step nearest 500.
- **R49:** generated `muted` and `accentText` hold 4.5:1 on page, surface and card.

Unnumbered rulings stated in specs:
- Defaults reproduce the prior look.
- The API is strict: an unknown key is a 400 (`round-1 spec:293`).
- `hero`, `frames` and `shadow` stay top-level.
- Presets never set part choices or colours.
- Simple keeps stored Advanced values.
- No free CSS or pixels.
- Public pages never depend on a socket (locks fail open).

## 9. What the summary got wrong or left out

- "Flat set of named settings": it is 18 flat keys plus 8 nested blocks. Colour and number values are not from a fixed list.
- There are two modes: `color_mode` (how colour is generated) and `mode` (the Simple/Advanced gate). `mode` also gates `color_mode`.
- A mode gate applies only when `simple` is explicit. Inferred modes (R34, R47) never gate, and inference is per layer. The gate resolves from preset and base, not just preset.
- `registry.js` is browser-only. The shared artefact is `categoryPaths.json` (plus the `unit-names.json` fixture for unit names).
- "Reset all" is composition-only; "Reset to preset" is team-only and conditional. "N changes" is composition-only.
- Presets write five governed keys, not "governed keys" generally.
- `passport.css` is small. Most variants branch in React lookup tables, and several `data-*` attributes are unused.
- The round 2 spec is stale on saving. The Design page has no Save, Discard or leave guard now; categories save on leave, with a local copy banner and a save status (`Index.jsx:297-304`). R43 also removed four specimen strips that the round 2 spec lists.
- The server never resolves a design; the raw blob goes to the browser. Left out: placement-level `display`, `component_options`, the masthead copy, Field List and chart options, the Display-as popover, the Composer preview endpoint, Consul editing designs through the same service, and the realtime/lock stack.

## 10. Pitfalls and debts a port should not copy

- Contract lists are duplicated in more than eight places: fixture, JS `BLOCKS`/`BLOCK_DEFAULTS`, PHP `BLOCKS`, `categoryPaths.json`, `LEAF_LABELS` (`designUnits.js:53-72`), unit-names fixture, OpenAPI and guides, and the Composer schema. Parity is checked for constants only, not for defaults or resolution.
- Derived defaults are baked into the resolved design and report 'base'. They need special handling in three places (`resolveDesign`, `Hero.jsx`, `withSetting`/`rederiveHeroImage`).
- Mode inference with exceptions (`shadow`, `font_figures`), a server twin, and client compensation in `storedForm` (`Index.jsx:196-213`) is a lot of machinery for legacy fields.
- Two stored shapes (null blocks in storage, all-null objects in the studio) need `normalize` bridges in the editor adapter.
- Two theme paths (token system and the raw `buildTheme`) coexist.
- `GOVERNED_KEYS` is documentation that the code does not use; unused root `data-*` attributes remain.
- The studio is coupled to realtime (`collab`, `routeChange`, `LiveUnit`) and to a 2252-line editor shared with other surfaces. PHP reading `resources/js/.../categoryPaths.json` couples deployment to the frontend tree.
- `FontPicker` loads all 24 families when opened (`controls.jsx:323`). Each specimen mounts a full `PassportRoot` (tokens, lightbox provider, fonts, ResizeObserver), and there are dozens per category.
- The preview frame has no `sandbox` and no schema check on payload messages. Preview-frame messages are accepted only on origin and source identity.
- A block shared by two categories (`masthead.figures` is Figures', the rest Masthead's) forced leaf-level paths and a special check (`ensureAsPlanned`).
- Enum leaves are strings even for numbers (`gallery_columns: "2"`).
- The palette's meaning is positional, with a single-entry `lightness` exception.
- Advanced colour roles are unchecked for contrast by design.

**Unknowns.** The R-ledger (`.superpowers/sdd/...`), the Composer preview endpoint's controller, the full `Cards.jsx`/`Chapters.jsx` internals, and which components still read the legacy `theme`.
