# Menu face: breathing, photo-led layout with full item pages

## Goal
Replace the boxed, square-thumbnail layout with a spacious, food-led menu where each dish has room and a real item page opens when you tap it.

## Menu list
- Remove the small square thumbnail on the right. Image-bearing items become full-width stacked compositions: large photo (soft, wide crop, gentle rounding) on top, then bold full name, short description, price and labels below.
- Generous vertical spacing between items; no card borders or boxes. Thin separators only between text-only items.
- Text-only items stay as clean editorial rows with name, description and price aligned, so sections without photos still look intentional.
- First section keeps a horizontal photo strip with larger cards.
- The whole item (photo and text) is one obvious tap target, with a subtle "view" chevron cue.

## Item page
- Tapping an item opens a full-screen item page (not a half-height popup): full-bleed photo, floating back/close button, large name and price, full description, portion, dietary labels, allergens with names, extra details and modifier groups as large readable choice rows.
- Browser back closes it and returns to the same scroll position; the page has its own link (hash) so it can be shared.
- Still browsing only: no add, quantity, cart or payment controls.

## Unchanged
- Header, category rail with active tracking, filters, language switch, themes (light/dark), allergen legend.
- Contract rules: render only the supplied view model, full names, source order, required slot/state markers, BCP 47 language, 44 px targets, focus return, Escape, reduced motion.

## Technical details
- Changes stay inside `src/features/restro-face/` (`face.tsx`, `styles.ts`); item page is face presentation state synced to `location.hash` (`#item-<id>`) with `popstate` handling, rendered as a fixed full-viewport dialog with focus trap and scroll lock.
- Use `card`/`full` image variants via existing `srcset` helper, larger `sizes`.
- Update tests: item open via hash, back closes, full name on page, text-only rendering.
- Verify with Playwright at 320/390/430 px and desktop, BG/EN, light/dark.
