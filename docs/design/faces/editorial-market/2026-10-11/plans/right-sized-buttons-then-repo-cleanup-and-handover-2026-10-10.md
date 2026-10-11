# Right-sized buttons, then repo cleanup and handover

## 1. Buttons sized to the screen and the text (first)
The "+", the "− 1 +" counter, the waiter bubble and "View your order" are currently fixed large sizes, so on a phone they look heavy next to the dish names and prices.

- **"+" on dish cards:** smaller, lighter square/round button (about 34–36 px visible) next to the price on one line, not on its own row; the touch area stays 44 px with invisible padding so it's still easy to tap.
- **"− 1 +" counter:** matches the new "+" height, slimmer numbers and icons.
- **Waiter bubble and "View your order" bar:** slimmer (about 48 px tall instead of 58), smaller icons and text that match the menu's text size, tighter side padding.
- **Sizes follow the screen:** buttons and icons scale gently between small phones (320 px) and tablets, instead of one fixed size for all.
- **2-column cards:** price and "+" share one line at every phone width; the description sits under them.
- Same treatment for header pills (Bill, BG | EN) and the dish-page "Add to bag" bar so everything feels like one family.

## 2. Remove all product-passport work
- Delete the passport pages, passport data files, passport documents and images, passport components and their tests.
- The menu becomes the start page of the app.
- Remove passport rules from the project notes; keep only menu/ordering rules.
- Remove anything only the passports used (e.g. chart library), if nothing else needs it.

## 3. Write handover.md
A complete list for your platform team covering:
- **What the menu draws itself:** layouts (list / 1 / 2 columns), dish page, filters, allergens, themes, motion, bag, table order, waiter call, payment screens, receipt page, language switch.
- **What must come from the platform:** menu content and translations, prices and formatting, images, theme colours and rounding, table and venue info, VAT rate, dish choices, order sending, table order status, waiter calls, payment, receipt data/PDF/email/print.
- **Each connection point:** what data goes in, which actions come back out, and what happens if it's missing.
- **Rules the menu guarantees:** accessibility, full dish names, order of items, required markers, 44 px touch areas, reduced motion.
- **What's demo-only today** and open questions to decide together.

## Technical details
- Sizes via CSS `clamp()` tokens in `ORDER_CSS` (`--ro-btn`, `--ro-bar`, `--ro-icon`), 44 px hit area via pseudo-element; Lucide icons 16–18 px.
- Delete `src/routes/passports.$slug.tsx`, `src/components/passport-*`, `src/lib/passports.ts`, `src/data/*.json`, `public/documents`, `public/images`, passport parts of `src/test/app-routing.test.tsx`; `/` renders the menu preview; update AGENTS.md, roadmap.md, README.
- Run tests and type check; Playwright at 320/360/390/430 px and 797 px.
