# The guest menu designer today: what a venue can set and how

Made by: research subagent (Sonnet) for the menu designer planning, 2026-10-27. Read-only survey of ad/foundation; facts only.

# Restro guest-menu design: what exists today (read-only survey, 2026-10-27)

All paths are under `E:\Restro`. Branch `ad/foundation`. Nothing was edited or run.

## 1. What a venue can set today

All venue look settings live in one JSON blob, `venues.settings`, under the keys `theme`, `presentation` and `guest_features`. The schemas are `packages/core/src/theme/settings.ts:59` and `presentation.ts:34,75`. Menu-level settings live in `menus.settings` and `menus.name`. Section-level settings are field values on the section node.

| Setting | Allowed values | Stored | Scope | Published in snapshot | Honoured by |
|---|---|---|---|---|---|
| Template (face) | A visible manifest id, today `editorial-market` only (`apps/web/src/faces/manifests.ts:56-88`); `qr-phone` is hidden. Pattern: kebab-case, max 64 chars (`presentation.ts:20`). | `venues.settings.presentation.face` | venue | `presentation.face` (written only if the venue chose one, `build.ts:437`) | The guest page picks the face from the registry. |
| Template look options | Per-face enum (up to 8 lowercase tokens) or boolean; max 16 keys (`presentation.ts:44`). | `venues.settings.presentation.options` | venue | `presentation.options` | No option is declared today: both manifests have `options: {}` (`editorial-market/src/manifest.ts:58`, `qr-phone/src/manifest.ts`). |
| Brand / Tertiary colour | Free hex `#rrggbb` (`settings.ts:36`). | `theme.colors.tertiary` (legacy `theme.brand`) | venue | `theme.palette` (11 steps from the tertiary, `settings.ts:97`) and the light accent | Both faces |
| Primary (page) | Free hex | `theme.colors.primary` | venue | Folded into `theme.roles.*.background` | Both faces |
| Secondary (panels) | Free hex | `theme.colors.secondary` | venue | Folded into `theme.roles.*.surface` | Both faces |
| Hand-set roles ("Advanced") | Free hex, only the 8 base roles, per scheme (`PartialRolesSchema`, `settings.ts:42-51`) | `theme.overrides.{light,dark}` | venue | Laid verbatim over the derived roles in `theme.roles` | Both faces (eight base roles only) |
| Font | Fixed list of 6 ids (`fonts.ts:34-41`): inter, manrope, montserrat, playfair-display, lora, unbounded | `theme.font` (id) | venue | `theme.font` (family name; regex-checked, `schema.ts:135`) | Both faces, via `--rm-font` |
| Corner radius | Integer 0-32 in core; the slider offers 0-24 (`style-panel.tsx:44`) | `theme.radius` | venue | `theme.radius` | Both faces |
| Shadow | Integer 0-5 | `theme.shadow` | venue | `theme.shadow` | Both faces |
| Screen policy | `auto`, `light`, `dark` (`roles.ts:96`) | `theme.scheme` | venue | `theme.scheme` | Both faces (`data-scheme`) |
| Logo | An asset id, or null (key required) | `theme.logo_asset_id` | venue | `theme.logo`, only when the asset is stored and has variants (`publish.ts:408`) | Both faces draw it in their header. |
| Preset | `botanical`, `midnight`, `nordic`, `terracotta`, or null | `theme.preset` | venue | Not published | Still in the schema and in `presets.ts`. The admin form always saves `preset: null` (`look-state.ts:289`). |
| Guest features | `filters` boolean; `call_waiter {enabled, kinds[6]}`; `bill`, `ordering`, `pay` booleans (`presentation.ts:60-79`) | `venues.settings.guest_features` | venue | `features` | A face draws a control only if its manifest lists the feature. |
| Header name | Free text, trimmed, 1-120 chars; blank means the venue name | `menus.name` | menu | `menu.title`: header name, else the document title, else the venue name (`build.ts:449-461`) | Both faces |
| Menu layout (default) | `list`, `one_column`, `two_columns` (`menus.ts:8`) | `menus.settings.layout` | menu | `layout.default` (`list`, `one`, `two`) | editorial-market. I found no use of `view.layout` in qr-phone (grep). |
| Guest may switch layout | boolean | `menus.settings.layout_switch` | menu | `layout.guest_switch` | editorial-market |
| Section layout | `vertical` or `horizontal` (`venue-menu.ts:22`); default `vertical` | Section field `layout` (a `setField` op, layer `manual`) | section | `sections[id].hints.layout` | editorial-market draws `horizontal` as a strip (`isStrip`, `model.ts:127`). qr-phone: not found. |
| Section colour / icon hint | Hex, or an icon token | Section fields `hint_color`, `hint_icon` (`venue-menu.ts:197-204`) | section | `hints.color`, `hints.icon` | I found no admin control that sets them (grep of `apps/web/src` and `packages`). Unknown whether a face uses them. |

