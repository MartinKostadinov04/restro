# Brief SH-01: theme engine and presentation contract (core)

- **Model:** Opus 5.5.
- **Branch:** create `sh/01-theme-contract` from `sh/foundation` yourself. Your worktree may start on another branch. Check that the CF-03 merge (the neutral `till` layer) is in your history; the lead launches you only after it is.
- **Task:** T74.
- **Decisions:** D69 (gallery, `presentation` in the snapshot), D70 (3 colours + colour theory + fonts), D71 (guest features), D67 (guardrails).

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D59, D60, D67, D69–D72 and T74.
2. The designer's delivery `docs/design/faces/editorial-market/2026-10-11/`:
   - `handover.md` §10 (formatting panel, the 8 colour roles and where each appears) and §12;
   - `source/fixtures/themes/presets.json`;
   - `plans/menu-face-colour-roles-venue-themes-and-smooth-motion-2026-10-10.md` (the 60-30-10 idea).
3. Today's theme code:
   - `packages/core/src/theme.ts` (palette maths, `VenueThemeSchema` v1, `readVenueTheme`, `snapshotPalette`);
   - `packages/shell/src/palette.ts` (`contrastRatio`, `readableOn`, `semanticColours`, `semanticColoursDark`);
   - `packages/core/src/apply/venue-theme.ts` (the writer) and its test;
   - `packages/core/src/snapshot/{schema,build,diff,leak-guard}.ts`;
   - `packages/core/src/apply/publish.ts` (`snapshotThemeOf`, around lines 347–364; `loadDraft`/prepare, around lines 440–460);
   - `apps/web/src/appearance/preview.ts` (how the admin previews today).
4. The S3-03 brief in `docs/agent-briefs/`, for how the palette maths moved from the shell to core.

## Why

Martin's first template paints with **8 semantic colour roles**, for light and for dark:
`background, surface, accent, onAccent, text, muted, accentText, border`.
Martin decided (D70):
- a venue picks **3 colours**: Primary (~60%, the page), Secondary (~30%, the panels behind photos and the header) and Tertiary (~10%, badges, buttons and highlights);
- the rest, and the whole dark version, are worked out "with colour theory", always readable;
- the designer's 4 themes are starting points;
- a short list of fonts.

The venue also picks a template (D69) and switches guest features on and off (D71). All of it is published with the menu.

You build the **core** half:
- the colour engine;
- the venue settings and their writers;
- the snapshot fields;
- the publisher.

Out of scope here:
- the shell's use of the new fields (SH-03);
- the admin UI (SH-05a/b).

## What to build

### 1. Split `packages/core/src/theme.ts` into `packages/core/src/theme/`

Files: `colour.ts`, `contrast.ts`, `roles.ts`, `derive.ts`, `harmony.ts`, `presets.ts`, `fonts.ts`, `settings.ts` and `index.ts`.

**Every current export keeps its name and behaviour.** That means `PALETTE_STEPS`, `Palette`, `PaletteStep`, `FALLBACK_BRAND`, `isHexColour`, `hexToRgb`, `rgbToHex`, `hexToHsl`, `hslToHex`, `generatePalette`, `VenueThemeSchema`, `VenueTheme`, `readVenueTheme` and `snapshotPalette`, and core's index re-exports them all.

### 2. Colour maths (`colour.ts`, `contrast.ts`)

