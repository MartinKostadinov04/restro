// The stylesheet of the face, as one string the root component puts in a <style> element. It
// holds no colour of its own (R13): every colour is `var(--rq-…)`, set from the view model's
// theme on the root element (model.ts, `themeVariables`). Where a variable is missing (the
// loading skeleton and error notices are drawn before any theme is known) the fallback is a CSS
// system colour, which follows the guest's light or dark screen by itself.
//
// Tap targets are 44 px or more; text is never cut except the description, which has a "More"
// button; motion is off for guests who ask for less of it.

/** The variables of the dark scheme, mapped onto the ones the rules read. */
const DARK = `
  --rq-bg: var(--rq-d-bg);
  --rq-surface: var(--rq-d-surface);
  --rq-accent: var(--rq-d-accent);
  --rq-on-accent: var(--rq-d-on-accent);
  --rq-text: var(--rq-d-text);
  --rq-muted: var(--rq-d-muted);
  --rq-accent-text: var(--rq-d-accent-text);
  --rq-border: var(--rq-d-border);
`

export const FACE_CSS = `
.rq-root {
  color-scheme: light dark;
  min-height: 100dvh;
  background: var(--rq-bg, Canvas);
  color: var(--rq-text, CanvasText);
  font-family: var(--rq-font, system-ui, sans-serif);
  font-size: 16px;
  line-height: 1.45;
  -webkit-text-size-adjust: 100%;
}
@media (prefers-color-scheme: dark) {
  .rq-root:not([data-scheme="light"]) {${DARK}}
}
.rq-root[data-scheme="dark"] {${DARK}}
.rq-root[data-scheme="light"] { color-scheme: light; }
.rq-root[data-scheme="dark"] { color-scheme: dark; }
.rq-root *, .rq-root *::before, .rq-root *::after { box-sizing: border-box; }
.rq-root :focus-visible { outline: 2px solid var(--rq-accent-text, LinkText); outline-offset: 2px; }
.rq-root button { font: inherit; color: inherit; cursor: pointer; }
.rq-root h1, .rq-root h2, .rq-root h3, .rq-root h4, .rq-root p, .rq-root ul, .rq-root dl, .rq-root dd { margin: 0; }
.rq-root ul { padding: 0; list-style: none; }
.rq-root :where(fieldset) { min-width: 0; margin: 0; padding: 0; border: 0; }

.rq-page { max-width: 40rem; margin: 0 auto; padding: 0 16px 48px; }

.rq-header { padding-top: 20px; }
.rq-logo { display: block; width: auto; height: auto; max-width: 60%; max-height: 48px; margin-bottom: 12px; object-fit: contain; object-position: left center; }
.rq-titlerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rq-title { font-size: 1.75rem; line-height: 1.15; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: anywhere; padding-top: 6px; }
.rq-intro { margin-top: 8px; color: var(--rq-muted, GrayText); overflow-wrap: anywhere; white-space: pre-line; }
.rq-banner { display: inline-flex; align-items: center; min-height: 36px; margin-top: 12px; padding: 4px 14px; border-radius: 999px; background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); font-weight: 600; }
.rq-menu-schedule { margin-top: 12px; color: var(--rq-accent-text, LinkText); font-weight: 600; }

.rq-lang { display: flex; flex: none; overflow: hidden; border: 1px solid var(--rq-border, GrayText); border-radius: 999px; background: var(--rq-surface, Canvas); }
.rq-lang button { min-width: 44px; min-height: 44px; padding: 0 12px; border: 0; background: transparent; font-weight: 500; }
.rq-lang button[aria-pressed="true"] { background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); }

.rq-jump { position: sticky; top: 0; z-index: 20; margin: 16px -16px 0; padding: 0 16px; background: var(--rq-bg, Canvas); border-bottom: 1px solid var(--rq-border, GrayText); }
.rq-jump ul { display: flex; gap: 8px; padding: 8px 0; overflow-x: auto; scrollbar-width: none; }
.rq-jump ul::-webkit-scrollbar { display: none; }
.rq-jump a { display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px; border: 1px solid var(--rq-border, GrayText); border-radius: 999px; background: var(--rq-surface, Canvas); color: var(--rq-text, CanvasText); font-weight: 500; white-space: nowrap; text-decoration: none; }
.rq-jump a[aria-current="true"] { border-color: transparent; background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); }

.rq-filters { display: grid; gap: 4px; margin-top: 12px; }
.rq-filter-group { display: flex; align-items: center; gap: 8px; }
.rq-filter-label { flex: none; color: var(--rq-muted, GrayText); font-size: 0.8125rem; font-weight: 500; }
.rq-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; }
.rq-chips::-webkit-scrollbar { display: none; }
.rq-chip { flex: none; min-height: 44px; padding: 0 14px; border: 1px solid var(--rq-border, GrayText); border-radius: 999px; background: var(--rq-surface, Canvas); white-space: nowrap; }
.rq-chip[aria-pressed="true"] { border-color: transparent; background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); }
.rq-clear { min-height: 44px; padding: 0 4px; border: 0; background: none; color: var(--rq-accent-text, LinkText); font-weight: 500; text-decoration: underline; }
.rq-empty { margin-top: 32px; display: grid; justify-items: center; gap: 4px; text-align: center; color: var(--rq-muted, GrayText); }

.rq-section { margin-top: 28px; scroll-margin-top: 72px; }
.rq-section[data-hint] > .rq-section-head { padding-inline-start: 12px; border-inline-start: 4px solid var(--rq-hint); }
.rq-section-title { font-size: 1.375rem; line-height: 1.2; font-weight: 600; overflow-wrap: anywhere; }
.rq-subsection-title { font-size: 1.125rem; line-height: 1.25; font-weight: 600; overflow-wrap: anywhere; }
.rq-section-text { margin-top: 4px; color: var(--rq-muted, GrayText); overflow-wrap: anywhere; }
.rq-section-image { display: block; width: 100%; height: auto; margin-top: 12px; aspect-ratio: 16 / 7; object-fit: cover; border-radius: var(--rq-radius, 8px); }
.rq-subsection { margin-top: 20px; }
.rq-items { display: grid; gap: 12px; margin-top: 12px; }

.rq-item { overflow: hidden; border: 1px solid var(--rq-border, GrayText); border-radius: var(--rq-radius, 8px); background: var(--rq-surface, Canvas); box-shadow: var(--rq-shadow, none); }
.rq-item-media { aspect-ratio: 4 / 3; background: var(--rq-border, GrayText); }
.rq-item-media img { display: block; width: 100%; height: 100%; object-fit: cover; }
.rq-item[data-state="sold_out"] .rq-item-media img, .rq-item[data-state="unavailable"] .rq-item-media img { filter: grayscale(1); }
.rq-item-body { display: grid; gap: 8px; padding: 14px 16px 16px; }
.rq-item-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.rq-item-name { font-size: 1.0625rem; line-height: 1.3; font-weight: 600; overflow-wrap: anywhere; }
.rq-price { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rq-item[data-state="sold_out"] .rq-item-name, .rq-item[data-state="sold_out"] .rq-price,
.rq-item[data-state="unavailable"] .rq-item-name, .rq-item[data-state="unavailable"] .rq-price { color: var(--rq-muted, GrayText); }
.rq-state { justify-self: start; padding: 2px 10px; border: 1px solid currentColor; border-radius: 999px; color: var(--rq-accent-text, LinkText); font-size: 0.875rem; font-weight: 600; }
.rq-state[data-state="available"] { display: none; }
.rq-state[data-state="sold_out"], .rq-state[data-state="unavailable"] { color: var(--rq-muted, GrayText); }
.rq-note { color: var(--rq-accent-text, LinkText); font-size: 0.9375rem; font-weight: 500; }

.rq-desc { color: var(--rq-muted, GrayText); overflow-wrap: anywhere; white-space: pre-line; }
.rq-desc[data-clamped="true"] { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.rq-more { justify-self: start; min-height: 44px; margin: -10px 0; padding: 0 4px; border: 0; background: none; color: var(--rq-accent-text, LinkText); font-weight: 500; }

.rq-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rq-pill { padding: 2px 10px; border: 1px solid var(--rq-border, GrayText); border-radius: 999px; color: var(--rq-muted, GrayText); font-size: 0.8125rem; white-space: nowrap; }
.rq-pill[data-kind="new"] { border-color: transparent; background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); font-weight: 600; }
.rq-allergens { display: flex; flex-wrap: wrap; align-items: center; margin: -4px -4px -4px; }
.rq-allergen { display: inline-grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0; border: 0; background: none; }
.rq-allergen-code { display: inline-grid; place-items: center; width: 28px; height: 28px; border: 1.5px solid var(--rq-accent-text, LinkText); border-radius: 50%; color: var(--rq-accent-text, LinkText); font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.rq-fields { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; font-size: 0.9375rem; }
.rq-fields dt { color: var(--rq-muted, GrayText); }
.rq-fields dd { overflow-wrap: anywhere; }
.rq-groups { display: grid; gap: 4px; font-size: 0.9375rem; }
.rq-group-name { font-weight: 500; }
.rq-options { color: var(--rq-muted, GrayText); }

.rq-footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid var(--rq-border, GrayText); color: var(--rq-muted, GrayText); font-size: 0.875rem; }
.rq-footer h2 { margin-bottom: 4px; color: var(--rq-text, CanvasText); font-size: 1rem; font-weight: 600; }
.rq-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); gap: 4px 16px; margin-top: 12px; }
.rq-legend li { display: flex; align-items: center; gap: 8px; }
.rq-legend .rq-allergen-code { flex: none; width: 24px; height: 24px; font-size: 0.75rem; }

.rq-backdrop { position: fixed; inset: 0; z-index: 50; display: flex; align-items: flex-end; justify-content: center; background: color-mix(in srgb, var(--rq-text, CanvasText) 45%, transparent); }
.rq-sheet { width: 100%; max-width: 40rem; max-height: 85dvh; overflow-y: auto; padding: 20px 16px calc(20px + env(safe-area-inset-bottom)); border-radius: calc(var(--rq-radius, 8px) * 2) calc(var(--rq-radius, 8px) * 2) 0 0; background: var(--rq-surface, Canvas); color: var(--rq-text, CanvasText); }
.rq-sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.rq-sheet h2 { font-size: 1.25rem; font-weight: 600; }
.rq-sheet-sub { margin-top: 2px; color: var(--rq-muted, GrayText); overflow-wrap: anywhere; }
.rq-sheet-hint { margin-top: 12px; color: var(--rq-muted, GrayText); font-size: 0.9375rem; }
.rq-sheet-list { display: grid; gap: 4px; margin-top: 12px; }
.rq-sheet-list li { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 8px; border-radius: var(--rq-radius, 8px); }
.rq-sheet-list li[data-on="true"] { background: color-mix(in srgb, var(--rq-accent, Highlight) 14%, transparent); font-weight: 600; }
.rq-close { flex: none; min-width: 44px; min-height: 44px; border: 1px solid var(--rq-border, GrayText); border-radius: 999px; background: var(--rq-surface, Canvas); }

.rq-neutral .rq-page { padding-top: 20px; }
.rq-skel { border-radius: 8px; background: color-mix(in srgb, var(--rq-text, CanvasText) 10%, transparent); }
.rq-notice { display: grid; place-content: center; justify-items: center; gap: 8px; min-height: 100dvh; padding: 24px; text-align: center; }
.rq-notice h1 { font-size: 1.375rem; font-weight: 600; }
.rq-notice p { color: var(--rq-muted, GrayText); }
.rq-button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 999px; background: var(--rq-accent, Highlight); color: var(--rq-on-accent, HighlightText); font-weight: 600; }

@media (prefers-reduced-motion: no-preference) {
  html:has(.rq-root) { scroll-behavior: smooth; }
  .rq-sheet { animation: rq-up 0.2s ease-out; }
  .rq-backdrop { animation: rq-fade 0.2s ease-out; }
  .rq-skel { animation: rq-pulse 1.4s ease-in-out infinite; }
  @keyframes rq-up { from { transform: translateY(24px); opacity: 0; } }
  @keyframes rq-fade { from { opacity: 0; } }
  @keyframes rq-pulse { 50% { opacity: 0.55; } }
}
@media (prefers-reduced-motion: reduce) {
  .rq-root * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`
