# The menu design options, component by component

Made by: spec subagent (Fable, max effort) for the menu designer grilling, 2026-10-27, at Martin's request. A proposal for Martin to grill; it binds nothing until the decision log and a D-number say so.

It builds on the component inventory (`2026-10-27-guest-menu-component-inventory.md`), the decision log (rows 1.1–1.12), the editing-model proposal (§1–2A) and the research synthesis; the inventory's facts are not repeated. Where it cuts a starred option or keeps a "less" one, it says why.

## 1. How to read this

- An option is **in** only if (a) a venue owner would plausibly want it to differ between venues, and (b) one renderer can draw every value well on a phone from 320 px up, with every §7.5 rule of the designer guide and the inventory's "never hidden or changed" block kept. Everything else is **out**, with its reason in one line. Nothing is taken off the item row: a part with content is always drawn there (R8; Martin 10-27), so an option places, sizes and styles a part, never removes it.
- Sizes are the words s, m, l (xl once), never pixels; every value is a short lower-case token, so a Style is a list of words and nothing else. The three colours stay the one free value, contrast-checked as today (D70, D93).
- **Basic** is the base Style of decision 1.2. Every base value here is a proposal, not a settled default: Martin decides the base after the option set (10-27), so the tables say "proposed base". **Editorial** is Editorial Market as drawn today. *Feasibility* uses the inventory's words: CSS, Branch (different markup), Data (a new stored field).
- Simple shows General's first three rows (Style, colours, fonts); Advanced shows General whole, then the component pages (decision 1.11). The menu layout and the guest switch move from the composer into the designer as venue design settings (Martin 10-27, §3.4); a section's own item layout stays a Structure setting (decision 1.5) and is not in this list.
- Each page names the `data-design-part` markers it owns, so a tap on the preview opens the page that owns the part; in Simple a tap on an Advanced part opens General with a "styled in Advanced" line and a switch.

## 2. General

General is Simple's three controls and, in Advanced, every page-wide setting. The logo is uploaded here beside the colours; it is a brand asset, not an option, and is not counted.

| Option | Values | Proposed base | What the guest sees change |
|---|---|---|---|
| Style | basic, editorial, soft, classic, club; then the venue's own designs under "My menu designs" | basic, for every venue until it changes (Martin 10-27: live venues are not moved to Editorial) | Every option on every page changes at once to the Style's values; the colours, logo and body font stay (below) |
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

Corners and depth replace today's two sliders with four and three words (inventory Q6); corners now reach chips and sheets, depth now reaches phones. Editorial Market's `--rm-shadow` reaches only wide screens, but its sheets, strip cards and "+" carry fixed small shadows: those become the `low` step.

**What a Style sets, and never sets (recommendation).** A Style sets every option on every page, heading font, screen, corners and depth included; it never sets the three colours, the Advanced roles, the logo or the body font. Classic's serif and Club's display face are the Style's voice, the body font is the venue's reading voice; Club is dark or it is not Club; colours and logo are the brand (inventory Q7, proposal §1.1). This narrows the proposal's "colours, fonts and logo stay" and the inventory's "not set: colours, logo, fonts, screen, corners" to one list. Everything is editable after the switch, and a Style's tile is drawn in the venue's own colours and body font, so a tile never lies (Q1).

**Out, and why.**
- One page-wide "capitals" (inventory ★): split into section title case (§3.3) and item name case (§3.4), where a tap on a title lands.
- A weight of its own for the menu title: follows the heading weight.
- Showing or hiding the intro: content; an intro the venue does not want is deleted, not hidden (Q5).
- The header name: per menu, content (D92), not a look.
- Colour presets: none (D92); a Style never carries colours.

Markers: none for the page as a whole; `button` opens General at Buttons.

## 3. The component pages, in the order a guest meets them

### 3.1 Header

