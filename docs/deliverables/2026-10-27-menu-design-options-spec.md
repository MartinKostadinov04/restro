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
- Where the bill, pay and filter entries sit: fixed in the venue bar; the waiter and the Order live in the order bar (§3.11).

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
- The add control ("+" or "Add"): the Order page owns it (§3.11).
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
- The order bar, floating or docked: the Order page owns it (§3.11). The veil: fixed.

Markers: `sheet`, `footer`.

### The guest-feature screens

Decision 1.8: the five screens are pages of the designer from the start, each with its own table by the same rule as the Items page. The admin preview draws them with demo data under the "Preview" marker (D71), so their tiles and the preview show the real screens. What D72 and D122 fix is never an option and stays in the never-list: the words, the states and their order, every amount and line, the waiter reference at 40 px and 7:1, the consent text, the "Preview" marker. Every look is designable now. The five inherit General (colours, screen, fonts, weights, text size, density, corners, depth, buttons), the sheet colour (§3.8) and the labels look (§3.6) for their choice chips, with D93's selected roles. Three looks are shared and owned once: the status panel (Call a waiter), the rows and the lines (Bill). Derived, not options: input fields (the note, the custom tip, the promo code, the e-receipt email) follow the labels look (outline → boxed, soft → filled, text → underlined); secondary buttons (Edit, Remove, Cancel, "with the waiter", the receipt's actions) are quiet outlines with the strong border whatever the Style; primary buttons take General's Buttons.

### 3.9 Call a waiter

Today: a grid of the allowed kinds, each an icon and a word; a note for "something else"; Send; then one status panel (a mark, a title, a hint) with Cancel or "New request".

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Kinds | tiles, list, words | tiles | The allowed kinds as a grid of icon-over-word tiles; as rows with a small icon at the start; or as rows of words alone | (a) a venue with two kinds (waiter, bill) wants rows, one with six a grid; Classic wants words, Club tiles; (b) CSS; 44 px; the chosen one by D93's selected roles, never by colour alone |
| Status | centred, inline | centred | The state of a request, a sent order or a payment as a big centred mark with its title under it (as today), or as a quiet line: the mark beside the title, left-aligned, the hint under | (a) a club wants the big tick, a bistro the quiet line; (b) CSS; the same panel serves the Order and Pay, which follow this value; `role=status` and `role=alert` stay |

Fixed by D72 and D122, never an option: the kinds the venue allows, the request's words and states, the still card "Please order from your waiter" until the staff screen takes calls.

