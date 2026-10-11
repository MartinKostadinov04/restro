# Brief SH-04: template registry, the guest page and the preview render the chosen template, fonts

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/04-registry-guest` from `sh/foundation` yourself, after SH-01, SH-02 and CF-14 are merged.
- **Task:** T74.
- **Decisions:** D61, D68, D69, D70.
- **Runs in parallel with:** SH-03 (`packages/shell` and the two faces' code). Stay out of `packages/shell`, `packages/core` and the faces' `src/` (except the `package.json` exports below).

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D61, D68 and D69–D70.
2. **Next.js 16.4 is newer than your training data.** Before writing code, read the font guide and the lazy-loading guide in `apps/web/node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`).
3. The guest side:
   - `apps/web/src/guest/{guest-menu,context,load,cdn}.tsx/ts` (CF-12 made the table token "confirmed"; CF-14 made the address `/m/<slug>-<code>`);
   - `apps/web/app/m/**`;
   - `apps/web/src/publish/{draft-face,preview-dialog,phone-frame}.tsx`;
   - `apps/web/app/layout.tsx` (today's `Inter` with `next/font/google`).
4. The faces:
   - `packages/faces/{qr-phone,editorial-market}/src/index.ts`, `manifest.ts`, `package.json`;
   - `packages/shell/src/face-props.ts` (`FaceHostProps`).
5. Core `THEME_FONTS` (SH-01, `packages/core/src/theme/fonts.ts`) and the snapshot's `theme.scheme`, `presentation` and `features`.
6. `.dependency-cruiser.cjs` and `scripts/depcruise-rules.test.ts`.
7. The e2e specs `apps/web/e2e/{guest,sold-out,publish,appearance,tables}.spec.ts`, which may select the qr-phone's `rq-*` classes.

## What to build

### 1. Manifest-only entry points

Add `"./manifest": "./src/manifest.ts"` to `exports` in both faces' `package.json`. The registry can then know every template's manifest without loading its components.

### 2. Registry (`apps/web/src/faces/registry.ts`, new)

```ts
export interface FaceEntry {
  readonly id: string                       // = manifest.face
  readonly manifest: FaceManifest
  readonly load: () => Promise<ComponentType<FaceHostProps>>
  readonly hidden: boolean                  // hidden templates are never offered to venues (D69)
  readonly name: { readonly bg: string; readonly en: string }
  readonly description: { readonly bg: string; readonly en: string }
  readonly thumbnail: string                // '/faces/<id>.png'
}
export const DEFAULT_FACE_ID = 'editorial-market'
export const FACES: readonly FaceEntry[]   // editorial-market (visible), qr-phone (hidden)
export function faceEntry(id: string | null | undefined): FaceEntry  // unknown or missing → default, logged once (structured, no personal data)
export function visibleFaces(): readonly FaceEntry[]
```

- `load` uses a dynamic `import('@restro/editorial-market')`, so the guest page downloads one template.
- Names:
  - Editorial Market: "Editorial Market" / "Редакционен пазар". Description: a photo-led, editorial menu with a category rail and three layouts.
  - qr-phone: "Simple (test reference)".

  These are product words. The lead may adjust them.

### 3. Rendering the chosen template

Add a small client hook or component (e.g. `apps/web/src/faces/use-face.ts` or `chosen-face.tsx`). It loads the entry's component (`React.lazy` or a state-based loader, following the Next guide). While loading it shows the existing skeleton (`QrPhoneSkeleton` for now).

**`GuestMenu`** (`guest-menu.tsx`):
- renders `faceEntry(snapshot.presentation?.face)`;
- passes everything it passes today (`view`, `assetBase`, `languages`, `onLanguageChange`, `tableLabel` from the confirmed table), plus:
  - `scheme = snapshot.theme.scheme ?? 'auto'`;
  - `fontStacks = FONT_STACKS` (from the new fonts module);
  - `options = snapshot.presentation?.options`.
- Do not pass context capabilities. They stay at their defaults, all off, in Stage 3 (D71).

**`DraftFace`:** the same, plus an optional `faceId` prop that overrides the snapshot's face. SH-05a's Design preview will use it. `scheme` keeps its preview override.

### 4. Fonts (`apps/web/src/fonts.ts`, new)

- Use `next/font/google` for every `THEME_FONTS` family:
  - `subsets: ['latin', 'cyrillic']`, `display: 'swap'`;
  - `variable: '--font-<id>'`;
  - **`preload: false` for everything except Inter**, so the admin and guest pages don't preload six fonts.
- Export:
  - `FONT_VARIABLES`: the class names, applied on `<html>` in `app/layout.tsx`, replacing today's single Inter;
  - `FONT_STACKS: Record<family, string>`: `var(--font-<id>), "<Family>", <system fallback by kind>`.
- Remove the old `FONT_STACKS` from `guest-menu.tsx` (import the new one).
- Guests must never request a third-party host. Next self-hosts these files at build time; check the built HTML or CSS has no `fonts.googleapis.com` or `fonts.gstatic.com`.

### 5. Thumbnails

Add `apps/web/public/faces/editorial-market.png` and `qr-phone.png`, each at most 150 KB: phone-width screenshots of the demo menu, made with a one-off Playwright script kept in your scratchpad, not in the repo.

### 6. Guardrails (tighten only)

- **`apps/web/src/faces/registry.test.ts`:** for **every** entry, hidden ones included:
  - `entry.id === entry.manifest.face`;
  - `validateManifest(entry.manifest).ok`;
  - `runFaceContract` over all fixtures has zero failures (render each loaded component with `renderToStaticMarkup`);
  - `DEFAULT_FACE_ID` is visible;
  - ids are unique.

  SH-03 is adding a `faceContractSuite` helper in parallel; once both merge, the lead switches this test to it.
- **New dependency-cruiser rule `faces-only-react-and-shell`:** a non-test file under `packages/faces/*/src/` may import only:
  - its own package's files;
  - `react`, `react-dom` (and their internals such as `scheduler`, `react/jsx-runtime`);
  - `@restro/shell`.

  Add the proving case to `scripts/depcruise-rules.test.ts` (a face file importing `lucide-react` or `@restro/core` must fail).

### 7. e2e

- Update the selectors in `guest`, `sold-out`, `publish` and `tables` specs that depend on qr-phone's markup. Prefer roles, text and `data-*` contract markers (`data-item`, `data-slot`, `data-state`) over classes.
- **New assertions:**
  - the demo venue's guest page shows the Editorial Market (`data-layout` on its root);
  - a sold-out mark still appears within the 15-second refresh;
  - a forced `scheme` from a snapshot reaches the root's `data-scheme`, if it can be set through the existing seed. Otherwise use a component test.

### 8. Findings from SH-02 to check on the real page

- **History on the real page.** The face opens the dish page with `history.pushState({ rmItem }, '', '#item-<id>')` and closes it with `history.back()`. Next.js patches `history`. Prove in e2e that on `/m/...`:
  - opening a dish and pressing the browser's Back closes it, without leaving the menu;
  - a shared `#item-<id>` link opens that dish on load.
- **Page-wide scroll rules.** The face's CSS sets `html:has(.rm) { overflow-x: hidden }` and hides the scrollbar while it is mounted. Check that it does not leak into the admin's Design preview (SH-05a renders the face inside the admin page). If it does, report it and the lead decides; do not edit the face's CSS.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build && pnpm test:e2e` pass with DB tests on `restro_sh_04` (54329).
- **Fonts:** the built guest page loads its fonts only from our own origin.
- **Vendor words:** the test stays green.
- **Report:** in the CLAUDE.md format, including the guest page's JS size for `/m/[venue]` before and after (from `pnpm build` output).

## Never / scope

- **Out of scope:**
  - the Design tab (SH-05a), the composer panel (SH-05b), the services (SH-06);
  - shell or core code.
- **Dependencies:** none new (next/font is part of Next).
- **Guardrails only tighten.**
- **Never** read `.env.local` or call barsy.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