- **Item scope:** there is no design setting at item scope. Items carry data only (name, price, tags and so on).
- **Defaults:** `DEFAULT_THEME` is the default palette, Inter, radius 8, shadow 1, no logo and scheme `auto` (`build.ts:157`). `DEFAULT_MENU_LAYOUT` is two columns with the guest switch on (`build.ts:119`).

## 2. Per-template options

- **Declaration.** A face manifest has `options: Record<camelCaseKey, FaceOption>` (`packages/shell/src/manifest.ts:195-203`, max 16 keys).
  - An enum option has `values` (1-8 lowercase tokens), a `default`, a `group` and a bilingual `label`.
  - A boolean option has a `default`, a `group` and a bilingual `label`.
  - `group` is `feature` or `look` (`OPTION_GROUPS`, line 99).
  - `validateManifest` checks that an enum default is one of its values (`option_default_not_allowed`).
- **Reading.** `resolveOptions` (`manifest.ts:288`) keeps only declared keys. A wrong type or an unlisted enum value becomes the default. It never throws.
- **Admin validation.**
  - `chooseTemplate` (`apps/web/src/server/design/service.ts:179`) requires a visible face and runs `mergeOptions` (`apps/web/src/design/template-options.ts:44-64`).
  - The result then goes through `PresentationSchema`, which allows short lowercase tokens that are not id-shaped.
  - `look` options come from the Design form. `feature` options come from the composer's guest-features card. Each panel saves only its own group.
- **Form.** `LookOptions` (`look-options.tsx`) builds the form from the manifest: a segmented control for an enum, a switch for a boolean. It shows nothing when a face has no look options.
- **Usage today.** Zero options in both shipped faces. Editorial Market used to have `layout`, `layoutSwitch` and `featureFirstSection`. D92 moved them to menu and section settings (comment in `editorial-market/src/manifest.ts:8-11`).
- **Test coverage.** The only coverage is generic tests with synthetic manifests: `packages/shell/src/manifest.test.ts:213` and `apps/web/src/design/template-options.test.ts`.

## 3. Resolution today

- **No layering.** I found no item to section to menu to venue to preset chain, no "changed here" markers and no per-setting reset. A venue has one `theme` and one `presentation`. A menu has `layout` and `layout_switch`. A section has `layout`.
- **Nulls.** `null` or absent means "default" in several places:
  - `readVenueTheme` returns null, giving `DEFAULT_THEME` (`settings.ts:73`, `build.ts:157`).
  - A missing `radius`, `shadow`, `font` or `scheme` falls back to `DEFAULT_THEME` (`publish.ts:403-410`).
  - A missing menu `layout` or `layout_switch` takes `DEFAULT_MENU_LAYOUT` (`build.ts:135`).
  - A missing section `layout` is `vertical`.
  - A missing option is the manifest default (`resolveOptions`).
  - Nothing is ever derived into storage (`settings.ts:6`). Palette and roles are worked out at publish time, so a better derivation reaches every venue on its next publish.
- **Closest to a reset.**
  - "Use tints of my brand colour again" (`followBrand`, `look-state.ts:~330`) hands the page and panels back to the brand tints.
  - "Reset" on an Advanced role calls `clearOverride`, and "Reset all adjusted colours" calls `clearAllOverrides`.
  - The form keeps `edited.primary` and `edited.secondary` flags. These are the only inherit-versus-own state in the code.
- **Preset.** Presets are no longer offered in the UI (D92). `THEME_PRESETS` is still exported from core and used only by tests, e2e and seed scripts.

## 4. Colour and type system

