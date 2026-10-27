# The menu design options, component by component

Made by: spec subagent (Fable, max effort) for the menu designer grilling, 2026-10-27, at Martin's request. A proposal for Martin to grill; it binds nothing until the decision log and a D-number say so.

It builds on the component inventory (`2026-10-27-guest-menu-component-inventory.md`: the facts, the candidate options, the never-hidden block), the decision log (rows 1.1–1.12), the editing-model proposal (§1–2A) and the research synthesis. The inventory's facts are not repeated. Where this spec cuts an option the inventory starred, or keeps one it marked "less", it says so and why.

## 1. How to read this

- An option is **in** only if (a) a venue owner would plausibly want it to differ between venues, and (b) one renderer can draw every value well on a phone from 320 px up, with every §7.5 rule of the designer guide and the inventory's "never hidden or changed" block kept. Everything else is **out**, with its reason in one line.
- Sizes are the words s, m, l (xl once), never pixels; every value is a short lower-case token (the shell's own option-value pattern), so a Style is a list of words and nothing else. The three colours stay the one free value, contrast-checked as today (D70, D93).
- **Base** is the plain menu of decision 1.2; **Editorial** is Editorial Market as drawn today. *Feasibility* uses the inventory's words: CSS, Branch (different markup), Data (a new stored field).
- Simple shows General's first three rows (Style, colours, fonts); Advanced shows General whole, then the component pages (decision 1.11). A section's item layout and a menu's layout and guest switch stay composer settings (D92, decision 1.5) and are not in this list.
- Each page names the `data-design-part` markers it owns, so a tap on the preview opens the page that owns the part; in Simple a tap on an Advanced part opens General with a "styled in Advanced" line and a switch.

## 2. General

General is Simple's three controls and, in Advanced, every page-wide setting. The logo is uploaded here beside the colours; it is a brand asset, not an option, and is not counted.

| Option | Values | Base | What the guest sees change |
|---|---|---|---|
| Style | plain, editorial, soft, classic, club; then the venue's own designs under "My menu designs" | plain for a new venue; editorial for a venue live today (Q5) | Every option on every page changes at once to the Style's values; the colours, logo and body font stay (below) |
| Colours | Primary, Secondary, Tertiary as free hex with the harmony suggestions; the Advanced roles of both screens as today | the venue's own | The page, the panels and the accent; every text-on-colour pair stays readable (D70, D93) |
| Screen | auto, light, dark | auto | Whether the menu follows the phone's dark mode, or is always light or always dark |
| Body font | inter, manrope, montserrat, playfair-display, lora, unbounded | inter | Every running text: descriptions, prices, labels, the sheets |
| Heading font | same, or one of the six | same | The menu title, section titles and item names in a second face, or the body font throughout |
| Heading weight | regular, bold, heavy | bold | How heavy the menu title and section titles are (item names have their own weight, §3.4) |
| Corners | square, soft, round, extra | soft | The rounding of photos, cards, buttons, chips, sheets and the order bar, all at once |
| Depth | none, low, high | low | Whether cards, sheets, the "+" and the order bar sit flat or lift off the page with a shadow |
| Density | compact, comfortable, spacious | comfortable | The space between items and sections and inside cards; tap targets never shrink below 44 px |
| Text size | standard, large | standard | Every text one step larger, for dark rooms and older eyes; the 12 px floor holds in both |
| Buttons | accent, ink | accent | The fill of every primary button ("+", Send, Pay, the order bar): the venue's accent, or the ink with the page colour as its writing |

Corners and depth replace today's 0–32 and 0–5 sliders with four and three words (inventory Q6). Corners now reach chips and sheets; depth now reaches phones. Editorial Market's own `--rm-shadow` reaches only the page column above 641 px, while its sheets, strip cards and "+" carry fixed small shadows: those become the `low` step, so nothing it draws today is lost.

**What a Style sets, and never sets (recommendation).** A Style sets every option on every page, the heading font, heading weight, screen, corners, depth, density, text size and buttons included. It never sets the three colours, the Advanced roles, the logo or the body font. Reasons: Classic's serif and Club's display face are the Style's voice, while the body font is the venue's reading voice; Club is dark or it is not Club; the colours and the logo are the brand (inventory Q7; proposal §1.1). This narrows the two lists on the table (the proposal's "colours, fonts and logo stay", the inventory's "not set: colours, logo, fonts, screen, corners") to colours, roles, logo and body font. After the switch everything is editable, and a Style's tile is drawn in the venue's own colours and body font, so a tile never lies (Q1).

**Out, and why.**
- One page-wide "capitals" (none, items, sections, all; inventory ★): split into section title case (§3.3) and item name case (§3.4), the pages a tap on a title lands on.
- A weight of its own for the menu title: it follows the heading weight; one heading voice per page.
- Showing or hiding the intro: content; an intro the venue does not want is deleted, not hidden (Q8).
- The header name: per menu, content (D92), not a look.
- Colour presets: none (D92); a Style never carries colours.
- Free numbers for rounding and shadow: replaced by the words above.

Markers: none for the page as a whole; `button` opens General at Buttons.

## 3. The component pages, in the order a guest meets them

### 3.1 Header

The venue bar (logo, table label, language switch, the bill, pay and filter entries) and the title block (the h1, the intro, the closed-menu note).

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Band | page, panel, ink, accent | page | The colour behind the logo and title: the page itself, the panel colour, a dark ink band, or the venue's accent. On the dark screen an ink band turns light (the roles swap, §5.4); a venue that wants dark on dark picks panel | (a) the first and strongest brand statement on the page; (b) CSS; the pairs of §5.4: ink writes in `background`, accent in `onAccent`, page and panel in `text`; never `muted` on a band |
| Arrangement | stacked, centred, compact | stacked | The logo row, then the title and intro under it; everything centred; or the logo and title on one line with the intro folded under (the h1 stays) | (a) centred reads "restaurant", left reads "editorial", one line reads "app"; (b) CSS grid areas |
| Title size | s, m, l, xl | m | How big the menu's name is; it wraps, never cut | (a) a club wants its name huge, a bistro modest; (b) CSS |
| Logo size | s, m, l | m | The box the logo fills; a wordmark needs width, an emblem does not | (a) "can the logo be bigger?" is the first thing owners ask; (b) fixed boxes, no layout shift |
| Title | shown, hidden | shown | With a logo that already carries the name, the written name can go; the h1 stays for screen readers, and the title block keeps the intro and the closed-menu note. Ignored while the venue has no logo | (a) a wordmark beside its own name reads twice; (b) CSS |

**Out, and why.**
- A sticky venue bar (inventory: less): the rail is already sticky and carries the jump; a second sticky layer takes a third of a 568 px phone.
- The language switch look (pills or codes; less): never hidden, 44 px either way, two values a few pixels apart.
- The table label's look: fixed; it is the guest's proof of where the order goes.
- Where the bill, pay and filter entries sit: waits for D122's screens (§3.9–3.13).

Markers: `header`, `header.logo`, `header.title`.

### 3.2 Section navigation

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Marker | underline, pills | underline | The current section is underlined in the accent, or sits in a filled pill (D93 `selected` and `selectedText`) | (a) pills read "app", underline reads "print"; (b) CSS; the active one is shown by shape, not colour alone |
| Band | page, header | page | The rail sits on the page, or continues the header's band under it: one dark top block when the header is ink or panel | (a) the app-bar look clubs want; (b) CSS; the same pair rules as the header |

Derived, not options: the rail's alignment follows the header arrangement (centred header, centred rail while the names fit); its weight and case follow the section titles; it appears only with two or more sections, as today.

**Out, and why.** Section tiles before the menu: adds a tap (inventory: no). A sheet listing every section (less): if a long menu needs "all sections", that is functionality every renderer gets through the functionality file, not a look. Rail text size: General's text size covers it.

Markers: `nav`.

### 3.3 Sections

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Header | plain, ruled, centred, band | ruled | The title alone; a thin rule above it; the title centred between short rules; or the title on a strip of the panel colour | (a) the strongest rhythm cue of a menu; (b) CSS; the band uses `surface` under `text`, so it needs no colour hint. The inventory's colour band through `hints.color` is dropped: no setter exists and the only guaranteed pair is `onColor` |
| Title size | s, m, l | m | How big section titles are; a sub-section's title one step smaller | (a) a spirits list against restaurant courses; (b) CSS |
| Title case | written, capitals | written | Section titles as written, or in capitals | (a) classic menus capitalise; (b) CSS `text-transform`, checked on all-caps Cyrillic (the hostile-names fixture) |
| Strip card size | s, m, l | m | How wide each card of a horizontal section is; the next card always peeks | (a) three big "top picks" against a scrolling row of small ones; (b) CSS; the row stays focusable |

**Out, and why.**
- The item layout of a section (list, one, two, strip): a Structure setting on the section (D92, decision 1.5), not a look.
- Section image and description shown or hidden (less): content; delete it instead (Q8).
- A section icon: no icon set exists (inventory: no, for now).
- Space between sections: density.
- The strip's photo shape: follows Photos (one crop per page); Editorial's 1.22:1 becomes 4:3 (inventory Q10).

Markers: `section`, `section.title`, `strip`.

### 3.4 Items

The product row or card inside a section.

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Frame | rows, cards, open | rows | A thin line between items; each item in a panel-coloured card with General's corners and depth; or nothing but space | (a) Martin's own example: cards, or no card around each product; (b) CSS; the card edge is decoration, the 44 px tap area stays |
| Name size | s, m, l | m | How big item names are; never cut | (a) Club's large names; (b) CSS |
| Name weight | regular, bold, heavy | bold | How heavy item names are, apart from the headings | (a) a classic list in regular, a club in heavy; (b) CSS |
| Name case | written, capitals | written | Names as written, or in capitals | (a) Editorial's signature; (b) CSS, Cyrillic checked |
| Price place | end, under | end | The price at the end of the name's line, or on its own line under the name | (a) bars read the price at the end of the line, Editorial puts it under; (b) grid; the price is never smaller than the body text and always visible |
| Portion place | beside, own | beside | "12,50 € · 50 ml" beside the price, or the portion on its own line | (a) bars read ml by the price; (b) CSS; the portion is never hidden (the law is unknown, inventory) |
| Description lines | none, 1, 2, 3, all | 2 | How much of the description the card shows before "more"; none means the dish page alone has it | (a) a cocktail list wants one line, a club spirits list none, a bistro all; (b) R9: a cut always has the dish page behind it; `none` needs the R8 ruling (Q2) |
| Choices | dish-page, on-card | dish-page | Whether "Size: S, M, L +1,00 €" lines show on the card or only on the dish page | (a) club cocktails get noisy; (b) CSS; needs the R8 ruling (Q2) |

**Out, and why.**
- The add control ("+" or "Add"): waits for D122 (§3.11).
- A dotted price leader: breaks on 60-character names (inventory: no).
- Price colour, ink or accent (less): the price must be the calmest, most legible thing on the row (98/6/EC "clearly legible"); ink is the one value that always wins, and accent text is already the colour of the state label and the marks.
- Extra fields inline or as rows (less): the shell formats them into one list; a minor detail.
- Anything per item: no (inventory §4, market scan).

Markers: `item`, `item.name`, `item.price`, `item.description`, `item.choices`.

### 3.5 Photos

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Shape | square, landscape, wide, portrait | landscape | The crop of item photos in one- and two-column sections and in strips, 1:1, 4:3, 16:9 or 4:5 around the focal point; list thumbnails stay square | (a) food wants 4:3 or square, bottles portrait, a promo strip wide; (b) a reserved aspect and `objectPosition`, no layout shift |
| Frame | bleed, stage | bleed | The photo fills its box edge to edge, or sits on a panel-coloured stage with a margin (Editorial) | (a) stage reads "catalogue", bleed reads "app"; (b) CSS on `surface` |
| On the card | on-card, dish-page | on-card | Photos on the menu itself, or only on the dish page: a text menu with its photos one tap away | (a) Classic needs it, as do venues that photograph for the dish page but want a text list; (b) the renderer already draws text-only rows (`no_image_layout: text_only`); needs the R8 ruling (Q2) |

The inventory recommended never hiding photos. I keep "dish-page" because Martin's Classic is "photos only on the dish page", and because, unlike allergens or a price, a photo is one tap away and carries nothing the law or the contract requires.

**Out, and why.** The thumbnail's side in the list (less): it sits at the end so name, price and allergens keep one column. Thumbnail size in the list: a minor detail. Photo corners: General.

Markers: `item.photo`.

### 3.6 Labels, allergens and state

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Labels | outline, soft, text | outline | Dietary labels, tags and the filter chips as outlined chips, soft-filled chips, or plain words. Marks ("New") follow as the loud version: a filled accent pill for outline and soft, an accent word for text | (a) text suits long drink lists, soft suits Soft; (b) CSS; the 12 px floor (Editorial's 10 px rises); `selected` and `selectedText` for chips |
| Allergens | numbers, names | numbers | Boxed numbers on the item, explained in the footer and the sheet; or the names in words ("Gluten · Milk") on the item, with the sheet behind them | (a) a bistro reads names, a bar reads numbers; (b) Branch, both from the data; never hidden, never hover-only, the codes always explained (R6). The manifest's `allergen_mode` becomes this value, and the contract test checks the chosen one |

**Out, and why.**
- Marks as their own option (inventory ★): folded into labels. A loud "New" beside quiet labels is the one combination that works, and the fold saves a row.
- Marks place (less): on the photo when there is one, else before the name: derived.
- Allergen icons: later, once 14 icons are drawn and checked for recognisability (inventory Q4).
- Allergens behind one "Allergens" button: hides the codes before the order (inventory: no).
- The sold-out look (less): one fixed system, visible, faded with the contrast-checked disabled text, its label, no "+", never moved (glossary, rule 5). The shell's `soldOutDisplay: hide` stays out of the designer (Q3).
- The state label's look: fixed, the shell's label in accent text; it must read the same on every venue's menu.

Markers: `item.labels`, `item.marks`, `item.allergens`, `item.state`. The last two open this page, whose panel says what is fixed and why.

### 3.7 Dish page

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Kind | sheet, page | sheet | The item opens as a tall sheet over the menu, or as a full page with Back | (a) sheet reads "app", page reads "catalogue", and long descriptions want the page; (b) Branch, small: the overlay has both looks already; `#item-<id>`, Back and the dialog rules hold for both |
| Photo | hero, small | hero | The photo full width at the top, or a small square beside the name | (a) a gin and tonic does not want a hero; (b) CSS; the crop follows §3.5 |

Always on the dish page, with no option: the name, the price, the whole description, the state and its label, the allergens by name with the sheet, the portion, tags, marks and extra fields, and the choices with their deltas or the ordering part. Editorial leaves out tags, portion and marks today; the renderer draws them.

**Out, and why.** The sticky name-and-price bar (less): shown whenever the page scrolls, a renderer behaviour. Choices in one or two columns (less): the renderer takes two when every option is short.

Markers: `dish`, `dish.photo`.

### 3.8 Overlays and footer

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Sheets | page, panel, ink | panel | The colour of every sheet (filters, allergens, the dish sheet, the five guest-feature sheets), and of the allergen footer, which follows it | (a) Editorial's ink sheets against calm panel sheets; (b) CSS; the band rules of §5.4; inputs at 16 px |

**Out, and why.**
- The footer band as its own option (inventory ★): in all five Styles the footer wants the sheets' colour; folded. The footer is never hidden while the menu lists allergens.
- The filter place, sheet or chip row (less): the chip row fights the rail for the top of a small phone; the sheet works in every layout.
- Footer extras (address, hours, a legal line): content the snapshot lacks (inventory Q9).
- The order bar, floating or docked: waits for D122. The veil: fixed.

Markers: `sheet`, `footer`.

### The guest-feature screens

Decision 1.8: the switcher lists the five screens from the start. Each inherits the colours and screen; fonts, heading weight, text size, density, corners, depth and buttons from General; the sheet colour from §3.8; the labels look for its choice chips (request kinds, pay scope, tips) with D93's selected roles; and the rows of §3.10. A screen with no option of its own still shows in the switcher, drawn in the current design, with the line "Its own options come with the ordering template (D122)". What D122 fixes is never an option: the words, the states, the waiter reference at 40 px and 7:1, the consent text, the "Preview" marker.

### 3.9 Call a waiter

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Icons | shown, hidden | shown | The request kinds as icon tiles, or as words only | (a) Classic wants words, Club icons; (b) CSS |

Waits for D122: the still card "Please order from your waiter" until the staff screen takes calls, the kinds the venue allows, the request's states.

Markers: `call`.

### 3.10 Bill

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Rows | ruled, zebra, open | ruled | The bill's lines separated by thin rules, alternating bands, or space; the Order's lines, the pay summary and the receipt follow | (a) a long club bill reads better zebra, a short one open; (b) CSS; the amounts never change |

Waits for D122: the POS's own lines with discounts and free lines, no "from your phones" marking, "Ask your waiter to split this bill", the Pay entry. Out: grouping by sent order, because the bill is the POS's (D122 §4).

Markers: `bill`.

### 3.11 Order

| Option | Values | Base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Line photos | shown, hidden | hidden | A small photo on each line of the Order | (a) a photo-led menu wants them, a text menu does not; (b) Branch, small: a line already resolves its item live, so the image is there |

Waits for D122: Send naming the table and the count, the states on every phone, the "Show this to your waiter" panel, the sold-out line and "Send the other 4", the duplicate check, the note field only with the capability, pay-first lines, the location consent, last orders; and with them the add control ("+" or "Add") and the order bar (floating or docked).

Markers: `order`, `order.bar`, `item.add`.

### 3.12 Pay

No option of its own now. It inherits as above; Apple Pay's button keeps Apple's own look whatever the Style. Waits for D122: where the tip sits (#45), the method list, the optional email for an electronic receipt, "Download" as the provider's confirmation, 3-D Secure, group payment later.

Markers: `pay`.

### 3.13 Receipt

No option of its own now; it takes the Bill's rows and the sheet colour. Out: a "paper receipt" look. The receipt is the venue's, or the provider's confirmation (D122 §8), and dressing it as a fiscal document would mislead. Waits for D122: the wording, and the actions only where the receipt offers them.

Markers: `receipt`.

## 4. What the five Styles set

Editorial reproduces Editorial Market as drawn today (inventory §5); Plain is the base; Soft, Classic and Club are proposals in the spirit of Martin's one-line descriptions. The body font, the colours and the logo are not in the table: no Style sets them.

| Option | Plain (base) | Editorial | Soft | Classic | Club |
|---|---|---|---|---|---|
| Screen | auto | auto | auto | auto | dark |
| Heading font | same | same | same | playfair-display | unbounded |
| Heading weight | bold | heavy | bold | regular | heavy |
| Corners | soft | soft | round | square | soft |
| Depth | low | low | low | none | low |
| Density | comfortable | spacious | comfortable | comfortable | compact |
| Text size | standard | standard | standard | standard | standard |
| Buttons | accent | ink | accent | ink | accent |
| Header band | page | ink | panel | page | panel |
| Header arrangement | stacked | stacked | centred | centred | compact |
| Header title size | m | xl | m | l | m |
| Logo size | m | m | m | m | l |
| Title | shown | shown | shown | shown | shown |
| Nav marker | underline | underline | pills | underline | pills |
| Nav band | page | page | page | page | header |
| Section header | ruled | plain | plain | centred | band |
| Section title size | m | l | m | m | l |
| Section title case | written | written | written | capitals | capitals |
| Strip card size | m | l | m | m | l |
| Item frame | rows | rows | cards | open | rows |
| Name size | m | l | m | m | l |
| Name weight | bold | heavy | bold | regular | heavy |
| Name case | written | capitals | written | written | capitals |
| Price place | end | under | end | end | end |
| Portion place | beside | own | beside | beside | beside |
| Description lines | 2 | 3 | 2 | all | 1 |
| Choices | dish-page | on-card | dish-page | dish-page | dish-page |
| Photo shape | landscape | landscape | square | landscape | square |
| Photo frame | bleed | stage | bleed | bleed | bleed |
| Photos | on-card | on-card | on-card | dish-page | on-card |
| Labels | outline | outline | soft | text | soft |
| Allergens | numbers | numbers | numbers | names | numbers |
| Dish kind | sheet | page | sheet | page | sheet |
| Dish photo | hero | hero | hero | hero | hero |
| Sheets | panel | ink | panel | page | panel |
| Call icons | shown | shown | shown | hidden | shown |
| Bill rows | ruled | ruled | open | open | zebra |
| Order line photos | hidden | hidden | shown | hidden | hidden |

Notes on the columns.
- **Editorial** changes in four small places, each forced by a rule or a fold: its 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor; the strip crop and the dish photo become 4:3 (one crop per page); the card description shows three lines beside a photo too (today two); its sheet, strip-card and "+" shadows become the `low` step. Everything else is as drawn today, the lowered 10 px excepted.
- **Club** keeps its header on `panel`, not `ink`: on the dark screen an ink band is light, and Club wants dark on dark. Its tight spacing comes from density and one description line, its large names from name size l and heavy, its wide strips from strip card size l, its pill navigation on the header's band.
- **Classic** gets its text list from photos on the dish page, labels as words and allergens by name; its serif from the heading font; its rules from the centred section header and the open item frame. The heaviest weight Lora and Playfair Display serve from our copies is unverified (inventory): `heavy` may fall back to bold for those two faces, which Classic does not use.
- **Soft** is the app look: round corners, cards, panel bands, soft chips, pills, square photos, open rows and photos on the Order lines.

## 5. The never-list, as a contract clause

No option, in any Style and at any value, may hide, move, re-colour, resize below its floor or change:
- an item's **name**, never cut; its **price** and its "from" on a priced item, in the ink, never struck through, never smaller than the body text;
- the **allergens** and a way to read their meaning, on every layout and screen size, never behind hover or a feature;
- the item's **state and its label**, and "Ask your waiter"; a **sold-out** item stays visible, faded, never orderable, never moved;
- the **order** of sections, items, groups and options (R2); every placement drawn once (R7);
- the **closed-menu note**, the **table label**, the **language switch** with two or more languages, and every **guest-feature control** whose feature is on (R15);
- the **amounts and lines** on the bill, the quote and the receipt (D72, D122), and the waiter **reference** at 40 px and 7:1, the consent text and the "Preview" marker;
- the §7.5 floors: 12 px text, 16 px inputs, 44 px targets, the 4.5:1 text and 3:1 control pairs, visible focus, reduced motion, `lang`, no horizontal scroll at 320 px, theme tokens only.

And no option introduces a free value: no pixels, no hex outside the three colour pickers and the Advanced roles, no CSS, no per-item setting. A test compares every Style at every value against this list before a Style can be offered.

## 6. Counts and sanity

| Page | Options | Of which Branch, Data or a contract change |
|---|---|---|
| General | 11 (Style, colours, screen, body font, heading font, heading weight, corners, depth, density, text size, buttons) | Style (Data: the design record), heading font (Data: a theme key) |
| Header | 5 | — |
| Section navigation | 2 | — |
| Sections | 4 | — |
| Items | 8 | description `none`, choices `dish-page` (R8 contract test) |
| Photos | 3 | `dish-page` (R8 contract test) |
| Labels, allergens and state | 2 | allergens (Branch) |
| Dish page | 2 | kind (Branch, small) |
| Overlays and footer | 1 | — |
| Call a waiter | 1 | — |
| Bill | 1 | — |
| Order | 1 | line photos (Branch, small) |
| Pay | 0 | — |
| Receipt | 0 | — |
| **Total** | **41** | 7 to stage |

- The largest component page is Items with eight; General has eleven as the group. Five exist today (colours, screen, body font, corners and depth, the last two as numbers); the Style row replaces the template chooser.
- Every option appears on exactly one page. Four of the inventory's starred rows are folded rather than cut: marks into labels (§3.6), the footer band into sheets (§3.8), the title's weight into the heading weight, page-wide capitals into the two case options. Three "less" rows are kept with a reason: depth (it now reaches phones), portion place, photos on the dish page. Derived behaviours (rail alignment, marks place, sub-section title size, the sticky dish bar) are renderer rules, not options.
- Against the inventory's 35 stars: 41 here, of which 3 are the guest-feature screens' own and 6 are folds or cuts of starred rows; the set covers every part of the page at least once, the five screens included.
- To stage first (they cost more than CSS): the design record and the heading font (Data), allergens by name and the dish page kind (Branch), the Order's line photos (Branch), and the three values that need the R8 ruling and its contract test. Text size and density are CSS but touch every component's stylesheet, so they land with the renderer, not after it.
- Unknowns carried from the inventory: whether Bulgarian law requires the portion on a menu (it is never hidden here either way); Bulgaria's rule on non-prepacked allergen information; the heaviest weight of Lora and Playfair Display.

## 7. Questions for Martin

Each is worded so that "yes" accepts the recommendation.

1. **A Style sets the heading font and the screen** (Classic's serif, Club's Unbounded and dark screen) and never the three colours, the Advanced roles, the logo or the body font; after the switch everything is editable, and the Style tiles are drawn in the venue's own colours and body font. Yes?
2. **"Dish page only" is allowed for the description, the choices summary and the photos**, with the contract test changed for those three slots (R8), and never for the name, price, allergens, state, portion or label. Yes?
3. **Sold out has one fixed look** (visible, faded, labelled, no "+") with no option in the designer, and the shell's `hide` setting is decided as a menu rule outside the designer or removed. Yes?
4. **Allergens are numbers or names now, icons later**, and never a single "Allergens" button. Yes?
5. **Venues live today move to the Editorial Style at the switch**, so no live menu changes beyond the four small places named in §4, and new venues start on Plain. Yes?
6. **Corners and depth become words** (square, soft, round, extra; none, low, high) that reach cards, chips, sheets and the order bar on phones, replacing the two sliders. Yes?
7. **The five guest-feature screens get three options of their own now** (icons on Call a waiter, rows on the Bill, line photos on the Order) and otherwise inherit the general looks; everything else about them waits for D122's template work, and the switcher shows every screen from the start. Yes?
8. **Content is content:** no switch hides the intro, a section's description or its image; a venue that does not want one deletes it. Yes?