The venue bar (logo, table label, language switch, the bill, pay and filter entries) and the title block (the h1, the intro, the closed-menu note).

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Band | page, panel, ink, accent | page | The colour behind the logo and title: the page, the panel colour, a dark ink band, or the accent. On the dark screen an ink band turns light (the roles swap); dark on dark is panel | (a) the strongest brand statement on the page; (b) CSS; §5.4 pairs: ink writes in `background`, accent in `onAccent`, page and panel in `text`; never `muted` on a band |
| Arrangement | stacked, centred, compact | stacked | The logo row, then the title and intro under it; everything centred; or the logo and title on one line with the intro folded under (the h1 stays) | (a) centred reads "restaurant", left reads "editorial", one line reads "app"; (b) CSS grid areas |
| Title size | s, m, l, xl | m | How big the menu's name is; it wraps, never cut | (a) a club wants its name huge, a bistro modest; (b) CSS |
| Logo size | s, m, l | m | The box the logo fills; a wordmark needs width, an emblem does not | (a) "can the logo be bigger?" is the first thing owners ask; (b) fixed boxes, no layout shift |
| Title | shown, hidden | shown | With a logo that carries the name, the written name can go; the h1 stays for screen readers, the intro and the closed-menu note stay. Ignored without a logo | (a) a wordmark beside its own name reads twice; (b) CSS |

**Out, and why.**
- A sticky venue bar (inventory: less): the rail is already sticky and carries the jump; a second sticky layer takes a third of a 568 px phone.
- The language switch look (pills or codes; less): never hidden, 44 px either way, two values a few pixels apart.
- The table label's look: fixed; it is the guest's proof of where the order goes.
- Where the bill, pay and filter entries sit: waits for D122's screens (§3.9–3.13).

Markers: `header`, `header.logo`, `header.title`.

### 3.2 Section navigation

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Marker | underline, pills | underline | The current section is underlined in the accent, or sits in a filled pill (D93 `selected` and `selectedText`) | (a) pills read "app", underline reads "print"; (b) CSS; the active one is shown by shape, not colour alone |
| Band | page, header | page | The rail sits on the page, or continues the header's band under it: one dark top block when the header is ink or panel | (a) the app-bar look clubs want; (b) CSS; the same pair rules as the header |

Derived, not options: the rail's alignment follows the header arrangement (centred header, centred rail while the names fit); its weight and case follow the section titles; it appears only with two or more sections, as today.

**Out, and why.** Section tiles before the menu: adds a tap (inventory: no). A sheet listing every section (less): if a long menu needs it, that is functionality every renderer gets, not a look. Rail text size: General's text size.

Markers: `nav`.

### 3.3 Sections

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Header | plain, ruled, centred, band | ruled | The title alone; a thin rule above it; the title centred between short rules; or the title on a strip of the panel colour | (a) the strongest rhythm cue of a menu; (b) CSS; the band is `surface` under `text`, so it needs no colour hint; the inventory's colour band through `hints.color` is dropped (no setter, no pair beyond `onColor`) |
| Title size | s, m, l | m | How big section titles are; a sub-section's title one step smaller | (a) a spirits list against restaurant courses; (b) CSS |
| Title case | written, capitals | written | Section titles as written, or in capitals | (a) classic menus capitalise; (b) CSS `text-transform`, checked on all-caps Cyrillic (the hostile-names fixture) |
| Strip card size | s, m, l | m | How wide each card of a horizontal section is; the next card always peeks | (a) three big "top picks" against a scrolling row of small ones; (b) CSS; the row stays focusable |

**Out, and why.**
- A section's own item layout (list, one, two, strip): stays a Structure setting on the section (decision 1.5); it starts from the design's layout (§3.4).
- Section image and description shown or hidden (less): content; delete it instead (Q5).
- A section icon: no icon set exists (inventory: no, for now).
- Space between sections: density.
- The strip's photo shape: follows Photos (one crop per page); Editorial's 1.22:1 becomes 4:3 (inventory Q10).

Markers: `section`, `section.title`, `strip`.

### 3.4 Items

