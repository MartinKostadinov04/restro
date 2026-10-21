# Menu face visual refinement

## Goal
Raise the current `/menu` experience to the quality of the supplied references while keeping it original, browsing-only, bilingual, theme-aware, and compatible with the existing shell contract.

## Opening and navigation
- Replace the oversized generic opening with a compact venue bar and tighter menu introduction so food appears sooner.
- Refine the sticky category rail with stronger typography, balanced spacing, reliable active-section tracking, and automatic visibility of the active category while scrolling.
- Preserve direct section jumps and full Cyrillic labels at narrow phone widths.

## Menu presentation
- Rebalance the first section into a stronger photo-led feature strip, with cleaner image crops, larger product names, and more intentional price/badge placement.
- Give standard items a more polished editorial rhythm: confident full names, restrained descriptions, clear prices, subtle separators, and better image-to-copy proportions.
- Keep text-only items complete and attractive rather than leaving image-shaped gaps.
- Improve badge, dietary, state, portion, and allergen styling so information remains easy to scan without resembling a delivery marketplace.

## Detail, filters, and modifiers
- Redesign item details as a polished bottom sheet with a dominant food image, floating close control, stronger title/price hierarchy, and clearly grouped dietary, allergen, extra-field, and state information.
- Present modifier groups as large readable choice-style rows inspired by the supplied customization reference, without adding selection or ordering behaviour the resolved view model does not support.
- Refine the filter sheet into the focused dark treatment shown in the references, with clearer selected states and filter-reset behaviour.
- Keep ordering, cart, payment, quantity, and “Add to bag” controls out of scope.

## Accessibility and contract accuracy
- Add robust dialog focus containment, Escape handling, scroll locking, and return focus to the control that opened each sheet.
- Keep 44 px targets, reduced-motion support, BCP 47 language attributes, full untruncated item names, source ordering, required slots, and state markers.
- Continue rendering only the resolved view model; do not fetch, translate, format prices, reinterpret availability, or introduce business logic.
- Preserve all theme colours and visual parameters through the existing shell-supplied semantic variables.

## Technical details
- Keep the self-contained `restro-face` package and shared renderer boundary unchanged.
- Extend the face only with presentation state needed for active navigation and accessible sheets.
- Update the scoped face CSS rather than the passport design system.
- Add focused tests for active navigation, nested source order, dialog focus/close behaviour, full names, modifier rendering, and text-only items.

## Verification
- Compare the finished experience directly against the supplied opening, scrolling-menu, filter, product-detail, and customization screenshots.
- Verify Bulgarian and English, light and dark schemes, 320/360/390/430 px phone widths, and the centred desktop view.
- Exercise category scrolling, item opening, filters where available, allergen details, keyboard navigation, Escape, return focus, and long-name/text-only cases.
