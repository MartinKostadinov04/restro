# Interaction polish for a guest face

The recipes D109 admits, in plain CSS. `xx` stands for your face's prefix (Editorial Market's is `rm`), and `.xx` for its root element. Where a line here differs from `restro-overrides.md` or the guide's §7.5, **those win**. Each recipe ends with the check the reviewer runs (`template-review` steps 4b and 4c); write it so the check passes.

## Tokens on the face root

Every curve and every duration lives here, once; the rest of the CSS writes `var(--xx-…)`. A `cubic-bezier(` or a time literal (`160ms`, `0.2s`) anywhere else is a finding.

```css
.xx {
  --xx-ease-out: cubic-bezier(0.23, 1, 0.32, 1);       /* enter, exit, press, fade */
  --xx-ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);   /* something that moves while it stays in view */
  --xx-ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);    /* a sheet or the dish page */
  --xx-dur-press: 140ms;
  --xx-dur-sheet-in: 280ms;
  --xx-dur-sheet-out: 220ms;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
```

| Motion | Duration | Curve |
|---|---|---|
| Press feedback, a colour change on a small control | 100 to 160 ms | `--xx-ease-out` |
| A small popover | 125 to 200 ms | `--xx-ease-out` |
| A dropdown | 150 to 250 ms | `--xx-ease-out` |
| A sheet, the dish page, a dialog | 200 to 500 ms (over 300 is flagged, never blocked) | `--xx-ease-drawer` or `--xx-ease-out` |
| The host's answer to a command (once, override row 7) | 350 ms at most | `--xx-ease-out` |

Name only the tokens you use. The touch lines remove the tap delay and the grey flash, so every tappable then needs its pressed state.
*Check:* the root rule holds both touch lines; every curve and time in the CSS is a `var(--xx-…)`.

## Press

```css
.xx-chip { transition: transform var(--xx-dur-press) var(--xx-ease-out); }
.xx-chip:active { transform: scale(0.97); }              /* 0.95 to 0.98 */
@media (prefers-reduced-motion: reduce) {
  .xx-chip { transition: none; }
  .xx-chip:active { transform: none; background-color: var(--xx-accent); color: var(--xx-on-accent); }
}
```

Under reduced motion the pressed state is a colour change on a named pair (§5.4), instant.
*Check:* every tappable (`button`, `a`, `[role="button"]`, a card that opens) has an `:active` rule; the reduced-motion block keeps a pressed state without `transform`.

## Sheet and dish page

Enters and leaves on the same edge, in `translateY(%)`, exit no longer than enter. Scale-in starts at `scale(0.96)` or more, never `scale(0)`.

```css
.xx-sheet {
  transform: translateY(100%);
  transition: transform var(--xx-dur-sheet-out) var(--xx-ease-drawer);
}
.xx-sheet[data-state="open"] {
  transform: translateY(0);
  transition-duration: var(--xx-dur-sheet-in);
}
@media (prefers-reduced-motion: reduce) { .xx-sheet { transition: none; } }
```

A transition on a state attribute, not a keyframe on an `is-leaving` class: a tap during the exit reverses it from where it is. The component mounts the panel closed and sets `data-state="open"` in a `requestAnimationFrame` from an effect; on close it sets `closed` and unmounts on the panel's `transitionend` (`event.target === event.currentTarget`, `propertyName === 'transform'`). Under reduced motion no `transitionend` fires, so close at once when `matchMedia('(prefers-reduced-motion: reduce)').matches`. The open state lives in the component, so a refreshed `view` replays nothing.
*Check:* the closed rule names one edge for both directions; out duration ≤ in duration; no `setTimeout` beside the leaving state.

## Sideways row

```css
.xx-row { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain; }
.xx-row > * { flex: none; scroll-snap-align: start; }
```

The browser scrolls the row; give it `tabindex="0"` and a name (`aria-label` from the section's name) when nothing inside is focusable, so a keyboard can scroll it too.
*Check:* no `pointermove`, `touchmove` or drag handler and no `touch-action: none` on the row.

## Selection

`user-select: none` on controls only (chips, jump links, the layout and language switches, close and quantity buttons). Names, prices, descriptions and allergens stay selectable.
*Check:* every `user-select: none` sits on a control selector.

## Translucent bars

Every `backdrop-filter` sits on a solid fill and switches on only where it is supported:

```css
.xx-bar { background-color: var(--xx-text); color: var(--xx-bg); }
@supports (backdrop-filter: blur(1px)) {
  .xx-bar { background-color: color-mix(in oklch, var(--xx-text) 92%, transparent); backdrop-filter: blur(12px); }
}
```

*Check:* each `backdrop-filter` is inside such an `@supports` block with a solid fill outside it; it is never transitioned.

## Words for a brief and the Motion roles table

- **Allowed:** press, fade, slide-in sheet, scale-in.
- **Forbidden:** stagger, parallax, scroll reveal, typewriter, ticker, marquee, pulse, float, shimmer, bounce.

A brief or a design plan that asks for a forbidden word is a question to the lead.