**Out, and why.**
- The note field's look: follows the labels look (derived, above).
- The waiter entry (icon and word) in the order bar: the order bar's (§3.11).
- A status banner that keeps the kinds visible while a request is open: a flow change (one request at a time, then "New request", is D72's contract), not a look.
- Cancel and "New request": secondary and primary buttons, General's.

Markers: `call`, `call.kinds`, `status`.

### 3.10 Bill

Today: an intro line; lines with quantity, name, options, a status word and the amount; the host's total; "View receipt"; "Pay €46,00". D122: the bill is the POS's, drawn as it is read, discounts and free lines included, no "from your phones" marking; the reading's age is shown.

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Rows | ruled, zebra, open | ruled | The lines separated by thin rules, alternating bands, or space alone; the Order's lines, the pay summary and the receipt follow | (a) a long club bill reads better zebra, a short one open; (b) CSS; the amounts never change |
| Frame | flat, card | flat | The bill flat on the sheet, or on a panel-coloured card with General's corners, like a slip; the receipt follows | (a) a slip reads "restaurant", flat reads "app"; (b) CSS on `surface` |
| Lines | detailed, compact | detailed | Options and notes on their own lines under the name (as today), or one row per line with the options inline after the name in smaller text; the Order and the receipt follow. Nothing is folded away: every option a guest chose stays readable | (a) a club with twelve lines wants one row each, a restaurant the full line; (b) CSS; the status word and the amount keep their place |
| Total place | bottom, top | bottom | The total and the Pay button after the lines (as today), or pinned at the top of the sheet with Pay beside it and the lines under | (a) a club wants the number first, a restaurant reads the lines first; (b) CSS, sticky inside the sheet; the amount is the host's |

Fixed by D72 and D122, never an option: every line and amount as the POS gives them, the reading's age, the line states and their words, "Ask your waiter to split this bill".

**Out, and why.**
- Names only, options folded: a guest must see what is charged (the lines on the bill are in the never-list); the compact line keeps the options.
- Grouping by sent order or by time: the bill is drawn as the POS gives it (D122 §4), and grouping needs data a reading may not have.
- Status marks as chips or words: follow the labels look (outline and soft → a chip in D93's status roles, text → the word), derived.
- The bill entry in the venue bar ("Bill · €46,00"): follows the header band; it shows the total once there is a bill, fixed.
- Unit prices beside the line totals: the face adds up nothing and shows the lines as given (D72).

Markers: `bill`, `bill.lines`, `bill.total`.

### 3.11 Order

Today: a round "+" by the price that turns into a stepper; a floating pill at the bottom with the waiter button and "View order · approx. €X"; the sheet with lines (name, options, note, Edit, Remove, stepper, amount), the estimate row, Send. D122: the Order is the table's, shared by every phone; Send names the table and the count; the states show on every phone.

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Add control | plus, add | plus | On an orderable item, a round "+" by the price that becomes a stepper once the item is in the Order (as today), or a small "Add" pill that does the same | (a) a bar wants "+", a restaurant the word; Classic's word, Club's plus; (b) Branch, small; 44 px; the word is the shell's |
| Order bar | floating, docked | floating | The bar at the bottom as a pill floating above the edge (as today), or docked full-width to the bottom edge; its fill is General's Buttons | (a) app look against system look; Club docked, Editorial floating; (b) CSS; safe-area insets; 44 px; hidden while a sheet is open, as today |
| Line photos | shown, hidden | hidden | A small photo on each line of the Order | (a) a photo-led menu wants them, a text menu does not; (b) Branch, small: a line resolves its item live, so the image is there |

Fixed by D72 and D122, never an option: Send's words (the table and the count), the states on every phone, the "Show this to your waiter" panel at 40 px and 7:1, the sold-out line and "Send the other 4", the duplicate check, the note field only with the capability, pay-first lines, the location consent, last orders, the estimate labelled "approx." from core's money module.

**Out, and why.**
- Line layout: the Bill's Lines (§3.10), shared.
- The stepper's look: one stepper per renderer, shaped by General's corners and buttons; a second shape is a minor detail.
- Where the estimate sits: in the estimate row, fixed. D122 gives the Send button its words ("Send 3 items to Table 7"), so the row is the one place for the money.
- The Send button's style: General's Buttons, wide at the foot of the sheet.
- The count badge on the "+" and on the bar: fixed.
- The sent panel: the Status of §3.9.

Markers: `order`, `order.bar`, `item.add`.

### 3.12 Pay

Today: "What to pay" as a segmented choice (the whole table, an equal share with a people stepper, only mine); the tip as chips (none, the host's percentages, custom) with an input; the promo code in a fold; the allergy line; the quote's rows (subtotal, tip, VAT lines, total); the methods as wide buttons (Apple Pay in Apple's look, "with the waiter" quiet); then the status panel.

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Scope | segmented, stacked | segmented | The three choices in one segmented control (as today), or as three tall rows one under the other, each a 44 px target | (a) a venue with big tables wants the choice to read as a list, a bar the compact control; (b) CSS; the same three words; D93 selected roles |
| Tip | chips, rows | chips | None, 10 %, 15 %, custom as chips (as today), or as rows that also show the host's amount for each ("10 % · €4,60") | (a) a restaurant wants the money shown, a bar the chips; (b) CSS; the amounts are the quote's `tipOptions`, never computed (D72); "none" is always the first choice |
| Methods | list, tiles | list | The methods as wide buttons one under the other (as today), or as tiles side by side | (a) a club with two methods wants two tiles, a restaurant a list; (b) CSS; Apple Pay keeps Apple's own look in both; "with the waiter" stays a quiet secondary in both |
| Promo field | folded, open | folded | The promo-code field behind a "Promo code" fold (as today), or open from the start | (a) a venue that runs codes wants it seen, one that does not wants it out of the way; (b) CSS; the field exists only when the host's quote has a promo slot |

Fixed by D72 and D122, never an option: every row of the quote (subtotal, tip, each VAT line, the total, "per person"), the allergy line, the methods the host allows, the e-receipt email only under D122's five conditions, "Download" as the provider's confirmation, the words of processing, paid, failed and unknown. Whether the tip is asked on the Bill or here is #45: a flow, not a look.

**Out, and why.**
- Summary density (the total alone, the breakdown behind a tap): the amounts on the quote are never hidden; General's density already tightens the rows.
- A tip stepper: it hides the choices behind taps and makes "no tip" harder to find; chips and rows keep every choice visible.
- The pay button: the method buttons are the pay buttons; their fill is General's Buttons.
- The custom tip and the promo inputs: fields follow the labels look (derived).
- The status panels: the Status of §3.9.

Markers: `pay`, `pay.scope`, `pay.tip`, `pay.methods`.

### 3.13 Receipt

Today: a page with Back; the venue's name, the table and the time; the lines; VAT, tip, total, method and references; PDF, email and print only where the receipt offers them. D122: the venue issues the fiscal receipt; what the app shows is the provider's confirmation and is never called fiscal.

| Option | Values | Proposed base | Plain words: what changes for the guest | Why it is in (a/b) |
|---|---|---|---|---|
| Layout | detailed, compact | detailed | Every row at body size with its label (VAT included 20 %, Method, Reference), as today; or the lines tight, with the VAT rows, the method and the references in small type under the total. Every row stays | (a) a bar wants the one-glance version, a restaurant the full statement; (b) CSS; nothing is folded away |
| Venue block | name, logo | name | The venue's name at the top (as today), or its logo from General with the name small under it; without a logo, the name | (a) a branded confirmation against a plain one; (b) CSS; the `logo` token |

Fixed by D122, never an option: every line and amount, the method, the references, the title and wording, the actions only where offered, "never called fiscal".

**Out, and why.**
- Frame and rows: the Bill's (§3.10), shared.
- A paper-slip look with a dashed edge: it dresses the provider's confirmation as a fiscal document (D122 §8); the card frame is as far as it goes.
- The actions' look: secondary buttons, General's.

Markers: `receipt`, `receipt.venue`.

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
| Call kinds | tiles | tiles | tiles | words | tiles |
| Status | centred | centred | centred | inline | centred |
| Bill rows | ruled | ruled | open | open | zebra |
| Bill frame | flat | flat | card | card | flat |
| Lines | detailed | detailed | detailed | detailed | compact |
| Total place | bottom | bottom | bottom | bottom | top |
| Add control | plus | plus | plus | add | plus |
| Order bar | floating | floating | floating | docked | docked |
| Order line photos | hidden | hidden | shown | hidden | hidden |
| Pay scope | segmented | segmented | stacked | stacked | segmented |
| Tip | chips | chips | chips | rows | chips |
| Methods | list | list | list | list | tiles |
| Promo field | folded | folded | folded | folded | folded |
| Receipt layout | detailed | detailed | detailed | detailed | compact |
| Venue block | name | name | logo | name | logo |

Notes on the columns.
- **Editorial** changes in four small places, each forced by a rule or a fold: its 9–11 px marks, chips, allergen numbers and table label rise to the 12 px floor; the strip crop and the dish photo become 4:3; the card description shows three lines beside a photo too (today two); its fixed shadows become the `low` step. Everything else is as drawn today.
- **Club** keeps its header on `panel`, not `ink`: on the dark screen an ink band is light. Tight spacing is density compact and one description line; large names are size l, heavy; wide strips are card size l; the pills sit on the header's band.
- **Classic** is a text list where the venue uploads no photos (a photo, when there is one, is drawn: R8): labels as words, allergens by name, a serif heading font, centred section headers over open rows. The heaviest weight Lora and Playfair Display serve is unverified (inventory); `heavy` may fall back to bold on those two faces.
- **Soft** is the app look: round corners, cards, panel bands, soft chips, pills, square photos, open rows and photos on the Order lines.
- **The five screens** follow each Style's temper: Club takes compact lines, the total first, a docked bar and method tiles; Classic takes words for the kinds, the quiet status line, a card slip, the "Add" word, a docked bar and tip rows with amounts; Soft takes the stacked scope rows and the logo on its receipt; Basic and Editorial keep today's looks.

## 5. The never-list, as a contract clause

No option, in any Style and at any value, may hide, move, re-colour, resize below its floor or change:
- an item's **name**, never cut; its **price** and its "from" on a priced item, in the ink, never struck through, never smaller than the body text;
- the **allergens** and a way to read their meaning, on every layout and screen size, never behind hover or a feature;
- every part an item has, on its row: the description (cut only with "more"), photo, portion, labels, marks, extra fields and the choices summary (R8); an option places, sizes and styles them, never removes them;
- the **state and its label** of every item that is drawn (a scheduled item's "from 18:00", an unavailable one), and "Ask your waiter"; an item drawn as not available is never orderable and never moved. Whether a sold-out item is drawn at all is the shell's rule (D22, under review), never a design option;
- the **order** of sections, items, groups and options (R2); every placement drawn once (R7);
- the **closed-menu note**, the **table label**, the **language switch** with two or more languages, and every **guest-feature control** whose feature is on (R15);
- the **words, states, amounts and lines** of the five guest-feature screens (D72, D122): the bill, the quote and the receipt, the sent order's states on every phone, the waiter **reference** at 40 px and 7:1, the consent text and the "Preview" marker;
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
| Call a waiter | 2 (kinds, status) | — |
| Bill | 4 (rows, frame, lines, total place) | — |
| Order | 3 (add control, order bar, line photos) | add control, line photos (Branch, small) |
| Pay | 4 (scope, tip, methods, promo field) | — |
| Receipt | 2 (layout, venue block) | — |
| **Total** | **53** | 7 to stage |

- The largest component page is Items with nine; General has eleven as the group. Seven exist today (colours, screen, body font, corners and depth as numbers, the menu layout and the guest switch as menu settings); the Style row replaces the template chooser.
- Every option appears on exactly one page. Four starred rows are folded, not cut: marks into labels, the footer band into sheets, the title's weight into the heading weight, page-wide capitals into the two case options. Two "less" rows are kept: depth (it now reaches phones) and portion place. Cut on Martin's word of 10-27: every option that takes a part off the item row (the inventory's starred choices summary, the description and the photos on the dish page only) and any sold-out option. Rail alignment, marks place, sub-section title size and the sticky dish bar are renderer rules, not options.
- Against the inventory's 35 stars: 53 here, 15 of them the five guest-feature screens' own by the same rule (of the 21 candidates weighed for them, 13 are in, one of those shared as the Bill's Lines, and 8 are cut on their pages; the Bill's frame and the promo field are added), and 2 Martin's additions of 10-27 (layout, guest switch); every part of the page has at least one choice, the five screens included.
- To stage (they cost more than CSS): the design record, the heading font and the layout's move to the venue (Data); allergens by name, the dish page kind, the add control and the Order's line photos (Branch). Nothing needs a contract change. Text size and density are CSS but touch every component, so they land with the renderer, not after it.
- Unknowns carried from the inventory: whether Bulgarian law requires the portion on a menu (it is never hidden here either way); Bulgaria's rule on non-prepacked allergen information; the heaviest weight of Lora and Playfair Display.

## 7. Questions for Martin

Each is worded so that "yes" accepts the recommendation.

1. **A Style sets the heading font and the screen** (Classic's serif, Club's Unbounded and dark screen), never the three colours, the Advanced roles, the logo or the body font; everything is editable after the switch. Yes?
2. **Allergens are numbers or names now, icons later**, and never a single "Allergens" button. Yes?
3. **Corners and depth become words** (square, soft, round, extra; none, low, high) that reach cards, chips, sheets and the order bar on phones, replacing the two sliders. Yes?
4. **One status look, one rows look and one lines look serve all five guest-feature screens** (owned by Call a waiter and the Bill), instead of a setting per screen. Yes?
5. **Content is content:** no switch hides the intro, a section's description or its image; a venue that does not want one deletes it. Yes?
6. **The menu layout and the guest switch are venue-wide, on the Items page**; a section's own layout in Structure still wins where it is set, the guest's switch applies to every vertical section, and strips never switch. Yes?
