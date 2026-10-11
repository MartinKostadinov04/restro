# Brief SH-08: docs and the designer guide v2

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/08-docs` from `sh/foundation` yourself, after SH-05a, SH-05b and SH-06 are merged.
- **Task:** T74.
- **Decisions:** D63, D69–D72.
- **Runs in parallel with:** SH-07 (the face's CSS and the e2e). Edit only docs, plus `CLAUDE.md` and `README.md`.

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D38, D63, D67 and D69–D72, and T74.
2. **What was built (read the merged code, not the briefs):**
   - **core theme:** `packages/core/src/theme/**` and the snapshot additions in `snapshot/schema.ts`;
   - **shell:** `packages/shell/src/{build,features,manifest,services,bag,face-props}.ts`;
   - **shell testing:** `packages/shell/testing/{contract,css,fixtures,services,index}.ts`;
   - **faces:** `packages/faces/editorial-market/**`, `packages/faces/qr-phone/src/manifest.ts`;
   - **web:** `apps/web/src/faces/registry.ts`, `apps/web/src/fonts.ts`, `apps/web/src/design/**`, `apps/web/src/composer/guest-features-panel.tsx`.
3. **The docs to update:**
   - `docs/guides/shell-handoff/visualization-shell.md` (v1, written 10-10);
   - `docs/architecture/data-architecture.md`: the sections on the visualization shell, the face contract, R1–R14, publishing and the snapshot contract;
   - `README.md` "Scaffold conventions";
   - `CLAUDE.md`.
4. **The delivery:** `docs/design/faces/editorial-market/2026-10-11/{README,handover}.md`.

## What to write

### 1. Designer guide v2 (`docs/guides/shell-handoff/visualization-shell.md`)

Rewrite it as v2, dated, in the same plain style. Keep what is still true. Change or add:

- **§0:** the gallery exists (D69). A face is a "template"; Editorial Market is the default.
- **The theme (R13):**
  - the venue's 3 colours and how the 8 roles are derived for light and dark (D70);
  - overrides;
  - the presets;
  - `theme.scheme`;
  - the six fonts.
  - Faces still read only `theme.colors`/`colorsDark`. They must pair roles as named, and inverse bands use `text`/`background`.
- **R15 Features:** what `view.features` means, and that it is fail-closed. Faces draw a feature only when it is on, and they mark it with its `menu.*` slot.
- **The manifest:** `features` and `options` (`type`, `values`, `default`, `group: 'feature' | 'look'`, `label`), with the Editorial Market manifest as the example.
- **Host props:** `FaceHostProps`, now with `options` and `services`.
- **Services (D72):**
  - the `ServiceBinding` contract (commands, results, state);
  - the "no local success" rule with the four flows as sequences: send, bill, waiter, pay;
  - the preview marker;
  - what the face may compute (the bag estimate, through the shell) and what it may not (totals, tips, VAT, splits).
- **Tests a template must pass:** `faceContractSuite`, the CSS theme-only check, the feature-slot checks, the registry test, and the visual audit spec (`FACES_VISUAL=1`).
- **New section "Delivering an update to a template":**
  - the designer keeps the same file structure;
  - Restro stores each delivery in `docs/design/faces/<id>/<date>/`, diffs `source/` against the previous delivery and ports only the differences.
- **New section "A new template":**
  - a checklist from first sketch to gallery: package, manifest, registry entry, thumbnail, tests, screenshots;
  - a ready-to-copy brief skeleton for the porting agent.
- **Appendix C** ("where the guide and code differ"): refresh it against the code.

### 2. Architecture mirror (`docs/architecture/data-architecture.md`)

Update the shell and outbound sections:
- the snapshot's optional `theme.roles`/`scheme`, `presentation` and `features`, with the "optional forever, parser-first after deploy" note;
- R13 as changed;
- R15;
- the template registry;
- the services contract as the face-side half of Stage 4, with a pointer to A5 §5.1 for the platform half.

Keep the doc's voice and section order. The lead mirrors your text into the live page.

### 3. `README.md`

In "Scaffold conventions", add how a face package is laid out:
- `./manifest` and `./preview` subpath exports;
- the allowed imports;
- its tests.

### 4. `CLAUDE.md`

- **Layout:** check the faces line is still right.
- **Rule:** add one line under "Import boundaries" for the two new dependency rules: faces import only react, react-dom and `@restro/shell`; guest pages never import a face's `/preview`.
- **Commands:** add `FACES_VISUAL=1 pnpm test:e2e` for the screenshot matrix.

## Done when

- **Gate:** `pnpm lint` passes (Markdown is not linted, but `CLAUDE.md` and `README.md` must stay valid).
- **Check:** every code name you write (function, type, file, slot, option) exists in the merged code. Grep each one.
- **Report:** in the CLAUDE.md format, with a list of every section you changed and the code names you checked.

## Never / scope

- **Docs only.** No code changes. If the code and the plan differ, document the code and list the difference in your report.
- **Never** edit the stored delivery under `docs/design/**/2026-10-11/`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
