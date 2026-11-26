// The stylesheet of the booking page (#577), as one string the booking screen adds after
// EDITORIAL_CSS (booking.tsx). Its own `bk-` classes only, each in a rule of its own: nothing here
// refines a menu rule, so the menu's stored renderings never move for it.
//
// Like css.ts it holds no colour of its own (R13): every colour is a theme variable (`--rm-*`), a
// `color-mix()` of them, `currentColor` or `transparent`. booking.test.tsx holds it to that.
//
// Every control is at least 44 px high (the touch rule of the service screens), and the fields use
// 16 px text so a phone does not zoom into them. The page is one column, as wide as the phone up to
// 560 px, so the longest Bulgarian words wrap inside a 390 px screen.
//
// The spot picker (#580) draws the plan in a frame of its own that scrolls sideways when a plan of
// many small spots would shrink them below a finger (booking-plan.tsx sets the box's least width),
// so the page itself never scrolls sideways. A spot's state is never colour alone: a taken spot is
// hatched and dimmed, a picked one filled and ticked, and the legend says each in words.

export const BOOKING_CSS = `
.bk-page {
  box-sizing: border-box;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  padding: calc(28px * var(--rm-space)) 16px calc(40px + env(safe-area-inset-bottom));
}
.bk-venue {
  margin: 0;
  color: var(--rm-muted);
  font-size: calc(14px * var(--rm-type));
  font-weight: var(--rm-nav-weight);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}
.bk-title {
  margin: 6px 0 0;
  font-family: var(--rm-font-heading);
  font-size: var(--rm-title-size);
  font-weight: var(--rm-heading-weight);
  line-height: var(--rm-title-leading);
  overflow-wrap: anywhere;
}
.bk-intro {
  margin: 12px 0 0;
  color: var(--rm-muted);
  overflow-wrap: anywhere;
}
.bk-form {
  display: grid;
  gap: 16px;
  margin-top: calc(24px * var(--rm-space) + 8px);
}
.bk-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.bk-label {
  font-weight: var(--rm-subheading-weight);
  overflow-wrap: anywhere;
}
.bk-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 48px;
  padding: 10px 12px;
  border: 1px solid var(--rm-muted);
  border-radius: var(--rm-radius);
  background: var(--rm-surface);
  color: var(--rm-text);
  font: inherit;
  font-size: 16px;
}
.bk-input:focus-visible {
  outline: 3px solid var(--rm-accent-text);
  outline-offset: 2px;
}
.bk-note {
  min-height: 96px;
  resize: vertical;
}
.bk-refusal {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--rm-radius);
  background: color-mix(in srgb, var(--rm-accent) 12%, var(--rm-surface));
  color: var(--rm-text);
  overflow-wrap: anywhere;
}
.bk-send {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: 12px 16px;
  border: 0;
  border-radius: var(--rm-pill);
  background: var(--rm-button);
  color: var(--rm-on-button);
  font: inherit;
  font-weight: var(--rm-subheading-weight);
  cursor: pointer;
  touch-action: manipulation;
}
.bk-send:active:not(:disabled) {
  transform: scale(0.97);
}
.bk-send:disabled {
  opacity: 0.55;
  cursor: default;
}
.bk-send:focus-visible {
  outline: 3px solid var(--rm-accent-text);
  outline-offset: 3px;
}
.bk-answer {
  margin-top: calc(28px * var(--rm-space) + 8px);
  padding: 20px 18px;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius);
  background: var(--rm-surface);
}
.bk-answer h2 {
  margin: 0;
  font-family: var(--rm-font-heading);
  font-size: calc(22px * var(--rm-type));
  font-weight: var(--rm-heading-weight);
  line-height: 1.2;
  overflow-wrap: anywhere;
}
.bk-answer h2:focus:not(:focus-visible) {
  outline: none;
}
.bk-answer p {
  margin: 8px 0 0;
  color: var(--rm-muted);
  overflow-wrap: anywhere;
}
.bk-plans {
  display: grid;
  gap: 10px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.bk-hint {
  margin: 0;
  color: var(--rm-muted);
  overflow-wrap: anywhere;
}
.bk-plan {
  display: grid;
  gap: 6px;
  min-width: 0;
}
.bk-plan-name {
  margin: 0;
  font-size: calc(16px * var(--rm-type));
  font-weight: var(--rm-subheading-weight);
  overflow-wrap: anywhere;
}
.bk-plan-frame {
  overflow-x: auto;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius);
  background: var(--rm-surface);
  overscroll-behavior-x: contain;
}
.bk-plan-box {
  position: relative;
  width: 100%;
}
.bk-spot {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 2px;
  border: 2px solid var(--rm-muted);
  border-radius: 6px;
  background: var(--rm-surface);
  color: var(--rm-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.1;
  cursor: pointer;
  touch-action: manipulation;
}
.bk-spot[data-shape='circle'],
.bk-spot[data-shape='pill'] {
  border-radius: 999px;
}
.bk-spot[data-state='taken'] {
  border-style: dashed;
  background: repeating-linear-gradient(
    135deg,
    var(--rm-surface) 0 6px,
    color-mix(in srgb, var(--rm-muted) 35%, var(--rm-surface)) 6px 8px
  );
  color: var(--rm-muted);
  cursor: default;
}
.bk-spot[data-state='picked'] {
  border-color: var(--rm-button);
  background: var(--rm-button);
  color: var(--rm-on-button);
  font-weight: var(--rm-subheading-weight);
}
.bk-spot:disabled {
  cursor: default;
}
.bk-spot:focus-visible {
  outline: 3px solid var(--rm-accent-text);
  outline-offset: 2px;
  z-index: 1;
}
.bk-spot-name {
  overflow: hidden;
  max-width: 100%;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bk-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--rm-muted);
  font-size: calc(14px * var(--rm-type));
}
.bk-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.bk-key::before {
  content: '';
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 2px solid var(--rm-muted);
  border-radius: 4px;
  background: var(--rm-surface);
}
.bk-key[data-state='taken']::before {
  border-style: dashed;
  background: repeating-linear-gradient(
    135deg,
    var(--rm-surface) 0 3px,
    color-mix(in srgb, var(--rm-muted) 35%, var(--rm-surface)) 3px 5px
  );
}
.bk-key[data-state='picked']::before {
  border-color: var(--rm-button);
  background: var(--rm-button);
}
.bk-picked {
  margin: 0;
  overflow-wrap: anywhere;
}
`
