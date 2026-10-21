# Brief SH-05b: the composer's "Guest features" panel

- **Model:** Haiku 5.5. The task is precise and small: follow the steps exactly.
- **Branch:** create `sh/05b-guest-features` from `sh/foundation` yourself, after SH-03 and SH-04 are merged.
- **Task:** T74.
- **Decision:** D71.
- **Runs in parallel with:** SH-05a (the Design tab) and SH-06 (services). Edit only the files listed here.

## Why

Martin (D71): "Call a waiter and the rest of the menu functionality should be settings in the composer (appear/hide)."

The venue switches guest features on and off here. The platform-level features are stored by core's `setGuestFeatures` (SH-01). Template features (options with `group: 'feature'` in the template's manifest, e.g. the layout switch) are stored in `presentation.options`.

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entry D71.
2. `apps/web/src/composer/tags-panel.tsx`. It is your pattern: a side Sheet opened from the composer, with its own server actions.
3. `apps/web/src/composer/composer.tsx`:
   - the `tagsOpen` state (around line 171);
   - the "open-tags" button (around line 662);
   - the `<TagsPanel>` render (around line 712).
4. `apps/web/src/composer/composer-tab.tsx`, which loads data in parallel with `Promise.all`.
5. `apps/web/src/server/appearance/actions.ts`, the pattern for a server action: `requireTenant`, `canManageIntegration`, Zod, `revalidatePath`, `logError`.
6. Core (SH-01):
   - `GuestFeatures`, `GuestFeaturesSchema`, `DEFAULT_GUEST_FEATURES`, `readGuestFeatures`, `readPresentation` from `@restro/core`;
   - `setGuestFeatures`, `setVenuePresentation` from `@restro/core/apply`.
7. Shell (SH-03): `SERVICE_KINDS`, `resolveOptions`. Registry (SH-04): `faceEntry` in `apps/web/src/faces/registry.ts`.

## Steps

### 1. Load the data (`composer-tab.tsx`)

Read the venue's `guest_features` (`readGuestFeatures(venue.settings)`) and `presentation` (`readPresentation(venue.settings)`; null means the registry default). Pass to `<Composer>`:
- `guestFeatures`;
- `featureOptions`, which is:
  - **declared:** the current face's manifest options with `group: 'feature'`, as `{ key, type, values?, default, label }`;
  - **values:** `resolveOptions(manifest, presentation?.options)` limited to those keys;
- `canEditFeatures = canManageIntegration(role)`.

### 2. Server actions (`apps/web/src/server/composer/guest-features-actions.ts`, new, `'use server'`)

- **`saveGuestFeaturesAction({ venueId, features })`:** Zod with `GuestFeaturesSchema`, then the role check, then `setGuestFeatures`, then `revalidatePath`.
- **`saveFeatureOptionsAction({ venueId, options })`:**
  1. read the stored presentation;
  2. keep only keys that the current face declares with `group: 'feature'`, with valid values;
  3. merge them into the stored options, keeping the `look` keys that the Design tab owns;
  4. save with `setVenuePresentation`.
- **Results:** `{ ok: true } | { ok: false, error: 'forbidden' | 'invalid' | 'failed' }`.

### 3. Panel (`apps/web/src/composer/guest-features-panel.tsx`, new)

A Sheet titled "Guest features" / "Функции за гостите". A short intro: what guests see on the phone menu, and that changes reach guests with the next publish.

**Group "Menu":**
- a switch "Filters (diet and tags)";
- one switch per template feature option (labels from the manifest, BG/EN by admin locale);
- a fixed line with a lock icon: "Allergen information is always shown" (not a switch, R6).

**Group "Service at the table":**
- a switch "Call a waiter", with six checkboxes for the request kinds:
  - waiter;
  - bill;
  - water;
  - cutlery;
  - card terminal;
  - other (with a note);
- a switch "Show the table's bill";
- a switch "Order from the phone";
- a switch "Pay from the phone".

Under the four service switches, a muted note:
- "Guests see this once ordering is connected (Stage 4)" for waiter, bill and ordering;
- "(Stage 5)" for pay.

**Behaviour:**
- One "Save" button, disabled until something changed and while saving.
- The toast: "Saved. Guests see it after the next publish".
- Read-only (switches disabled) when `canEditFeatures` is false.
- Turning "Call a waiter" on with no kinds checked checks "waiter" by default.

### 4. Composer wiring (`composer.tsx`)

- Add `featuresOpen` state.
- Add a second outline button under "open-tags": icon `SlidersHorizontalIcon`, label "Guest features", `data-testid="open-guest-features"`.
- Render `<GuestFeaturesPanel>` next to `<TagsPanel>`.

### 5. Messages

`composer.guestFeatures.*`, BG and EN. Bulgarian wording:
- Функции за гостите;
- Филтри (диета и етикети);
- Информацията за алергените се показва винаги;
- Повикване на сервитьор;
- Показване на сметката на масата;
- Поръчка от телефона;
- Плащане от телефона;
- Гостите ще видят това, когато поръчките бъдат свързани (етап 4).

The request kinds:
- сервитьор;
- сметката;
- вода;
- прибори;
- терминал за карти;
- друго.

## Tests

- **Component test** (`guest-features-ui.test.tsx`, jsdom; copy the setup of `tags-ui.test.tsx`):
  - toggles and the dirty state;
  - turning on "Call a waiter" checks "waiter";
  - the Stage 4/5 notes are shown;
  - the allergen line has no switch;
  - read-only for non-admins.
- **Action test** (DB, `CI=true`; copy the pattern of the tags actions tests):
  - saving features;
  - refusing a non-admin;
  - feature options merge without touching look keys;
  - an option key the face does not declare is dropped.
- **e2e** (`apps/web/e2e/guest-features.spec.ts`): switch Filters off → save → publish (Publishing tab) → the guest page has no element with `data-slot="menu.filters"`.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build && pnpm test:e2e` pass with DB tests on `restro_sh_05b` (54329: create it, then `pnpm db:migrate` and `pnpm db:roles`).
- **Report:** in the CLAUDE.md format.

## Never / scope

- **Edit only:**
  - `composer-tab.tsx`, `composer.tsx` (the three small additions);
  - the new panel, its test and the new actions file;
  - messages;
  - the new e2e spec.
- **Dependencies:** none new.
- **Guardrails:** never weaken a test or guardrail. If something fails that you cannot fix inside these files, stop and report.
- **Never** read `.env.local`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`); never push.