Written in-house, with no colour library (Martin, 10-10).
- **Conversions:** sRGB hex ↔ linear RGB ↔ OKLab ↔ OKLCH (Björn Ottosson's published matrices).
- **Gamut:** a gamut-safe `oklchToHex` that reduces chroma until the colour fits sRGB.
- **Move here from `packages/shell/src/palette.ts`:**
  - `relativeLuminance`, `contrastRatio`, `readableOn` and `MIN_TEXT_CONTRAST` → `contrast.ts`;
  - `semanticColours`, `semanticColoursDark` and `SemanticColours` → `derive.ts` (today's v1 path).

  The shell **re-exports** them unchanged, so nothing that imports the shell changes. This is the same pattern S3-03 used for the palette.

### 3. Roles (`roles.ts`)

Use snake_case for role names everywhere in core and in stored JSON. The shell maps them to its camelCase `SemanticColours` once, in SH-03.

```ts
export const ROLE_NAMES = ['background', 'surface', 'accent', 'on_accent', 'text', 'muted', 'accent_text', 'border'] as const
export type RoleName = (typeof ROLE_NAMES)[number]
/** One scheme's colours, each `#rrggbb` in lower case. */
export type ThemeRoles = { readonly [R in RoleName]: string }
export interface ThemeRoleSet { readonly light: ThemeRoles; readonly dark: ThemeRoles }
/** The three colours a venue chooses (D70): page ~60%, panels ~30%, highlights ~10%. */
export interface ThemeColours { readonly primary: string; readonly secondary: string; readonly tertiary: string }
export interface RoleOverrides { readonly light?: Partial<ThemeRoles>; readonly dark?: Partial<ThemeRoles> }
/** Text-on-colour pairs that must read at `min` (WCAG AA 4.5:1). */
export const REQUIRED_PAIRS: readonly { readonly fg: RoleName; readonly bg: RoleName; readonly min: number }[]
//   text/background, text/surface, muted/background, muted/surface,
//   accent_text/background, accent_text/surface, on_accent/accent — all 4.5
export interface PairIssue { readonly mode: 'light' | 'dark'; readonly fg: RoleName; readonly bg: RoleName; readonly ratio: number; readonly min: number }
export function validateRoles(set: ThemeRoleSet): PairIssue[]
export const ThemeRolesSchema /* strict, every role HexColour lower case */
```

The designer's face also inverts `text` and `background` for its header and footer bands, which the text/background pair already covers.

### 4. Derivation (`derive.ts`)

```ts
export function deriveRoles(colours: ThemeColours, overrides?: RoleOverrides): ThemeRoleSet
```

**Light** (the colours as chosen):
- `background = primary`, `surface = secondary`, `accent = tertiary`.
- `text`: a deep ink in the primary's hue. Low chroma, OKLCH lightness lowered until text/background and text/surface both pass. Fall back to black.
- `muted`: the blend from `text` toward `background` that is as soft as possible while muted/background and muted/surface still pass.
- `accent_text`: the tertiary's hue and chroma, lightness moved until it passes on background and surface.
- `on_accent`: the first that passes on the accent, in this order: the page colour, the ink, white, black.
- `border`: a quiet blend of text into background, about 12–18%. It is decorative; no pair requirement.

**Dark**, a hue-preserving transform (colour theory, not inversion):
- `background`: the primary's hue at OKLCH L ≈ 0.16–0.20, with chroma reduced.
- `surface`: the secondary's hue, a step lighter than the dark background.
- `accent`: the tertiary, lightened if it is too dark to stand out on the dark background.
- `text`: a light ink in the primary's hue.
- `muted`, `accent_text`, `on_accent` and `border`: the same method as in light.

**Invariants, each pinned by a property test:**
- **Derived roles always pass.** For any three valid colours, every derived role passes `REQUIRED_PAIRS` in both modes. Where colour theory cannot reach 4.5, the derivation falls back to black or white ink, never a failing pair.
- **Overrides are kept verbatim.** `deriveRoles` never changes an override. `validateRoles` reports the overrides that fail.
- **Pure and deterministic.** It never throws on valid hex input.

### 5. Harmony (`harmony.ts`)

```ts
export const HARMONY_RULES = ['complementary', 'analogous', 'triadic', 'split_complementary', 'monochrome'] as const
export function suggestHarmony(seed: string, rule: HarmonyRule): ThemeColours
```

- The seed is the venue's brand colour.
- The tertiary keeps the seed's hue.
- The secondary and the primary take the rule's hues in OKLCH. The primary is a calm, light, low-chroma page colour (L ≈ 0.94–0.97); the secondary is a slightly deeper panel colour.
- Deterministic. Tests check each rule's hue relations.

### 6. Presets (`presets.ts`)

```ts
export const THEME_PRESET_IDS = ['botanical', 'midnight', 'nordic', 'terracotta'] as const
export interface ThemePreset { readonly id: ThemePresetId; readonly label: { readonly bg: string; readonly en: string }; readonly colours: ThemeColours; readonly overrides: Required<RoleOverrides>; readonly radius: number }
export const THEME_PRESETS: readonly ThemePreset[]
```

- Take the values **exactly** from `source/fixtures/themes/presets.json`:
  - `colours` = light background, surface, accent;
  - `overrides` = all 8 roles for light and dark.

  The JSON uses camelCase `onAccent`/`accentText`; map them to snake_case.
- BG labels: Ботаника, Полунощ, Скандинавски, Теракота.
- A test proves every preset passes `REQUIRED_PAIRS` in both modes. If a designer value fails, change it minimally (the smallest lightness move that passes), list every change in your report, and comment it in the file.

### 7. Fonts (`fonts.ts`)

```ts
export const THEME_FONTS: readonly { readonly id: string; readonly family: string; readonly kind: 'sans' | 'serif' | 'display' }[]
// inter/Inter (default), manrope/Manrope, montserrat/Montserrat, playfair-display/Playfair Display, lora/Lora, unbounded/Unbounded
```

Before you commit to the list, check that each family has a `cyrillic` subset in `apps/web/node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`. Replace any family without one by a Cyrillic-capable family of the same kind, and report it.

The `family` string must pass the snapshot's font regex (`schema.ts`, `font`).

### 8. Venue settings v2 (`settings.ts`)

All stored in `venues.settings` jsonb, snake_case. **No migration.**

**`theme`.** `VenueThemeSchema` becomes:
- v1 fields:
  - `brand`: `#rrggbb`, **now optional**;
  - `logo_asset_id`: nullable, required as today;
- plus these optional fields:
  - `preset`: `ThemePresetId | null`;
  - `colors`: `{ primary, secondary, tertiary }`;
  - `overrides`: `{ light?: partial roles, dark?: partial roles }`;
  - `font`: a `THEME_FONTS` id;
  - `radius`: int 0–32;
  - `shadow`: int 0–5;
  - `scheme`: `'auto' | 'light' | 'dark'`.

Rules:
- A stored v1 row (`{brand, logo_asset_id}`) must parse and **publish exactly as today**. Write a test for it.
- `readVenueTheme` still returns null for anything invalid.
- Add `themeRolesOf(theme: VenueTheme | null): ThemeRoleSet`:
  - with `colors` set: `deriveRoles(colors, overrides)`;
  - otherwise: today's path, `semanticColours`/`semanticColoursDark` of `generatePalette(brand ?? FALLBACK_BRAND)`, mapped to snake_case.
- Add the matching `themePaletteOf(theme)`: the palette from `colors.tertiary`, else `brand`, else the default.

**`presentation`.** `PresentationSchema`:
- `face`: kebab-case, at most 64 characters, the same regex as the manifest's `face`;
- `options`: a record of key `^[a-z][A-Za-z0-9]{0,31}$` → value `^[a-z0-9_-]{1,32}$` or boolean, with at most 16 keys.

Core does not know which faces exist; the admin checks the face and its options against the registry before it saves. Add `readPresentation(settings)`.

**`guest_features`.** `GuestFeaturesSchema`:

```ts
{ filters: boolean,
  call_waiter: { enabled: boolean, kinds: ('waiter'|'bill'|'water'|'cutlery'|'terminal'|'other')[] /* unique, ≤ 6 */ },
  bill: boolean, ordering: boolean, pay: boolean }
```

- `DEFAULT_GUEST_FEATURES` = filters on; everything else off with `kinds: []`.
- Add `readGuestFeatures(settings)`. It returns the defaults when the setting is absent or invalid.

### 9. Writers in `packages/core/src/apply/`

Follow `venue-theme.ts`: Zod input, `withTenantWrite`, venue row `for update`, merge only their own key of `settings`, return what is stored, and a typed error class.

- **`setVenueTheme`**, extended:
  - refuses unreadable roles with the new error code `'unreadable'`, whose message lists the failing pairs (`validateRoles(themeRolesOf(theme))`);
  - refuses an unknown font or an out-of-range radius or shadow with `'invalid_input'`.
  - Keep the logo check.
- **`apply/presentation.ts`:** `setVenuePresentation(pool, tenantId, { venueId, presentation: Presentation | null })`.
- **`apply/guest-features.ts`:** `setGuestFeatures(pool, tenantId, { venueId, features: GuestFeatures | null })`.

Roles (owner/admin) are checked by the web actions, as for the theme today. Export the writers from `@restro/core/apply` like `setVenueTheme`.

### 10. Snapshot `menu-snapshot/1` (additive, optional)

In `snapshot/schema.ts`, only the theme part and the top level. CF-12 changed `LiveOverlaySchema`; leave it alone.

```ts
SnapshotThemeSchema += {
  roles:  z.strictObject({ light: ThemeRolesSchema, dark: ThemeRolesSchema }).optional(),
  scheme: z.enum(['auto', 'light', 'dark']).optional(),
}
SnapshotShape += {
  presentation: PresentationSchema.optional(),
  features:     GuestFeaturesSchema.optional(),
}
```

- Every snapshot published before this change (no new keys) must still parse. Test it with a stored old snapshot, e.g. `docs/guides/shell-handoff/barsy-demo-snapshot.json`.
- Put a comment above the additions: new fields inside `menu-snapshot/1` stay optional forever. After the first deploy the readers change first (CF-12's parser-first rule).
- **Fix CF-12's comment** above `LiveOverlaySchema`. It says the snapshot is "not extended in place", which is no longer true. Reword it to the actual rule:
  - the snapshot schema stays strict for **unknown** keys;
  - it gains **known, optional** fields in place (D69–D71);
  - after the first deploy, a new field ships in the reader one deploy before the producer writes it. A phone still running an older reader keeps its current menu on screen until reload, because the pointer poll ignores a snapshot it cannot parse.

### 11. Builder and publisher

- **`snapshot/build.ts`:**
  - `SnapshotContext` gains `presentation?: Presentation | null` and `features?: GuestFeatures | null`;
  - `buildSnapshot` writes `presentation` only when it is set, and **always** writes `features` (the defaults when unset);
  - `DEFAULT_THEME` gains `roles` (from the default palette through the v1 path) and `scheme: 'auto'`.
- **`apply/publish.ts`:**
  - `snapshotThemeOf` writes `palette: themePaletteOf(theme)`, `roles: themeRolesOf(theme)`, the venue's `font` family, `radius`, `shadow` (defaults as `DEFAULT_THEME`), `scheme` (default `'auto'`) and the logo as today;
  - load `readPresentation` and `readGuestFeatures` next to `readVenueTheme` (around line 459) and pass them to the builder.
- **`snapshot/diff.ts`:** the `look` area also compares `presentation`, and the `menu` area also compares `features`. Do not add a new area: the web labels them.
- **Leak guard:** the new fixed strings must never be mistaken for leaks. Add them to `SNAPSHOT_VOCABULARY` or the public strings: scheme names, feature kinds, option values, the face id and role colours. Prove it with a test: an internal note whose text is `"two"` or `"bill"` must not block a publish that has those option or feature values.

## Tests

**Unit and property tests** (fast-check, as for rules 5, 6 and 8):
- OKLCH round trip within ±1 per channel;
- `deriveRoles` invariants (§4);
- `validateRoles`;
- harmony relations;
- presets pass;
- fonts list;
- settings schemas (v1 row, v2 row, defaults, invalid rows → null or defaults).

**DB tests** (`CI=true`, your own database):
- the three writers: tenant isolation, unknown venue, refusals, other settings keys untouched, idempotent;
- publishing a venue with v2 settings writes `theme.roles`/`scheme`, `presentation` and `features`;
- a v1 venue's snapshot keeps today's look in `palette` and gets `roles` equal to today's derived colours.

**Back-compat:** an old snapshot without the new keys parses, through `MenuSnapshotSchema` and the guest loader's schema use.

**Snapshot hashes change** for every venue, because `features` and `roles` are always written. Update the golden and hash expectations **deliberately**, and list each one you changed with the reason.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests on your own database `restro_sh_01` (54329: create it, then `pnpm db:migrate` and `pnpm db:roles`), plus `pnpm test:e2e`.
  - The Appearance card and the publish preview must still work: they use v1 paths.
- **Vendor words:** the test stays green. Core's count must not rise.
- **Report:** in the CLAUDE.md format, plus:
  - the preset values you changed, if any;
  - the font list as verified;
  - the hash and golden expectations you updated.

## Never / scope

- **Out of scope:**
  - the shell's `build.ts`/`view-model.ts` (SH-03);
  - `apps/web` beyond what the moved functions need (a re-export keeps it compiling);
  - the faces;
  - migrations.
- **No new dependencies**, no colour library.
- **Guardrails only tighten (D67).** Never weaken a schema check, a property test or the leak guard to pass. Stop and ask instead.
- **Never** read `E:\Restro\.env.local`. Never call barsy.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.
