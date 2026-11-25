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
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius);
  background: var(--rm-surface);
  color: var(--rm-text);
  font: inherit;
  font-size: 16px;
}
.bk-input:focus-visible {
  outline: 2px solid var(--rm-accent);
  outline-offset: 2px;
}
.bk-note {
  min-height: 96px;
  resize: vertical;
}
.bk-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
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
.bk-send:disabled {
  opacity: 0.55;
  cursor: default;
}
.bk-send:focus-visible {
  outline: 2px solid var(--rm-accent);
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
.bk-answer p {
  margin: 8px 0 0;
  color: var(--rm-muted);
  overflow-wrap: anywhere;
}
@media (max-width: 360px) {
  .bk-pair {
    grid-template-columns: minmax(0, 1fr);
  }
}
`
