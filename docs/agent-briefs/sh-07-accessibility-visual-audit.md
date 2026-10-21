# Brief SH-07: accessibility and visual audit of Editorial Market, with fixes

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/07-audit` from `sh/foundation` yourself, after SH-05a, SH-05b and SH-06 are merged and the lead's preview switch is in.
- **Task:** T74.
- **Decisions:** D69–D72.
- **Runs in parallel with:** SH-08 (docs only).

## Read first

**Testing.** Follow CLAUDE.md's two tiers. Your own spec runs with `--reporter=line`; the full Playwright suite runs in CI after the lead pushes.

1. `CLAUDE.md`.
2. The designer guide `docs/guides/shell-handoff/visualization-shell.md` §7.5 (visual and accessibility rules).
3. The handover `docs/design/faces/editorial-market/2026-10-11/handover.md`:
   - §2 "Current presentation behavior (verify before production)". The designer says some controls and ordering dialogs still need a touch-target and focus audit;
   - §10 (inverse compositions, the `color-mix` derived colours);
   - §13 acceptance scenarios.
4. The face: `packages/faces/editorial-market/src/**` (`css.ts`, `services/services-css.ts`).
5. The e2e set-up `apps/web/e2e/{support,global-setup}.ts` and an existing spec, e.g. `guest.spec.ts`.
6. **For the service screens:** `apps/web/e2e/design.spec.ts` and its seed `apps/web/scripts/seed-design-e2e.ts` (a "Design Club" venue of its own, reset on each run). The Design preview's "Preview guest services" switch is `data-testid="design-preview-services"` (`apps/web/src/design/design-preview.tsx`). It shows only the services the venue switched on, so switch them on first through the composer's Guest features panel or the seed (`venues.settings.guest_features`), then press the preview's Refresh.
7. **Don't repeat SH-05a's screenshots:** its Design-tab pictures are in the lead's scratchpad already. Yours are of the guest face.

## What to do

### 1. Screenshot matrix (`apps/web/e2e/faces-visual.spec.ts`)

Not a pixel comparison: it saves files for people to review. Each test writes to `test-results/faces-visual/<preset>-<scheme>-<lang>-<width>-<screen>.png`, and the spec is skipped unless `FACES_VISUAL=1`, so the normal gate stays fast.

| Dimension | Values |
|---|---|
| Widths | 320, 360, 390, 430, 820 |
| Language | BG, EN |
| Scheme | light, dark |
| Theme | the 4 presets + 1 custom theme from three colours (e.g. primary `#f6f1e9`, secondary `#e9dccb`, tertiary `#7a2e8c`) |

Screens:
- the top of the menu;
- a section with photo cards in each layout (list, 1, 2);
- a long Cyrillic name (60 characters) at 320;
- sold-out and scheduled items;
- the dish page;
- the filter sheet;
- the allergen sheet;
- in the Design preview with "preview services" on: the bag, the bill, call a waiter, pay and the receipt.

Run it once with `FACES_VISUAL=1` and copy the images to your scratchpad.

### 2. Automated checks (these run in the normal gate)

Add them to the same spec, or to a second spec without the skip:
- **Touch targets:** every `button`, `a` and `[role="radio"]` in the face measures at least 44×44 px (`getBoundingClientRect`) at 320 and 390 px.
- **Dialogs:** every dialog (dish, filters, allergens, and each service sheet in preview) moves focus inside on open, keeps Tab inside, closes on Escape and returns focus to its opener.
- **No horizontal scroll** at 320 px: `scrollWidth ≤ clientWidth`.
- **Names never cut:** no `text-overflow: ellipsis` and no line clamp on `[data-slot="item.name"]` (computed style).
- **Reduced motion:** with `reducedMotion: 'reduce'`, opening the dish page applies no animation (computed `animation-name: none` or a duration of 0).
- **Rendered contrast** for each preset in light and dark:
  - read the computed colours of the header band, the footer band, the bag bar and the muted texts on them;
  - assert at least 4.5:1 for text and at least 3:1 for control borders the guest must see (inputs, choice boxes).
  - These are the `color-mix` and inverse compositions the colour rules alone do not cover.

**Known from SH-02** (each needs a fix or an explained "not fixed"):
- **Tap targets below 44 px:** the layout buttons (36×30) and the language buttons (34/30 px high). Add invisible hit areas without changing the look.
- **Heading levels:** item names are `h3` under sub-sections too; the guide says `h4` there. The CSS targets `h3`, so adjust it with the markup.
- **Image sizes:** item photos use full-width `sizes` even in the two-column layout. Make `sizes` follow the layout so phones pick smaller files.
- **Allergen sheet:** it marks the dish's allergens only by weight and opacity. Add a non-visual cue as well, such as visually hidden text or `aria-current`.

**Known from SH-04:**
- **Table label:** `.rm-table { display: none }` hides the table label at 350 px wide or less, so the guest loses "Table 12". Keep it visible: shorten it or let it wrap.
- **Dish name markup:** the dish name is a `div` and an `h3` inside a `<button>`, which is not valid. Restructure it, for example the button inside the heading, or a link-style button beside it, keeping the contract markers and the focus behaviour.
- **Assertion:** SH-04 records the Editorial targets under 44 px as an e2e annotation. Once you fix them, promote that annotation to an assertion.

### 3. Fixes

- Fix every failure in the face's CSS and markup only (`css.ts`, `services/services-css.ts`, small markup changes such as `aria-*` or wrapping a target).
- Keep the design. Where a fix changes the look visibly (a bigger target, a stronger muted inverse colour), choose the smallest change and list it.
- If a contrast failure comes from the theme rules themselves (core `deriveRoles`), do **not** change core: report it with the numbers, and the lead decides.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build && pnpm test:e2e` pass with DB tests on `restro_sh_07` (54329).
- **Report:** in the CLAUDE.md format, with:
  - a findings table: check → result before → fix → result after (or "not fixed" with the reason and a recommendation);
  - the path of the screenshot folder;
  - a short list of the 10 most telling screenshots for Martin.

## Never / scope

- **Edit only:** the face package's CSS and markup and the new spec(s). No core, shell or admin changes.
- **Dependencies:** none new. Playwright is already there.
- **Guardrails only tighten.** Never relax an existing assertion.
- **Never** read `.env.local`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