- **Three inputs** (D70): Primary (about 60%), Secondary (about 30%) and Tertiary (about 10%). `deriveRoles` (`derive.ts:561`) works in OKLCH.
  - Light screen: the page is the primary and the panels are the secondary. The accent is the tertiary.
  - Light ink: starts at L 0.28 with chroma capped at 0.045, then darkened until it reads on page and panels.
  - Dark page: the primary's hue at L 0.18. Dark panels: the secondary's hue at L 0.24. Both keep 50% of the chroma, capped at 0.03 and 0.035.
  - Dark accent: the tertiary lightened until it stands out 3:1 on the dark page.
  - Dark ink: starts at L 0.94 (light) in the primary's hue.
  - `muted` is the softest blend that still reads. `accent_text` moves in lightness until it reads. `on_accent` is the first of page, ink, white or black that reads. `border` is 15% of the ink in the page.
- **Roles.**
  - 8 base roles (`ROLE_NAMES`): background, surface, accent, on_accent, text, muted, accent_text, border.
  - 10 extended roles from D93 (`EXTENDED_ROLE_NAMES`, `roles.ts:46-57`): error, error_text, success, success_text, disabled_text, selected, selected_text, focus, backdrop, border_strong.
  - Both schemes are always derived. The extended roles are optional in stored and published JSON.
- **Contrast guarantees.**
  - `REQUIRED_PAIRS` (`roles.ts:104-112`) are 7 pairs at 4.5:1.
  - `EXTENDED_PAIRS` (`roles.ts:121-133`) hold the status, selected and disabled text at 4.5 or 3:1, and the strong border and focus ring at 3:1 against page and panels.
  - Derived roles always read, falling back to black, white or grey. Only overrides can fail.
  - Where page and panels lie on opposite sides of mid-grey, the panels move in lightness (`derive.ts` header).
- **Enforcement.**
  - `setVenueTheme` refuses with `unreadable` and names the pairs (`venue-theme.ts:84-93`).
  - The publisher does not call `validateRoles` (grep: only `venue-theme.ts`, `shell/theme.ts` and the web form use it).
  - The shell re-checks at draw time (`packages/shell/src/theme.ts`). A failing base-role text colour is replaced by the nearest palette step, black or white. A scheme that still fails falls back to the palette-derived colours. Failing extended roles are dropped.
- **Advanced overrides.** The user can set any of the 8 base roles per scheme. The extended roles cannot be set by hand (`role-panel.tsx:14-16`). The light page, panels and highlight are the three pickers, so their cells are not repeated in Advanced.
- **Harmony suggestions.** `suggestHarmony` (`harmony.ts`) offers 5 rules: complementary, analogous, triadic, split_complementary, monochrome. They fill the page and panels from the brand colour.
- **Brand-first.** The brand colour is the Tertiary. Page and panels are pre-filled as monochrome tints (`look-state.ts:tintsOf`). A warning appears when the page chroma exceeds 0.05. A note appears when the accent has less than 3:1 against the page.
- **Fonts.**
  - Six fonts with Cyrillic (`fonts.ts`), loaded via `next/font/google` at build time and served from our origin (`apps/web/src/fonts.ts`).
  - Only Inter is preloaded. The others are `preload: false`.
  - Subsets are latin and cyrillic. They are variable fonts.
  - The snapshot carries the family name. The host passes `fontStacks` to the face (`face-props.ts:19`), and the face sets `--rm-font`.
- **What faces consume.**
  - `themeVariables` (`editorial-market/src/model.ts:197-218`) emits only the 8 base colours per scheme (`--rm-l-*`, `--rm-d-*`), plus font, radius and shadow.
  - I found no use of the 10 extended roles in either face's source (grep for the camelCase names returned nothing).
  - The manifest lists `color.*` tokens including the extended ones as allowed names (`manifest.ts:62-71`). Editorial Market declares only the base eight, plus `font`, `radius`, `shadow` and `logo`.

## 5. The admin Design subtab

- **Reached at:** `/venues/{venue}?tab=composer&sub=design` (`docs/guides/admin-map.md:19`). It is a server component, `design-tab.tsx`, handing plain data to a client `DesignPanel` (`design-panel.tsx`).
- **Order (D92):**
  1. Template chooser, collapsed to one line, plus look options if the face has any.
  2. Card "Logo and header name".
  3. Card "Guest functions" (`GuestFeaturesCard`, keyed by face).
  4. Card "Style": font dropdown, radius slider, shadow slider, screen segmented control.
  5. Card "Colours": three hex+picker fields, "Use tints again", the harmony menu, a saturation warning, a pale-highlight note, and a collapsed "Advanced".
  6. A sticky save bar.
