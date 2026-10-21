# Menu responsiveness: remaining fixes (phone first, then tablet)

## 1. Right edge: no stray line, no extra scroll bar
- The page currently shows a second scroll area and a thin line along the right edge, with the "+" poking past the photo. Fix it so the menu has one scroll (the phone's own), and nothing sits outside the screen.
- The "+" stays inside the photo corner (no negative offset); photos keep their side margin.
- Check at 320, 360, 390 and 430 px that the page is exactly screen-wide (the 6 px overflow at 320 px is fixed too).

## 2. View switch: smaller and under the section title
- About 20% smaller (icon buttons around 36x30, icons 15 px).
- Placed directly under the first main-menu section title (below the top picks), aligned to the left with the title.

## 3. List view rows
- Fixed square photo on the right, "+" and counter docked inside its bottom corner; "New" tag small on its top corner.
- Long names, several tags or choice lines never collide with the photo or the "+".
- Dishes without a photo show the "+" at the end of the price line.

## 4. 2-column cards
- 360–430 px: tight gap, 4:3 photo, readable title size; price and "+" on one line under the name, never overlapping.
- Under 360 px: smaller padding and title so long Bulgarian names wrap cleanly.

## 5. Top bar on small phones
- Venue name keeps its space and never breaks into three lines; the bill pill shows icon + amount only under 390 px; table label hides first under 350 px.

## 6. Bottom bar clearance
- Enough space at the end of the menu and before the footer so the waiter bubble and order bar never cover a dish, including the phone's safe area.

## 7. Tablet (641–1024 px)
- Menu widens to about 820 px instead of a 680 px phone strip; 2 columns get more breathing room, top picks cards scale accordingly.
- Demo theme switcher moves to a small bottom-left button so it never covers dishes on any size.

## Technical details
- Changes in `src/features/restro-face/styles.ts`, the layout block in `ordering/ui.tsx` ORDER_CSS, the switcher placement in `face.tsx` (rendered inside the second top-level section head), and the preview control in `src/routes/menu.tsx`.
- Investigate the right-edge scroll first: likely `.rm` / overlay or `overflow-x:clip` producing an inner scroller plus `.ro-quick` right:-4px; replace absolute pixel offsets with positioning relative to the photo box.
- Verify: tests + type check; Playwright at 320/360/390/430/797 px in all three views, BG/EN, light/dark, asserting `scrollWidth === clientWidth` and no element past the viewport edge.
