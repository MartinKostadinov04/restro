# Brief SH-02: port the Editorial Market face (browsing only)

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/02-face-port` from `sh/foundation` yourself; your worktree may start on another branch.
- **Task:** T74 (tracker). Decisions D63, D69–D72.

## Read first

1. `CLAUDE.md`.
2. `docs/tracker.md`: D38, D60, D63, D67, D69–D72, T74.
3. The designer's delivery in `docs/design/faces/editorial-market/2026-10-11/`:
   - `README.md`;
   - `handover.md`, sections 1, 2, 10 and 11;
   - `source/face.tsx`, `styles.ts`, `model.ts`, `manifest.ts`, `guest-strings.ts`, `types.ts`;
   - `source/_tests/restro-face.test.tsx`.

   It is reference material: read it, never import it.
4. The designer guide `docs/guides/shell-handoff/visualization-shell.md`, sections 5–9 (the rules, the view model, the face contract, the reference face).
5. The reference face `packages/faces/qr-phone/src/*`. Copy its patterns:
   - the manifest validated at module load;
   - CSS as a string injected with `dangerouslySetInnerHTML`;
   - `themeVariables`;
   - the `Text` helper that sets `lang` only when it differs;
   - `srcset` from `image.variants`;
   - its `face.test.tsx` use of `runFaceContract`.
6. `packages/shell/src/{view-model,strings,manifest}.ts` and `packages/shell/testing/{contract,fixtures}.ts`.

## Why

Martin's first gallery template (D69) arrived as a Lovable project. It was built against our exact view model: its fixtures are our `barsy-demo-view-model.*.json`, same ids. It must become a real face package that passes our contract.

This brief ports the **browsing** part only. Later briefs add, without you:
- the manifest's `features`/`options` (SH-03);
- the registry and the guest page wiring (SH-04);
- the service screens (SH-06).

## What to build

### 1. New package `packages/faces/editorial-market`

- **`package.json`:** like qr-phone, name `@restro/editorial-market`.
  - **dependencies:** `@restro/shell` (workspace), `react` and `react-dom` 19.3.0.
  - **devDependencies:** `@types/react` and `@types/react-dom` 19.3.0, plus `@testing-library/react` 16.3.3 and `jsdom` 30.1.1. These two are the only new devDependencies this brief allows, same versions as `apps/web`.
- **`tsconfig.json`:** like qr-phone's.
- Run `pnpm install` once so the workspace links it. The workspace guard and the Vitest project pick a new `packages/faces/*` package up automatically.

### 2. Files

`src/index.ts`, `manifest.ts`, `face.tsx`, `header.tsx`, `category-rail.tsx`, `section.tsx`, `item.tsx`, `detail.tsx`, `overlay.tsx`, `filters.tsx`, `allergen-sheet.tsx`, `layout-switch.tsx`, `icons.tsx`, `model.ts` and `css.ts`. Split differently if it reads better, but keep one component per concern.

The delivered code is minified onto single lines. Rewrite it into readable, Biome-formatted, strict TypeScript, with a short header comment per file in the style of qr-phone. **Keep the design:**
- class names (`rm-*`), the CSS, motion and reduced-motion handling;
- the three layouts (`list`, `one`, `two`; default `two`) and their `sessionStorage` key `rm-layout`;
- the photo-led first section;
- the sticky category rail with active tracking and auto-centring;
- the dish page as a hash route `#item-<id>`, with the phone's back button and focus return;
- the filter sheet (dietary AND, tags OR);
- the allergen sheet and the legend footer.

### 3. Exports

`src/index.ts` exports:
- `EditorialMarketFace`;
- `EDITORIAL_MARKET_MANIFEST`;
- `EDITORIAL_CSS`;
- the props type.

### 4. Types

Use `@restro/shell` types only (`ViewModel`, `ViewItem`, `ViewSection`, `ViewText`, `ViewImage`, `Locale` via the shell's re-exports). Delete the copied `types.ts`. Where the shell's types are stricter (branded ids, `ViewBadge` as a union), follow the shell.

### 5. Host props: `packages/shell/src/face-props.ts` (new; export it from the shell's index)

```ts
/** What every face receives from its host besides the view model. */
export interface FaceHostProps {
  readonly view: ViewModel
  /** Where `/a/…` image paths live. */
  readonly assetBase?: string
  /** The menu's languages for the switch; fewer than two hides it. */
  readonly languages?: readonly Locale[]
  readonly onLanguageChange?: (locale: Locale) => void
  /** The confirmed table's label ("12"), or null. */
  readonly tableLabel?: string | null
  /** Font family name → self-hosted font stack. */
  readonly fontStacks?: Readonly<Record<string, string>>
  /** Forced colour scheme; `auto` follows the guest's screen. */
  readonly scheme?: 'auto' | 'light' | 'dark'
  /** The face's own presentation options as published (unvalidated; the face falls back to its defaults). */
  readonly options?: Readonly<Record<string, string | boolean>>
}
```

- `QrPhoneFaceProps` becomes `FaceHostProps` (an alias or an `extends` with nothing added).
- `EditorialMarketFaceProps` is `FaceHostProps` too.

### 6. Options

The face reads `options` with these defaults: `layout: 'two'` (one of `list`, `one`, `two`), `layoutSwitch: true`, `featureFirstSection: true`. Missing, unknown or wrongly typed values fall back to the defaults.
- `layoutSwitch: false` hides the switch.
- `featureFirstSection: false` draws the first section like the others.
- `layout` is the starting layout. A remembered `rm-layout` wins while the switch is shown.

The manifest declaration of options comes in SH-03; don't add an `options` key to the manifest now, because `validateManifest` would reject it.

### 7. Strings

Use `stringsFor(view.locale).guest` from `@restro/shell` and delete `guest-strings.ts`.
- The table banner uses `strings.table(label)`.
- Add these keys to `GuestStrings` in `packages/shell/src/strings.ts`, BG and EN, with the delivery's wording:
  - `filterIntro`: "Choose one or more labels." / "Изберете един или повече етикети.";
  - `back`: "Back to menu" / "Обратно към менюто";
  - `layout`: "Menu layout" / "Изглед на менюто";
  - `layoutList`: "List" / "Списък";
  - `layoutOne`: "1 column" / "1 колона";
  - `layoutTwo`: "2 columns" / "2 колони".
- Any other interface word you find in the delivery goes there the same way. Never hard-code a word in a component.

### 8. Icons

Replace `lucide-react` (`LayoutGrid`, `List`, `Square`) with inline SVG components in `icons.tsx`, drawn with `currentColor` strokes. **No icon or UI library**: faces depend on React only.

### 9. Branding

Remove the hard-coded "RESTRO / FACE 01" wordmark and the "RESTRO" kicker. Do not invent other brand text.
- Without a logo, the brand line shows nothing on the left, and the menu title (`h1`) carries the identity.
- With a logo, draw it as today.

### 10. CSS (`css.ts`, `EDITORIAL_CSS`)

- No literal colours (no hex, `rgb()`, `hsl()` or named colours such as `white` or `black`). The delivery has `white` in four places: replace each with a token (`var(--rm-…)`) or a `color-mix()` of tokens with the same effect.
- `transparent`, `currentColor` and `inherit` are fine.
- Every colour, the font, the radius and the shadow come from `themeVariables(view.theme, fontStacks)`. Keep the delivery's `--rm-l-*` / `--rm-d-*` / `data-scheme` mechanism.
- Inject the CSS like qr-phone: `<style dangerouslySetInnerHTML={{ __html: EDITORIAL_CSS }} />` with the same `biome-ignore` reason. A text child would be escaped by React.

### 11. Contract fixes (the delivery breaks these; our harness will catch them)

- **Badges (R8):** an item with badges draws a `data-slot="item.badges"` element on photo cards *and* text-only rows, holding all its badges. Keep the photo-corner look for the first badge if you like, but the slot must exist for every item that has badges.
- **Filters:** a section with no visible items is hidden, and so is a parent whose children are all hidden. When nothing is visible, show `strings.noMatches` and a "clear filters" button. Items stay in the markup (`hidden` attribute), as in the delivery and qr-phone.
- **Legend footer:** hide the whole footer when `view.allergenLegend` is empty. The footer text speaks of codes that would not exist.
- **Descriptions (R9):** clamp them only when `description.truncatable` is true (the dish page shows the full text).
- **Language (R3):** every text drawn from a `ViewText` carries `lang` (BCP 47) when its `lang` differs from the page's. This includes rail links, section titles, tags and dietary labels, and the allergen labels in sheets.
- **Static first render:** never read `window`, `document`, `sessionStorage` or `matchMedia` during render; only in effects and handlers, as the delivery mostly does already. Everything must be in the first `renderToStaticMarkup` output.

### 12. Manifest (`manifest.ts`)

Validated at module load like qr-phone's:

```
face 'editorial-market', version '1.0.0', channels ['qr'],
slots: the four required; description {optional, lines 3, overflow 'expand'};
image {optional, variant 'card', aspect '4:3'}; badges, portion, dietary, tags, extra_fields, modifiers optional,
allergen_mode 'inline_codes', no_image_layout 'text_only', ordering false, paging null,
tokens: the 8 color.* plus font, radius, shadow, logo
```

`ordering` stays `false` until SH-06.

### 13. Out of scope

Do **not** port:
- `source/ordering/**`, `demo.ts`, `fixtures/themes/**`, `_preview/menu.tsx`;
- any shadcn/Tailwind file.

Don't touch `apps/web`, `packages/core` or the shell's `build.ts`/`manifest.ts`. The face is not wired into any page yet (SH-04).

## Tests (in the package)

- **`manifest.test.ts`:** `validateManifest(EDITORIAL_MARKET_MANIFEST).ok`.
- **`contract.test.tsx`:** `runFaceContract((view) => renderToStaticMarkup(<EditorialMarketFace view={view} />), EDITORIAL_MARKET_MANIFEST)` over **all** fixtures returns zero failures. Pattern: `packages/faces/qr-phone/src/face.test.tsx`.
- **`css.test.ts`:** `EDITORIAL_CSS` contains no hex, `rgb(`, `rgba(`, `hsl(`, `hsla(` and no named colours. Write a small, strict regex check with a list of named colours. SH-03 will generalise it into the harness.
- **`face.test.tsx`** (`// @vitest-environment jsdom`; call `cleanup()` in `afterEach`, since Vitest globals are off; stub `matchMedia` in the test):
  1. defaults to two columns, and the switch changes `data-layout`;
  2. `options.layout = 'list'` starts in list;
  3. `options.layoutSwitch = false` hides the switch;
  4. opening a dish sets `#item-<id>` and a dialog named after the dish; Back closes it and returns focus to the opener; Escape closes too;
  5. dietary filters combine with AND, tags with OR; an emptied section is hidden; the empty state and clear work;
  6. the allergen button names the allergens and opens the sheet;
  7. no wordmark text "RESTRO" anywhere;
  8. a text-only item with a badge has `[data-slot="item.badges"]`.
- **Shell:** the new strings exist in BG and EN. Extend the existing strings test if there is one.

## Done when

- `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass.
  - You need no database for this brief. Database tests are skipped without `CI=true`; that is fine here, so say so in the report.
- The vendor-word test is green. The face and the shell must not name any vendor.
- **Report** in the CLAUDE.md format, plus a table of each change made while porting (what the delivery did → what you did → which rule).

## Never

- **Dependencies:** none beyond the two devDependencies named above.
- **Files:** never edit `docs/design/**` (the stored delivery) or `C:\Platform`.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Guardrails:** never weaken or skip a guardrail or a contract check to pass. If the contract cannot pass, stop and report.
- **Line endings:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