The product row or card inside a section.

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Frame | rows, cards, open | rows | A thin line between items; each item in a panel-coloured card with General's corners and depth; or nothing but space | (a) Martin's own example: cards, or no card around each product; (b) CSS; the card edge is decoration, the 44 px tap area stays |
| Name size | s, m, l | m | How big item names are; never cut | (a) Club's large names; (b) CSS |
| Name weight | regular, bold, heavy | bold | How heavy item names are, apart from the headings | (a) a classic list in regular, a club in heavy; (b) CSS |
| Name case | written, capitals | written | Names as written, or in capitals | (a) Editorial's signature; (b) CSS, Cyrillic checked |
| Price place | end, under | end | The price at the end of the name's line, or on its own line under the name | (a) bars read the price at the end of the line, Editorial puts it under; (b) grid; the price is never smaller than the body text and always visible |
| Portion place | beside, own | beside | "12,50 € · 50 ml" beside the price, or the portion on its own line | (a) bars read ml by the price; (b) CSS; the portion is never hidden (the law is unknown, inventory) |
| Description lines | 1, 2, 3, all | 2 | How much of the description the row shows before "more"; the rest is one tap away on the dish page | (a) a cocktail list wants one line, a bistro all; (b) R9: a cut always has the dish page behind it, and the description never leaves the row (R8) |
| Layout | list, one, two | list | Every vertical section as a list of rows, one column of big cards, or a two-column grid. A section's own layout from Structure wins where set; strips stay strips | (a) a drinks list against a photo grid; (b) exists today as a menu setting (D92), moved to the venue's design (Martin 10-27); the snapshot's `layout` field stays |
| Guest switch | on, off | on | Whether the guest can switch the layout for the visit, with the three icon buttons under the first section | (a) some venues want one fixed look; (b) exists today (D92); applies to every vertical section, never to a strip (Q6) |

**Out, and why.**
- The add control ("+" or "Add"): waits for D122 (§3.11).
- Taking a part off the row: the description, the choices summary (inventory ★) or the photo on the dish page only. Martin 10-27: a part with content is always drawn on the row, and R8 stays as it is.
- A dotted price leader: breaks on 60-character names (inventory: no).
- Price colour, ink or accent (less): the price must be the calmest, most legible thing on the row; ink always wins, and accent text is already the state label's and the marks' colour.
- Extra fields inline or as rows (less): a minor detail.
- Anything per item: no (inventory §4, market scan).

Markers: `item`, `item.name`, `item.price`, `item.description`, `item.choices`, `layout.switch`.

### 3.5 Photos

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Shape | square, landscape, wide, portrait | landscape | The crop of item photos in one- and two-column sections and in strips, 1:1, 4:3, 16:9 or 4:5 around the focal point; list thumbnails stay square | (a) food wants 4:3 or square, bottles portrait, a promo strip wide; (b) a reserved aspect and `objectPosition`, no layout shift |
| Frame | bleed, stage | bleed | The photo fills its box edge to edge, or sits on a panel-coloured stage with a margin (Editorial) | (a) stage reads "catalogue", bleed reads "app"; (b) CSS on `surface` |

**Out, and why.** Photos on the dish page only (less): Martin 10-27, nothing comes off the row; a venue that wants a text list uploads no photos. The thumbnail's side in the list (less): it sits at the end so name, price and allergens keep one column. Thumbnail size in the list: a minor detail. Photo corners: General.

Markers: `item.photo`.

