// The stylesheet of a guest's own link to his booking (#579), added after BOOKING_CSS on the booking
// page only (booking.tsx). Its own `bk-` classes, each in a rule of its own, so neither the menu's
// stored renderings nor the booking form's rules move for it.
//
// No colour of its own (R13): every colour is a theme variable (`--rm-*`), a `color-mix()` of them,
// `currentColor` or `transparent`. Every control is at least 44 px high; the facts are one column
// that wraps inside a 390 px screen.

export const BOOKING_LINK_CSS = `
.bk-facts {
  display: grid;
  gap: 12px;
  margin: calc(24px * var(--rm-space) + 8px) 0 0;
  padding: 18px;
  border: 1px solid var(--rm-border);
  border-radius: var(--rm-radius);
  background: var(--rm-surface);
}
.bk-fact {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.bk-fact-label {
  margin: 0;
  color: var(--rm-muted);
  font-size: calc(14px * var(--rm-type));
  overflow-wrap: anywhere;
}
.bk-fact-value {
  margin: 0;
  font-weight: var(--rm-subheading-weight);
  overflow-wrap: anywhere;
}
.bk-link-note {
  margin: 16px 0 0;
  color: var(--rm-muted);
  overflow-wrap: anywhere;
}
.bk-link-actions {
  display: grid;
  gap: 12px;
  margin-top: 20px;
}
.bk-ask {
  margin: 0;
  overflow-wrap: anywhere;
}
.bk-quiet {
  box-sizing: border-box;
  width: 100%;
  min-height: 52px;
  padding: 12px 16px;
  border: 1px solid var(--rm-muted);
  border-radius: var(--rm-pill);
  background: transparent;
  color: var(--rm-text);
  font: inherit;
  font-weight: var(--rm-subheading-weight);
  cursor: pointer;
  touch-action: manipulation;
}
.bk-quiet:disabled {
  opacity: 0.55;
  cursor: default;
}
.bk-quiet:focus-visible {
  outline: 3px solid var(--rm-accent-text);
  outline-offset: 3px;
}
`
