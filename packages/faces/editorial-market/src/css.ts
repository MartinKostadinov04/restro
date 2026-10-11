// The stylesheet of the Editorial Market face, as one string injected in a <style> element (see
// face.tsx). Ported from the designer's delivery of 2026-10-11 (docs/design/faces/editorial-market):
// the same classes (`rm-…`) and rules, with the delivery's chains of overrides folded into their
// final values and its ordering rules left out.
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
  min-height: 100vh;
  background: var(--rm-bg);
  color: var(--rm-text);
  font-family: var(--rm-font);
  font-size: 16px;
  line-height: 1.45;
  letter-spacing: 0;
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
  padding: 18px 20px 24px;
  background: var(--rm-text);
  color: var(--rm-bg);
}
.rm-brandline {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
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
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
}
.rm-table {
  border: 1px solid color-mix(in srgb, var(--rm-bg) 24%, transparent);
  border-radius: 999px;
  padding: 7px 10px;
  font-size: 11px;
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
  padding-top: 26px;
  max-width: 560px;
}
.rm-titleblock h1 {
  margin: 0;
  font-size: clamp(38px, 11vw, 60px);
  line-height: 0.95;
  font-weight: 880;
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
  gap: 24px;
  overflow-x: auto;
  padding: 0 20px;
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
  min-height: 56px;
  display: flex;
  align-items: center;
  color: var(--rm-muted);
  font-size: 13px;
  font-weight: 800;
  text-decoration: none;
  white-space: nowrap;
}
.rm-sections a:after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
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
  padding: 58px 20px 0;
  scroll-margin-top: 56px;
}
.rm-section-head {
  margin-bottom: 22px;
}
.rm-section-head > img {
  width: 100%;
  aspect-ratio: 16 / 7;
  object-fit: cover;
  border-radius: var(--rm-radius);
  margin-bottom: 24px;
}
.rm-section h2,
.rm-section h3 {
  margin: 0;
  font-size: 31px;
  line-height: 1.02;
  font-weight: 880;
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
  gap: 18px;
  padding: 25px 0;
  border-top: 1px solid var(--rm-border);
  content-visibility: auto;
  contain-intrinsic-size: 210px;
}
.rm-item[data-state="sold_out"],
.rm-item[data-state="unavailable"] {
  opacity: 0.52;
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
  border-radius: 999px;
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-size: 10px;
  font-weight: 850;
  box-shadow: 0 3px 10px color-mix(in srgb, var(--rm-text) 14%, transparent);
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
.rm-item h3 {
  font-size: 19px;
  line-height: 1.12;
  font-weight: 850;
}
.rm-price {
  margin-top: 7px;
  font-size: 14px;
  font-weight: 850;
}
.rm-state {
  min-height: 0;
  margin-top: 7px;
  color: var(--rm-accent-text);
  font-size: 13px;
  font-weight: 800;
}
.rm-state:empty {
  display: none;
}
.rm-description {
  margin-top: 9px;
  color: var(--rm-muted);
  font-size: 14px;
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
  font-size: 12px;
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
  border-radius: 999px;
  font-size: 10px;
  font-weight: 800;
}
.rm-allergens {
  margin-top: 8px;
}
.rm-allergens button {
  min-height: 44px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  display: flex;
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
  border-radius: 7px;
  font-size: 11px;
}
.rm-extra,
.rm-modifiers {
  margin-top: 10px;
  color: var(--rm-muted);
  font-size: 12px;
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
/* The photo-led strip: the first section, a row of big cards that scrolls sideways. */
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
  aspect-ratio: 1.22 / 1;
  border-radius: calc(var(--rm-radius) * 1.15);
}
.rm-section.is-feature .rm-item-copy {
  padding-top: 17px;
}
.rm-section.is-feature .rm-item h3 {
  font-size: 22px;
}
.rm-section.is-feature .rm-price {
  font-size: 15px;
}
/* The allergen information footer. */
.rm-footer {
  margin-top: 78px;
  padding: 42px 20px calc(120px + env(safe-area-inset-bottom));
  background: var(--rm-text);
  color: var(--rm-bg);
}
.rm-footer h2 {
  margin: 0;
  font-size: 25px;
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
.rm-allergen-sheet span {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
}
.rm-legend b,
.rm-allergen-sheet b {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid currentColor;
  border-radius: 7px;
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
  box-shadow: 0 -18px 48px color-mix(in srgb, var(--rm-text) 25%, transparent);
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
  font-size: 12px;
  font-weight: 850;
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
  border-radius: 999px;
  background: var(--rm-bg);
  color: var(--rm-text);
  box-shadow: 0 4px 18px color-mix(in srgb, var(--rm-text) 22%, transparent);
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
  font-size: 20px;
  font-weight: 850;
}
.rm-filter-group button {
  min-height: 48px;
  padding: 0 17px;
  border: 1px solid color-mix(in srgb, var(--rm-bg) 30%, transparent);
  border-radius: var(--rm-pill);
  background: transparent;
}
.rm-filter-group button[aria-pressed="true"] {
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  border-color: var(--rm-accent);
}
.rm-clear {
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
  margin-top: 26px;
}
.rm-allergen-sheet span {
  opacity: 0.48;
}
.rm-allergen-sheet span.is-present {
  opacity: 1;
  font-weight: 800;
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
  font-size: 30px;
  line-height: 1.03;
  font-weight: 880;
  overflow-wrap: anywhere;
}
.rm-detail-title strong {
  font-size: 16px;
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
  font-size: 20px;
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
  font-size: 13px;
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
  .rm-sections,
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
  .rm-sections,
  .rm-footer {
    padding-left: 14px;
    padding-right: 14px;
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
    font-size: 39px;
  }
  .rm-section h2 {
    font-size: 28px;
  }
  .rm-legend,
  .rm-allergen-sheet {
    grid-template-columns: 1fr;
  }
  .rm-table {
    display: none;
  }
}
/* Motion: smooth only when the guest has not asked for less; the reduce blocks switch it all off. */
@media (prefers-reduced-motion: no-preference) {
  .rm {
    scroll-behavior: smooth;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rm * {
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
.rm-item-open:after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
}
.rm-allergens button {
  position: relative;
  z-index: 2;
}
.rm-item-open [data-slot="item.name"] {
  display: inline;
}
.rm-item-open h3 {
  display: inline;
}
.rm-chevron {
  display: inline-block;
  margin-left: 8px;
  color: var(--rm-muted);
  font-weight: 500;
  transition: transform 0.2s;
}
.rm-item:hover .rm-chevron {
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
.rm-section:not(.is-feature) .rm-item.has-photo h3 {
  font-size: 24px;
  line-height: 1.1;
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-price {
  font-size: 16px;
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-description p {
  -webkit-line-clamp: 2;
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
  aspect-ratio: 1 / 1;
}
.rm-detail-title h2 {
  font-size: 34px;
}
.rm-detail-copy > p {
  font-size: 16px;
  line-height: 1.6;
}
@media (prefers-reduced-motion: reduce) {
  .rm-photo img,
  .rm-chevron {
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
.rm-item h3,
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
  font-size: 20px;
}
.rm-detail-allergens {
  font-size: 14px;
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
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.rm-detail-bar span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rm-detail-bar strong {
  font-size: 17px;
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
.rm .rm-layout button {
  display: grid;
  place-items: center;
  width: 36px;
  height: 30px;
  min-height: 30px;
  padding: 0;
  border: 0;
  border-radius: calc(var(--rm-pill) - 3px);
  background: transparent;
  color: var(--rm-muted);
  transition:
    background 0.18s,
    color 0.18s;
}
.rm .rm-layout button svg {
  width: 18px;
  height: 18px;
}
.rm .rm-layout button[aria-checked="true"] {
  background: var(--rm-text);
  color: var(--rm-bg);
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
.rm .rm-language button {
  min-width: 38px;
  height: 34px;
  min-height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: calc(var(--rm-pill) - 3px);
  background: transparent;
  color: color-mix(in srgb, var(--rm-bg) 70%, transparent);
  font-size: 11.5px;
  font-weight: 850;
  letter-spacing: 0.06em;
}
.rm .rm-language button[aria-pressed="true"] {
  background: var(--rm-bg);
  color: var(--rm-text);
}
@media (max-width: 380px) {
  .rm .rm-table {
    display: none;
  }
  .rm .rm-language button {
    min-width: 32px;
    padding: 0 6px;
  }
  .rm .rm-layout {
    margin-left: 14px;
  }
}
/* Layout: two columns (the default). The photo-led strip is not affected by the layout. */
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
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3 {
  font-size: 14px;
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
  font-size: 12.5px;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-chevron {
  display: none;
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-modifiers,
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-extra {
  display: none;
}
@media (max-width: 359px) {
  .rm[data-layout="two"] .rm-section:not(.is-feature) > .rm-items {
    column-gap: 10px;
  }
  .rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo h3 {
    font-size: 12.5px;
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
  font-size: 9px;
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
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo h3 {
  font-size: 17px;
}
/* The page: no sideways scroll and no scrollbar while the face is on it; the narrowest phones. */
html:has(.rm),
body:has(.rm) {
  overflow-x: hidden;
  scrollbar-width: none;
}
html:has(.rm)::-webkit-scrollbar {
  display: none;
}
.rm {
  overflow-x: clip;
  max-width: 100vw;
}
.rm .rm-brandline > :first-child {
  min-width: 0;
}
.rm main {
  padding-bottom: calc(110px + env(safe-area-inset-bottom));
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
