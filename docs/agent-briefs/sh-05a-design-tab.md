# Brief SH-05a: the Design tab (template gallery, colours, fonts, live preview)

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/05a-design-tab` from `sh/foundation` yourself, after SH-03 and SH-04 are merged.
- **Task:** T74.
- **Decisions:** D69, D70.
- **Runs in parallel with:**
  - SH-05b (`apps/web/src/composer/guest-features-*`);
  - SH-06 (the face's services, the shell's services, core money).

  Stay out of those files.

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D59, D69 and D70.
2. The designer's handover `docs/design/faces/editorial-market/2026-10-11/handover.md` §10:
   - the formatting-panel specification and its suggested workflow;
   - what each colour role paints;
   - the validation rules.
3. Today's look editor, which you replace:
   - `apps/web/src/appearance/{appearance-card,appearance-section,preview}.tsx/ts` and their tests;
   - `apps/web/src/server/appearance/{service,actions}.ts`;
   - `apps/web/e2e/appearance.spec.ts`.
4. Venue workspace:
   - `apps/web/src/components/admin/workspace-tab-defs.ts`;
   - `apps/web/app/(admin)/venues/[venueId]/page.tsx` (how tabs render, lazily for heavy ones);
   - the Tables tab as a pattern.
5. The preview path:
   - `apps/web/src/server/publish/{service,actions}.ts` (`previewDraft`/`previewDraftAction`);
   - `apps/web/src/publish/{draft-face,phone-frame,preview-dialog}.tsx`.
6. **Core** (SH-01), from `@restro/core`:
   - `THEME_PRESETS`, `THEME_FONTS`, `HARMONY_RULES`, `suggestHarmony`;
   - `deriveRoles`, `validateRoles`, `REQUIRED_PAIRS`, `themeRolesOf`;
   - `VenueTheme` v2 and `Presentation`.

   From `@restro/core/apply`: `setVenueTheme`, `setVenuePresentation`.
7. **Registry** (SH-04): `apps/web/src/faces/registry.ts` (`visibleFaces`, `faceEntry`) and `apps/web/src/fonts.ts` (`FONT_STACKS`).
8. **Shell** (SH-03): `resolveOptions` and the manifest's `options` with `group`.

## What to build

### 1. A new "Design" workspace tab

- `{ value: 'design', labelKey: 'workspace.tabs.design', icon: PaletteIcon }`, placed after `publishing`. Admin pages may use lucide.
- Render it from the venue page like the other tabs: the server component loads, and a client component edits.
- **Who can edit:** owners and admins (`canManageIntegration`, as for the look today). Others see it read-only.

### 2. Server (`apps/web/src/server/design/{service,actions}.ts`)

- **`loadDesign(tenantId, venueId)`** returns:
  - the current theme (`readVenueTheme`; v1 rows map to "From brand colour");
  - the presentation (`readPresentation`, the registry default when unset);
  - the logo's signed link (reuse `loadAppearance`'s logic);
  - `canEdit`.
- **`saveLookAction({ venueId, theme })`:** calls `setVenueTheme`.
  - Map `'unreadable'` to an error that names the failing pairs.
  - Map invalid input and an unusable logo as today.
  - **Never save a partial theme** (SH-01 finding). The old `saveAppearance` wrote only `{brand, logo_asset_id}` and would drop every v2 field. Build the whole v2 theme from the complete form state (preset, colours, overrides, font, radius, shadow, scheme, logo, plus `brand` if the venue still uses the brand-colour path), and remove the old action with the card.
- **`chooseTemplateAction({ venueId, face, lookOptions })`:**
  1. checks that the face is a **visible** registry entry;
  2. runs the look options through `resolveOptions` with that face's manifest, keeping only `group: 'look'` keys;
  3. **merges** them into the stored `presentation.options`, keeping the `group: 'feature'` keys the composer panel owns (SH-05b);
  4. saves with `setVenuePresentation`.

  When the face changes, keys the new face doesn't declare are dropped.
- **Both actions:** `requireTenant()`, the role check, Zod input, `revalidatePath`, and `logError` for unknown failures. Follow `server/appearance/actions.ts`.

### 3. UI (`apps/web/src/design/**`)

**Templates.** One card per `visibleFaces()` entry:
- thumbnail, name and description in the admin's language;
- an "In use" badge;
- a "Use this template" button.

Only one template exists today; the gallery must still read as a gallery.

**Template look options.** Controls generated from the chosen face's manifest options with `group: 'look'`:
- enum → segmented control;
- boolean → switch;
- labels from the manifest's `label.bg`/`label.en`.

**Colours (D70):**
- **Starting points:** preset chips for the four `THEME_PRESETS` (BG/EN labels), plus "From my brand colour" (v1 behaviour) and "Custom".
- **Three colour pickers,** each with a hex input like today's card (`normaliseHex`) and a one-line explanation:
  - **Primary:** the page, about 60%;
  - **Secondary:** panels behind photos and the header, about 30%;
  - **Tertiary:** badges, buttons and highlights, about 10%.
- **"Suggest with colour theory":** a menu of the five `HARMONY_RULES`, seeded from the current tertiary. It fills the three pickers.
- **Derived colours:** the full 8 roles for **light** and **dark**, side by side.
  - Each role shows a swatch, its name in plain words (from handover §10, e.g. "Text on highlights"), and the contrast ratios of the pairs it is part of (`REQUIRED_PAIRS`).
  - Each role has "Adjust" (an override colour input) and "Reset to derived".
  - A failing override is shown in red with the failing pair, and Save is blocked while any pair fails.
- **Font:** a list of `THEME_FONTS`, each name rendered in its own stack (`FONT_STACKS`), with the sample "Меню · Menu 12,50 €".
- **Corners and shadow:** a corner radius slider (0–24, with live numbers) and a shadow slider (0–5).
- **Logo:** reuse the upload code and messages from `appearance-card.tsx` (`precheckImage`, `uploadImage`).
- **Light / dark policy:** follow the guest's phone (default), always light, or always dark.

**Live preview** (desktop: right column; small screens: below):
- `PhoneFrame` and `DraftFace` with `faceId` = the chosen template, and the draft snapshot from `previewDraftAction`, loaded once when the tab opens with a "Refresh" button.
- **The unsaved look is applied in memory:** a copy of the draft snapshot with:
  - `theme.roles = themeRolesOf(formState)`;
  - `theme.font`, `radius`, `shadow` and `scheme`;
  - `presentation = { face, options }`.

  The preview always shows the current form.
- Switches for light/dark and BG/EN (`DraftFace` already supports the language switch).
- When the venue has no menu or nothing is visible, show the publish preview's message.
- **Page-wide CSS:** the Editorial face's CSS has page-wide rules (`html:has(.rm)` hides the scrollbar and horizontal overflow). Check the admin page still scrolls normally with the preview open. If it does not, report it; SH-04 or the lead decides how to scope it.

**Save:** "Save look" saves colours, font, corners, shadow, logo and policy. The toast reads "Saved. Guests see it after the next publish", with a link to the Publishing tab. Template and look options save when chosen, with the same toast.

### 4. Remove the Appearance card from Settings

Delete `apps/web/src/appearance/*` once its tests have moved into `apps/web/src/design/*`. Keep `preview.ts`'s helpers if you reuse them.

`apps/web/e2e/appearance.spec.ts` becomes `design.spec.ts`.

### 5. Messages

Under a new `design.*` namespace, BG and EN, natural Bulgarian. Drop the `appearance.*` keys you no longer use.

## Tests

- **Component tests** (jsdom; follow `appearance-card.test.tsx`):
  - choosing a preset fills the three colours and the overrides;
  - a harmony suggestion fills the pickers;
  - an unreadable override blocks Save and names the pair;
  - "Reset to derived" works;
  - font and radius reach the preview root (its CSS variables);
  - look options render from the manifest;
  - read-only for a non-admin.
- **Action tests** (DB, `CI=true`):
  - `saveLookAction` happy path and `'unreadable'`;
  - `chooseTemplateAction` refuses a hidden or unknown face;
  - it merges look options while keeping feature keys;
  - a non-admin is refused.
- **e2e `design.spec.ts`:** open Design → choose Midnight → save → publish from Publishing → the guest page's root carries Midnight's background. Read the computed style of the face root, or its `--rm-l-background` variable.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build && pnpm test:e2e` pass with DB tests on `restro_sh_05a` (54329).
- **Vendor words:** the test stays green.
- **Report:** in the CLAUDE.md format, with three screenshots of the tab (desktop light; desktop with a failing override; phone width) saved to your scratchpad, and their paths in the report.

## Never / scope

- **Out of scope:**
  - the composer (SH-05b);
  - the faces' and the shell's code;
  - core logic. If core lacks something you need, stop and ask.
- **No "preview guest services" switch yet.** The lead adds it after SH-06.
- **Dependencies:** none new. The admin already has shadcn/ui, lucide and react-hook-form.
- **Guardrails only tighten.**
- **Never** read `.env.local`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