### 3.6 Labels, allergens and state

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Labels | outline, soft, text | outline | Dietary labels, tags and the filter chips as outlined chips, soft-filled chips, or plain words. Marks ("New") follow as the loud version: a filled accent pill for outline and soft, an accent word for text | (a) text suits long drink lists, soft suits Soft; (b) CSS; the 12 px floor (Editorial's 10 px rises); `selected` and `selectedText` for chips |
| Allergens | numbers, names | numbers | Boxed numbers on the item, explained in the footer and the sheet; or the names in words ("Gluten · Milk") on the item, with the sheet behind them | (a) a bistro reads names, a bar reads numbers; (b) Branch, both from the data; never hidden, never hover-only, the codes always explained (R6). The manifest's `allergen_mode` becomes this value, and the contract test checks the chosen one |

**Out, and why.**
- Marks as their own option (inventory ★): folded into labels; a loud "New" beside quiet labels is the one combination that works.
- Marks place (less): on the photo when there is one, else before the name: derived.
- Allergen icons: later, once 14 icons are drawn and checked for recognisability (inventory Q4).
- Allergens behind one "Allergens" button: hides the codes before the order (inventory: no).
- Sold out: no option either way. Martin 10-27: an item that is no longer available is not drawn at all (this reverses D22 and is being confirmed); whichever way it lands, the shell decides what is drawn and the designer only styles what is.
- The state label's look: fixed, the shell's label in accent text; it must read the same on every venue's menu.

Markers: `item.labels`, `item.marks`, `item.allergens`, `item.state` (opens this page; its panel says the state's look is fixed).

### 3.7 Dish page

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Kind | sheet, page | sheet | The item opens as a tall sheet over the menu, or as a full page with Back | (a) sheet reads "app", page reads "catalogue", and long descriptions want the page; (b) Branch, small: the overlay has both looks already; `#item-<id>`, Back and the dialog rules hold for both |
| Photo | hero, small | hero | The photo full width at the top, or a small square beside the name | (a) a gin and tonic does not want a hero; (b) CSS; the crop follows §3.5 |

Always on the dish page, with no option: the name, the price, the whole description, the state and its label, the allergens by name with the sheet, the portion, tags, marks and extra fields, and the choices with their deltas or the ordering part. Editorial leaves out tags, portion and marks today; the renderer draws them.

**Out, and why.** The sticky name-and-price bar (less): shown whenever the page scrolls, a renderer behaviour. Choices in one or two columns (less): the renderer takes two when every option is short.

Markers: `dish`, `dish.photo`.

### 3.8 Overlays and footer

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Sheets | page, panel, ink | panel | The colour of every sheet (filters, allergens, the dish sheet, the five guest-feature sheets), and of the allergen footer, which follows it | (a) Editorial's ink sheets against calm panel sheets; (b) CSS; the band rules of §5.4; inputs at 16 px |

**Out, and why.**
- The footer band as its own option (inventory ★): in all five Styles the footer wants the sheets' colour; folded. The footer is never hidden while the menu lists allergens.
- The filter place, sheet or chip row (less): the chip row fights the rail for the top of a small phone; the sheet works in every layout.
- Footer extras (address, hours, a legal line): content the snapshot lacks (inventory Q9).
- The order bar, floating or docked: waits for D122. The veil: fixed.

Markers: `sheet`, `footer`.

### The guest-feature screens

Decision 1.8: the switcher lists the five screens from the start. Each inherits the colours and screen, everything in General, the sheet colour (§3.8), the labels look for its choice chips (request kinds, pay scope, tips) with D93's selected roles, and the rows of §3.10. A screen with no option of its own still shows in the switcher, drawn in the current design, with the line "Its own options come with the ordering template (D122)". What D122 fixes is never an option: the words, the states, the waiter reference at 40 px and 7:1, the consent text, the "Preview" marker.

### 3.9 Call a waiter

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Icons | shown, hidden | shown | The request kinds as icon tiles, or as words only | (a) Classic wants words, Club icons; (b) CSS |

Waits for D122: the still card "Please order from your waiter" until the staff screen takes calls, the kinds the venue allows, the request's states.

Markers: `call`.

### 3.10 Bill

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Rows | ruled, zebra, open | ruled | The bill's lines separated by thin rules, alternating bands, or space; the Order's lines, the pay summary and the receipt follow | (a) a long club bill reads better zebra, a short one open; (b) CSS; the amounts never change |

Waits for D122: the POS's own lines with discounts and free lines, no "from your phones" marking, "Ask your waiter to split this bill", the Pay entry. Out: grouping by sent order, because the bill is the POS's (D122 §4).

Markers: `bill`.

### 3.11 Order

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
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

Basic is the base Style, its values a proposal (§1); Editorial reproduces Editorial Market as drawn today (inventory §5); Soft, Classic and Club are proposals in the spirit of Martin's one-line descriptions. The body font, the colours and the logo are not in the table: no Style sets them.

| Option | Basic (proposed) | Editorial | Soft | Classic | Club |
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
| Layout | list | two | two | list | list |
| Guest switch | on | on | on | off | on |
| Photo shape | landscape | landscape | square | landscape | square |
| Photo frame | bleed | stage | bleed | bleed | bleed |
| Labels | outline | outline | soft | text | soft |
| Allergens | numbers | numbers | numbers | names | numbers |
| Dish kind | sheet | page | sheet | page | sheet |
| Dish photo | hero | hero | hero | hero | hero |
| Sheets | panel | ink | panel | page | panel |
| Call icons | shown | shown | shown | hidden | shown |
| Bill rows | ruled | ruled | open | open | zebra |
| Order line photos | hidden | hidden | shown | hidden | hidden |

Notes on the columns.
- **Editorial** changes in four small places, each forced by a rule or a fold: its 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor; the strip crop and the dish photo become 4:3; the card description shows three lines beside a photo too (today two); its fixed shadows become the `low` step. Everything else is as drawn today.
- **Club** keeps its header on `panel`, not `ink`: on the dark screen an ink band is light. Tight spacing is density compact and one description line; large names are size l, heavy; wide strips are card size l; the pills sit on the header's band.
- **Classic** is a text list where the venue uploads no photos (a photo, when there is one, is drawn: R8): labels as words, allergens by name, a serif heading font, centred section headers over open rows. The heaviest weight Lora and Playfair Display serve is unverified (inventory); `heavy` may fall back to bold on those two faces.
- **Soft** is the app look: round corners, cards, panel bands, soft chips, pills, square photos, open rows and photos on the Order lines.

## 5. The never-list, as a contract clause

No option, in any Style and at any value, may hide, move, re-colour, resize below its floor or change:
- an item's **name**, never cut; its **price** and its "from" on a priced item, in the ink, never struck through, never smaller than the body text;
- the **allergens** and a way to read their meaning, on every layout and screen size, never behind hover or a feature;
- every part an item has, on its row: the description (cut only with "more"), photo, portion, labels, marks, extra fields and the choices summary (R8); an option places, sizes and styles them, never removes them;
- the **state and its label** of every item that is drawn (a scheduled item's "from 18:00", an unavailable one), and "Ask your waiter"; an item drawn as not available is never orderable and never moved. Whether a sold-out item is drawn at all is the shell's rule (D22, under review), never a design option;
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
| Items | 9 (frame, name size, weight and case, price place, portion place, description lines, layout, guest switch) | layout and guest switch (Data: a venue design setting instead of a menu setting) |
| Photos | 2 | — |
| Labels, allergens and state | 2 | allergens (Branch) |
| Dish page | 2 | kind (Branch, small) |
| Overlays and footer | 1 | — |
| Call a waiter | 1 | — |
| Bill | 1 | — |
| Order | 1 | line photos (Branch, small) |
| Pay | 0 | — |
| Receipt | 0 | — |
| **Total** | **41** | 6 to stage |

- The largest component page is Items with nine; General has eleven as the group. Seven exist today (colours, screen, body font, corners and depth as numbers, the menu layout and the guest switch as menu settings); the Style row replaces the template chooser.
- Every option appears on exactly one page. Four starred rows are folded, not cut: marks into labels, the footer band into sheets, the title's weight into the heading weight, page-wide capitals into the two case options. Two "less" rows are kept: depth (it now reaches phones) and portion place. Cut on Martin's word of 10-27: every option that takes a part off the item row (the inventory's starred choices summary, the description and the photos on the dish page only) and any sold-out option. Rail alignment, marks place, sub-section title size and the sticky dish bar are renderer rules, not options.
- Against the inventory's 35 stars: 41 here, 3 of them the guest-feature screens' own and 2 Martin's additions of 10-27 (layout, guest switch); every part of the page has at least one choice, the five screens included.
- To stage (they cost more than CSS): the design record, the heading font and the layout's move to the venue (Data); allergens by name, the dish page kind and the Order's line photos (Branch). Nothing needs a contract change. Text size and density are CSS but touch every component, so they land with the renderer, not after it.
- Unknowns carried from the inventory: whether Bulgarian law requires the portion on a menu (it is never hidden here either way); Bulgaria's rule on non-prepacked allergen information; the heaviest weight of Lora and Playfair Display.

## 7. Questions for Martin

Each is worded so that "yes" accepts the recommendation.

1. **A Style sets the heading font and the screen** (Classic's serif, Club's Unbounded and dark screen), never the three colours, the Advanced roles, the logo or the body font; everything is editable after the switch. Yes?
2. **Allergens are numbers or names now, icons later**, and never a single "Allergens" button. Yes?
3. **Corners and depth become words** (square, soft, round, extra; none, low, high) that reach cards, chips, sheets and the order bar on phones, replacing the two sliders. Yes?
4. **The guest-feature screens get three options of their own now** (icons on Call a waiter, rows on the Bill, line photos on the Order) and otherwise inherit; the rest waits for D122's template work, and the switcher shows every screen from the start. Yes?
5. **Content is content:** no switch hides the intro, a section's description or its image; a venue that does not want one deletes it. Yes?
6. **The menu layout and the guest switch are venue-wide, on the Items page**; a section's own layout in Structure still wins where it is set, the guest's switch applies to every vertical section, and strips never switch. Yes?
