# Restaurant menu face: editorial market direction

## Visual direction
- Create an original restaurant/café menu face inspired by the supplied Honest Greens screens’ strongest principles: confident typography, food isolated on calm image fields, a compact horizontal category rail, generous whitespace and selective high-energy accents.
- Avoid delivery-app conventions: no repeated “Add” controls, cart bar, quantity steppers or dense marketplace cards. This phase is presentation only.
- Use an editorial mix rather than one repeated card: a compact venue header, an initial horizontal feature strip, large photo-led items and refined text-only rows. Preserve one clear reading order without copying Honest Greens’ branding or exact composition.
- Let venue themes meaningfully change the atmosphere through the supplied semantic colours, typeface, radius, shadow and logo. Support both light and dark schemes without face-specific colour values.

## Menu experience
- Build a phone-first opening with venue identity, menu title, language and table context; keep the food visible immediately rather than making a marketing landing page.
- Add a sticky, horizontally scrollable category rail with a fine active underline and direct jumps through large menus, closely reflecting the useful behaviour in the supplied screens.
- Present dietary/tag filters in a focused dark overlay above the menu, with a clear close action and immediate selected states. Only the safe filter semantics supplied by the shell are used; allergens remain information, not a safety filter.
- Give each section a strong editorial heading and optional image/description, followed by readable item compositions that keep full names, descriptions, portions, prices and states aligned.
- Open a focused item-detail layer from a menu item, echoing the supplied product view: generous food image, complete name and price, description, state, dietary labels, allergens, extra fields and modifiers. It remains informational—no Add to bag, quantity or payment controls.
- Reveal dense item information without turning every item into a boxed card; use subtle separators and occasional image surfaces rather than a stack of identical cards.
- Use inline allergen codes with an accessible bottom sheet and a complete menu legend. Keep sold-out, unavailable and scheduled items legible without shifting the layout.

## Integration-ready deliverable
- Keep the new face isolated from the existing passport renderer and expose it through a separate preview page.
- Build the face as a self-contained React 19 source folder with only React, plain CSS and inline SVG: component, manifest, copied view-model types, theme-variable helper and `guest-strings.ts`.
- Render only the supplied view model. Do not fetch, translate, sort, format prices, compute colours or interpret availability inside the face.
- Include the required `data-item`, `data-slot` and `data-state` markers; stable ID keys; static first-render content; BCP 47 language attributes; responsive image `srcset`; and preserved UI state when the view model refreshes.
- Declare QR only, browsing only, inline allergen codes, text-only fallback for missing images and no paging. Keep the component boundary ready for the Restro team to replace local copied types and strings with their real packages.
- Use the supplied Bulgarian and English view models unchanged in a small preview harness. The raw snapshot remains reference data only and never reaches the face.

## Assets and reference material
- Use the supplied `shell-handoff-images.zip` package and preserve its `/a/<asset id>/w320|w640|w1280.webp` structure behind the preview’s `assetBase`; do not invent images or alter menu content.
- Keep the required text-only layout complete for records that have no photo.
- Use Honest Greens only as design research—not its name, logo, copy, illustrations or exact page composition.

## Verification and handoff
- Cover the handoff’s key edge cases: long Cyrillic names, no images, sold-out/scheduled states, nested sections, modifiers, filters, language fallback and a large menu.
- Verify 320, 360, 390 and 430 px widths, plus a centred desktop preview; light/dark and Bulgarian/English; keyboard focus, Escape/return-focus for sheets, 44 px tap targets and reduced motion.
- Produce the requested screenshot set at 390 px for both languages and schemes, plus the 320 px long-name stress case.
- Add focused contract tests for item order, required slots, full names, language attributes, allergens and state markers, then update the project roadmap and architecture notes.
