// The stylesheet of the Editorial Market face, as one string injected in a <style> element (see
// face.tsx). Ported from the designer's delivery of 2026-10-11 (docs/design/faces/editorial-market):
// the same classes (`rm-…`) and rules, with the delivery's chains of overrides folded into their
// final values. The delivery's ordering rules (`ro-…`) are in services/services-css.ts, which the
// face adds only when it draws a service; so the room the bottom bar needs under the page is
// there too, and a browsing-only page has no empty band.
//
// It holds no colour of its own (R13): every colour, the font, the radius and the shadow are
// variables that `themeVariables()` writes onto the root (`--rm-l-*` for a light screen, `--rm-d-*`
// for a dark one); the `.rm[data-scheme]` rules pick the set. css.test.ts holds it to that.
//
// The rules run in the delivery's order, and a later rule refines an earlier one: the first part is
// the base (page, venue bar, rail, sections, items, sheets, the dish page, schemes, wide and narrow
// screens), then the designer's refinements (photo stage, motion, the dish page again), then the
// layouts, the layout and language switches and the page rules. Comments inside the string mark
// where each part starts.

export const EDITORIAL_CSS = `
/* The page: the venue's variables, the light set by default. */
.rm {
  --rm-pill: calc(var(--rm-radius) * 1.6);
  --rm-bg: var(--rm-l-background);
  --rm-surface: var(--rm-l-surface);
  --rm-accent: var(--rm-l-accent);
  --rm-on-accent: var(--rm-l-onAccent);
  --rm-text: var(--rm-l-text);
  --rm-muted: var(--rm-l-muted);
  --rm-accent-text: var(--rm-l-accentText);
  --rm-border: var(--rm-l-border);
  /* General (D130): a first value is the base here, every other value a rule below. */
  --rm-font-heading: var(--rm-font);
  --rm-heading-weight: 700;
  --rm-subheading-weight: 700;
  --rm-full: 999px;
  --rm-depth: 0 4px 12px color-mix(in srgb, var(--rm-text) 20%, transparent);
  --rm-depth-up: 0 -4px 12px color-mix(in srgb, var(--rm-text) 20%, transparent);
  --rm-space: 0.67;
  --rm-type: 1;
  --rm-button: var(--rm-accent);
  --rm-on-button: var(--rm-on-accent);
  --rm-button-mark: var(--rm-on-accent);
  --rm-on-button-mark: var(--rm-accent);
  min-height: 100vh;
  background: var(--rm-bg);
  color: var(--rm-text);
  font-family: var(--rm-font);
  font-size: calc(16px * var(--rm-type));
  line-height: 1.45;
  letter-spacing: 0;
}
.rm[data-heading-weight="regular"] {
  --rm-heading-weight: 400;
  --rm-subheading-weight: 400;
}
.rm[data-heading-weight="heavy"] {
  --rm-heading-weight: 880;
  --rm-subheading-weight: 850;
}
.rm[data-corners="square"] {
  --rm-full: 0px;
}
.rm[data-depth="none"] {
  --rm-depth: none;
  --rm-depth-up: none;
}
.rm[data-density="compact"] {
  --rm-space: 0.5;
}
.rm[data-density="spacious"] {
  --rm-space: 1;
}
.rm[data-text-size="large"] {
  --rm-type: 1.125;
}
.rm[data-buttons="ink"] {
  --rm-button: var(--rm-text);
  --rm-on-button: var(--rm-bg);
  --rm-button-mark: var(--rm-accent);
  --rm-on-button-mark: var(--rm-on-accent);
}
/* An ink button on an ink sheet inverts (D130): page fill, ink writing. */
.rm[data-buttons="ink"] .rm-overlay-panel:not(.is-detail) {
  --rm-button: var(--rm-bg);
  --rm-on-button: var(--rm-text);
}
.rm * {
  box-sizing: border-box;
}
.rm [hidden] {
  display: none !important;
}
.rm button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.rm button:focus-visible,
.rm a:focus-visible {
  outline: 3px solid var(--rm-accent-text);
  outline-offset: 3px;
}
.rm svg {
  width: 24px;
  height: 24px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
}
.rm-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
/* The venue bar and the title block. */
.rm-header {
  padding: calc(18px * var(--rm-space)) 20px calc(24px * var(--rm-space));
  background: var(--rm-text);
  color: var(--rm-bg);
}
.rm-brandline {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  align-items: center;
}
.rm-logo {
  display: block;
  max-width: 96px;
  max-height: 44px;
  object-fit: contain;
}
.rm-headtools {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 2px 6px;
  min-width: 0;
}
.rm-table {
  border: 1px solid color-mix(in srgb, var(--rm-bg) 24%, transparent);
  border-radius: var(--rm-full);
  padding: 7px 10px;
  font-size: calc(12px * var(--rm-type));
}
.rm-icon,
.rm-overlay-head button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  background: transparent;
  color: inherit;
}
.rm-titleblock {
  padding-top: calc(26px * var(--rm-space));
  max-width: 560px;
}
.rm-titleblock h1 {
  margin: 0;
  font-size: clamp(calc(38px * var(--rm-type)), 11vw, calc(60px * var(--rm-type)));
  line-height: 0.95;
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-heading-weight);
  overflow-wrap: anywhere;
}
.rm-titleblock > p {
  margin: 12px 0 0;
  max-width: 40ch;
  color: color-mix(in srgb, var(--rm-bg) 72%, transparent);
}
.rm-titleblock .rm-schedule {
  color: var(--rm-bg);
  font-weight: 750;
}
/* The category rail. */
.rm-sections {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 0 12px;
  background: color-mix(in srgb, var(--rm-bg) 96%, transparent);
  border-bottom: 1px solid var(--rm-border);
  scrollbar-width: none;
  overscroll-behavior-x: contain;
}
.rm-sections::-webkit-scrollbar,
.rm-section.is-feature .rm-items::-webkit-scrollbar {
  display: none;
}
.rm-sections a {
  position: relative;
  flex: none;
  min-width: 44px;
  min-height: 56px;
  padding: 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--rm-muted);
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}
.rm-sections a:after {
  content: "";
  position: absolute;
  right: 8px;
  bottom: 0;
  left: 8px;
  height: 3px;
  background: var(--rm-accent-text);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.2s ease;
}
.rm-sections a[aria-current="true"] {
  color: var(--rm-text);
}
.rm-sections a[aria-current="true"]:after {
  transform: scaleX(1);
}
/* Sections and their items. */
.rm-section {
  padding: calc(58px * var(--rm-space)) 20px 0;
  scroll-margin-top: 56px;
}
.rm-section-head {
  margin-bottom: calc(22px * var(--rm-space));
}
.rm-section-head > img {
  width: 100%;
  aspect-ratio: 16 / 7;
  object-fit: cover;
  border-radius: var(--rm-radius);
  margin-bottom: 24px;
}
.rm-section h2,
.rm-section h3,
.rm-section h4 {
  margin: 0;
  font-size: calc(31px * var(--rm-type));
  line-height: 1.02;
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-heading-weight);
  overflow-wrap: anywhere;
}
.rm-section-head p {
  max-width: 42ch;
  margin: 12px 0 0;
  color: var(--rm-muted);
}
.rm-items {
  display: grid;
  gap: 0;
}
.rm-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 116px;
  gap: calc(18px * var(--rm-space));
  padding: calc(25px * var(--rm-space)) 0;
  border-top: 1px solid var(--rm-border);
  content-visibility: auto;
  contain-intrinsic-size: 210px;
}
.rm-photo {
  grid-column: 2;
  grid-row: 1;
  position: relative;
}
.rm-photo img {
  display: block;
  width: 116px;
  height: 116px;
  object-fit: cover;
  border-radius: calc(var(--rm-radius) * 0.8);
  background: var(--rm-surface);
}
/* Badges: one slot with all of an item's badges, over the photo's corner or above a text row. */
.rm-badges {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.rm-photo .rm-badges {
  position: absolute;
  top: 8px;
  left: 8px;
  max-width: calc(100% - 16px);
}
.rm-badge {
  padding: 5px 8px;
  border-radius: var(--rm-full);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  box-shadow: var(--rm-depth);
}
.rm-item-copy {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
}
.rm-item-open {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
}
.rm-item :is(h3, h4) {
  font-size: calc(19px * var(--rm-type));
  line-height: 1.12;
  font-weight: 850;
}
.rm-price {
  margin-top: 7px;
  font-size: calc(14px * var(--rm-type));
  font-weight: 850;
}
.rm-state {
  min-height: 0;
  margin-top: 7px;
  color: var(--rm-accent-text);
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
}
.rm-state:empty {
  display: none;
}
.rm-description {
  margin-top: 9px;
  color: var(--rm-muted);
  font-size: calc(14px * var(--rm-type));
}
.rm-description p {
  margin: 0;
}
.rm-description p[data-clamped="true"] {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.rm-portion {
  margin-top: 7px;
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
}
.rm-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 11px;
}
.rm-labels span {
  padding: 5px 9px;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-full);
  font-size: calc(12px * var(--rm-type));
  font-weight: 800;
}
.rm-allergens {
  margin-top: 8px;
}
.rm-allergens button {
  min-width: 44px;
  max-width: 100%;
  min-height: 44px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.rm-allergens b {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  padding: 0 4px;
  border: 1px solid var(--rm-border);
  border-radius: calc(var(--rm-radius) * 0.875);
  font-size: calc(12px * var(--rm-type));
}
.rm-extra,
.rm-modifiers {
  margin-top: 10px;
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
}
.rm-extra {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rm-modifiers p {
  margin: 5px 0;
}
.rm-waiter {
  font-weight: 750;
}
/* The photo-led strip: a section marked horizontal (D92), big cards that scroll sideways. */
.rm-section.is-feature {
  padding-top: 38px;
}
.rm-section.is-feature .rm-items {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  margin: 0 -20px;
  padding: 0 20px 18px;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: 20px;
  scrollbar-width: none;
}
.rm-section.is-feature .rm-item {
  display: block;
  flex: 0 0 84vw;
  width: 84vw;
  max-width: 390px;
  padding: 0 0 24px;
  border: 0;
  scroll-snap-align: start;
}
.rm-section.is-feature .rm-photo,
.rm-section.is-feature .rm-item-copy {
  display: block;
}
.rm-section.is-feature .rm-photo img {
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  border-radius: calc(var(--rm-radius) * 1.15);
}
.rm-section.is-feature .rm-item-copy {
  padding-top: 17px;
}
.rm-section.is-feature .rm-item :is(h3, h4) {
  font-size: calc(22px * var(--rm-type));
}
.rm-section.is-feature .rm-price {
  font-size: calc(15px * var(--rm-type));
}
/* The allergen information footer. */
.rm-footer {
  margin-top: 78px;
  padding: 42px 20px calc(42px + env(safe-area-inset-bottom));
  background: var(--rm-text);
  color: var(--rm-bg);
}
.rm-footer h2 {
  margin: 0;
  font-size: calc(25px * var(--rm-type));
}
.rm-footer > p {
  max-width: 46ch;
  color: color-mix(in srgb, var(--rm-bg) 70%, transparent);
}
.rm-legend {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 28px;
}
.rm-legend span,
.rm-allergen-sheet li {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: calc(13px * var(--rm-type));
}
.rm-legend b,
.rm-allergen-sheet b {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid currentColor;
  border-radius: calc(var(--rm-radius) * 0.875);
}
/* Sheets (filters, allergens) and the dish page: one dialog, two looks. */
.rm-overlay {
  position: fixed;
  z-index: 50;
  inset: 0;
  background: color-mix(in srgb, var(--rm-text) 72%, transparent);
  display: flex;
  justify-content: center;
  align-items: flex-end;
  padding-top: 8dvh;
}
.rm-overlay-panel {
  width: min(100%, 640px);
  max-height: 92dvh;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--rm-text);
  color: var(--rm-bg);
  padding: 0 20px 38px;
  border-radius: calc(var(--rm-radius) * 1.4) calc(var(--rm-radius) * 1.4) 0 0;
  box-shadow: var(--rm-depth-up);
}
.rm-overlay-panel.is-detail {
  position: relative;
  padding: 0;
  background: var(--rm-bg);
  color: var(--rm-text);
}
.rm-overlay-head {
  position: sticky;
  z-index: 3;
  top: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-height: 64px;
  background: inherit;
  border-bottom: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  font-size: calc(12px * var(--rm-type));
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-subheading-weight);
  text-transform: uppercase;
}
.rm-overlay-panel.is-detail > .rm-overlay-head {
  position: absolute;
  right: 12px;
  left: 12px;
  background: transparent;
  border: 0;
  pointer-events: none;
}
.rm-overlay-panel.is-detail > .rm-overlay-head > span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.rm-overlay-panel.is-detail > .rm-overlay-head button {
  margin-left: auto;
  border-radius: var(--rm-full);
  background: var(--rm-bg);
  color: var(--rm-text);
  box-shadow: var(--rm-depth);
  pointer-events: auto;
}
.rm-overlay-head > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rm-overlay-intro {
  color: color-mix(in srgb, var(--rm-bg) 70%, transparent);
}
.rm-filter-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 28px 0 0;
  padding: 0;
  border: 0;
}
.rm-filter-group legend {
  width: 100%;
  margin-bottom: 8px;
  font-size: calc(20px * var(--rm-type));
  font-weight: 850;
}
.rm-filter-group button {
  min-width: 44px;
  min-height: 48px;
  padding: 0 17px;
  /* The edge of a choice shows at 3:1 on the panel (it was 30 %, about 1.9:1). */
  border: 1px solid color-mix(in srgb, var(--rm-bg) 52%, transparent);
  border-radius: var(--rm-pill);
  background: transparent;
}
.rm-filter-group button[aria-pressed="true"] {
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  border-color: var(--rm-accent);
}
.rm-clear {
  min-width: 44px;
  min-height: 48px;
  margin-top: 30px;
  padding: 0;
  border: 0;
  background: transparent;
  text-decoration: underline;
}
.rm-allergen-sheet {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin: 26px 0 0;
  padding: 0;
  list-style: none;
}
.rm-allergen-sheet li {
  opacity: 0.72;
}
.rm-allergen-sheet li.is-present {
  opacity: 1;
  font-weight: 800;
}
.rm-allergen-sheet li.is-present b {
  background: var(--rm-bg);
  color: var(--rm-text);
}
.rm-detail-photo {
  overflow: hidden;
  background: var(--rm-surface);
}
.rm-detail-photo img {
  display: block;
  width: 100%;
  max-height: 52dvh;
  aspect-ratio: 4 / 3;
  object-fit: cover;
}
.rm-detail-copy {
  padding: 30px 20px 52px;
}
.rm-detail-title {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: start;
}
.rm-detail-title h2 {
  margin: 0;
  font-size: calc(30px * var(--rm-type));
  line-height: 1.03;
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-heading-weight);
  overflow-wrap: anywhere;
}
.rm-detail-title strong {
  font-size: calc(16px * var(--rm-type));
}
.rm-detail-copy > p {
  color: var(--rm-muted);
}
.rm-detail-state {
  color: var(--rm-accent-text) !important;
  font-weight: 800;
}
.rm-detail-allergens {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--rm-border);
}
.rm-detail-extra {
  margin: 8px 0;
}
.rm-detail-group {
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid var(--rm-border);
}
.rm-detail-group h3 {
  margin: 0 0 14px;
  font-size: calc(20px * var(--rm-type));
}
.rm-detail-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.rm-detail-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  padding: 10px 13px;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius);
  font-size: calc(13px * var(--rm-type));
}
.rm-detail-option b:empty {
  display: none;
}
/* The dark set, forced (data-scheme="dark") or following the guest's screen (auto). */
.rm[data-scheme="dark"] {
  --rm-bg: var(--rm-d-background);
  --rm-surface: var(--rm-d-surface);
  --rm-accent: var(--rm-d-accent);
  --rm-on-accent: var(--rm-d-onAccent);
  --rm-text: var(--rm-d-text);
  --rm-muted: var(--rm-d-muted);
  --rm-accent-text: var(--rm-d-accentText);
  --rm-border: var(--rm-d-border);
}
@media (prefers-color-scheme: dark) {
  .rm[data-scheme="auto"] {
    --rm-bg: var(--rm-d-background);
    --rm-surface: var(--rm-d-surface);
    --rm-accent: var(--rm-d-accent);
    --rm-on-accent: var(--rm-d-onAccent);
    --rm-text: var(--rm-d-text);
    --rm-muted: var(--rm-d-muted);
    --rm-accent-text: var(--rm-d-accentText);
    --rm-border: var(--rm-d-border);
  }
}
/* Wider screens (a centred column), and the narrowest phones. */
@media (min-width: 641px) {
  .rm {
    width: min(100%, 680px);
    margin: auto;
    box-shadow: 0 0 calc(var(--rm-shadow) * 18px)
      color-mix(in srgb, var(--rm-text) 12%, transparent);
  }
  .rm-header {
    padding: 22px 34px 30px;
  }
  .rm-sections {
    padding-left: 26px;
    padding-right: 26px;
  }
  .rm-section {
    padding-left: 34px;
    padding-right: 34px;
  }
  .rm-section.is-feature .rm-items {
    margin-left: -34px;
    margin-right: -34px;
    padding-left: 34px;
    padding-right: 34px;
    scroll-padding-inline: 34px;
  }
  .rm-footer {
    padding-left: 34px;
    padding-right: 34px;
  }
  .rm-item {
    grid-template-columns: minmax(0, 1fr) 150px;
  }
  .rm-photo img {
    width: 150px;
    height: 150px;
  }
  .rm-detail-copy {
    padding-right: 34px;
    padding-left: 34px;
  }
}
@media (max-width: 350px) {
  .rm-header,
  .rm-section,
  .rm-footer {
    padding-left: 14px;
    padding-right: 14px;
  }
  .rm-sections {
    padding-left: 6px;
    padding-right: 6px;
  }
  .rm-item {
    grid-template-columns: minmax(0, 1fr) 92px;
    gap: 13px;
  }
  .rm-photo img {
    width: 92px;
    height: 92px;
  }
  .rm-titleblock h1 {
    font-size: calc(39px * var(--rm-type));
  }
  .rm-section h2 {
    font-size: calc(28px * var(--rm-type));
  }
  .rm-legend,
  .rm-allergen-sheet {
    grid-template-columns: 1fr;
  }
}
/* Motion: smooth only when the guest has not asked for less; the reduce blocks switch it all off. */
@media (prefers-reduced-motion: no-preference) {
  .rm {
    scroll-behavior: smooth;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rm *,
  .rm *::before,
  .rm *::after {
    scroll-behavior: auto !important;
    animation: none !important;
    transition: none !important;
  }
}
/*
 * The designer's refinements: the whole item is one tap target, the photo sits on a stage panel,
 * names are set in capitals, the dish page is full screen and slides in.
 */
.rm-item {
  position: relative;
}
/* The button sits inside the item's heading and carries its name; its ::before is the item-wide tap
   area, its ::after the arrow (a picture: the second content value is its empty alternative text). */
.rm-item-open {
  text-transform: inherit;
  letter-spacing: inherit;
}
.rm-item-open::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
}
.rm-item-open::after {
  content: "→";
  content: "→" / "";
  display: inline-block;
  margin-left: 8px;
  color: var(--rm-muted);
  font-weight: 500;
  transition: transform 0.2s;
}
.rm-allergens button {
  position: relative;
  z-index: 2;
}
.rm-item:hover .rm-item-open::after {
  transform: translateX(4px);
  color: var(--rm-text);
}
.rm-item:hover .rm-photo img {
  transform: scale(1.02);
}
.rm-photo {
  overflow: hidden;
  border-radius: calc(var(--rm-radius) * 1.2);
}
.rm-photo img {
  transition: transform 0.5s ease;
}
.rm-section:not(.is-feature) .rm-item.has-photo {
  display: block;
  padding: 20px 0 44px;
  border-top: 0;
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img {
  width: 100%;
  height: auto;
  aspect-ratio: 4 / 3;
  border-radius: calc(var(--rm-radius) * 1.2);
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy {
  padding-top: 18px;
}
.rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: calc(24px * var(--rm-type));
  line-height: 1.1;
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-price {
  font-size: calc(16px * var(--rm-type));
}
.rm-item.is-text {
  display: block;
  padding: 22px 0;
}
.rm-item.has-photo + .rm-item.is-text {
  border-top: 0;
}
.rm-overlay:has(.is-detail) {
  padding: 0;
  align-items: stretch;
  background: var(--rm-bg);
}
.rm-overlay-panel.is-detail {
  width: min(100%, 680px);
  max-height: none;
  height: 100dvh;
  border-radius: 0;
  box-shadow: none;
  animation: none;
}
.rm-overlay-panel.is-detail > .rm-overlay-head {
  position: fixed;
  top: 14px;
  left: auto;
  right: auto;
  margin-left: 14px;
  width: auto;
}
.rm-detail-copy > p:first-of-type {
  margin-top: 16px;
}
.rm-overlay-panel.is-detail > .rm-overlay-head button {
  margin-left: 0;
  margin-right: auto;
}
.rm-overlay-panel.is-detail .rm-detail-photo img {
  max-height: 62dvh;
  aspect-ratio: 4 / 3;
}
.rm-detail-title h2 {
  font-size: calc(34px * var(--rm-type));
}
.rm-detail-copy > p {
  font-size: calc(16px * var(--rm-type));
  line-height: 1.6;
}
@media (prefers-reduced-motion: reduce) {
  .rm-photo img,
  .rm-item-open::after {
    transition: none !important;
    transform: none !important;
  }
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-photo,
.rm-section.is-feature .rm-photo {
  background: var(--rm-surface);
  padding: 14px;
  border-radius: calc(var(--rm-radius) * 1.3);
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img,
.rm-section.is-feature .rm-photo img {
  border-radius: var(--rm-radius);
  background: transparent;
}
.rm-photo .rm-badges {
  top: 22px;
  left: 22px;
  max-width: calc(100% - 44px);
}
.rm-item-copy > .rm-badges {
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.rm-badge {
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.rm-item :is(h3, h4),
.rm-detail-title h2 {
  text-transform: uppercase;
  letter-spacing: 0.005em;
}
.rm-labels span {
  border-color: var(--rm-text);
  background: transparent;
}
.rm-item {
  transition:
    transform 0.18s ease,
    opacity 0.2s;
}
.rm-item:active {
  transform: scale(0.985);
}
.rm img {
  animation: rm-fade 0.5s ease both;
}
@keyframes rm-fade {
  from {
    opacity: 0;
  }
}
.rm-sections a:after {
  transition: transform 0.32s cubic-bezier(0.16, 1, 0.3, 1);
}
.rm-sections a {
  transition: color 0.2s;
}
.rm-overlay:has(.is-detail) {
  background: color-mix(in srgb, var(--rm-text) 40%, transparent);
  animation: rm-veil 0.32s ease both;
}
.rm-overlay-panel.is-detail {
  animation: rm-sheet 0.38s cubic-bezier(0.16, 1, 0.3, 1) both;
  overflow: auto;
}
.rm-overlay.is-leaving {
  animation: rm-veil-out 0.26s ease forwards;
}
.rm-overlay.is-leaving .rm-overlay-panel {
  animation: rm-sheet-out 0.26s cubic-bezier(0.7, 0, 0.84, 0) forwards;
}
@keyframes rm-sheet {
  from {
    transform: translateY(100%);
  }
}
@keyframes rm-sheet-out {
  to {
    transform: translateY(100%);
  }
}
@keyframes rm-veil {
  from {
    background: transparent;
  }
}
@keyframes rm-veil-out {
  to {
    background: transparent;
  }
}
.rm-overlay-panel.is-detail > .rm-overlay-head {
  position: sticky;
  top: 0;
  left: 0;
  right: 0;
  margin: 0;
  height: 0;
  min-height: 0;
  padding: 14px 14px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
}
.rm-overlay-panel.is-detail > .rm-overlay-head button {
  margin: 0;
  background: var(--rm-bg);
  color: var(--rm-text);
  pointer-events: auto;
}
.rm-detail-photo {
  background: var(--rm-surface);
  padding: 72px 28px 28px;
}
.rm-overlay-panel.is-detail .rm-detail-photo img {
  max-height: 56dvh;
  border-radius: var(--rm-radius);
}
.rm-detail-title {
  display: block;
}
.rm-detail-title strong {
  display: block;
  margin-top: 10px;
  font-size: calc(20px * var(--rm-type));
}
.rm-detail-allergens {
  font-size: calc(14px * var(--rm-type));
  color: var(--rm-muted);
}
.rm-detail-copy {
  padding-bottom: 110px;
}
.rm-detail-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
  min-height: 64px;
  padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
  background: var(--rm-text);
  color: var(--rm-bg);
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.rm-detail-bar span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rm-detail-bar strong {
  font-size: calc(17px * var(--rm-type));
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .rm-overlay,
  .rm-overlay-panel,
  .rm img,
  .rm-item {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}

/* How the sheets come in. */
@keyframes rm-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: none;
  }
}
.rm-overlay {
  animation: rm-fade 0.24s ease both;
}
.rm-overlay-panel {
  animation: rm-up 0.34s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.rm-item-open:active {
  transform: scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .rm-overlay,
  .rm-overlay-panel {
    animation: none !important;
  }
  .rm-item-open:active {
    transform: none;
  }
}
/* The layout switch and the language switch. */
.rm .rm-layout {
  display: inline-flex;
  gap: 2px;
  margin: 14px 20px 0;
  padding: 2px;
  width: auto;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-pill);
  background: var(--rm-bg);
}
/* Each button is a 44 x 44 px target; the negative margin keeps the row 30 px high, so the capsule
   keeps its height, and the chosen button's fill (its ::before) keeps the 30 px of the old look. */
.rm .rm-layout button {
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  min-height: 44px;
  margin: -7px 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rm-muted);
  transition: color 0.18s;
}
.rm .rm-layout button::before {
  content: "";
  position: absolute;
  inset: 7px 0;
  z-index: -1;
  border-radius: calc(var(--rm-pill) - 3px);
  background: transparent;
}
.rm .rm-layout button svg {
  width: 18px;
  height: 18px;
}
.rm .rm-layout button[aria-checked="true"] {
  color: var(--rm-bg);
}
.rm .rm-layout button[aria-checked="true"]::before {
  background: var(--rm-text);
}
.rm .rm-language {
  display: inline-flex;
  margin: 0;
  min-width: 0;
  padding: 3px;
  gap: 2px;
  border: 1px solid color-mix(in srgb, var(--rm-bg) 30%, transparent);
  border-radius: var(--rm-pill);
}
/* The same for the language buttons: 44 x 44 px targets in a 34 px high pill. */
.rm .rm-language button {
  position: relative;
  isolation: isolate;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  margin: -5px 0;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--rm-bg) 70%, transparent);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  letter-spacing: 0.06em;
}
.rm .rm-language button::before {
  content: "";
  position: absolute;
  inset: 5px 0;
  z-index: -1;
  border-radius: calc(var(--rm-pill) - 3px);
  background: transparent;
}
.rm .rm-language button[aria-pressed="true"] {
  color: var(--rm-text);
}
.rm .rm-language button[aria-pressed="true"]::before {
  background: var(--rm-bg);
}
@media (max-width: 380px) {
  .rm .rm-layout {
    margin-left: 14px;
  }
}
/* Layout: two columns. The photo-led strip is not affected by the layout. */
.rm[data-layout="two"] .rm-section:not(.is-feature) > .rm-items {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 12px;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.is-text {
  grid-column: 1 / -1;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo {
  min-width: 0;
  padding: 14px 0 28px;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo {
  padding: 8px;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img {
  aspect-ratio: 4 / 3;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: calc(14px * var(--rm-type));
  line-height: 1.15;
  overflow-wrap: anywhere;
  hyphens: auto;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 8px;
  padding-top: 12px;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy > * {
  flex: 1 1 100%;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy > .rm-price {
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-description {
  font-size: calc(12.5px * var(--rm-type));
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item-open::after {
  display: none;
}
@media (max-width: 359px) {
  .rm[data-layout="two"] .rm-section:not(.is-feature) > .rm-items {
    column-gap: 10px;
  }
  .rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
    font-size: calc(12.5px * var(--rm-type));
  }
  .rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo {
    padding: 5px;
  }
}
/* Layout: list (one column of one-line rows with a small photo). One column is the base look. */
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px;
  gap: 14px;
  align-items: start;
  position: relative;
  padding: 18px 0;
  border-top: 1px solid var(--rm-border);
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo {
  grid-column: 2;
  align-self: start;
  width: 96px;
  height: 96px;
  padding: 0;
  overflow: hidden;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img {
  width: 96px;
  height: 96px;
  aspect-ratio: 1 / 1;
  object-fit: cover;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo .rm-badges {
  top: 5px;
  left: 5px;
  max-width: 90px;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-badge {
  font-size: calc(12px * var(--rm-type));
  padding: 3px 6px;
  max-width: 90px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  padding-top: 0;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: calc(17px * var(--rm-type));
}
/* The narrowest phones. The page around the face (no sideways scroll, no scrollbar) is the guest
   page's, not the face's: apps/web styles html[data-guest-page]. */
.rm {
  overflow-x: clip;
  max-width: 100vw;
}
.rm .rm-brandline > :first-child {
  min-width: 0;
}
@media (max-width: 350px) {
  .rm .rm-section.is-feature .rm-items {
    margin: 0 -14px;
    padding: 0 14px 18px;
    scroll-padding-inline: 14px;
  }
  .rm .rm-section.is-feature .rm-item {
    flex-basis: 82vw;
    width: 82vw;
  }
}
@media (min-width: 641px) {
  .rm {
    width: min(100%, 820px);
  }
  .rm-section.is-feature .rm-item {
    flex-basis: 46%;
    width: 46%;
  }
}
/* New in the port: what the page says when the filters leave nothing. */
.rm-empty {
  padding: 64px 20px 0;
  text-align: center;
}
.rm-empty p {
  margin: 0;
  color: var(--rm-muted);
}
.rm-empty .rm-clear {
  margin-top: 8px;
}
@media (min-width: 641px) {
  .rm-empty {
    padding-left: 34px;
    padding-right: 34px;
  }
}
`
