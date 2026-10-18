> Filed 2026-10-18 by the lead (session "UI/UX skills for workflows"). Made by: T92 session (Sonnet). For: T92, PR 16. Source: `t92-motion-trial-editorial-market.md`. Status: see `docs/deliverables.md`.

# T92 trial: motion audit (template-review step 4b) on Editorial Market

Run 2026-10-17 by the T92 implementer. Read-only: `packages/faces/editorial-market/src/css.ts` and `src/services/services-css.ts`, plus the TSX keys and `use-dish-route.ts` where a finding depends on them. No browser, no test run, nothing in the face changed. Overrides A1 to A12 applied (standards 1 and 10 dropped, facts only, step 7 line format). Findings marked "by the cascade" are inferred from CSS rules, not seen on a device.

```text
wrong        | A3 / template-design override row 7 (motion only in answer to a tap) | src/css.ts:942 | `.rm img` fades every image in over 0.5 s on mount, no tap involved: remove the rule so images appear at once
wrong        | STANDARDS accessibility (gate hover motion) | src/css.ts:808, 812 | `.rm-item:hover` slides the arrow 4 px and scales the photo with no `@media (hover: hover)`, so a phone sticks in hover after a tap; gate both (transitions at 802 and 820, the photo one is 0.5 s) or drop them
wrong        | STANDARDS easing (ease-out on enter and exit, never ease-in) | src/css.ts:967 | every sheet leaves on `cubic-bezier(0.7, 0, 0.84, 0)`, an ease-in curve (the entrance uses `0.16, 1, 0.3, 1`): give the exit an ease-out curve
wrong        | A3 (motion only in answer to a tap) | src/services/services-css.ts:265, 285 | the service bar and each of its buttons both run `ro-up` (the button slides up inside a bar that is already sliding), on page load and again whenever `hidden` ends after a sheet closes: keep one, or none
wrong        | STANDARDS press feedback | src/services/services-css.ts:285, 287-289 | `animation: ro-up ... both` holds `transform: none` after it ends, and an animation beats the normal rule `:active { transform: scale(0.98) }`, so the bar buttons never show a press (by the cascade)
wrong        | A5 (flag layout properties), pinned Animation "transform/opacity only" | src/services/services-css.ts:319 | the waiter button animates `padding` for 0.3 s when the bag fills: animate a transform or opacity, or let it snap
inconsistent | A5 (colour changes only on small controls), standard 7 | src/css.ts:957, 964, 979-987 | the full-screen overlay animates `background` (`rm-veil`, `rm-veil-out`): fade the opacity of a backdrop element instead
inconsistent | STANDARDS physicality and press values | src/services/services-css.ts:996 (used at 168, 342, 491, 779), 80; src/css.ts:939 | `ro-pop` starts at `scale(0.7)` (range 0.9 to 0.97); `.ro-plus:active` is 0.9 and `.rm-item:active` 0.985 (press range 0.95 to 0.98)
inconsistent | STANDARDS duration (A6: a flag, never a block) | src/css.ts:950, 935 | the jump-bar underline takes 0.32 s on a 3 px line; the item press takes 0.18 s (button press 100 to 160 ms)
inconsistent | standard 6 (rapidly triggered motion) | src/services/parts.tsx:90, src/services/bag-bar.tsx:40; services-css.ts:168, 342 | `key={value}` and `key={resolved.count}` remount the counter on every tap, so the `ro-pop` keyframe restarts from zero while the guest keeps tapping +
inconsistent | STANDARDS easing (built-in easings are too weak) | src/css.ts:957, 1077; src/services/services-css.ts:168 | enter fades and pops use the built-in `ease`; STANDARDS asks for a strong custom curve (a fix of taste, small)
inconsistent | escalation trigger `scale(0)` | src/css.ts:176 | `scaleX(0)` is the start state of the jump-bar underline, a line that grows from the left; probably fine, the designer's eye decides
extra        | (dead declaration) | src/css.ts:178 | `transition: transform 0.2s ease` on `.rm-sections a:after` is overridden by 0.32 s at 950
extra        | (dead declaration) | src/css.ts:864 | `animation: none` on `.rm-overlay-panel.is-detail` is overridden by `rm-sheet` at 960
Verdict: not clean (6 wrong, 6 inconsistent, 2 extra)
```

