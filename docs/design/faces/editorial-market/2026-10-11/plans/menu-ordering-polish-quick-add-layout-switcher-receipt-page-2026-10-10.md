# Menu ordering polish: quick add, layout switcher, receipt page, clearer server call

## 1. Fix the quick-add "+" button
- The "+" shows as an empty circle because a general rule recolours it to match its background. Make the "+" a proper icon in the contrasting colour so it's always visible.
- Add a clear reaction when you point at it: slight lift, accent colour, pointer cursor. Add a visible focus ring for keyboard users. Keep the press effect.
- Same treatment for the "− 1 +" counter buttons.

## 2. Choose how dishes are shown: List / 1 column / 2 columns
- Small three-option switch (icon + short label) above the first category, under the category bar.
- **2 columns (default):** photo on the stage panel, name, price and "+" below; description trimmed to 2 lines (name never trimmed).
- **1 column:** the current large photo layout.
- **List:** compact rows, small photo on the side, for fast scanning.
- Dishes without photos stay clean text rows in every mode.
- The choice is remembered during the visit; filters, scroll position and the open-dish link keep working.

## 3. Receipt as its own page
- The receipt opens as a full-screen page (like the dish page) with a back button, its own link, and the phone's back button returning to where you were.
- Laid out like a printed receipt: venue, table, date, items, VAT, tip, total, payment method, reference number, with Download PDF / Email / Print buttons at the bottom. Buttons still only show a confirmation.
- Reachable after payment and from the table order.

## 4. Clearer "call a server" and table order controls
- Replace the bell with icon + text pills in the header: **"Waiter"** (a hand-raised icon) and **"Bill · €24.00"** (receipt icon, showing the running table total).
- On narrow phones the labels stay; spacing tightens instead of hiding text.
- The call-server sheet options also get icon + text (waiter, bill, water, cutlery, card terminal, other).
- All icons come from the Lucide icon set, which covers every case (hand, receipt, glass of water, utensils, credit card, list/grid views).

## Out of scope
- Real restaurant system, payments or PDF creation — still demo behaviour.

## Technical details
- Use `lucide-react` (already installed with the template) inside `src/features/restro-face/`; no other new dependencies.
- Fix specificity: `.rm .ro-plus` rule for colour; add `:hover`, `:focus-visible`, `cursor:pointer`, `@media (hover:hover)` guard.
- View mode is face presentation state (`data-layout="list|one|two"` on `.rm`), stored in `sessionStorage` read after hydration; CSS grid per mode, contract slots unchanged.
- Receipt: new `#receipt` full-viewport page using the shared `Overlay` detail style and existing hash/popstate handling.
- Strings for new labels in EN/BG.
- Tests: default layout is two columns, switching changes layout, receipt opens via hash and back closes it, header "Waiter" button has a visible text label.
- Verify with Playwright at 320/390/430 px and desktop, BG/EN, light/dark.
