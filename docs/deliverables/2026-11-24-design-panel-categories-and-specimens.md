# Design panel: a list of parts, and pictures of the part alone

Spec, 11-24. **Answered:** Martin accepted all six recommendations the same day ("Yes, all six"); recorded in D159 and the decision log `2026-11-24-design-panel-decision-log.md`. Made by the lane 2 session of the 11-18 screen round (Opus), after Martin's request of 11-24.

**Martin's request (11-24), in short.** The example designer in `D:\platform` is better designed in two ways:
1. The first step is choosing a part of the design (Style ›, Brand ›, Type › …), not pills or tabs.
2. When an option cannot be shown well inside a card, the card does not draw the whole menu: it draws only the component. In the example's chart options, only the chart is drawn, not the whole passport. Seeing the part alone makes the choice simple.

**Flow.** This is new behaviour inside current decisions (`change.md`, step 2):
- D129 fixes what Simple and Advanced hold, not how the panel moves between pages.
- D130 already says a tile draws "a specimen … never the whole menu" (its ticket 8). Today's tiles fall short of that: they draw a cut-down menu with its header and section rail.

So this spec changes the panel and the tiles only. No option, value, Style or stored field changes. One point (Q2) regroups D129's General and needs Martin's yes.

---

## 1. What is wrong today

Seen in the 11-18 screen round (lane 2: S1, S2, S5) and on the Design page now:
- **Advanced opens on fourteen chips** above the open page's options. The owner reads a row of words before seeing anything. After S1 the chips wrap, which pushes the options down.
- **Every option tile is the whole guest page, shrunk to fit.** A tile is a full renderer in its own frame (`option-tiles.tsx`, `scaled-frame.tsx`), drawing the header, the rail and two sections. Three problems follow:
  - The part the option changes is a few pixels of a busy picture. Tiles for "Name size: S / M / L" look nearly alike (S2).
  - A page of tiles takes 10–40 s to draw (S5).
  - The eye has to find the change. In the example designer it is the only thing in the card.
- **Simple is one long scroll:** the Style tiles, My styles, the colours, the fonts, the logo and the layout, one under the other.

## 2. What the example does (read from `D:\platform`, read-only)

Taken from `resources/js/Components/Design/` (`DesignStudio.jsx`, `studio/registry.js`, `specimens/`):
- **The panel shows one thing at a time:** the list of categories, or one category's page.
  - A category's page has a back arrow (‹) to the list.
  - The list has one row per category: its name, a muted one-line summary of what is set (a colour dot and its hex, a font's name), and a ›.
  - Simple lists Style, Brand and Type. Advanced adds every part's category after a divider.
- **The preview and the panel follow each other.**
  - A part clicked in the preview opens its category.
  - Opening a category makes the preview show its part.
- **A specimen draws one component** with the current design and one setting swapped. The rest of the passport is not drawn.
  - It is a picture, not a control: inert, hidden from screen readers, no pointer events, nothing focusable.
  - It is drawn at a set design width and scaled down to fit, never up.
- **Preset tiles** (the Style) are the one place that shows the whole design: picking a preset changes everything.
- **Motion:** the list and a page slide 8 px and fade in over 180 ms. With reduced motion it is a 120 ms fade only.

What we take: the list and its summaries, the drill-in with ‹, the two-way link with the preview, and specimens of the part alone.

What we do not take:
- **Specimens drawn in the admin's own page.** Our renderer's CSS reads the viewport: 18 `@media` width rules and several `vw`/`dvh` sizes. A part drawn inside the admin page would be laid out at the admin's width, not a phone's. So our specimens stay in a frame laid out at the phone width (§5.3).
- **Made-up sample data.** Our specimens keep the venue's own dishes, as today (§5.2).

---

## 3. The panel: a list of parts

### 3.1 Simple

The panel opens on a list:

| Row (en / bg) | Summary line (example) | Opens |
|---|---|---|
| Style › / Стил › | `Club` · or `Club, changed` / `Club, променен` when an option differs from the Style's | the Style tiles and My styles (as today) |
| Colours and logo › / Цветове и лого › | three colour dots, then `Logo` / `Лого` or `No logo` / `Без лого` | the three colours with their help and suggestions, then the logo (as today) |
| Fonts › / Шрифтове › | `Inter · Playfair Display` (body · headings), each name drawn in its font | the two font pickers (as today) |
| Layout › / Подредба › | `List · guests can switch` / `Списък · гостите могат да сменят` | the layout for all menus and the guest switch (as today) |

Q1 asks whether Colours and Logo share a row.

### 3.2 Advanced

Simple's first three rows on top: Style, Colours and logo, Fonts. Layout is not repeated: in Advanced its two options sit on the Items page, where the contract puts them (today's behaviour). Then a divider titled "Parts of the menu" / "Части на менюто", with one row per page of D130, in the contract's order:
- General
- Header
- Navigation
- Sections
- Items
- Photos
- Labels and allergens
- Dish page
- Sheets and footer
- Call a waiter
- Bill
- Order
- Pay
- Receipt

