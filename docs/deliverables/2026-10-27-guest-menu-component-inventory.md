# The guest page by component: what could vary, and the options worth offering

Made by: design-research subagent (Opus) for the menu designer grilling, 2026-10-27. Facts from the code and the functionality file; the options are proposals.

**How to read it.**
- Sections 1 and the "Today" columns are facts, from `packages/shell/src/{view-model,build,manifest,face-props}.ts`, `packages/faces/editorial-market/src/` and the designer guide. Everything else is a proposal.
- **Feasibility:** *CSS* = the renderer draws it from its own markup with a data attribute and CSS only; *Branch* = needs different markup; *Data* = needs a new snapshot or view-model field and an admin setter.
- **Verdict:** ★ = a bar or club owner would plausibly want it, and the renderer can draw it well; *less* = possible, less valuable; *no* = not worth it or not allowed (reason given).
- **Words.** "Order" is the glossary's word for what the code still calls the bag (`menu.bag`). "Mark" is the look of the `item.badges` slot (the "New" mark and tags not shown elsewhere). The panel's pages are called **panel pages** here, because the glossary keeps "category" away from sections.

## 1. The guest page as a tree of components

"EM" = Editorial Market. "Required" cites the rule that makes it so.

### 1.1 Page frame

| Component | Data it gets | `data-slot` in EM | Required? | Today in EM |
|---|---|---|---|---|
| Root | `view.theme` (8 colours per scheme, font, radius, shadow), `scheme` prop, `view.locale` | none (`data-face`, `data-layout`, `data-scheme`, `lang`) | `lang` on the root (§7.5) | Page colour, the venue's font, 16 px body |
| Venue bar | `theme.logo` | none | optional (null collapses) | Inverse band (`text` fill, `background` writing); logo up to 96×44 px, left |
| Table label | host prop `tableLabel`, `strings.table` | none (the guide's `menu.table` is not used) | drawn when a table is confirmed (functionality file, supported) | 11 px outlined pill in the bar |
| Language switch | host props `languages`, `onLanguageChange` | `menu.language` | present exactly with 2+ languages (contract, §7.6) | Segmented pill in the bar |
| Bill and pay entries | `features.bill`, `features.pay`, `state.bill.total` | `menu.bill`, `menu.pay` | exactly when the feature is on (R15) | Pill with the host's total in the bar |
| Filter button | `features.filters`, `view.filters` | `menu.filters` | exactly when the feature is on (R15) | Icon button in the bar |
| Title block | `menu.title` (h1), `menu.intro`, `menu.schedule` | none | h1 always (falls back to "Menu"); the closed-menu note while `schedule` is set (R1) | 38–60 px title at weight 880; intro faded on the band; schedule note bold |
| Section navigation | top-level `sections[].title` | none (`nav`, `aria-current`) | a way to jump between sections (functionality file) | Sticky rail, 13 px bold, active link underlined in `accentText`, follows the scroll; shown only with 2+ sections |
| Layout switch | `view.layout.guestSwitch` | `menu.layout_switch` (EM's own) | when the menu lets guests switch (D92) | Three icon buttons under the first non-strip section title |
| Empty filter result | `strings.noMatches`, `clearFilters` | none | when filters leave nothing (functionality file) | Message and a clear button |
| Allergen footer | `view.allergenLegend`, `strings.footerTitle/Text` | `menu.allergen_legend` | the codes must be explained (R6); EM also explains them in the sheet | Inverse band, numbered legend in two columns |
| Order bar | `features.callWaiter`, `features.ordering`, the Order | `menu.call_waiter`, `menu.bag` | exactly when the feature is on (R15) | Floating inverse pill at the bottom |
| Host notices | loading, not found, not published, load failed | drawn by the host page with `qr-phone`'s parts | — | Outside the template today |
| **Not in the data** | a venue name apart from the header name, address, hours, social links, a legal line, a menu cover photo | — | — | — |

### 1.2 Section

| Component | Data | `data-slot` | Required? | Today in EM |
|---|---|---|---|---|
| Section block | `id`, `hints.layout` | none (`data-section-layout`) | every section, in order (R2) | 58 px above each section |
| Section image | `image` (variant, focal) | none | optional | 16:7 banner above the title |
| Title | `title` (h2; h3 in a sub-section) | none | yes | 31 px, weight 880; sub-sections the same size |
| Description | `description` | none | optional | Muted, up to 42 characters wide |
| Colour and icon hints | `hints.color`, `hints.onColor`, `hints.icon` | — | optional | **Not drawn**, and no admin control sets them |
| Horizontal strip | `hints.layout = horizontal` | `data-section-layout="horizontal"` | drawn as a sideways row when marked (D92) | Cards 84 % of the screen wide, snap scrolling, photo 1.22:1 on a panel |
| Sub-sections | `sections[]` | none | after the section's own items (R2, §7.3) | Same block, h3 |
| Items area | `view.layout.default` (list, one, two) | root `data-layout` | — | Two columns by default |

### 1.3 Item in a section

| Component | Data | `data-slot` | Required? | Today in EM |
|---|---|---|---|---|
| Item wrapper | `id`, `state.code` | `data-item`, `data-state` | once per placement, in order (R2, R7) | Rows with a line above; photo items as a block on a "stage" |
| Name | `name` with its `lang` | `item.name`, its button `item.open` | yes, never cut (R7, R9) | Upper case, 19 px (24 px with a photo), weight 850 |
| Price | `price.text` ("from 12,50 €") | `item.price` | when priced (R7; final price, 2011/83 Art. 6) | 14 px (16 with photo), bold, under the name |
| Add control | `order.controls`, `features.ordering` | `item.add` | exactly when ordering is on and the item orderable (R11, R15) | Round "+" by the price, then a counter |
| State | `state.code`, `label`, `schedule` | `item.state` + `data-state` | yes (R5, R7) | Label in `accentText`; sold out and unavailable: photo at 52 %, name and price `muted` |
| "Ask your waiter" | `order.askWaiter` | none | when set | Bold line |
| Description | `description`, `truncatable` | `item.description` | optional; cut only with a way to read the rest (R9) | Muted 14 px, 3 lines (2 with a photo) |
| Photo | `image` (variants, focal), `noImage` | `item.image` | optional; no-image layout `text_only` | 4:3 on a `surface` panel (one, two), 96 px square (list) |
| Marks | `badges` ("New"; tags and dietary labels not shown elsewhere) | `item.badges` | optional | Upper-case accent pills on the photo's corner, or above a text row; **10 px** |
| Portion | `portion.text` ("50 ml") | `item.portion` | optional | 12 px muted, own line |
| Dietary labels | `dietary` | `item.dietary` | optional | Outline chips, **10 px** |
| Tags | `tags` | `item.tags` | optional | Same chips |
| Allergens | `allergens` (code, number 1–14, label) | `item.allergens` (`data-allergen` each) | when the item lists any (R6, EU 1169/2011) | Boxed numbers (**11 px**) in one button that opens the allergen sheet |
| Extra fields | `extraFields` (label, ready text) | `item.extra_fields` | optional | "Label value", 12 px muted |
| Choices summary | `modifierGroups` | `item.modifiers` | optional | "Group: a, b +3,00 €" lines |

### 1.4 Item detail page (the dish page, `#item-<id>`)

Dialog named by the item, Back closes it, link shareable. Every part is drawn in EM as: square photo on a panel; name and price side by side; the whole description; state label; dietary chips; **allergens by name** ("Allergens: Gluten · Milk") with an info button for the sheet; extra fields as lines; the choices as a read-only two-column grid with deltas, or, when the item can be ordered, the ordering part (groups with limits, a note, a quantity, "Add" with the shell's `draftPrice`); a sticky bar with name and price when not ordering. **EM's dish page leaves out tags, portion and marks**, though the data is there. No dish-page part is contract-checked.

### 1.5 Overlays

| Overlay | Data | Marker | Today in EM |
|---|---|---|---|
| Filter sheet | `view.filters` (dietary AND, tags OR) | opened from `menu.filters` | Bottom sheet on an inverse panel; toggle chips; "Clear filters" |
| Allergen sheet | `allergenLegend`, the item's allergens | none (the guide's `menu.allergen_sheet` is not used) | The whole legend in two columns, the item's own filled and `aria-current` |
| Overlay frame | — | `role="dialog"` | Veil of `text` at 72 %, sticky head with title and close |

### 1.6 Guest-feature screens

All five are **drawn, platform parked** in the functionality file; they draw the host's state and send commands (D72). D122 adds words and states not yet in the contract (the shared Order, sent-order states Sending/Added/Not sent/Unconfirmed, the "Show this to your waiter" panel whose reference is at least 40 px at 7:1, the location consent, last orders, no note field without the capability), and says the template for them is designed last, by its own agent.

| Screen | Address and markers | Parts drawn in EM |
|---|---|---|
| Call a waiter | `#call`, `menu.call_waiter` | Grid of the allowed kinds, a note for "other", the request's host status, withdraw |
| Bill | `#tab`, `menu.bill` | Rounds by origin and time; lines with quantity, name, options, status; the host's total |
| Order | `#bag`, `menu.bag`, `item.add` | Lines (name and price looked up live, options, note, stepper, unavailable flag), the "approx." estimate, Send, pending/accepted/rejected |
| Pay | `#pay`, `menu.pay`, `pay.method`, `pay.receipt_open` | Scope (whole, equal share with people, mine), tip choices and amount, promo, allergy note, subtotal/tip/VAT/total from the quote, methods, processing/paid/failed |
| Receipt | `#receipt`, `pay.receipt` | Venue, table, time, lines, VAT, tip, total, method, references, PDF/email/print only where offered |
| Preview marker | `data-preview="true"` | On every sheet while the state is demo data (§10.4) |

## 2. The candidate options, component by component

Each table lists the option, its fixed values, the **base** value and the **EM** value, feasibility, constraints and the verdict. The base column is the proposal of section 5.

**Never hidden or changed by any option** (law, rules R2 to R11, rule 5, the glossary): the item's name (never cut), its price on a priced item and its "from", the allergens and a way to read their meaning, the item state and its label, "Ask your waiter", the order of sections, items, groups and options, the closed-menu note, the table label, the language switch with 2+ languages, the guest-feature controls whose feature is on, the amounts and lines on the bill, quote and receipt. No option may strike a price through (it reads as a discount), make a sold-out item look orderable, or move sold-out items to the end (that is an order change; the shell's job if ever).

### 2.1 Whole page (passport: preset, brand, type, rounding, shadow, rhythm)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Style preset | base, editorial-market, (later: club dark, T87) | base / editorial-market | Data (venue key) | Presets set look options only (section 5) | ★ |
| Colours | primary, secondary, tertiary + Advanced roles | exists | exists (free hex) | D70/D93 contrast; the one free value | ★ (keep) |
| Screen | auto, light, dark | auto / auto | exists | — | ★ (keep) |
| Body font | the six | Inter / Inter | exists | Cyrillic, self-hosted | ★ (keep) |
| Heading font | same as body, or one of the six | same / same | Data (`theme` key; `fontStacks` already maps any of the six) | — | ★ |
| Heading weight | regular, bold, heavy | bold / heavy | CSS | Lora's upper weight unverified (section 6) | ★ |
| Capitals | none, items, sections, all | none / items | CSS | Headings only; the `hostile-names` fixture (all-caps Cyrillic) | ★ |
| Text size | standard, large | standard / standard | CSS | 12 px floor; no sideways scroll at 320 px | ★ (dark rooms) |
| Corners | square, soft, round, extra (0, 8, 16, 24 px) | soft / venue's (default 8) | Admin enum over today's number | Replaces the 0–32 slider | ★ |
| Depth | none, low, medium, high (0, 1, 3, 5) | low / — | Admin enum + CSS | **EM uses shadow only on the page column above 641 px**, so it does nothing on a phone today | less |
| Buttons | accent fill, ink fill | accent / ink (`text` fill) | CSS | `onAccent` on `accent`; D93 strong outline when the accent is pale | ★ |
| Density | compact, comfortable, spacious | comfortable / spacious | CSS | 44 px targets; 12 px floor | ★ |

### 2.2 Header (passport: `top_bar` + `masthead`)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Band | page, panel, ink, accent | page / ink | CSS | Pairs of §5.4: ink band writes in `background`, accent band in `onAccent` (controls too); `muted` never on a band | ★ |
| Arrangement | stacked, centred, compact | stacked / stacked | CSS (grid areas) | Compact keeps the h1 | ★ |
| Title size | s, m, l, xl | m / xl | CSS | Wraps, never cut | ★ |
| Logo size | s, m, l | m / m | CSS | — | ★ |
| Show | title (visual only, when a logo exists), intro | both / both | CSS | The h1 stays for screen readers | ★ |
| Sticky bar | off, on | off / off | Branch (two sticky layers with the rail) | Room on a 568 px-tall phone | less |

### 2.3 Section navigation (passport: `chapters.index`, `chapters.tabs`)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Marker | underline, pills | underline / underline | CSS | Active shown by shape, not colour alone; pills use D93 `selected`/`selectedText` | ★ |
| Kind | rail, rail with full list | rail / rail | Branch (a sheet listing sections) | "Hidden" is not a value: a way to jump is required | less |
| Section tiles first | off, on | off / off | Branch + section images | Adds a tap before the menu | no |
| Language switch look | pills, codes | pills / pills | CSS | Never hidden; 44 px | less |

### 2.4 Section (passport: `sections`, `chapters.header`)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Header | plain, ruled, centred, colour band | ruled / plain | CSS; band needs a setter for the existing `hints.color` | Band text is `hints.onColor` only | ★ (first three); band less |
| Title size | s, m, l | m / l | CSS | Sub-sections one step smaller (proposal; EM draws them equal) | ★ |
| Section image | banner, hidden | banner / banner | CSS | — | less (the venue chooses by uploading) |
| Description | shown, hidden | shown / shown | CSS | — | less |
| Icon | from a fixed icon set | — | Data (icon set + setter; `hints.icon` is free text today) | — | no (now) |
| Item layout | list, one, two, strip | menu default / two | Data (section field; `hints.layout` widens) + CSS | Interplay with the guest switch (section 6) | ★ |
| Strip card size | s, m, l (≈44, 64, 84 % wide) | m / l | CSS | Next card must peek; row focusable | ★ |

### 2.5 Item in a section (passport: `fields`, `frames`, `components`)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Frame | rows, cards, open | rows / rows (photo on a stage) | CSS | Card edge is decoration, the tap area stays 44 px | ★ |
| Name size | s, m, l | m / l | CSS | Never cut | ★ |
| Price place | under the name, end of the name line | end / under | CSS (grid) | Price at least the body size; always visible | ★ |
| Price dotted leader | off, on | off / off | CSS, fragile with long names | 60-character fixture | no |
| Price colour | ink, accent text | ink / ink | CSS | `accentText` on page/panel only | less |
| Portion place | own line, beside the price ("12,50 € · 50 ml") | beside / own line | CSS | Not hideable (law unknown, section 6) | ★ (bars read ml by the price) |
| Description lines | 1, 2, 3, all | 2 / 3 (2 with photo) | CSS | R9: a cut needs the dish page, which always exists | ★ |
| Description on the card | shown, dish page only | shown / shown | CSS | Contract R8 says an optional slot with content is drawn: needs a ruling | less |
| Choices summary on the card | shown, dish page only | dish page only / shown | CSS | Same ruling | ★ (club cocktails get noisy) |
| Extra fields | inline, rows | inline / inline | CSS | — | less |
| Add control | round "+", "Add" button | "+" / "+" | Branch (small) | 44 px; D122 words | later (with D122) |

**Photo** (passport: `component_options.image`, `masthead.image_*`)

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Shape (one, two, strip) | square, landscape 4:3, wide 16:9, portrait 4:5 | 4:3 / 4:3 (strip 1.22:1) | CSS | Focal point via `objectPosition`; reserve the aspect; list thumbnails stay square | ★ |
| Frame | bleed, stage | bleed / stage | CSS | Stage uses `surface` | ★ |
| Side in the list | end, start | end / end | CSS | — | less |
| Photos on cards | shown, dish page only | shown / shown | CSS | Needs the R8 ruling | less |

**Labels, marks, allergens, state**

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Labels (dietary, tags, filter chips) | outline, soft fill, text | outline / outline | CSS | 12 px floor (EM's 10 px fails §7.5) | ★ ("text" suits long drink lists) |
| Marks look | filled pill, outline, text | pill / pill | CSS | `onAccent` on `accent` | ★ |
| Marks place | on the photo, before the name | on the photo (else before the name) / same | CSS | — | less |
| Allergens | numbers, names, icons | numbers / numbers | numbers and names: Branch, data present; icons: 14 drawn icons | Never hidden or hover-only; codes explained; today the contract checks the manifest's `allergen_mode`, which would become a setting | ★ numbers and names; icons less |
| Allergens as one "Allergens" button | — | — | Branch | The functionality file allows "a visible control that opens them", but it hides the codes behind a tap before ordering | no |
| Sold-out label | line, mark | line / line | CSS | Stays visible, label at 4.5:1, no add control, no strikethrough; hiding is the shell's `soldOutDisplay`, not design | less |

### 2.6 Dish page

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Kind | full page, tall sheet | sheet / full page | Branch (the overlay already has both looks) | `#item-<id>`, Back, dialog rules | ★ |
| Photo shape | follows the item photo shape | — | CSS | — | (no own option) |
| Name and price bar | shown, hidden | shown / shown | CSS | — | less |
| Choices list | one column, two columns | one / two | CSS | Delta text as given | less |
| Always on the page | name, price, whole description, state, allergens by name, required choices; proposal: also portion and tags | — | — | — | fixed |

### 2.7 Overlays, footer, guest-feature screens

| Option | Values | Base / EM | Feasibility | Constraints | Verdict |
|---|---|---|---|---|---|
| Sheet colour (filters, allergens, guest-feature sheets) | page, panel, ink | panel / ink | CSS | §5.4 band rules; inputs 16 px | ★ |
| Filter place | sheet, chip row under the rail | sheet / sheet | Branch | A chosen chip never stays on when the control goes | less |
| Footer band | page, panel, ink | panel / ink | CSS | Never hidden while the menu lists allergens | ★ |
| Footer extras (address, hours, legal line, social) | — | — | Data | Content, not look | no (now) |
| Order bar | floating, docked | floating / floating | CSS | Safe-area insets; 44 px | later (with D122) |
| Bill, Order, Pay, Receipt, Call | inherit colours, font, corners, buttons, sheet colour only | — | — | D72: draw the host's state; D122 not yet in the contract | fixed until D122's template work |

**Count:** 35 options starred (three of them exist today), 16 "less", 5 "no", 2 "later"; the starred set alone gives every part of the page (whole page, header, navigation, section, item, photo, dish page, sheets and footer) at least one visible choice.

## 3. Proposed panel pages

Every option above has exactly one page. Simple shows pages 1–4; Advanced adds 5–12. Parts are the `data-design-part` values the renderer carries for click-to-edit; in Simple, a click on an Advanced part opens the nearest Simple page (as the passport's ruling R44 does).

| # | Page | Mode | Options | `data-design-part` |
|---|---|---|---|---|
| 1 | Style | Simple | preset, screen, corners, density | none (whole page) |
| 2 | Brand | Simple | colours (+ Advanced roles), logo, header name (menu), buttons | `header.logo`, `button` |
| 3 | Type | Simple | body font, heading font, heading weight, capitals, text size | none |
| 4 | Layout | Simple | menu layout and guest switch (menu, exists), section item layout, strip card size | `section`, `strip` |
| 5 | Header | Advanced | band, arrangement, title size, logo size, show, sticky bar | `header`, `header.title` |
| 6 | Navigation | Advanced | marker, kind, section tiles, language switch look | `nav`, `language` |
| 7 | Sections | Advanced | header, title size, image, description, icon | `section.head` |
| 8 | Items | Advanced | frame, name size, price place, leader, price colour, portion place, description lines, description on card, choices summary, extra fields, add control | `item`, `item.price`, `item.description` |
| 9 | Photos | Advanced | shape, frame, side in list, photos on cards | `item.photo` |
| 10 | Labels and allergens | Advanced | labels, marks look, marks place, allergens, allergen button, sold-out label | `item.labels`, `item.marks`, `item.allergens`, `item.state` |
| 11 | Dish page | Advanced | kind, name and price bar, choices list | `dish` |
| 12 | Sheets and footer | Advanced | sheet colour, filter place, footer band, footer extras, order bar | `sheet`, `footer`, `order.bar` |

Guest-feature switches (filters, call a waiter, bill, ordering, pay) are not looks; they stay in the Guest functions card (D71, D92). Passport pages with no menu equivalent: figures, charts.

## 4. Which settings make sense per layer

| Option group | Venue | Menu | Section | Item | Reason |
|---|---|---|---|---|---|
| Style preset | yes | later, on request | no | no | One look per venue; a second menu (brunch) may want its own later |
| Colours, screen, fonts, type | yes | no | no (except the colour band through `hints.color`) | no | The brand is the venue's |
| Corners, depth, buttons, density | yes | no | no | no | Mixed shapes on one page look broken |
| Header options | yes | header name only (exists) | — | — | The header is the venue's identity |
| Navigation | yes | no | — | — | One page, one navigation |
| Menu layout and guest switch | no | yes (exists, D92) | — | no | Already a menu setting |
| Section item layout | no | default (exists) | yes | no | Cocktails in two columns, spirits as a list |
| Strip card size | yes | no | no | no | One strip look reads as one system |
| Section header, title size | yes | no | no | — | Consistency; a section varies by layout, not by heading |
| Item frame, name, price, portion, description | yes | no | no | no | Varying per section makes the menu look patched |
| Photo shape | yes | no | no (proposal; a strip may want its own later) | no | One crop per page |
| Labels, marks, allergens | yes | no | no | no | Allergen display must be one predictable system |
| Dish page, sheets, footer | yes | no | — | — | Single components |
| Anything at item level | — | — | — | **no** | No menu builder offers it (market scan); a "featured" item is content (a tag or mark), not design; per-item looks risk rule 5 |

## 5. The plain base look

**Proposal.** A calm, readable list a stranger understands at a glance in a dark room: the venue's page colour with a plain header (logo left, menu title at medium size, intro under it), a sticky rail of section names with an underline, sections opened by a thin rule and a medium bold title, items as rows with the price at the end of the name line and the portion beside it, two lines of description, photos in 4:3 bleeding to rounded corners, outline labels, accent "New" marks, boxed allergen numbers explained in a panel-coloured footer, the dish page as a tall sheet, sheets on the panel colour, accent buttons, Inter, soft corners, low depth, comfortable density, every text at 12 px or more. Choices are listed on the dish page only.

| Option | Base | Editorial Market preset sets |
|---|---|---|
| Heading weight | bold | heavy |
| Capitals | none | items |
| Buttons | accent | ink |
| Density | comfortable | spacious |
| Header band / title size | page / m | ink / xl |
| Section header / title size | ruled / m | plain / l |
| Item frame | rows | rows |
| Name size | m | l |
| Price place | end | under the name |
| Portion place | beside the price | own line |
| Description lines | 2 | 3 (2 with photo) |
| Choices summary | dish page only | shown |
| Photo shape / frame | 4:3 / bleed | 4:3 (strip 1.22:1) / stage |
| Labels / marks / allergens | outline / pill / numbers | outline / pill / numbers |
| Strip card size | m | l |
| Dish page kind | sheet | full page |
| Sheet colour / footer band | panel / panel | ink / ink |
| Not set by a preset | colours, logo, fonts, screen, corners, menu layout, section layouts | — |

EM as a preset changes one thing visibly: its 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor. Its strip crop (1.22:1) is not one of the four shapes: either the preset keeps it as a strip-only exception or it becomes 4:3 (section 6).

## 6. Open questions for Martin

1. **Existing venues.** Move every venue to the Editorial Market preset at the switch, so no live menu changes, and give only new venues the base? *Recommend yes* (it keeps "a new option never changes an existing look").
2. **Hiding parts that have content** (description, choices summary or photos only on the dish page). The contract says an optional slot with content is drawn (R8). *Recommend* allowing "dish page only" for the choices summary and the description, never for photos, and changing the contract test with it.
3. **Section layout against the guest switch.** *Recommend:* the section's layout is where it starts; the guest's switch, when allowed, applies to every vertical section; strips never switch.
4. **Allergen display.** *Recommend* numbers and names now, icons later (14 icons to draw and check for recognisability), never "button only".
5. **Sold-out "hide".** The shell already has `soldOutDisplay: show | hide` (default show) with no admin setter, while the glossary defines sold out as visible. *Recommend* keeping it out of the designer and deciding it as a menu rule, or removing `hide`.
6. **Corners and depth as four steps** instead of the 0–32 and 0–5 numbers, with depth applied to cards, sheets and the bar (today it reaches only wide screens). *Recommend yes.*
7. **Do presets carry colours?** *Recommend no:* colours are the brand; a preset may suggest them.
8. **Guest-feature screens.** *Recommend* only the global looks until D122's screens are in the contract and the template agent designs them.
9. **Footer content** (address, hours, a legal line): content the snapshot does not have. *Recommend* a separate content decision, not part of the designer.
10. **The strip crop** in the EM preset: keep 1.22:1 as a strip-only value, or 4:3? *Recommend* 4:3 (one fewer value).

**Facts I could not establish.**
- Whether Bulgarian law requires the portion (g, ml) on a menu; if it does, portion joins "never hidden" (it is shown wherever set today).
- Bulgaria's national rule on how allergen information is given for non-prepacked food (the market scan could not confirm one).
- The heaviest weight Lora and Playfair Display serve from our copies (a "heavy" heading may fall back).
- Whether `menu.intro` has an admin setter (the publisher reads a menu field `intro`; I found no control).
- How D122's shared Order, sent-order states and consent screen will look in the contract.
- How the planned dark club template (T87) maps onto these options; I did not read its brief.