- **Controls.** Controls are hex field plus picker (`hex-field.tsx`), a Select, native range inputs and a Segmented control. Nothing in the Design tab offers free CSS. Colours are free hex.
- **Preview.**
  - The same React tree in a `PhoneFrame` (`publish/phone-frame.tsx`). It is a styled div, not an iframe, with a transform that makes it the containing block for the face's fixed sheets.
  - It draws `DraftFace` (`publish/draft-face.tsx`) from the server-built draft snapshot. The draft is fetched once by `usePreviewDraft` (calling `previewDraftAction`), and again on "Refresh" or after the header name saves.
  - The unsaved form look is overlaid in the browser by `previewSnapshot` (`preview-snapshot.ts`). It mirrors the publisher's `snapshotThemeOf`: palette, roles, font, radius, shadow, scheme and presentation. The logo stays as saved.
  - `useDeferredValue` keeps slider drags smooth.
  - Controls on the preview are a light/dark switch and a "Preview guest services" toggle (demo services).
  - Each template has a pop-up phone preview.
- **Saving (three paths).**
  - The look (colours, font, radius, shadow, scheme, logo) saves as a whole with "Save look" → `saveLookAction` → `FullThemeSchema`, then `saveLook`, then `setVenueTheme` (`server/design/actions.ts:44`, `service.ts:121-143`).
    - `FullThemeSchema` makes font, radius, shadow and scheme required, and refuses `colors` together with `brand`.
  - The template and its look options save immediately on choice → `chooseTemplateAction` → `chooseTemplate` → `setVenuePresentation`.
  - The header name has its own Save (`renameMenuAction`). Guest features have their own Save (`GuestFeaturesCard`).
  - Each action: Zod `safeParse`, `requireTenant`, role check `canManageIntegration` (owners and admins), then `getVenue`, then the service. After a success it calls `revalidatePath`.
- **Write path.**
  - `setVenueTheme` and `setVenuePresentation` live in `packages/core/src/apply/`. Each locks the venue row (`FOR UPDATE`, `lockLiveVenue`), rewrites the `settings` JSON and returns it. They do not go through a `changeSet`.
  - I found no `events` or `field_values` insert in these two files, so there is no provenance record.
  - The section layout path differs: `setSectionLayoutAction` emits a `setField` op with layer `manual`, scope `master` (`composer/actions.ts:341`).
- **Concurrency.** I found a row lock for the duration of the write. I found no version or optimistic check: the whole `theme` object is replaced (last writer wins). Unknown whether anything else guards this.
- **Dirty state.** The form compares `JSON.stringify(view.theme)` with the last saved key. Save is disabled while any box holds an invalid hex, any pair is unreadable, a logo is uploading or a save is running.

## 6. Publishing

- **Design change to guests.**
  - Saved settings go live on the next publish, all at once (D92, `design-panel.tsx:21`).
  - Publish reads `venues.settings` (`publish.ts:520-525`) and builds the snapshot's `theme`, `presentation`, `features` and `layout`.
  - `snapshotThemeOf` (`publish.ts:398`) derives the palette and roles at that moment.
- **Guards:**
  - `buildSnapshot` and the strict `MenuSnapshotSchema`. `SnapshotThemeSchema` (`schema.ts:133`) checks the palette (1-16 hex), the font regex, radius 0-32, shadow 0-5 and role hex values in lower case. Unknown keys fail because the schemas are strict.
  - The leak guard `assertSnapshotSafe` (`publish.ts:643-658`).
    - Theme and presentation strings are passed as `publicStrings` (`lookPublicStrings`, `leak-guard.ts:89`).
    - Fixed theme, layout and feature key words are allowed.
    - Only `menu.title` is exempt (the header name).
  - The V10 check: refuses a menu with no visible item.
  - Presentation option values must be short lowercase tokens that are not id-shaped (`presentation.ts:23-29`).
  - The shell re-validates roles at view-model time (see section 4).
- **Unknown:** whether a stored theme that became unreadable between save and publish is stopped. I found no `validateRoles` call at publish. The shell would repair it at draw time.

