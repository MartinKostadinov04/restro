# Menu face: colour roles, venue themes and smooth motion

## Goal
Give every venue a designed look made from a small set of colours, each with a fixed job, so one template can switch between very different themes and still look good. At the same time, make the menu feel smooth instead of snapping.

## 1. Colour roles (60-30-10)
Each theme fills nine roles. Every part of the menu uses one role, never a raw colour.

| Role | Share | Used for |
|---|---|---|
| Canvas | ~60% | page background, item page background |
| Stage | ~30% | soft panel behind dish photos, header bar, filter sheet |
| Ink | text | names, prices, headings |
| Muted ink | text | descriptions, portion, allergen names |
| Accent | ~10% | "New" badges, active category underline, selected filters |
| On-accent | text | text on accent badges |
| Accent ink | text | state messages ("Sold out"), links, focus ring |
| Line | detail | separators, outlined chips, allergen boxes |
| Inverse | detail | header bar, footer, filter sheet (dark band) |

Rules: accent appears only on small, important things; the dish photo always sits on Stage; text contrast is always readable (checked automatically).

## 2. Venue themes
Four ready-made themes, each with light and dark versions:
- **Botanical** (daytime cafe / healthy bowls): warm linen canvas, sand stage, deep green ink, bright citrus accent.
- **Midnight** (cocktail bar / club): near-black canvas, graphite stage, warm ivory ink, amber accent.
- **Nordic** (minimal bistro): cool white canvas, pale grey stage, charcoal ink, cobalt accent.
- **Terracotta** (trattoria / grill): cream canvas, clay-tinted stage, espresso ink, tomato red accent.

The theme comes with the menu data from the restaurant system, so the menu never decides colours itself. For the preview, a small switcher on `/menu` lets you try each theme in light and dark.

## 3. Smooth movement
- Dish page slides up from the bottom with a soft fade behind it; going back slides it down.
- Light press feedback when tapping a dish.
- Category underline glides between sections.
- Photos fade in when loaded.
- All movement is turned off for people who ask their phone for reduced motion.

## 4. Dish page polish
- Dish photo rests on the Stage panel with breathing room, not cut edge-to-edge.
- Back button top-left and allergen info button top-right, both floating clear of the food.
- Bold uppercase name with price directly under it, relaxed description, one tidy allergen line, outlined dietary chips.
- A slim bar at the bottom showing the price (no ordering buttons).

## 5. Menu list polish
- Dish photos sit on the Stage panel too, so the list and dish page match.
- Uppercase names, badges as accent pills on the photo.

## Out of scope
Ordering, basket, payment, quantity controls.

## Technical details
- Roles map to existing semantic variables (`background, surface, text, muted, accent, onAccent, accentText, border`) plus a derived inverse; no contract change. Presets live as JSON theme fixtures under `src/features/restro-face/fixtures/themes/`; the preview route merges the chosen preset into `view.theme` (shell-side), the face only reads it.
- Motion: CSS keyframes for enter; exit handled by a short `closing` state before unmount; `transform`/`opacity` only.
- Tests: each preset meets 4.5:1 for ink/canvas, muted/canvas, on-accent/accent; dish page open/close via hash still works.
- Verify with Playwright: 4 themes x light/dark, 320/390/430 px and desktop, BG/EN.
