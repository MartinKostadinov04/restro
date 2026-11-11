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

import { THEME_FONTS } from '@restro/shell'

/** The weights the Heavy steps ask for: the heading (880), the sub-heading (850) and the item name (850). */
const HEAVY = { heading: 880, subheading: 850, name: 850 } as const

/**
 * Heavy falls back where a font stops short of it (D130, Heading weight and Name weight): a font that
 * serves nothing above 700 (Lora) or 800 (Manrope) draws Heavy at its own heaviest weight, bold for
 * Lora, instead of leaving it to the browser. The heading font is the one drawing, so a rule per font
 * names it twice: chosen, and `same` with that font as the body. The list follows `THEME_FONTS`, so a
 * font added with a lower top weight gets its fallback with no edit here.
 */
export const HEAVY_FALLBACKS: readonly { readonly font: string; readonly heaviest: number }[] =
  THEME_FONTS.filter((font) => font.heaviest < HEAVY.heading).map((font) => ({
    font: font.id,
    heaviest: font.heaviest,
  }))

const HEAVY_FALLBACK_CSS = HEAVY_FALLBACKS.flatMap(({ font, heaviest }) =>
  [`[data-heading-font="${font}"]`, `[data-heading-font="same"][data-body-font="${font}"]`].flatMap(
    (drawn) => [
      `.rm[data-heading-weight="heavy"]${drawn} {
  --rm-heading-weight: ${Math.min(HEAVY.heading, heaviest)};
  --rm-subheading-weight: ${Math.min(HEAVY.subheading, heaviest)};
}`,
      `.rm[data-items-name-weight="heavy"]${drawn} {
  --rm-name-weight: ${Math.min(HEAVY.name, heaviest)};
}`,
    ],
  ),
).join('\n')

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
  /* The browsing pages (D130), the same way. The aliases keep the page's three colours within reach
     inside a band or a sheet, where --rm-text and --rm-bg hold that band's pair. */
  --rm-ink: var(--rm-text);
  --rm-page: var(--rm-bg);
  --rm-panel: var(--rm-surface);
  --rm-title-size: clamp(calc(28px * var(--rm-type)), 7.5vw, calc(36px * var(--rm-type)));
  --rm-title-narrow: calc(26px * var(--rm-type));
  --rm-title-leading: 1.05;
  --rm-logo-width: 96px;
  --rm-logo-height: 44px;
  --rm-nav-weight: 700;
  --rm-section-title: calc(26px * var(--rm-type));
  --rm-section-title-narrow: calc(24px * var(--rm-type));
  --rm-strip-card: 68vw;
  --rm-strip-card-max: 300px;
  --rm-strip-card-wide: 36%;
  --rm-strip-card-narrow: 70vw;
  --rm-item-rule: 1px solid var(--rm-border);
  --rm-name-text: calc(17px * var(--rm-type));
  --rm-name-list: calc(16px * var(--rm-type));
  --rm-name-one: calc(21px * var(--rm-type));
  --rm-name-two: calc(13.5px * var(--rm-type));
  --rm-name-two-narrow: calc(13px * var(--rm-type));
  --rm-name-strip: calc(20px * var(--rm-type));
  --rm-name-weight: 700;
  --rm-name-case: none;
  --rm-name-tracking: normal;
  --rm-price-photo: calc(15px * var(--rm-type));
  --rm-price-strip: calc(14.5px * var(--rm-type));
  --rm-photo-shape: 4 / 3;
  --rm-photo-fit: cover;
  --rm-photo-backdrop: var(--rm-surface);
  --rm-photo-pad: 0px;
  --rm-photo-pad-two: 0px;
  --rm-photo-pad-two-narrow: 0px;
  --rm-dish-photo-pad: 0px;
  --rm-photo-box-corners: 0px;
  --rm-photo-corners: 0px;
  --rm-mark-offset: 8px;
  --rm-mark-room: 16px;
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
  --rm-nav-weight: 400;
}
.rm[data-heading-weight="heavy"] {
  --rm-heading-weight: 880;
  --rm-subheading-weight: 850;
  --rm-nav-weight: 800;
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
.rm[data-header-title-size="s"] {
  --rm-title-size: clamp(calc(24px * var(--rm-type)), 6.2vw, calc(28px * var(--rm-type)));
  --rm-title-narrow: calc(22px * var(--rm-type));
}
.rm[data-header-title-size="l"] {
  --rm-title-size: clamp(calc(32px * var(--rm-type)), 9vw, calc(46px * var(--rm-type)));
  --rm-title-narrow: calc(31px * var(--rm-type));
  --rm-title-leading: 1;
}
.rm[data-header-title-size="xl"] {
  --rm-title-size: clamp(calc(38px * var(--rm-type)), 11vw, calc(60px * var(--rm-type)));
  --rm-title-narrow: calc(39px * var(--rm-type));
  --rm-title-leading: 0.95;
}
.rm[data-header-logo-size="s"] {
  --rm-logo-width: 64px;
  --rm-logo-height: 32px;
}
.rm[data-header-logo-size="l"] {
  --rm-logo-width: 144px;
  --rm-logo-height: 64px;
}
.rm[data-sections-title-size="s"] {
  --rm-section-title: calc(22px * var(--rm-type));
  --rm-section-title-narrow: calc(21px * var(--rm-type));
}
.rm[data-sections-title-size="l"] {
  --rm-section-title: calc(31px * var(--rm-type));
  --rm-section-title-narrow: calc(28px * var(--rm-type));
}
.rm[data-sections-strip-card-size="s"] {
  --rm-strip-card: 52vw;
  --rm-strip-card-max: 220px;
  --rm-strip-card-wide: 28%;
  --rm-strip-card-narrow: 56vw;
}
.rm[data-sections-strip-card-size="l"] {
  --rm-strip-card: 84vw;
  --rm-strip-card-max: 390px;
  --rm-strip-card-wide: 46%;
  --rm-strip-card-narrow: 82vw;
}
.rm[data-items-frame="cards"] {
  --rm-item-rule: 0;
}
.rm[data-items-frame="open"] {
  --rm-item-rule: 0;
}
/* A name's size is one option and five places. The price stays a step under it and never under the
   description (14 px, and 12.5 px in two columns), which is why it hardly moves. */
.rm[data-items-name-size="s"] {
  --rm-name-text: calc(16px * var(--rm-type));
  --rm-name-list: calc(15px * var(--rm-type));
  --rm-name-one: calc(19px * var(--rm-type));
  --rm-name-two: calc(13px * var(--rm-type));
  --rm-name-two-narrow: calc(12.5px * var(--rm-type));
  --rm-name-strip: calc(18px * var(--rm-type));
  --rm-price-photo: calc(14px * var(--rm-type));
  --rm-price-strip: calc(14px * var(--rm-type));
}
.rm[data-items-name-size="l"] {
  --rm-name-text: calc(19px * var(--rm-type));
  --rm-name-list: calc(17px * var(--rm-type));
  --rm-name-one: calc(24px * var(--rm-type));
  --rm-name-two: calc(14px * var(--rm-type));
  --rm-name-two-narrow: calc(12.5px * var(--rm-type));
  --rm-name-strip: calc(22px * var(--rm-type));
  --rm-price-photo: calc(16px * var(--rm-type));
  --rm-price-strip: calc(15px * var(--rm-type));
}
.rm[data-items-name-weight="regular"] {
  --rm-name-weight: 400;
}
.rm[data-items-name-weight="heavy"] {
  --rm-name-weight: 850;
}
${HEAVY_FALLBACK_CSS}
.rm[data-items-name-case="capitals"] {
  --rm-name-case: uppercase;
  --rm-name-tracking: 0.005em;
}
.rm[data-photos-shape="square"] {
  --rm-photo-shape: 1 / 1;
}
.rm[data-photos-shape="wide"] {
  --rm-photo-shape: 16 / 9;
}
.rm[data-photos-shape="portrait"] {
  --rm-photo-shape: 4 / 5;
}
.rm[data-photos-fit="contain"] {
  --rm-photo-fit: contain;
}
/* The backdrop sits on the photo's box: around a contained photo, behind a transparent one. The one
   value no venue colour can give, the face writes on the root itself (R13 keeps it out of here). */
.rm[data-photos-backdrop="tint"] {
  --rm-photo-backdrop: color-mix(in srgb, var(--rm-accent) 10%, var(--rm-bg));
}
.rm[data-photos-backdrop="none"] {
  --rm-photo-backdrop: transparent;
}
/* The frame. A bleed photo fills its box and draws no corners of its own, whatever Corners says: only
   an inset photo has corners to draw (the base holds bleed's zeros). */
.rm[data-photos-frame="inset"] {
  --rm-photo-pad: 14px;
  --rm-photo-pad-two: 8px;
  --rm-photo-pad-two-narrow: 5px;
  --rm-dish-photo-pad: 72px 28px 28px;
  --rm-photo-box-corners: calc(var(--rm-radius) * 1.3);
  --rm-photo-corners: var(--rm-radius);
  --rm-mark-offset: 22px;
  --rm-mark-room: 44px;
}
.rm[data-photos-frame="inset"][data-photos-corners="square"] {
  --rm-photo-box-corners: 0px;
  --rm-photo-corners: 0px;
}
.rm[data-photos-frame="inset"][data-photos-corners="round"] {
  --rm-photo-box-corners: max(calc(var(--rm-radius) * 1.3), 26px);
  --rm-photo-corners: max(var(--rm-radius), 20px);
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
  max-width: var(--rm-logo-width);
  max-height: var(--rm-logo-height);
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
  font-size: var(--rm-title-size);
  line-height: var(--rm-title-leading);
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
  font-weight: var(--rm-nav-weight);
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
  font-size: var(--rm-section-title);
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
  border-top: var(--rm-item-rule);
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
  object-fit: var(--rm-photo-fit);
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
  font-size: var(--rm-name-text);
  line-height: 1.12;
  font-weight: var(--rm-name-weight);
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
  flex: 0 0 var(--rm-strip-card);
  width: var(--rm-strip-card);
  max-width: var(--rm-strip-card-max);
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
  aspect-ratio: var(--rm-photo-shape);
  border-radius: calc(var(--rm-radius) * 1.15);
}
.rm-section.is-feature .rm-item-copy {
  padding-top: 17px;
}
.rm-section.is-feature .rm-item :is(h3, h4) {
  font-size: var(--rm-name-strip);
}
.rm-section.is-feature .rm-price {
  font-size: var(--rm-price-strip);
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
  background: var(--rm-photo-backdrop);
}
.rm-detail-photo img {
  display: block;
  width: 100%;
  max-height: 52dvh;
  aspect-ratio: var(--rm-photo-shape);
  object-fit: var(--rm-photo-fit);
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
    font-size: var(--rm-title-narrow);
  }
  .rm-section h2 {
    font-size: var(--rm-section-title-narrow);
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
  aspect-ratio: var(--rm-photo-shape);
  border-radius: calc(var(--rm-radius) * 1.2);
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy {
  padding-top: 18px;
}
.rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: var(--rm-name-one);
  line-height: 1.1;
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-price {
  font-size: var(--rm-price-photo);
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
  aspect-ratio: var(--rm-photo-shape);
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
  background: var(--rm-photo-backdrop);
  padding: var(--rm-photo-pad);
  border-radius: var(--rm-photo-box-corners);
}
.rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img,
.rm-section.is-feature .rm-photo img {
  border-radius: var(--rm-photo-corners);
  background: transparent;
}
.rm-photo .rm-badges {
  top: var(--rm-mark-offset);
  left: var(--rm-mark-offset);
  max-width: calc(100% - var(--rm-mark-room));
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
  text-transform: var(--rm-name-case);
  letter-spacing: var(--rm-name-tracking);
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
  background: var(--rm-photo-backdrop);
  padding: var(--rm-dish-photo-pad);
}
.rm-overlay-panel.is-detail .rm-detail-photo img {
  max-height: 56dvh;
  border-radius: var(--rm-photo-corners);
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
  padding: var(--rm-photo-pad-two);
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo img {
  aspect-ratio: var(--rm-photo-shape);
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: var(--rm-name-two);
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
    font-size: var(--rm-name-two-narrow);
  }
  .rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-photo {
    padding: var(--rm-photo-pad-two-narrow);
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
  border-top: var(--rm-item-rule);
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
  object-fit: var(--rm-photo-fit);
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
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  padding-top: 0;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo :is(h3, h4) {
  font-size: var(--rm-name-list);
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
    flex-basis: var(--rm-strip-card-narrow);
    width: var(--rm-strip-card-narrow);
  }
}
@media (min-width: 641px) {
  .rm {
    width: min(100%, 820px);
  }
  .rm-section.is-feature .rm-item {
    flex-basis: var(--rm-strip-card-wide);
    width: var(--rm-strip-card-wide);
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
/*
 * The browsing pages' options (D130). Everything above is the look at the values Editorial draws,
 * with the tokens at the root; each rule here is keyed on a value Editorial does not use, so it adds
 * nothing to Editorial's look. They come last: a rule here beats an equal one above.
 */
/* Header: the band. Inside a band --rm-text is the fill and --rm-bg the writing, as in every rule
   above; another band only changes what those two hold (the §5.4 pairs, never muted on a band). */
.rm[data-header-band="page"] .rm-header {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-page);
}
.rm[data-header-band="panel"] .rm-header {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-panel);
}
/* Header: centred. The bar's tools keep their corner and the logo stands over the title. */
.rm[data-header-arrangement="centred"] .rm-brandline {
  grid-template-columns: minmax(0, 1fr);
  justify-items: center;
}
.rm[data-header-arrangement="centred"] .rm-headtools {
  grid-column: 1;
  grid-row: 1;
  justify-self: stretch;
}
.rm[data-header-arrangement="centred"] .rm-logo {
  grid-row: 2;
}
.rm[data-header-arrangement="centred"] .rm-titleblock {
  margin-inline: auto;
  text-align: center;
}
.rm[data-header-arrangement="centred"] .rm-titleblock > p {
  margin-inline: auto;
}
/* The rail follows a centred header while the names fit; once they do not it scrolls from its start. */
.rm[data-header-arrangement="centred"] .rm-sections a:first-child {
  margin-inline-start: auto;
}
.rm[data-header-arrangement="centred"] .rm-sections a:last-child {
  margin-inline-end: auto;
}
/* Header: the logo's other sizes draw at their own width, so a square logo keeps to the margin. */
.rm[data-header-logo-size="s"] .rm-logo,
.rm[data-header-logo-size="l"] .rm-logo {
  width: auto;
  height: auto;
}
/* A large logo beside the tools would stack them three rows high: on a phone it stands under them. */
@media (max-width: 640px) {
  .rm[data-header-arrangement="stacked"][data-header-logo-size="l"] .rm-brandline {
    grid-template-columns: minmax(0, 1fr);
  }
  .rm[data-header-arrangement="stacked"][data-header-logo-size="l"] .rm-headtools {
    grid-column: 1;
    grid-row: 1;
  }
  .rm[data-header-arrangement="stacked"][data-header-logo-size="l"] .rm-logo {
    grid-row: 2;
  }
}
/* Header: one line. The logo and the title share a row and the intro folds under the title; on a
   phone the tools take the row above, as they would squeeze the title to nothing beside it. */
.rm[data-header-arrangement="compact"] .rm-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
}
.rm[data-header-arrangement="compact"] .rm-brandline {
  display: contents;
}
.rm[data-header-arrangement="compact"] .rm-headtools {
  grid-column: 1 / -1;
  grid-row: 1;
}
.rm[data-header-arrangement="compact"] .rm-logo {
  grid-column: 1;
  grid-row: 2;
  width: auto;
  height: auto;
  margin-inline-end: 12px;
}
.rm[data-header-arrangement="compact"] .rm-titleblock {
  grid-column: 2;
  grid-row: 2;
  padding-top: calc(12px * var(--rm-space));
}
@media (min-width: 641px) {
  .rm[data-header-arrangement="compact"] .rm-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .rm[data-header-arrangement="compact"] .rm-headtools {
    grid-column: 3;
  }
  .rm[data-header-arrangement="compact"] .rm-logo {
    grid-row: 1;
  }
  .rm[data-header-arrangement="compact"] .rm-titleblock {
    grid-row: 1;
    padding-top: 0;
  }
}
/* Navigation: the rail on the header's band, in the band's pair. On a page-coloured header it stays. */
.rm[data-navigation-band="header"][data-header-band="ink"] .rm-sections {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-page);
  --rm-muted: var(--rm-page);
  --rm-accent-text: var(--rm-page);
  --rm-border: transparent;
}
.rm[data-navigation-band="header"][data-header-band="panel"] .rm-sections {
  --rm-bg: var(--rm-panel);
  --rm-text: var(--rm-ink);
  --rm-muted: var(--rm-ink);
  --rm-accent-text: var(--rm-ink);
  --rm-border: transparent;
}
/* Navigation: pills. The current one is a filled pill, shown by shape and not by colour alone. A
   pill's edge stands on the page's margin, as the title's first letter does. */
.rm[data-navigation-marker="pills"] .rm-sections {
  gap: 2px;
  padding-inline: 20px;
}
@media (max-width: 380px) {
  .rm[data-navigation-marker="pills"] .rm-sections {
    padding-inline: 14px;
  }
}
@media (min-width: 641px) {
  .rm[data-navigation-marker="pills"] .rm-sections {
    padding-inline: 34px;
  }
}
.rm[data-navigation-marker="pills"] .rm-sections a {
  min-height: 44px;
  margin-block: 6px;
  padding: 0 14px;
  border-radius: var(--rm-full);
}
.rm[data-navigation-marker="pills"] .rm-sections a:after {
  content: none;
}
.rm[data-navigation-marker="pills"] .rm-sections a[aria-current="true"] {
  background: var(--rm-accent);
  color: var(--rm-on-accent);
}
/* A pill on a band uses the band's pair: the accent may sit badly on it. */
.rm[data-navigation-marker="pills"][data-navigation-band="header"][data-header-band="ink"]
  .rm-sections
  a[aria-current="true"],
.rm[data-navigation-marker="pills"][data-navigation-band="header"][data-header-band="panel"]
  .rm-sections
  a[aria-current="true"] {
  background: var(--rm-text);
  color: var(--rm-bg);
}
/* The rail's case follows the section titles. */
.rm[data-sections-title-case="capitals"] .rm-sections a,
.rm[data-sections-title-case="capitals"] .rm-section-head > :is(h2, h3) {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
/* Sections: a sub-section's title is one step smaller. */
.rm[data-sections-title-size="m"] .rm-section-head > h3 {
  font-size: calc(22px * var(--rm-type));
}
.rm[data-sections-title-size="s"] .rm-section-head > h3 {
  font-size: calc(19px * var(--rm-type));
}
/* Sections: ruled, centred, on a band. */
.rm[data-sections-header="ruled"] .rm-section-head {
  padding-top: 16px;
  border-top: 1px solid var(--rm-border);
}
.rm[data-sections-header="centred"] .rm-section-head {
  text-align: center;
}
.rm[data-sections-header="centred"] .rm-section-head > p {
  margin-inline: auto;
}
.rm[data-sections-header="centred"] .rm-section-head > :is(h2, h3) {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.rm[data-sections-header="centred"] .rm-section-head > :is(h2, h3)::before,
.rm[data-sections-header="centred"] .rm-section-head > :is(h2, h3)::after {
  content: "";
  flex: 0 0 24px;
  height: 1px;
  background: var(--rm-border);
}
.rm[data-sections-header="centred"] .rm-layout,
.rm[data-sections-header="band"] .rm-layout {
  margin-inline: 0;
}
/* The band runs to the screen's edges, whatever the section's margin. */
.rm[data-sections-header="band"] .rm-section-head {
  padding-block: 14px;
  background: var(--rm-surface);
  box-shadow: 0 0 0 100vmax var(--rm-surface);
  clip-path: inset(0 -100vmax);
}
/* A small strip card keeps a name and a price that fit it. */
.rm[data-sections-strip-card-size="s"] .rm-section.is-feature .rm-item :is(h3, h4) {
  font-size: calc(15px * var(--rm-type));
}
.rm[data-sections-strip-card-size="s"] .rm-section.is-feature .rm-price {
  font-size: calc(14px * var(--rm-type));
}
/* Items: a price at the end of the name's line, a portion beside the price. The copy turns into a
   wrapping row whose parts keep their order, each on its own line unless told otherwise. A row's
   end has to be on the screen, so nothing in it (a label with no spaces) may widen the column. */
.rm[data-items-price-place="end"] .rm-items,
.rm[data-items-portion-place="beside"] .rm-items {
  grid-template-columns: minmax(0, 1fr);
}
.rm[data-items-price-place="end"] .rm-labels span,
.rm[data-items-portion-place="beside"] .rm-labels span {
  max-width: 100%;
  overflow-wrap: anywhere;
}
.rm[data-items-price-place="end"] .rm-item-copy,
.rm[data-items-portion-place="beside"] .rm-item-copy {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  column-gap: 8px;
}
.rm[data-items-price-place="end"] .rm-item-copy > *,
.rm[data-items-portion-place="beside"] .rm-item-copy > * {
  flex: 1 1 100%;
  min-width: 0;
  order: 5;
}
.rm[data-items-price-place="end"] .rm-item-copy > .rm-badges,
.rm[data-items-portion-place="beside"] .rm-item-copy > .rm-badges {
  order: 0;
}
.rm[data-items-price-place="end"] .rm-item-copy > [data-slot="item.name"],
.rm[data-items-portion-place="beside"] .rm-item-copy > [data-slot="item.name"] {
  order: 1;
}
.rm[data-items-price-place="end"] .rm-item-copy > .rm-price,
.rm[data-items-portion-place="beside"] .rm-item-copy > .rm-price {
  flex: 0 0 auto;
  order: 2;
}
.rm[data-items-price-place="end"] .rm-item-copy > [data-slot="item.name"] {
  flex: 1 1 7em;
}
.rm[data-items-price-place="end"] .rm-item-copy > .rm-price {
  margin-top: 0;
}
.rm[data-items-portion-place="beside"] .rm-item-copy > .rm-portion {
  flex: 0 1 auto;
  order: 3;
}
.rm[data-items-portion-place="beside"] .rm-item-copy > .rm-portion::before {
  content: "· ";
  content: "· " / "";
}
.rm[data-items-price-place="end"][data-items-portion-place="beside"] .rm-item-copy > .rm-portion {
  margin-top: 0;
}
/* A two-column card is too narrow for a name and a price on one line: its price stays under the name. */
.rm[data-items-portion-place="beside"][data-layout="two"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-item-copy
  > .rm-price {
  flex: 0 1 auto;
}
.rm[data-items-portion-place="beside"][data-layout="two"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-item-copy
  > .rm-portion {
  flex: 0 1 auto;
  margin-top: 0;
}
/* In two columns the price follows the smaller names, down to the description's own size. */
.rm[data-items-name-size="m"][data-layout="two"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-price {
  font-size: calc(13px * var(--rm-type));
}
.rm[data-items-name-size="s"][data-layout="two"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-price {
  font-size: calc(12.5px * var(--rm-type));
}
/* Items: how much of a description shows. Three lines is the base; the dish page has the rest. */
.rm[data-items-description-lines="1"] .rm-description p[data-clamped="true"] {
  -webkit-line-clamp: 1;
}
.rm[data-items-description-lines="2"] .rm-description p[data-clamped="true"] {
  -webkit-line-clamp: 2;
}
.rm[data-items-description-lines="all"] .rm-description p[data-clamped="true"] {
  display: block;
  -webkit-line-clamp: none;
  overflow: visible;
}
/* Items: cards. Each item is a panel with General's corners and depth; a photo runs to the card's
   top and sides when it is bleed, and the copy gets the margin the card took away. */
.rm[data-items-frame="cards"] .rm-section:not(.is-feature) > .rm-items {
  row-gap: 12px;
}
.rm[data-items-frame="cards"] .rm-item {
  overflow: clip;
  background: var(--rm-surface);
  border-radius: var(--rm-radius);
  box-shadow: var(--rm-depth);
}
.rm[data-items-frame="cards"] .rm-item.is-text {
  padding: 14px 16px;
}
.rm[data-items-frame="cards"][data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo {
  padding: 14px;
}
.rm[data-items-frame="cards"][data-layout="one"] .rm-section:not(.is-feature) .rm-item.has-photo {
  padding: 0 0 16px;
}
.rm[data-items-frame="cards"][data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo {
  padding: 0 0 12px;
}
.rm[data-items-frame="cards"][data-layout="one"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-item-copy {
  padding: 16px 16px 0;
}
.rm[data-items-frame="cards"][data-layout="two"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-item-copy {
  padding: 10px 10px 0;
}
.rm[data-items-frame="cards"] .rm-section.is-feature .rm-items {
  padding-top: 8px;
}
.rm[data-items-frame="cards"] .rm-section.is-feature .rm-item {
  padding: 0 0 16px;
}
.rm[data-items-frame="cards"] .rm-section.is-feature .rm-item-copy {
  padding: 16px 16px 0;
}
/* Photos: the focal point only means something when the photo is cropped. */
.rm[data-photos-fit="contain"] :is(.rm-photo, .rm-detail-photo) img {
  object-position: center !important;
}
/* Labels: soft and plain words, and the marks and the filter chips that follow them. */
.rm[data-labels-labels="soft"] .rm-labels span {
  border-color: transparent;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.rm[data-labels-labels="soft"] .rm-filter-group button:not([aria-pressed="true"]) {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.rm[data-labels-labels="text"] .rm-labels {
  gap: 4px 12px;
}
.rm[data-labels-labels="text"] .rm-labels span {
  padding: 0;
  border: 0;
  border-radius: 0;
  font-weight: 700;
}
.rm[data-labels-labels="text"] .rm-filter-group {
  column-gap: 20px;
}
.rm[data-labels-labels="text"] .rm-filter-group button {
  padding-inline: 0;
  border-color: transparent;
  background: transparent;
  color: inherit;
  text-decoration: underline;
}
.rm[data-labels-labels="text"] .rm-filter-group button[aria-pressed="true"] {
  font-weight: 700;
  text-decoration-color: var(--rm-accent);
  text-decoration-thickness: 3px;
}
/* A badge in words is an accent word; on a photo no word reads, so it keeps a page-coloured tab. */
.rm[data-labels-labels="text"] .rm-badge {
  padding: 0;
  background: transparent;
  color: var(--rm-accent-text);
  box-shadow: none;
}
.rm[data-labels-labels="text"] .rm-photo .rm-badge {
  padding: 3px 8px;
  background: var(--rm-bg);
}
/* Dish page: a bleed photo runs to the top of the screen under the two buttons, and its box takes
   the Photos page's shape. Inset at the first shape is Editorial's own tall stage, which stays. */
.rm[data-photos-frame="bleed"] .rm-overlay-panel.is-detail:has(.rm-detail-photo) > .rm-overlay-head,
.rm[data-dish-photo="small"] .rm-overlay-panel.is-detail:has(.rm-detail-photo) > .rm-overlay-head {
  margin-bottom: -14px;
}
.rm[data-photos-frame="bleed"] .rm-detail-photo img,
.rm[data-photos-shape="square"] .rm-detail-photo img,
.rm[data-photos-shape="wide"] .rm-detail-photo img,
.rm[data-photos-shape="portrait"] .rm-detail-photo img {
  height: auto;
}
/* A page with little on it keeps the name and price bar at the bottom of the screen. */
.rm[data-photos-frame="bleed"] .rm-overlay-panel.is-detail,
.rm[data-dish-photo="small"] .rm-overlay-panel.is-detail {
  display: flex;
  flex-direction: column;
}
.rm[data-photos-frame="bleed"] .rm-overlay-panel.is-detail > .rm-overlay-head,
.rm[data-dish-photo="small"] .rm-overlay-panel.is-detail > .rm-overlay-head {
  flex: none;
}
.rm[data-photos-frame="bleed"] .rm-detail,
.rm[data-dish-photo="small"] .rm-detail {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}
.rm[data-photos-frame="bleed"] .rm-detail-copy,
.rm[data-dish-photo="small"] .rm-detail-copy {
  flex: 1 0 auto;
}
/* A dish with no photo starts under the two buttons. */
.rm[data-photos-frame="bleed"] .rm-detail-copy:first-child,
.rm[data-dish-photo="small"] .rm-detail-copy:first-child {
  padding-top: 72px;
}
/* Dish page: a small square photo at the name's end, in place of the hero. */
.rm[data-dish-photo="small"] .rm-detail {
  position: relative;
}
.rm[data-dish-photo="small"] .rm-overlay-panel.is-detail .rm-detail-photo {
  position: absolute;
  top: 72px;
  right: 20px;
  width: 96px;
  height: 96px;
  padding: 0;
  border-radius: var(--rm-photo-corners);
}
.rm[data-dish-photo="small"] .rm-overlay-panel.is-detail .rm-detail-photo img {
  width: 96px;
  height: 96px;
  max-height: none;
  aspect-ratio: 1 / 1;
}
.rm[data-dish-photo="small"] .rm-detail-copy {
  padding-top: 72px;
}
.rm[data-dish-photo="small"] .rm-detail-photo + .rm-detail-copy .rm-detail-title {
  min-height: 96px;
  padding-right: 112px;
}
.rm[data-dish-photo="small"] .rm-detail-title h2 {
  font-size: calc(26px * var(--rm-type));
  line-height: 1.1;
}
/* Sheets and the footer. As with the header's band: the same rules, another pair in the two tokens. */
.rm[data-sheets-sheets="panel"] .rm-overlay-panel:not(.is-detail),
.rm[data-sheets-sheets="panel"] .rm-footer,
.rm[data-sheets-sheets="panel"] .rm-detail-bar {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-panel);
}
.rm[data-sheets-sheets="page"] .rm-overlay-panel:not(.is-detail),
.rm[data-sheets-sheets="page"] .rm-footer,
.rm[data-sheets-sheets="page"] .rm-detail-bar {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-page);
}
/* A band in the page's own colour needs an edge to read as one. */
.rm[data-sheets-sheets="page"] .rm-footer,
.rm[data-sheets-sheets="page"] .rm-detail-bar {
  border-top: 1px solid var(--rm-border);
}
/* On the page's or the panel's colour the quiet text is the venue's own muted colour, the one the
   theme promises to read on both at 4.5:1. The dark band's softer ink would not hold there (a 70 %
   mix is about 4.3:1), and an edge of a choice takes the same colour to show at 3:1. */
.rm[data-header-band="page"] .rm-titleblock > p,
.rm[data-header-band="panel"] .rm-titleblock > p,
.rm[data-header-band="page"] .rm-language button:not([aria-pressed="true"]),
.rm[data-header-band="panel"] .rm-language button:not([aria-pressed="true"]),
.rm[data-sheets-sheets="panel"] .rm-footer > p,
.rm[data-sheets-sheets="page"] .rm-footer > p,
.rm[data-sheets-sheets="panel"] .rm-overlay-intro,
.rm[data-sheets-sheets="page"] .rm-overlay-intro {
  color: var(--rm-muted);
}
.rm[data-sheets-sheets="panel"] .rm-allergen-sheet li:not(.is-present),
.rm[data-sheets-sheets="page"] .rm-allergen-sheet li:not(.is-present) {
  opacity: 1;
  color: var(--rm-muted);
}
.rm[data-sheets-sheets="panel"]:not([data-labels-labels="text"])
  .rm-filter-group
  button:not([aria-pressed="true"]),
.rm[data-sheets-sheets="page"]:not([data-labels-labels="text"])
  .rm-filter-group
  button:not([aria-pressed="true"]) {
  border-color: var(--rm-muted);
}
/* A dish with no photo starts under the Back button, whatever the design says. */
.rm-detail-copy:first-child {
  padding-top: 72px;
}
/* A label with no spaces wraps inside its box rather than clip or widen it. */
.rm-labels span,
.rm-badge,
.rm-filter-group button {
  max-width: 100%;
  overflow-wrap: anywhere;
}
/* Allergens by name (D130): "Gluten · Milk" on the row, the names alone in the footer and the sheet.
   The row's words are the sheet's button, underlined so they read as one; a long list wraps. */
.rm[data-labels-allergens="names"] .rm-allergens button {
  display: block;
  padding: 11px 0;
  text-align: left;
  font-size: calc(13px * var(--rm-type));
  font-weight: 700;
  line-height: 1.4;
  text-decoration: underline;
  text-underline-offset: 3px;
  overflow-wrap: anywhere;
}
.rm[data-labels-allergens="names"] .rm-allergen-sheet li {
  align-items: baseline;
}
.rm[data-labels-allergens="names"] .rm-allergen-sheet li::before {
  content: "";
  flex: none;
  width: 10px;
  height: 10px;
  border: 1px solid currentColor;
  border-radius: 50%;
}
.rm[data-labels-allergens="names"] .rm-allergen-sheet li.is-present::before {
  background: currentColor;
}
/* The dish page as a sheet (D130, Dish page: Kind): the dish in the sheets' own panel, tall, over
   the menu with the veil showing above it. The sheets' colour (the Sheets page) is its fill, so
   inside it the page's tokens are the sheet's own pair, as on the full page; the full page's
   rules are keyed on .is-detail and stay as they are. */
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish {
  --rm-bg: var(--rm-panel);
  --rm-text: var(--rm-ink);
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: min(100%, 78dvh);
  padding: 0;
  background: var(--rm-bg);
  color: var(--rm-text);
}
.rm[data-dish-kind="sheet"][data-sheets-sheets="page"] .rm-overlay-panel.is-dish {
  --rm-bg: var(--rm-page);
}
.rm[data-dish-kind="sheet"][data-sheets-sheets="ink"] .rm-overlay-panel.is-dish {
  --rm-bg: var(--rm-ink);
  --rm-text: var(--rm-page);
  --rm-muted: color-mix(in srgb, var(--rm-page) 78%, transparent);
  --rm-border: color-mix(in srgb, var(--rm-page) 24%, transparent);
  --rm-accent-text: var(--rm-page);
}
/* An ink button reads on the sheet: ink on a panel or a page sheet, inverted on an ink one. */
.rm[data-dish-kind="sheet"][data-buttons="ink"] .rm-overlay-panel.is-dish {
  --rm-button: var(--rm-ink);
  --rm-on-button: var(--rm-page);
}
.rm[data-dish-kind="sheet"][data-buttons="ink"][data-sheets-sheets="ink"] .rm-overlay-panel.is-dish {
  --rm-button: var(--rm-page);
  --rm-on-button: var(--rm-ink);
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish > .rm-overlay-head {
  position: sticky;
  top: 0;
  z-index: 3;
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  width: 100%;
  height: 0;
  min-height: 0;
  padding: 14px 14px 0;
  background: transparent;
  border: 0;
  pointer-events: none;
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish > .rm-overlay-head > span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish > .rm-overlay-head button {
  border-radius: var(--rm-full);
  background: var(--rm-bg);
  color: var(--rm-text);
  box-shadow: var(--rm-depth);
  pointer-events: auto;
}
.rm[data-dish-kind="sheet"][data-photos-frame="bleed"]
  .rm-overlay-panel.is-dish:has(.rm-detail-photo)
  > .rm-overlay-head,
.rm[data-dish-kind="sheet"][data-dish-photo="small"]
  .rm-overlay-panel.is-dish:has(.rm-detail-photo)
  > .rm-overlay-head {
  margin-bottom: -14px;
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish .rm-detail {
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish .rm-detail-copy {
  flex: 1 0 auto;
}
.rm[data-dish-kind="sheet"] .rm-overlay-panel.is-dish .rm-detail-photo img {
  max-height: 40dvh;
  border-radius: var(--rm-photo-corners);
}
.rm[data-dish-kind="sheet"] .rm-detail-bar {
  border-top: 1px solid var(--rm-border);
}
.rm[data-dish-kind="sheet"][data-dish-photo="small"] .rm-detail {
  position: relative;
}
.rm[data-dish-kind="sheet"][data-dish-photo="small"] .rm-overlay-panel.is-dish .rm-detail-photo {
  position: absolute;
  top: 72px;
  right: 20px;
  width: 96px;
  height: 96px;
  padding: 0;
  border-radius: var(--rm-photo-corners);
}
.rm[data-dish-kind="sheet"][data-dish-photo="small"] .rm-overlay-panel.is-dish .rm-detail-photo img {
  width: 96px;
  height: 96px;
  max-height: none;
  aspect-ratio: 1 / 1;
}
`