## 7. Constraints a new designer must respect

- **Rule 1:** every change goes through `core.apply(changeSet)`. Today's theme and presentation writers sit in `core/apply/` but write `venues.settings` directly. Only the section layout goes through a `setField` op. Whether a new designer's per-section or per-item settings need `field_values` is open.
- **Rule 2 (provenance):** applies to stored values in `field_values` and `events`. Venue settings JSON carries no layer, source or job.
- **Rule 3 (no POS ids):** snapshot carries only `nd_`, `as_`, `sn_`, `tb_`, `tg_` ids. Contract test: "No id-shaped string other than nd_, as_ and tg_ appears" (guide §7.4). `ID_SHAPED` blocks id-like option values.
- **Rule 4:** the shell reads only snapshots. Anything a face needs must be in the snapshot and then in the view model.
- **Rule 5:** layers only make the menu more cautious. A design cannot hide, un-hide or reprice. Hidden items are not in the snapshot at all. The face draws `item.state` and the shell supplies the labels.
- **Faces stay pure (D72):** a face draws host state and sends commands. A face never computes colours from the three venue colours; it reads only `theme.colors` and `theme.colorsDark` (guide §5.4). Money formatting and `Intl` stay out of a face.
- **Import boundaries (depcruise):**
  - A face imports only its own package, `react`, `react-dom` and `@restro/shell`.
  - Only a face's `preview/` folder may use `@restro/shell/money`.
  - `packages/shell` never imports `db` or I/O.
  - Server code reads `manifests.ts`. Only client code imports `registry.ts`.
- **Guide §7.5 visual rules, enforced by tests:**
  - Colours only from theme tokens (`assertThemeOnlyCss`).
  - A face's CSS never selects `html`, `body` or `:root` (`assertFaceScopedCss`).
  - 44px tap targets.
  - 3:1 for control boundaries and focus rings.
  - Inputs at 16px.
  - Text at 12px or more.
  - Names are never truncated.
  - Reduced motion.
  - Allergens always reachable, whatever the layout or screen size.
  - `lang` on foreign-language text.
- **Hard guarantees a design must keep:**
  - Allergen information has no switch of any kind (D71, functionality file).
  - Sold-out items stay visible with a legible state and no order control.
  - Every item placement is drawn exactly once, in view-model order (R2, R7). No virtualising or paginating. Item name, price, allergens and state are required slots (`manifest.ts` `REQUIRED_SLOTS`) and a manifest cannot make them optional.
  - A feature control is absent whenever its feature is off (R15).
  - No ordering or payment "local success" (D72).
  - Faces render to static markup. Window reads belong in effects.
- **D105/D106/D123:**
  - Guest templates are designed by an agent through `template-design`, with an independent `template-review`. Martin accepts each template by clicking through it.
  - Operational screens (the admin Design tab) follow D107/D123: plain words, undo, few taps, shadcn, a screen plan before code, and 44px targets on the phone.
  - The admin map and the pattern list must be updated if a screen is added, moved or renamed.
- **Functionality file:** `docs/guides/menu-template-functionality.md` must be revised in the same change as anything that adds, changes or removes something a guest can do. Its guardrail is below.
- **Snapshot compatibility:** new fields in `menu-snapshot/1` are optional forever (`schema.ts:432-434`). Readers change first.

## 8. What already resembles the studio pattern, and what is missing

**Resembles it:**
- **Fixed lists.**
  - Font: 6 ids. Screen: 3. Menu layout: 3. Section layout: 2. Shadow: 0-5. Radius: 0-32.
  - Face options: enum or boolean only, with bounded length and pattern.
  - Nothing at venue level is free CSS.
  - Colours are the exception: free hex.
- **Derivation with guarantees.** Roles are derived from three colours with an overrides layer, and contrast is validated (D70, D93).
- **Part markers (partial).** The faces carry `data-slot` (38 uses in Editorial Market), `data-item`, `data-state`, `data-layout`, `data-section-layout`, `data-scheme` and `data-source`. These identify slots and states for contract and e2e tests. They are not design-part markers.
- **Real renderer in the preview.** The preview draws the actual face from a draft snapshot with unsaved state overlaid, and a pop-up per template. Option tiles are not drawn by the renderer: the only controls are the segmented controls and sliders.
- **Reset affordances.** Per-role "Reset" and "Reset all", "Use tints again".
- **Changed-vs-saved.** A single dirty flag for the look.
- **Manifest-driven forms.** `LookOptions` and the guest-feature switches are built from a manifest (see section 2).