The names and their order come from the contract file, as today: a page added there is a row here with no code of ours.

General holds the rest of its options: Screen, Heading weight, Corners, Depth, Density, Text size, Buttons. Style, colours and fonts are not repeated under it. Q2 asks for this.

**A row's summary line** is the value words of its page's first two options, joined by " · ", in the panel's language:
- Header: `Page colour · Stacked` / `Цвят на страницата · Една под друга`
- Items: `Rows · Medium` / `Редове · Среден`
- Photos: `Landscape 4:3 · Fill the frame` / `Хоризонтална 4:3 · Запълва рамката`

It is worked out from the contract, so no page needs code of its own.

### 3.3 Moving through it

- **Opening a row.** A tap on a row replaces the list with that page. The page's title sits next to a ‹ back button, which returns to the list with that row focused.
  - The pane slides 8 px and fades in over 180 ms. With reduced motion there is no motion at all (`operational-screens.md` → Reduced motion: "off, never gentler"; the example designer's 120 ms fade is not taken).
  - Keyboard: the page's title takes focus when it opens.
- **The address remembers the open part** (`?part=items`).
  - The browser's Back and a phone's back gesture return to the list, not out of the Design page.
  - A reload, or a link to the Design page, opens the same part.
  - The leave warning for unsaved changes (T88) still guards leaving the page itself.
- **A tap on a part in the preview** opens its row's page (in Advanced; today's `pageOfTap`). In Simple, the "Styled in Advanced" note stays as it is.
- **Opening a page makes the preview show its part:**
  - Header and Navigation: the top.
  - Items, Photos, Labels: the first dish.
  - Dish page: a dish, open.
  - Call a waiter, Bill, Order, Pay, Receipt, Sheets: their sheet, open.

  This uses each page's existing stage and focus (`tilePlanOf`). Back to the list returns the preview to the menu's top, closing what it opened, without a history step (as #470's S10 fix does for the Dish page).
- **Switching Simple ↔ Advanced** keeps the open row when the other level has it (Style, Colours and logo, Fonts). Simple's Layout opens Items in Advanced, and Items opens Layout in Simple. Otherwise it returns to the list.
- **Undo, Unsaved, Cancel, Done** stay in the bar under the preview, whatever is open.

---

## 4. Phone (under 768 px)

- The list and the pages fill the panel at full width, with the ‹ back button on top. The preview stays docked at the foot of the screen, as re-verified in S3. Q4 offers the example's alternative.
- Rows are at least 44 px tall (D107). A row's summary is one line, cut with an ellipsis. The full text is the row's accessible name.
- Nothing scrolls sideways at 320 px. The chip row is gone, so S1's wrap rule goes with it.

---

## 5. The option pictures: the part alone

### 5.1 What each option's tile draws

Every tile draws **only the part named below**, with the draft's colours, fonts and other values, and this tile's value swapped in. Nothing else of the guest page is drawn: no header unless the part is the header, no rail, no other sections.

| Page | Option(s) | The tile draws |
|---|---|---|
| General | Style | **The top of the whole menu**, as today: a Style changes everything (Q3) |
| General | Colours, Body font, Heading font | no tiles: colour fields and font pickers, as today |
| General | Screen | a slice of the menu: one section title and two dish rows, on the screen's own background |
| General | Heading weight | one section title and one dish name |
| General | Corners, Depth | one dish as a card, with its photo and its Add button |
| General | Density | three dish rows (spacing only shows between several) |
| General | Text size | one dish row with its description |
| General | Buttons | the foot of the Call a waiter sheet with its main button |
| Header | Band, Arrangement, Title size, Logo size | the header alone (logo, venue name, its tools) |
| Navigation | Marker | the section rail alone, four sections, the first marked |
| Navigation | Band | the header and the rail under it (the band is how the two meet) |
| Sections | Header, Title size, Title case | one section title with the first dish row under it |
| Sections | Strip card size | one strip of section cards |
| Items | Frame | two dishes |
| Items | Name size, Name weight, Name case | one dish row |
| Items | Price place, Portion place | one dish row with a portion |
| Items | Description lines | one dish row with a long description |
| Items | Layout | four dishes (two columns need four) |
| Items | Guest switch | the layout switch above a section title and two dishes |
| Photos | Shape, Fit, Backdrop, Frame, Corners | one dish with its photo (the demo photo's proportions differ from every shape, so Fit shows) |
| Labels and allergens | Labels | one dish with three labels |
| Labels and allergens | Allergens | one dish with its allergens, and the footer line that explains them |
| Dish page | Kind, Photo | a dish, open: a sheet over the menu, or its own page |
| Sheets and footer | Sheets | the Call a waiter sheet, open |
| Call a waiter | Kinds | the sheet's kinds |
| Bill | Rows, Lines | three bill lines and the total |
| Order | Add control | one dish row with its Add control |
| Order | Order bar | the foot of the screen with the order bar, over two dish rows |
| Order | Line photos | two lines of the open bag |
| Pay | Tip | the tip choice |
| Receipt | Venue block | the receipt's top |

### 5.2 What the dishes are

- The venue's own dishes, cut down as today (`specimen.ts`). Where the venue has none of a part, it is dressed with demo content: the demo photo, a sample description, a portion, a few labels.
- Demo content is never a price, never saved and never published.
- The owner recognises their own menu in every tile.
- One dish is used throughout a page, the same one in every tile, so the only thing that changes from tile to tile is the value.

### 5.3 How a tile is drawn

- **Still the real renderer in a frame laid out at 320 px**, the narrowest phone the renderer holds for. Its width rules and phone sizes then hold exactly as on a guest's phone.
- **The frame draws only the part.** The face gets a specimen view in its `preview/` folder: it draws one part (`Header`, the rail, `SectionBlock`, `Item`, a sheet's body) with the face's own CSS and nothing around it.
  - The admin imports it through `@restro/editorial-market/preview`, which the guest page never imports (an import rule already enforced).
  - The frame's height fits the part, so a tile of one dish row is short.
- **Size in the panel:**
  - A short part (at most 160 px tall at 320 px: a dish row, the header, the rail, a section title) gets a tile the panel's full width, one per line, drawn at 1:1, never scaled up.
  - A tall part (a sheet, an open dish, four dishes in two columns) gets two tiles a line, scaled down, never below half size.
- **Speed.**
  - The specimen frame loads no services host unless its part is a sheet. It draws no menu around the part.
  - Targets, checked on the pilot PC with the walk's seed:
    - the first tile of an opened page is drawn within 1 s;
    - every tile in view within 3 s;
    - a value picked shows in the preview within 300 ms.
  - Tiles out of view load as they come near, as today.
- **A tile is a picture:** inert, `aria-hidden`, refuses focus and pointer events, sticky parts drawn static. The radio and the value word under it are the control, as today.

### 5.4 Style tiles

Unchanged: a Style tile draws the top of the whole menu with that Style's values and the draft's colours. The Style tile that is already chosen draws the design as it stands now, edits included. Q3 asks for this.

---

## 6. Screen plan (`ship.md` §1, D123)

**Stories and taps** (today's taps from `docs/guides/admin-map.md`):

| Story | Today | Target |
|---|---|---|
| As an owner I want to pick a Style, so that my menu looks finished at once | 3 (Design, the tile, Done) | 4 (Design, Style ›, the tile, Done) |
| As an owner I want to change a colour, so that the menu is in my brand | 3 plus typing | 4 plus typing (Colours and logo ›) |
| As an owner I want to change one option of a part (the bill's rows), so that it reads my way | 5 (Design, Advanced, the page chip, the option, Done) | 5 (Design, Advanced, Bill ›, the option, Done) |
| As an owner I want to change a part I see in the preview | 4 (Design, Advanced, the part, the option, Done) | same |
| As an owner I want to compare the values of an option, so that I choose by looking | tiles of the whole menu, 10–40 s | tiles of the part alone, in view within 3 s |

Simple costs one tap more (the row). The trade is a first screen with four rows to read instead of a long scroll. Q5 asks Martin to accept it.

- **Place:** Studio › Design, `/venues/{venue}/design` (unchanged), with `?part=<id>` for the open part.
- **Pattern** (`operational-screens.md` → Patterns):
  - "The Design page" row: the draft, Undo, Done, Cancel (unchanged).
  - Picking a value: radio cards with a picture, as today.
  - The list of parts has no row in the patterns table. It is the drill-in list of the example designer. Q6: add it as a pattern row, "Many groups of settings: a list of rows, each with a one-line summary and ›; the group opens in place with ‹ back".
- **Primary action:** Done (unchanged). Inside a part, the radio cards.
- **States:**
  - **Loading:** the list shows at once from the draft. A tile shows its quiet placeholder ("Зареждане…") until drawn (S5's fix).
  - **Failed:** a tile that cannot draw keeps its value word and radio. The value can always be picked.
  - **Empty:** a venue without dishes or photos gets the demo content (§5.2).
  - **Longest Bulgarian text:**
    - "Повикване на сервитьор ›" with its summary at 320 px: the title on one line, the summary cut with an ellipsis.
    - "Страница на артикула" as a page title beside ‹.
  - **Many items:** not affected. Specimens cut the menu down.
  - **A role that may not edit:** the list and every page open read-only. The tiles are drawn and the radios are off (today's C8 rule).
  - **A POS venue:** no difference. Design is ours on every venue.
- **Strings, bg and en:**
  - The rows (§3.1) and the Advanced divider "Части на менюто" / "Parts of the menu".
  - The back button "Назад" / "Back", with the accessible name "Назад към всички части" / "Back to all parts".
  - The summary words "променен" / "changed", "Лого" / "Logo", "Без лого" / "No logo".
  - The layout summary "Списък · гостите могат да сменят" / "List · guests can switch".
  - Page names and value words come from the contract, as today.

---

## 7. How it is built

One PR into `sr/foundation`, on the Design page as merged from #470. Two parts, reviewed apart:
1. **The panel** (`apps/web/src/design`: `design-page.tsx`, `advanced-panel.tsx`, a new list component; `?part=` in the page's address).
   - Built with shadcn and D107: calm, one accent, 44 px targets.
   - Reviews: code-review high, security-review, pr-review-toolkit.
2. **The specimens** (the face's `preview/` folder, plus the tile frame in `apps/web/src/design`). The face changes, so this part goes through the template flow with template-review on another model (D105, D69).
   - Guest pages are untouched: the specimen view is reachable only through `/preview`.
   - The face's rendering snapshots (`__renderings__`) must not change.

Tests:
- the list and its summaries from the contract (a page added to the contract is a row);
- `?part=` and Back;
- each option's specimen draws its part and not the header or rail (Items › Name size draws no `header` marker);
- the speed targets in one e2e on the walk seed.

The build also updates `docs/guides/admin-map.md` (the Design row and its tap counts).

Walk at the end, at 320 and 390 px and on a PC width, in Bulgarian:
- Simple's four rows;
- Advanced › Items › Name size;
- Bill › Rows;
- a preview tap opening its row;
- Back.

---

## 8. Questions for Martin

Each with a recommendation. **Martin 11-24: "Yes, all six"**, so every recommendation below is decided (D159).

**Q1. Colours and the logo: one row or two?**
You open Design on Club Biad. The list shows "Style › Club", "Colours and logo › ● ● ● Logo", "Fonts › Inter · Playfair Display", "Layout › List".
- The example designer calls this row Brand: colours and logo together.
- Two rows ("Colours ›", "Logo ›") make five rows in Simple.

*Recommendation: one row, "Colours and logo", because the logo and the brand colour are chosen together.*

**Q2. In Advanced, do Style, colours and fonts move out of General?**
You switch to Advanced and see Style, Colours and logo and Fonts, then "Parts of the menu", then "General › Auto · Soft corners". D129 puts the Style, colours and fonts inside General.
- If they stay inside General, Advanced repeats them: the three rows on top, and again inside General. Or General becomes an eleven-option scroll.
- Taking them out leaves General with seven options: Screen, Heading weight, Corners, Depth, Density, Text size, Buttons.

*Recommendation: take them out, as the example does. D129's "General" then means these seven. The lead records it as a new decision refining D129 (the next free number).*

**Q3. Style tiles: whole menu or a slice?**
You open Style ›. Five tiles, Basic to Club.
- A Style changes the header, the rail, the dishes and the sheets together, so only the whole top of the menu shows what you would get.

*Recommendation: keep the whole top of the menu for the Style tiles only. Every other tile draws the part alone.*

**Q4. On a phone, where is the preview?**
You open Items › Name size on your phone (390 px).
- Today the preview is docked at the foot (S3). The list or the page sits above it, and you see the change at once.
- The example puts the preview behind a "Preview" button, in a sheet. The tiles get the whole screen, but each look at the result takes a tap.

*Recommendation: keep the dock. The tiles now show the part alone, so they are readable in the space above it.*

**Q5. Simple costs one tap more.**
Picking a Style goes from 3 taps to 4 (Design, Style ›, the tile, Done).
- In exchange, the first screen is four rows with their current values instead of a long scroll.

*Recommendation: accept it. It is what you asked for in point 1.*

**Q6. The list as a pattern for other screens.**
A future Settings page with eight groups of settings would use the same list: rows with a summary, ›, and ‹ back.

*Recommendation: yes. The pattern row is added to `operational-screens.md` with this PR, so the next screen with many groups uses it too.*

---

## 9. Out of scope

- Any new option, value or Style, or a change to D130's list.
- The face's look on the guest page.
- The colour fields and the font pickers themselves: they move behind their rows unchanged.
- My styles (unchanged, under the Style tiles).
