# Brief S3-02: the shell, rules R1–R14 → view model (pure)

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-01a is merged.
- **Read first:**
  - `CLAUDE.md` (import boundaries: `packages/shell` never imports db, barsy, apps or anything with I/O);
  - `docs/architecture/data-architecture.md` → "The visualization shell" (what it does, rules R1–R14, the face contract, planned faces, contract tests) and "Snapshot shape";
  - `docs/tracker.md` → D10, D24, D42, D45, D46, D60, D61;
  - S3-01a's `packages/core/src/snapshot/*` (the `MenuSnapshot` type and Zod schema, the live overlay type);
  - `packages/core/src/money.ts` and `locales.ts`.

## Goal
`packages/shell` turns *(snapshot, live overlay, context)* into a **view model** that a face only draws. Every rule from the doc lives here, so a face can change how the menu looks but never what is shown, in what order or in what state. It is pure and deterministic, and can be unit-tested without any face.

## Do
1. **Context type:**
   - `locale` (requested);
   - `now` (ISO with offset) and `timeZone` (the venue's, default Europe/Sofia);
   - `channel`: `'qr'` now, with `'kiosk' | 'print' | 'tv'` in the type;
   - `tableToken`: the opaque token or null;
   - `orderingEnabled`: false in Stage 3;
   - `soldOutDisplay`: `'show' | 'hide'`, from the menu setting, default `show`.
2. **`buildViewModel(snapshot, overlay | null, context)`** applies R1–R14 exactly as the doc words them:
   - **R1:** visibility, with scheduled items shown as scheduled on `qr`.
   - **R2:** order from the snapshot arrays only.
   - **R3:** language fallback: requested → default → any available. **Never empty**, and each text carries its real `lang`.
   - **R4:** money formatted from minor units for the locale (bg-BG / en-US) and the snapshot currency; `price_from` → "from …"; option deltas "+3,00 €". Use `Intl.NumberFormat`. The shell may format; it never computes prices.
   - **R5:** item state `available | sold_out | scheduled | unavailable`. The overlay's `sold_out` wins over `available`, never the other way round. `soldOutDisplay` is applied here.
   - **R6:** every food item exposes its allergens (codes + localized names). The view model includes the allergen legend for the menu.
   - **R7/R8:** required slots are always present; empty optional slots are absent, never placeholder text.
   - **R9:** names are never truncated; descriptions carry a `truncatable` flag for `qr`.
   - **R10:** image variant choice from the face's declared slot (`thumb` / `card` / `full`) and pixel density; the focal point passes through; a `noImage` flag otherwise.
   - **R11:** no ordering controls in Stage 3 (`orderingEnabled` false). Keep the computation; an `ask_waiter` item shows "Ask your waiter".
   - **R12:** public custom fields in template order into `extraFields`, through `field_types`.
   - **R13:** theme tokens to semantic pairs (background/surface/accent/on-accent/text/muted) with readable contrast (WCAG AA 4.5:1 for text). Write a small in-house palette helper here (one brand colour → an 11-step palette, ported from the Platform's `Pages/Design/Index.jsx` 26-46 and 120-130); **no `chroma-js`** (Martin, 10-10).
   - **R14:** reads nothing outside its three inputs (no `Date.now()`, no globals).
3. **Tags and badges:** the item's tag ids resolve to `{id, label(localized)}` from the snapshot's `tags`. Dietary labels → localized names (BG/EN tables in the shell). Badges pass through. The view model also lists the tags present on the menu, for the guest filter chips.
4. **Face manifest schema** (Zod) as in the doc: `face`, `version`, `channels`, `slots`, `allergen_mode`, `no_image_layout`, `ordering`, `paging`, `tokens`. Plus `validateManifest()`, which enforces R6 and R7: a face without required slots cannot be installed.
5. **Contract-test harness** (`packages/shell/testing`): fixture snapshots that pass S3-01a's schema, covering:
   - 60-character names;
   - six languages with gaps;
   - no images;
   - sold out by overlay;
   - scheduled;
   - 300 items;
   - deep modifier groups;
   - an `ask_waiter` item;
   - tags + dietary.

   Add `runFaceContract(renderFn, manifest)`, which renders every fixture and asserts:
   - each visible item has every required slot (`data-slot` attributes);
   - only `nd_` / `as_` / `tg_` ids appear;
   - allergens are reachable.

   S3-03 uses this harness for the `qr-phone` face.

## Tests
- **Unit tests** for each rule.
- **fast-check properties:**
  - same inputs → deep-equal view model;
  - no text is ever empty;
  - section and item order equals the snapshot order;
  - an overlay can only make items *less* available;
  - money output always parses back to the same minor units.

## Done when
`pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass. No database is needed.

## Never / scope
- **Scope:** `packages/shell/**` only (plus its `package.json` dependency on `@restro/core` for types and money, if not there).
- **No I/O:** no fetch, no React. Faces are S3-03.
- **No new dependency.**
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`, with the Platform port line for the palette.