**Missing entirely (by search):**
- Any layering above venue and below it: no menu-level theme, no section-level or item-level overrides, no inheritance chain.
- "Changed here" markers or per-setting override state.
- Categories that are both panel pages and save units. The tab has several independent save paths but no per-category scope.
- Option tiles drawn by the real renderer or specimens (searched `specimen` and `click-to-edit` across `apps/web/src` and `packages`: no hits).
- Click-to-edit from the preview (searched `postMessage`: no hits). The preview is not an iframe.
- Design-part markers in the face (such as `data-part`).
- Extended-role usage by faces, and any admin control that sets them.
- Any per-template option in use.
- Optimistic concurrency on the venue settings.

## 9. Tests and guardrails that cover design today

**Core (`packages/core`):**
- `src/theme/{settings,derive,roles,colour,fonts,harmony,presets}.test.ts`
- `src/snapshot/look.test.ts` (theme roles, presentation and features in the snapshot, leak guard)
- `src/snapshot/layout.test.ts`
- `src/apply/venue-theme.test.ts`
- `src/apply/venue-presentation.test.ts`
- `src/apply/menu-layout-publish.test.ts`
- `src/apply/header-name-publish.test.ts`
- `src/apply/menus.test.ts`

**Shell (`packages/shell`):**
- `src/theme.test.ts` (the repair rules)
- `src/palette.test.ts`
- `src/manifest.test.ts` (options validation)
- `testing/` contract harness: 17 fixtures (including `custom-roles`, `horizontal-sections`, `one-column`, `features-on`, `features-off`), `suite.ts`, `css.ts`, `contract.ts`. It runs the manifest check, all fixtures per channel, `assertThemeOnlyCss` and `assertFaceScopedCss`.

**Faces:**
- `packages/faces/editorial-market/src/{contract,css,face,manifest,model}.test.*`
- `packages/faces/qr-phone/src/face.test.tsx`

**Web (`apps/web`):**
- `src/design/{design-panel,look-state,template-options,preview-snapshot,hex}.test.*`
- `src/server/design/actions.test.ts`
- `src/server/composer/guest-features-actions.test.ts`
- `src/publish/draft-face.test.tsx`
- `src/guest/{guest-menu,face}.test.tsx`
- `src/fonts.test.ts`
- E2E: `e2e/design.spec.ts` (11 tests: composer subtab, template chooser, card order, colours, font, header name, layout, publish, phone width, Bulgarian), `faces-a11y.spec.ts`, `faces-a11y-services.spec.ts`, `faces-visual.spec.ts`, `faces-audit.ts` (rendered text and border contrast), `touch-targets.spec.ts`

**Repo guardrails:**
- `scripts/menu-template-functionality.test.ts`. It fails when the shell has a feature key the functionality file lacks, a status is outside the four, or a drawn entry names no guide section or decision.
- `scripts/depcruise-rules.test.ts` (import boundaries).
- `scripts/decisions.test.ts`.
- Vendor-word baseline (`scripts/vendor-words.baseline.json`).

**Would need to change** for a rebuilt designer, by what they pin:
- `design-panel.test.tsx` and `look-state.test.ts` pin the card order, the "Save look" whole-look semantics, the absence of presets, and "none of the ten D93 roles can be adjusted by hand".
- `design.spec.ts` pins the same UI structure.
- `actions.test.ts` pins `FullThemeSchema`.
- `look.test.ts` and `venue-theme.test.ts` pin the stored theme shape.
- The contract harness fixtures and the `custom-roles` fixture pin the base-eight consumption. Any new snapshot field also needs a fixture and a schema test.

## Unknowns

- Whether anything outside the files I read sets `hint_color` or `hint_icon`, or any face uses `hints.color` and `onColor`. I did not read all of Editorial Market's CSS or section code.
- Whether qr-phone honours the menu or section layout. A grep of its `face.tsx` for `view.layout` and `hints.layout` found nothing.
- Whether a venue-settings write has any other concurrency guard.
- Whether the live guest page applies anything beyond `face`, `scheme` and `options` from the snapshot. I only read `guest-menu.tsx:264,340-342`.
