# Menu polish: rounded buttons, icon layout switch, language switch, mobile fit

## 1. Buttons follow the theme rounding
- Every pill and round control (the "+" button, the "− 1 +" counter, the waiter bubble, the order button, filters, header pills) uses the theme's corner style, so Nordic looks crisp and Botanical looks soft.
- Fix the square highlight that sticks out of the counter when you hover "+" or "−".

## 2. Layout switch with icons only
- List / 1 column / 2 columns becomes a compact three-part switch showing only icons (list, square, 2x2 grid), like standard app controls.
- The selected option is highlighted; each icon still has a hidden name for screen readers and a tooltip.

## 3. Designed language switch
- Replace the plain dropdown with a small two-part pill "BG | EN" in the top bar, the selected language highlighted.

## 4. Fits every phone size
- Top bar on one line: venue name and table on the left, language and bill on the right; at very narrow widths spacing tightens and the table label drops before anything wraps.
- 2-column cards: photo, name, price and "+" stay inside the card at 320 px; long Bulgarian names wrap instead of overflowing.
- List rows: photo is a fixed square on the right with the "+" docked on its corner; the photo no longer stretches into a tall empty box.
- The bottom waiter bubble and order bar keep side margins and the phone's safe area.
- The demo theme switcher collapses to a small button on phones so it never covers dishes.

## Technical details
- All within `src/features/restro-face/` styles and small markup changes in `face.tsx` / `ordering/ui.tsx`; menu preview switcher in `src/routes/menu.tsx`.
- Rounding via `var(--rm-radius)`-derived values; `overflow:hidden` on stepper.
- Language switch rendered as buttons from the existing `languages` prop, calling `onLanguageChange`.
- Run tests and type check; Playwright at 320/390 px and desktop.
