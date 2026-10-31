// The stylesheet of the service screens, as one string the face adds after EDITORIAL_CSS only when
// it draws a service (see face.tsx). Ported from the `ro-…` rules of the designer's delivery of
// 2026-10-11 (docs/design/faces/editorial-market, ordering/ui.tsx `ORDER_CSS`), with its chains of
// overrides folded into their final values. The delivery's browsing rules (layouts, layout switch,
// language switch, header tools, the overlay animation) are in css.ts; this file holds the rest.
//
// Like css.ts it holds no colour of its own (R13): every colour is a theme variable (`--rm-*`), a
// `color-mix()` of them, `currentColor` or `transparent`. css.test.ts and services.test.tsx hold it
// to that, and to the touch rules below.
//
// Touch targets: every control on a sheet, the header and the bar is at least 44 px high and wide.
// The only compact ones are the "+" and the counter on a dish card. They look as small as the
// designer drew them (a round button of 32 to 38 px) but are 44 x 44 px themselves: a negative
// margin keeps the room they take and their `::before` draws the round fill (brief SH-07).

export const SERVICES_CSS = `
/* Sizes of the compact controls, and the room the bottom bar needs. */
.rm {
  --ro-btn: clamp(32px, 8.6vw, 38px);
  --ro-bar: clamp(46px, 12.4vw, 52px);
  --ro-icon: clamp(16px, 4.4vw, 18px);
}
.rm[data-services="bar"] main {
  padding-bottom: calc(110px + env(safe-area-inset-bottom));
}
.rm[data-services="bar"] .rm-footer {
  padding-bottom: calc(120px + env(safe-area-inset-bottom));
}

/* On a dish card: the "+" and, once the dish is in the bag, the counter. */
.rm .ro-quick {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: flex-end;
  margin-top: -34px;
  pointer-events: none;
}
.rm .ro-quick > * {
  pointer-events: auto;
}
/* The "+" is a real 44 x 44 px button that looks like the designer's round one: the negative margin
   keeps the room it takes (--ro-circle, 32 to 38 px), and the round fill is its ::before. */
.rm .ro-plus {
  --ro-circle: var(--ro-btn);
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin: calc((var(--ro-circle) - 44px) / 2);
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--rm-on-button);
  line-height: 1;
  touch-action: manipulation;
  transition:
    transform 0.18s ease,
    color 0.18s ease;
}
.rm .ro-plus::before {
  content: "";
  position: absolute;
  inset: calc((44px - var(--ro-circle)) / 2);
  z-index: -1;
  border-radius: var(--rm-pill);
  background: var(--rm-button);
  transition:
    background 0.18s ease,
    box-shadow 0.18s ease;
}
.rm .ro-plus svg {
  width: var(--ro-icon);
  height: var(--ro-icon);
  stroke-width: 2.4;
}
.rm .ro-plus:active {
  transform: scale(0.9);
}
.rm .ro-plus-count {
  position: absolute;
  top: calc((44px - var(--ro-circle)) / 2 - 4px);
  right: calc((44px - var(--ro-circle)) / 2 - 4px);
  min-width: 18px;
  height: 18px;
  border-radius: var(--rm-full);
  background: var(--rm-button-mark);
  color: var(--rm-on-button-mark);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  line-height: 18px;
  text-align: center;
}
@media (hover: hover) {
  .rm .ro-plus:hover {
    color: var(--rm-on-accent);
    transform: translateY(-2px);
  }
  .rm .ro-plus:hover::before {
    background: var(--rm-accent);
    box-shadow: var(--rm-depth);
  }
  .rm .ro-stepper button:hover {
    background: var(--rm-accent);
    color: var(--rm-on-accent);
  }
  .rm .ro-quick .ro-stepper button:hover {
    background: transparent;
  }
  .rm .ro-quick .ro-stepper button:hover::before {
    background: var(--rm-accent);
  }
}
.rm[data-layout="two"] .rm-section:not(.is-feature) .rm-item.has-photo .rm-item-copy > .ro-quick {
  flex: 0 0 auto;
  margin: 0;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick {
  position: absolute;
  top: calc(18px + 96px - 42px);
  right: 4px;
  z-index: 3;
  margin: 0;
}
/* Where the copy is a wrapping row (D130: the price at the end, a portion beside it) the "+" is one
   of its parts, right after the price and the portion. */
.rm[data-layout][data-items-price-place="end"] .rm-item-copy > .ro-quick,
.rm[data-layout][data-items-portion-place="beside"] .rm-item-copy > .ro-quick {
  flex: 0 0 auto;
  order: 4;
  align-self: center;
  margin: 0 0 0 auto;
}
.rm[data-layout="two"][data-items-portion-place="beside"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .rm-item-copy
  > .ro-quick {
  margin-left: auto;
}
/* On a card the list's thumbnail sits 14 px in, and the "+" stays on its corner. */
.rm[data-layout="list"][data-items-frame="cards"]
  .rm-section:not(.is-feature)
  .rm-item.has-photo
  .ro-quick {
  top: calc(14px + 96px - 42px);
  right: 18px;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick .ro-plus {
  --ro-circle: 36px;
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.has-photo .ro-quick .ro-plus::before {
  box-shadow: var(--rm-depth);
}
.rm[data-layout="list"] .rm-section:not(.is-feature) .rm-item.is-text .ro-quick {
  margin-top: -40px;
}
.rm[data-layout="list"][data-items-price-place="end"]
  .rm-section:not(.is-feature)
  .rm-item.is-text
  .rm-item-copy
  > .ro-quick,
.rm[data-layout="list"][data-items-portion-place="beside"]
  .rm-section:not(.is-feature)
  .rm-item.is-text
  .rm-item-copy
  > .ro-quick {
  margin-top: 0;
}

/* The quantity stepper: 44 px buttons, compact on a dish card (with a 44 px tap area). */
.rm .ro-stepper {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-pill);
  background: var(--rm-bg);
  color: var(--rm-text);
}
.rm .ro-stepper button {
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: calc(20px * var(--rm-type));
  touch-action: manipulation;
}
.rm .ro-stepper button:disabled {
  opacity: 0.3;
  cursor: default;
}
.rm .ro-stepper output {
  min-width: 22px;
  text-align: center;
  font-size: calc(14px * var(--rm-type));
  font-weight: 850;
  animation: ro-pop 0.2s ease;
}
/* On a dish card the counter keeps the size the designer drew (buttons of 32 to 38 px) but its buttons
   are real 44 x 44 px targets: the negative margin keeps the room, and the capsule no longer clips
   (its buttons reach a little past it), so the hover fill is drawn by the ::before of each button. */
.rm .ro-quick .ro-stepper {
  overflow: visible;
}
.rm .ro-quick .ro-stepper button {
  position: relative;
  isolation: isolate;
  width: 44px;
  height: 44px;
  min-width: 44px;
  min-height: 44px;
  margin: calc((var(--ro-btn) - 44px) / 2);
  font-size: calc(16px * var(--rm-type));
}
.rm .ro-quick .ro-stepper button::before {
  content: "";
  position: absolute;
  inset: calc((44px - var(--ro-btn)) / 2);
  z-index: -1;
  border-radius: var(--rm-pill);
  background: transparent;
}

/* The bill and the pay entry in the venue bar. */
.rm-headtools {
  flex-wrap: wrap;
}
.rm .ro-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 44px;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid color-mix(in srgb, var(--rm-bg) 30%, transparent);
  border-radius: var(--rm-pill);
  background: transparent;
  color: var(--rm-bg);
  font-size: calc(12.5px * var(--rm-type));
  font-weight: 800;
  white-space: nowrap;
  transition:
    background 0.18s,
    color 0.18s;
}
.rm .ro-pill svg {
  width: 15px;
  height: 15px;
}
@media (hover: hover) {
  .rm .ro-pill:hover {
    background: var(--rm-bg);
    color: var(--rm-text);
  }
}
@media (max-width: 389px) {
  .rm .ro-billword {
    display: none;
  }
}
/* With the pay entry beside it, the bill keeps to its icon and total up to 440 px too, so the two
   share the venue bar's row instead of the pay entry dropping to a row of its own and pushing the
   title down. The button's name (aria-label) still says "bill". */
@media (max-width: 439px) {
  .rm .ro-pill:has(~ .ro-payentry) .ro-billword {
    display: none;
  }
}
@media (max-width: 380px) {
  .rm .ro-pill {
    gap: 4px;
    padding: 0 9px;
    font-size: calc(12px * var(--rm-type));
  }
  .rm-headtools {
    gap: 4px;
  }
}

/* The bar at the bottom: the waiter, and the bag once it has something in it. */
.rm .ro-bagbar {
  position: fixed;
  z-index: 40;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  justify-content: center;
  gap: 10px;
  padding: 12px max(14px, env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom))
    max(14px, env(safe-area-inset-left));
  pointer-events: none;
  animation: ro-up 0.34s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.rm .ro-bagbar button {
  pointer-events: auto;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
  width: min(100%, 560px);
  min-height: max(44px, var(--ro-bar));
  padding: 0 16px 0 6px;
  border: 0;
  border-radius: var(--rm-pill);
  background: var(--rm-button);
  color: var(--rm-on-button);
  font-size: calc(14px * var(--rm-type));
  font-weight: 850;
  box-shadow: var(--rm-depth);
  touch-action: manipulation;
  transition: transform 0.12s;
  animation: ro-up 0.34s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.rm .ro-bagbar button:active {
  transform: scale(0.98);
}
.rm .ro-bagbar svg {
  width: var(--ro-icon);
  height: var(--ro-icon);
}
.rm .ro-bagslot {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  max-width: 490px;
}
.rm .ro-bagslot:empty {
  display: none;
}
.rm .ro-bagbar .ro-bagbtn {
  flex: 1 1 auto;
  width: auto;
}
.rm .ro-bagbtn span:nth-child(2) {
  text-align: left;
}
.rm .ro-bagbar .ro-waiter {
  display: flex;
  flex: none;
  justify-content: center;
  gap: 8px;
  width: auto;
  min-width: max(44px, var(--ro-bar));
  padding: 0 16px;
  transition:
    padding 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.12s;
}
.rm .ro-bagbar[data-bag="true"] .ro-waiter {
  width: max(44px, var(--ro-bar));
  padding: 0;
}
.rm .ro-bagbar[data-bag="true"] .ro-waiter span {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.rm .ro-count {
  display: grid;
  place-items: center;
  width: calc(var(--ro-bar) - 14px);
  height: calc(var(--ro-bar) - 14px);
  border-radius: var(--rm-full);
  background: var(--rm-button-mark);
  color: var(--rm-on-button-mark);
  font-size: calc(13px * var(--rm-type));
  animation: ro-pop 0.22s ease;
}

/* The ordering part of the dish page. */
.rm .ro-dish {
  margin-top: 8px;
}
.rm .ro-group {
  margin: 30px 0 0;
  padding: 22px 0 0;
  border: 0;
  border-top: 1px solid var(--rm-border);
}
.rm .ro-group legend {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 0;
  margin-bottom: 14px;
}
.rm .ro-group legend > span {
  font-size: calc(19px * var(--rm-type));
  font-weight: 850;
}
.rm .ro-group legend small {
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.rm .ro-group.is-invalid legend small {
  color: var(--rm-accent-text);
}
.rm .ro-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}
.rm .ro-options button,
.rm .ro-choicegrid button,
.rm .ro-tips button,
.rm .ro-scope button {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  min-height: 58px;
  padding: 10px 14px;
  /* The edge of a choice shows at 3:1: the muted colour reads at 4.5:1 on the page (the border
     colour is for separators and is about 1.3:1). */
  border: 1px solid var(--rm-muted);
  border-radius: var(--rm-radius);
  background: transparent;
  text-align: left;
  font-size: calc(14px * var(--rm-type));
  font-weight: 700;
  touch-action: manipulation;
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
}
.rm .ro-options [aria-checked="true"],
.rm .ro-options [aria-pressed="true"] {
  border-color: var(--rm-text);
  box-shadow: inset 0 0 0 1px var(--rm-text);
  background: var(--rm-surface);
}
.rm .ro-options b {
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
}
.rm .ro-note {
  display: grid;
  gap: 8px;
  margin-top: 26px;
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
}
.rm .ro-note textarea,
.rm .ro-input input,
.rm .ro-promo input {
  width: 100%;
  min-height: 52px;
  padding: 13px 14px;
  border: 1px solid var(--rm-muted);
  border-radius: var(--rm-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: calc(16px * var(--rm-type));
  resize: vertical;
}
.rm .ro-sheet .ro-note textarea,
.rm .ro-sheet .ro-input input,
.rm .ro-sheet .ro-promo input {
  /* On a sheet (the inverse colours) the edge of an input shows at 3:1 as well: 54 % of the text. */
  border-color: color-mix(in srgb, currentColor 54%, transparent);
}
.rm .ro-dish-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 30px -20px -52px;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--rm-border);
  background: color-mix(in srgb, var(--rm-bg) 94%, transparent);
  backdrop-filter: blur(12px);
}
.rm .ro-dish-bar .ro-primary {
  padding: 0 16px;
  font-size: calc(14px * var(--rm-type));
}

/* Buttons. */
.rm .ro-primary {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-height: max(44px, var(--ro-bar));
  padding: 0 20px;
  border: 0;
  border-radius: var(--rm-pill);
  background: var(--rm-button);
  color: var(--rm-on-button);
  font-size: calc(15px * var(--rm-type));
  font-weight: 850;
  touch-action: manipulation;
  transition:
    transform 0.12s ease,
    opacity 0.15s;
}
.rm .ro-primary[aria-disabled="true"],
.rm .ro-primary:disabled {
  opacity: 0.45;
}
.rm .ro-primary.is-wide {
  width: 100%;
  margin-top: 22px;
}
.rm .ro-primary b {
  animation: ro-pop 0.2s ease;
}
.rm .ro-primary span:only-child {
  margin: auto;
}
.rm .ro-primary:active,
.rm .ro-pay:active {
  transform: scale(0.98);
}
.rm .ro-ghost {
  width: 100%;
  min-height: 50px;
  margin-top: 10px;
  padding: 0 18px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: var(--rm-full);
  background: transparent;
  font-weight: 800;
  touch-action: manipulation;
}
.rm .ro-ghost:disabled {
  opacity: 0.45;
}

/* Sheets: the bag, the bill. */
.rm .ro-preview {
  display: inline-block;
  margin: 14px 0 0;
  padding: 3px 10px;
  border: 1px dashed currentColor;
  border-radius: var(--rm-full);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.rm .ro-sheet {
  padding-top: 6px;
}
.rm .ro-empty {
  padding: 30px 0;
  color: color-mix(in srgb, currentColor 70%, transparent);
}
.rm .ro-lines {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rm .ro-lines li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  padding: 18px 0;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}
.rm .ro-lines li[data-available="false"] {
  opacity: 0.75;
}
.rm .ro-lines li[data-being-paid],
.rm .ro-lines li[data-paid-in-app] {
  /* A line in some phone's payment, or already paid in the app (D127): greyed, nothing to tick.
     The muted colour keeps its contrast, which a fade of the whole line would not. */
  color: var(--rm-muted);
}
.rm .ro-confirm-note {
  color: var(--rm-muted);
  font-size: calc(14.4px * var(--rm-type));
}
.rm .ro-confirm {
  /* The Payment confirmation (D127 1.4): a plain card, nothing of a receipt's look. */
  display: grid;
  gap: 10px;
  padding: 18px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: calc(var(--rm-radius) * 1.5);
  text-align: left;
}
.rm .ro-confirm p {
  margin: 0;
}
.rm .ro-lines label {
  display: flex;
  gap: 12px;
  align-items: center;
  min-height: 44px;
}
.rm .ro-lines input[type="checkbox"] {
  /* Drawn by us so its edge shows at 3:1 on every theme: 54 % of the text colour, as the inputs'. */
  appearance: none;
  flex: none;
  width: 24px;
  height: 24px;
  margin: 0;
  border: 2px solid color-mix(in srgb, currentColor 54%, transparent);
  border-radius: calc(var(--rm-radius) * 0.75);
  background: transparent;
}
.rm .ro-lines input[type="checkbox"]:checked {
  border-color: currentColor;
  background: var(--rm-accent);
  box-shadow: inset 0 0 0 3px var(--rm-bg);
}
.rm .ro-line-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.rm .ro-line-main strong {
  font-size: calc(16px * var(--rm-type));
  overflow-wrap: anywhere;
}
.rm .ro-line-main small {
  color: color-mix(in srgb, currentColor 65%, transparent);
}
.rm .ro-line-main .ro-flag {
  justify-self: start;
  padding: 3px 9px;
  border-radius: var(--rm-full);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.rm .ro-line-actions {
  display: flex;
  gap: 16px;
}
.rm .ro-line-actions button {
  min-width: 44px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
  text-decoration: underline;
  text-underline-offset: 3px;
  touch-action: manipulation;
}
.rm .ro-line-actions button:disabled {
  opacity: 0.45;
}
.rm .ro-line-side {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.rm .ro-sum {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 0 0;
  font-weight: 800;
}
.rm .ro-sum.is-small {
  padding-top: 8px;
  font-size: calc(14px * var(--rm-type));
  font-weight: 600;
  opacity: 0.8;
}
.rm .ro-sum.is-big {
  margin-top: 18px;
  border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  font-size: calc(20px * var(--rm-type));
}
.rm .ro-notice {
  display: grid;
  gap: 6px;
  margin: 16px 0 0;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
  border-radius: var(--rm-radius);
  font-size: calc(14px * var(--rm-type));
}
.rm .ro-notice.is-bad {
  border-color: currentColor;
}
.rm .ro-notice .ro-ghost {
  justify-self: start;
  width: auto;
  margin: 4px 0 0;
}
.rm .ro-notice ul {
  margin: 0;
  padding-left: 18px;
}
/* The last refusal of an order command, over the bar when no sheet is open; a tap dismisses it. */
.rm .ro-barnote {
  position: fixed;
  z-index: 41;
  right: max(14px, env(safe-area-inset-right));
  bottom: calc(max(44px, var(--ro-bar)) + 28px + env(safe-area-inset-bottom));
  left: max(14px, env(safe-area-inset-left));
  box-sizing: border-box;
  max-width: 560px;
  min-height: 44px;
  margin-inline: auto;
  padding: 10px 14px;
  border: 1px solid currentColor;
  border-radius: var(--rm-radius);
  background: var(--rm-bg);
  color: var(--rm-text);
  font-size: calc(14px * var(--rm-type));
  text-align: left;
  touch-action: manipulation;
}
/* "Order this from your waiter" on a card, where the POS's ticket takes no choices (#78). */
.rm .ro-quick-note {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--rm-radius);
  background: var(--rm-bg);
  color: var(--rm-text);
  font-size: calc(12px * var(--rm-type));
  font-weight: 700;
}
/* "Show this to your waiter" (D120): the reference in large type, dark on light whatever the theme. */
.rm .ro-waiter-card {
  display: grid;
  gap: 10px;
  margin-top: 18px;
  padding: 18px;
  border-radius: var(--rm-radius);
  color-scheme: light;
  background: Canvas;
  color: CanvasText;
}
.rm .ro-waiter-card p {
  margin: 0;
}
.rm .ro-waiter-card ul {
  margin: 0;
  padding-left: 18px;
}
.rm .ro-waiter-ref {
  font-size: calc(48px * var(--rm-type));
  font-weight: 800;
  letter-spacing: 0.08em;
  line-height: 1.1;
}
.rm .ro-sent {
  margin-top: 8px;
}
.rm .ro-round {
  margin-top: 22px;
  padding: 16px;
  border-radius: var(--rm-radius);
  background: color-mix(in srgb, currentColor 7%, transparent);
}
.rm .ro-round header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.rm .ro-round em {
  padding: 3px 9px;
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  border-radius: var(--rm-full);
  font-style: normal;
}
.rm .ro-round[data-source="guest"] em {
  border-color: transparent;
  background: var(--rm-accent);
  color: var(--rm-on-accent);
}
.rm .ro-round ul {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.rm .ro-round li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 10px 0;
  font-size: calc(14px * var(--rm-type));
}
.rm .ro-round li[data-status="cancelled"] .ro-tabname {
  text-decoration: line-through;
}
.rm .ro-tabname {
  display: grid;
  overflow-wrap: anywhere;
}
.rm .ro-tabname small {
  /* The options of a line stay at the 12 px floor: the browser's "smaller" would be 11.7 px here. */
  font-size: calc(12px * var(--rm-type));
  opacity: 0.65;
}
.rm .ro-qty {
  font-weight: 850;
}
.rm .ro-status {
  padding: 4px 8px;
  border-radius: var(--rm-full);
  background: color-mix(in srgb, currentColor 12%, transparent);
  font-size: calc(12px * var(--rm-type));
  font-weight: 850;
}
.rm .ro-status[data-status="preparing"] {
  background: var(--rm-accent);
  color: var(--rm-on-accent);
}
/* A line that is done is quieter: an outline instead of a tint. (It used to fade to 60 %, which
   left its small text at about 3.5:1.) */
.rm .ro-status[data-status="served"],
.rm .ro-status[data-status="cancelled"] {
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 40%, transparent);
}

/* The waiter sheet, and the states a service goes through. */
.rm .ro-choicegrid,
.rm .ro-tips {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
  margin-top: 14px;
}
.rm .ro-choicegrid button,
.rm .ro-tips button,
.rm .ro-scope button {
  /* On a sheet (the inverse colours) a choice's edge is 54 % of the text colour, which shows at
     3:1 on every theme checked (it was 24 %, about 1.7:1). */
  border-color: color-mix(in srgb, currentColor 54%, transparent);
}
.rm .ro-choicegrid button {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rm .ro-choicegrid button svg {
  width: 20px;
  height: 20px;
  flex: none;
}
.rm .ro-choicegrid [aria-checked="true"],
.rm .ro-tips [aria-checked="true"],
.rm .ro-tips [aria-pressed="true"],
.rm .ro-sheet .ro-ghost[aria-pressed="true"],
.rm .ro-scope [aria-checked="true"] {
  /* The chosen one: the accent fill, and a ring in the sheet's own text colour, so it stands out by
     more than hue (the accent can be as light as the sheet itself: 1.06:1 on Botanical dark). */
  border-color: var(--rm-bg);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  box-shadow: inset 0 0 0 1px var(--rm-bg);
}
.rm .ro-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 40px 0 10px;
  text-align: center;
}
.rm .ro-state h3 {
  margin: 12px 0 0;
  font-size: calc(22px * var(--rm-type));
}
.rm .ro-state p {
  max-width: 32ch;
  margin: 0;
  opacity: 0.75;
}
.rm .ro-state .ro-kind {
  font-weight: 800;
  opacity: 0.9;
}
.rm .ro-state .ro-primary,
.rm .ro-state .ro-ghost {
  max-width: 340px;
}
.rm .ro-spinner {
  width: 54px;
  height: 54px;
  border: 3px solid color-mix(in srgb, currentColor 18%, transparent);
  border-top-color: var(--rm-accent);
  border-radius: var(--rm-full);
  animation: ro-spin 0.8s linear infinite;
}
.rm .ro-check {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: var(--rm-full);
  background: var(--rm-accent);
  color: var(--rm-on-accent);
  font-size: calc(30px * var(--rm-type));
  font-weight: 900;
  animation: ro-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.rm .ro-check.is-bad {
  border: 2px solid currentColor;
  background: transparent;
  color: inherit;
}
.rm .ro-pulse {
  width: 20px;
  height: 20px;
  border-radius: var(--rm-full);
  background: var(--rm-accent);
  animation: ro-pulse 1.4s ease-out infinite;
}

/* The pay sheet. */
.rm .ro-scope {
  display: grid;
  gap: 8px;
}
.rm .ro-tips {
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 6px;
}
.rm .ro-tips button {
  grid-template-columns: 1fr;
  min-height: 48px;
  padding: 0 4px;
  text-align: center;
  font-size: calc(13px * var(--rm-type));
}
.rm .ro-h {
  margin: 26px 0 10px;
  font-size: calc(15px * var(--rm-type));
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-subheading-weight);
}
.rm .ro-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.rm .ro-row .ro-stepper {
  border-color: color-mix(in srgb, currentColor 24%, transparent);
  background: transparent;
  color: inherit;
}
.rm .ro-input {
  display: block;
  margin-top: 10px;
}
.rm .ro-acc {
  margin-top: 22px;
  border-top: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  border-bottom: 1px solid color-mix(in srgb, currentColor 16%, transparent);
}
.rm .ro-acc summary {
  display: flex;
  align-items: center;
  min-height: 52px;
  font-weight: 800;
  cursor: pointer;
}
.rm .ro-promo {
  display: flex;
  gap: 8px;
  padding-bottom: 14px;
}
.rm .ro-promo .ro-ghost {
  width: auto;
  margin: 0;
}
.rm .ro-allergy {
  font-size: calc(13px * var(--rm-type));
  opacity: 0.75;
}
/* The legal block's two controls (ticket 198): the Privacy link and the "About the venue" disclosure keep
   the hint's look but are 44 px to tap. */
.rm .ro-allergy a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.rm .ro-allergy summary {
  box-sizing: border-box;
  min-height: 44px;
  padding-block: 12px;
  cursor: pointer;
}
.rm .ro-methods {
  display: grid;
  gap: 9px;
  margin-top: 20px;
}
.rm .ro-pay {
  min-height: 54px;
  border: 1px solid color-mix(in srgb, currentColor 26%, transparent);
  border-radius: var(--rm-pill);
  background: var(--rm-bg);
  color: var(--rm-text);
  font-weight: 850;
  touch-action: manipulation;
}
.rm .ro-pay.is-apple {
  border-color: transparent;
  background: var(--rm-accent);
  color: var(--rm-on-accent);
}
.rm .ro-pay:disabled {
  opacity: 0.45;
}

/* The receipt page. */
.rm .ro-page {
  padding: 76px 20px 40px;
}
.rm .ro-page > h2 {
  margin: 0 0 6px;
  font-size: calc(30px * var(--rm-type));
  font-family: var(--rm-font-heading);
  font-weight: var(--rm-heading-weight);
  letter-spacing: -0.01em;
  text-transform: uppercase;
}
.rm .ro-page .ro-preview {
  margin: 0 0 8px;
}
.rm .ro-receipt {
  margin-top: 10px;
  padding: 22px 20px;
  border-radius: var(--rm-radius);
  background: var(--rm-bg);
  color: var(--rm-text);
  font-size: calc(14px * var(--rm-type));
}
.rm .ro-page .ro-receipt {
  background: var(--rm-surface);
  box-shadow: 0 1px 0 var(--rm-border);
}
.rm .ro-receipt header {
  display: grid;
  gap: 3px;
  justify-items: center;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--rm-border);
  text-align: center;
}
.rm .ro-receipt header strong {
  font-size: calc(18px * var(--rm-type));
  letter-spacing: 0.12em;
  overflow-wrap: anywhere;
}
.rm .ro-receipt header span {
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
}
.rm .ro-receipt ul {
  margin: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--rm-border);
  list-style: none;
}
.rm .ro-receipt li,
.rm .ro-receipt dl div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
}
.rm .ro-receipt dl {
  margin: 12px 0 0;
}
.rm .ro-receipt dd {
  margin: 0;
  font-weight: 700;
}
.rm .ro-receipt .is-total {
  margin: 6px 0;
  padding: 10px 0;
  border-top: 1px solid var(--rm-border);
  border-bottom: 1px solid var(--rm-border);
  font-size: calc(18px * var(--rm-type));
  font-weight: 900;
}
.rm .ro-ref {
  margin: 12px 0 0;
  color: var(--rm-muted);
  font-size: calc(12px * var(--rm-type));
  text-align: center;
}
.rm .ro-toast {
  margin-top: 14px;
  text-align: center;
  font-weight: 800;
  animation: ro-fade 0.2s;
}

/* The five guest-feature screens' options (D130). The first value of each is what the sheets above
   draw (Editorial's own values are those, Basic's differ only where its first value is a new look),
   so every rule here is keyed on a value that draws something else. What D72 and D122 fix (the
   words, the states, the amounts, the lines, the waiter reference, the consent text) is in none of
   them. The five inherit General (colours, fonts, corners, depth, buttons, text size) from the
   variables above, the sheet colour from css.ts, and the labels look for their chips and inputs. */

/* Call a waiter, Kinds: tiles. The kinds as a grid of icon-over-word tiles; the list is the rule
   above (the icon beside the word, two to a row). */
.rm[data-call-kinds="tiles"] .ro-choicegrid {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 96px), 1fr));
}
.rm[data-call-kinds="tiles"] .ro-choicegrid button {
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-height: 84px;
  padding: 10px 6px;
  text-align: center;
  overflow-wrap: anywhere;
}

/* Bill, Rows: zebra. The Order's lines, the pay summary, the sent orders and the confirmation
   follow, for they are the same lines. */
.rm[data-bill-rows="zebra"] .ro-lines li {
  padding-inline: 12px;
  border-bottom: 0;
  border-radius: calc(var(--rm-radius) * 0.5);
}
.rm[data-bill-rows="zebra"] .ro-lines li:nth-child(odd) {
  background: color-mix(in srgb, currentColor 5%, transparent);
}
.rm[data-bill-rows="zebra"] .ro-round li {
  padding-inline: 8px;
  border-radius: calc(var(--rm-radius) * 0.5);
}
.rm[data-bill-rows="zebra"] .ro-round li:nth-child(even) {
  background: color-mix(in srgb, currentColor 6%, transparent);
}

/* Bill, Lines: compact. One row to a line: the options and the note run on after the name in
   smaller type (never under 12 px), and the status word and the amount keep their places. */
.rm[data-bill-lines="compact"] .ro-lines li {
  padding-block: 10px;
}
.rm[data-bill-lines="compact"] .ro-line-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 8px;
}
.rm[data-bill-lines="compact"] .ro-line-main small,
.rm[data-bill-lines="compact"] .ro-tabname small {
  font-size: calc(12px * var(--rm-type));
}
.rm[data-bill-lines="compact"] .ro-line-main .ro-flag {
  font-size: calc(12px * var(--rm-type));
}
.rm[data-bill-lines="compact"] .ro-tabname {
  display: block;
}
.rm[data-bill-lines="compact"] .ro-tabname small {
  display: inline;
  margin-left: 6px;
}
.rm[data-bill-lines="compact"] .ro-round li {
  padding-block: 6px;
}

/* Order, Add control: add. The same 44 px button, drawn as a small pill with the shell's word. */
.rm[data-order-add-control="add"] .ro-plus.is-word {
  width: auto;
  min-width: 44px;
  margin-inline: 0;
  padding: 0 14px;
  font-size: calc(13px * var(--rm-type));
  font-weight: 800;
}
.rm[data-order-add-control="add"] .ro-plus.is-word::before {
  inset: calc((44px - var(--ro-circle)) / 2) 0;
}
.rm[data-order-add-control="add"] .ro-plus.is-word .ro-plus-count {
  right: -4px;
}

/* Order, Order bar: docked. The bar runs the width of the screen and sits on its bottom edge (the
   safe area inside it); the waiter and the bag share it, the waiter first. */
.rm[data-order-order-bar="docked"] .ro-bagbar {
  gap: 0;
  padding: 0;
  justify-content: stretch;
}
.rm[data-order-order-bar="docked"] .ro-bagbar button {
  width: 100%;
  min-height: calc(max(44px, var(--ro-bar)) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 0;
  box-shadow: var(--rm-depth-up);
}
.rm[data-order-order-bar="docked"] .ro-bagbar .ro-bagbtn {
  padding-left: max(6px, env(safe-area-inset-left));
  padding-right: max(16px, env(safe-area-inset-right));
}
.rm[data-order-order-bar="docked"] .ro-bagslot {
  max-width: none;
}
.rm[data-order-order-bar="docked"] .ro-bagbar[data-bag="false"] .ro-waiter {
  flex: 1 1 auto;
  width: 100%;
}
.rm[data-order-order-bar="docked"] .ro-bagbar[data-bag="true"] .ro-waiter {
  border-right: 1px solid color-mix(in srgb, var(--rm-on-button) 30%, transparent);
}

/* Order, Line photos: shown. A small photo ahead of each line of the Order. */
.rm[data-order-line-photos="shown"] .ro-lines li.has-line-photo {
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: start;
}
.rm[data-order-line-photos="shown"] .ro-line-photo {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: calc(var(--rm-radius) * 0.6);
}

/* Pay, Tip: rows. Each percent on a row of its own with what it comes to. */
.rm[data-pay-tip="rows"] .ro-tips {
  grid-template-columns: 1fr;
  gap: 8px;
}
.rm[data-pay-tip="rows"] .ro-tips button {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 52px;
  margin-top: 0;
  padding: 0 14px;
  text-align: left;
}
.rm[data-pay-tip="rows"] .ro-tip-amount {
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

/* Receipt, Venue block: logo. The venue's logo, with the name small under it. */
.rm[data-receipt-venue-block="logo"] .ro-confirm-logo {
  justify-self: start;
  width: auto;
  max-width: 144px;
  max-height: 64px;
  object-fit: contain;
}
.rm[data-receipt-venue-block="logo"] .ro-confirm p.is-under-logo {
  margin-top: -6px;
  font-size: calc(12px * var(--rm-type));
  letter-spacing: 0.04em;
}

/* The labels look for the chips and the inputs of the five (the options spec: outline is the boxed
   look above, soft fills, text underlines). The edge of a control keeps its 3:1 in all three. */
.rm[data-labels-labels="soft"] .ro-choicegrid button:not([aria-checked="true"]),
.rm[data-labels-labels="soft"] .ro-tips button:not([aria-pressed="true"]),
.rm[data-labels-labels="soft"] .ro-scope button:not([aria-checked="true"]),
.rm[data-labels-labels="soft"] .ro-note textarea,
.rm[data-labels-labels="soft"] .ro-input input,
.rm[data-labels-labels="soft"] .ro-promo input {
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.rm[data-labels-labels="text"] .ro-choicegrid button:not([aria-checked="true"]),
.rm[data-labels-labels="text"] .ro-tips button:not([aria-pressed="true"]),
.rm[data-labels-labels="text"] .ro-scope button:not([aria-checked="true"]),
.rm[data-labels-labels="text"] .ro-note textarea,
.rm[data-labels-labels="text"] .ro-input input,
.rm[data-labels-labels="text"] .ro-promo input {
  border-width: 0 0 2px;
  border-radius: 0;
}

/* Wider screens match the dish page's wider padding. */
@media (min-width: 641px) {
  .rm .ro-dish-bar {
    margin-right: -34px;
    margin-left: -34px;
    padding-right: 34px;
    padding-left: 34px;
  }
  .rm .ro-page {
    padding-right: 34px;
    padding-left: 34px;
  }
}

/* Motion. */
@keyframes ro-up {
  from {
    transform: translateY(100%);
  }
  to {
    transform: none;
  }
}
@keyframes ro-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes ro-pop {
  0% {
    transform: scale(0.7);
    opacity: 0.3;
  }
  100% {
    transform: none;
    opacity: 1;
  }
}
@keyframes ro-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes ro-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--rm-accent) 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 22px transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rm .ro-bagbar,
  .rm .ro-bagbar button,
  .rm .ro-count,
  .rm .ro-stepper output,
  .rm .ro-primary b,
  .rm .ro-check,
  .rm .ro-spinner,
  .rm .ro-pulse,
  .rm .ro-toast {
    animation: none !important;
  }
  .rm .ro-primary:active,
  .rm .ro-pay:active,
  .rm .ro-plus:active,
  .rm .ro-bagbar button:active {
    transform: none;
  }
}
`