## The three the due diligence expected

| Expected | Result | Where |
|---|---|---|
| An image fade on load | Confirmed | css.ts:942 (`.rm img { animation: rm-fade 0.5s ease both }`) |
| Ungated hover motion | Confirmed in css.ts, refuted for services | css.ts:808, 812; services-css.ts:96 and 222 are gated with `@media (hover: hover)` (without the vendored `and (pointer: fine)`) |
| An ease-in exit curve on the sheet | Confirmed, and wider than expected | css.ts:967 applies to every `.rm-overlay-panel` leaving (bag, bill, allergens, dish page), not only the dish sheet |

## Verdict per standard (1 and 10 dropped by A7)

| Standard | Verdict |
|---|---|
| 2 Frequency (taps only, A10) | Fails for hover motion (css.ts:808, 812) and for the bar's slide on load (services-css.ts:265, 285). Taps, sheets and the counter pass. |
| 3 Easing | Fails: ease-in exit (css.ts:967); built-in `ease` on fades (note). |
| 4 Sub-300 ms, per the STANDARDS table | Sheets 0.34 to 0.38 s are inside "modals, drawers 200 to 500 ms". Flags: image fade 0.5 s (css.ts:942), photo hover 0.5 s (css.ts:820), underline 0.32 s (css.ts:950), item press 0.18 s (css.ts:935). |
| 5 Origin and physicality | No popover or dropdown in the face. `scale(0.7)` pop and press values (above). Sheets slide from the bottom edge, correct. |
| 6 Interruptibility | Sheets and bar are keyframes but not rapidly triggered: pass. The counter pop restarts on every tap (above). |
| 7 Only transform and opacity | Fails: `padding` (services-css.ts:319), full-screen `background` (css.ts:979-987). Colour transitions on small controls are allowed (A5). `ro-pulse` animates `box-shadow` on a 20 px dot: paint only, not a layout property, not flagged. |
| 8 Accessibility | Reduced motion passes: `.rm *` switches off animation, transition and smooth scroll (css.ts:767-774), with dedicated blocks at 892, 1056, 1085 and services-css.ts:1017. Hover gating fails in css.ts (above), passes in services. |
| 9 Asymmetric timing | No press-and-hold interaction in the face: not applicable. |

Escalation triggers also checked: no `transition: all` in either file; no `ease-in` keyword; no library motion.

## A12 (replay on a refreshed `view`)

Every list key in the face is a view id or a code (`section.tsx:63`, `category-rail.tsx:89`, `face.tsx:217`, …), so a refreshed `view` keeps the elements and no animation restarts. The only keys that change are the guest's own bag count and the counter value (`bag-bar.tsx:40`, `parts.tsx:90`), which follow a tap. Two replays exist that are not view-driven: `.rm img` on any remount (css.ts:942) and the service bar when `hidden` ends (services-css.ts:265, 285). Read from the sources, not run.

## Overlap with step 4's pinned Animation rules

Reduced motion, transform/opacity only, no `transition: all`, interruptibility and `transform-origin` overlap with the pinned section. In this trial step 4 was not run, so each is reported once above; in a real review a line step 4 already flagged (the padding and background findings) is reported once, under the pinned rule.

## Outside the motion audit (inferred, not verified)

`css.ts:1082` `.rm-item-open:active { transform: scale(0.98) }` gives the button a transform while pressed. A transformed element becomes the containing block of its absolutely positioned `::before` (`css.ts:789-794`, the item-wide tap area, `inset: 0`), so while the button is pressed the tap area may shrink from the whole item to the button, and the `click` might not reach the button. I did not test this; a Playwright tap on the item's blank area would settle it. For the lead to decide whether it deserves a bug ticket.
