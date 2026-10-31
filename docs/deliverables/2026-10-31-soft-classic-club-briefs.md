# Soft, Classic and Club: the briefs the three Styles were made from

> Filed 2026-10-31 by the agent building #178 (spec #168, closes T87). For: Martin's acceptance of
> the three remaining premade Styles, and the record of why each of their forty-five values is what
> it is (D114). The Style files are `packages/shell/src/design/styles/{soft,classic,club}.ts`

A Style is a preset of the design contract: one value for every option, drawn by the one renderer
(D128). It never sets the venue's colours, Advanced roles, logo or body font — those are the brand,
and they stay whatever the venue chose when it picks a Style.

The starting values for all three are the options spec's §4 table
([2026-10-27-menu-design-options-spec.md](2026-10-27-menu-design-options-spec.md)) with the
independent review's defaults ([2026-10-27-menu-design-options-review.md](2026-10-27-menu-design-options-review.md),
"Net effect"). Eight options of that table no longer exist — the review ditched the header's written
title, the status look, the bill's frame and total place, the pay scope, methods and promo field, and
the receipt's layout — so where a column asked for one of their values, the Style takes the fixed
default instead. Each Style's file lists in `departures` every value that stands off its column.

## How the values were judged

There is no preview while a Style is being written, so each value was read in the renderer's own
stylesheet (`packages/faces/editorial-market/src/css.ts`, `services/services-css.ts`): the rule keyed
on `data-<page>-<option>="<value>"` is what that value draws. Two things only a reading of the
stylesheet shows, and both decided a value below:

- **In two columns the price keeps its size while the name drops a step.** The renderer holds the
  price at or above the description's size, so at the medium name size a two-column card draws a
  13.5 px name over a 15 px price.
- **An item's name is drawn in the Heading font**, not the body font (`.rm-section h4`). A Style that
  picks a heading font picks the font of its item names with it.

## Soft

**The temper.** Soft is the app look. Everything on the page is a rounded card with a soft shadow
under it, each menu line a row with a square thumbnail at its end, the header on a band of the panel
colour, the section marks filled pills, the labels soft fills instead of outlined boxes, and the
order lines carry the dish's photo. It is the Style for a venue whose guests already order food on
their phone every week and expect a menu to feel like one of those apps: nothing sharp, nothing
printed, everything tappable.

**What it sets, and why.**

| Page | Values | Why |
|---|---|---|
| General | round corners, light shadow, comfortable, accent buttons, the body font for headings at bold | Round corners (16 px) and the one depth step are the whole look; the venue's own font carries it, so Soft fits any brand. |
| Header | the panel band, centred, medium title and logo | A panel-coloured band is an app's top bar; centred keeps the logo over the title. |
| Navigation | pills on the page | The filled pill is the app's section mark; on the page band it draws in the accent. |
| Sections | plain headers, medium title, as written, medium strip cards | The cards carry the page, so the headers stay quiet. |
| Items | cards, medium name at bold, as written, price at the end, 2 description lines, the list layout, the guest switch on | A card per row with the price at the end of the name's line is what a guest scans in an app. |
| Photos | square, fill the frame, panel backdrop, edge to edge, corners as in General | Square is the app thumbnail; the card clips it, so the round corners come from General. |
| Labels | soft, numbers | A soft fill is the app's chip. |
| Dish page | sheet, large photo | A sheet slides up over the menu, as an app's does. |
| Sheets | panel | The sheets sit a step off the page, like the cards. |
| Guest screens | tiles, ruled rows, detailed lines, "+", a floating bar, photos on the lines, tip chips, the logo on the receipt | Photos on the order lines is Soft's own line (the brief's), and the floating "+" is the app's add control. |

**Departures.** Two, both in the file: the list layout instead of two columns (two columns would draw
the price larger than the name, and two columns is already Editorial's layout), and ruled bill rows
instead of the open rows the brief asked for (one of the four values the review removed).

## Classic

**The temper.** Classic is a printed menu read on a phone. No frames, no shadows, square corners, a
centred serif title, section names centred in capitals with a rule either side, the whole description
on every line, labels as plain words, and the allergens written out by name instead of numbered. It is
the Style for a restaurant that has a menu card it is proud of and wants the phone to read like it —
quiet, typographic, no app furniture at all.

**What it sets, and why.**

| Page | Values | Why |
|---|---|---|
| General | Playfair Display for headings at the regular weight, square corners, flat, comfortable, ink buttons | A serif at the weight a book sets, on a flat page, is the whole Style. Ink buttons keep the accent out of it. |
| Header | the page band, centred, large title, medium logo | No band at all: the title stands on the page like the top of a menu card. |
| Navigation | underline on the page | A rule under the current section, not a pill. |
| Sections | centred headers, medium title, capitals, medium strip cards | Centred capitals with a rule either side is the printed section head. |
| Items | open, medium name at the regular weight, as written, price at the end, all description lines, the list layout, the guest switch off | No frame around a line, and the whole description: a menu card cuts nothing. The guest switch off keeps the one layout the venue set. |
| Photos | landscape, fill the frame, panel backdrop, edge to edge, corners as in General | Classic expects few photos; the one that exists is still drawn (R8), landscape and square-cornered. |
| Labels | text, names | Words, not boxes; and the allergens by name, which the footer then lists by name too. |
| Dish page | full page, large photo | A dish gets a page of its own, as a chapter would. |
| Sheets | page | A sheet is the page colour: no panel step anywhere. |
| Guest screens | list kinds, ruled rows, detailed lines, "Add", a docked bar, tip rows, the name on the receipt | The word "Add", a docked bar and tip rows with amounts: words rather than symbols, everywhere. |

**The heavy fallback does not apply.** Classic's heading weight is `regular`, and Playfair Display
serves 900 anyway (`packages/core/src/theme/fonts.ts`). Of the six fonts only Lora (700) and Manrope
(800) fall back, and only at the Heavy weight: a venue that moves Classic's heading weight to Heavy
on Lora gets bold.

**Departures.** Two, both in the file: list kinds for Call a waiter instead of the brief's `words`,
and ruled bill rows instead of `open` — both values the review removed from the set.

## Club

**The temper.** Club is the dark club night. The screen is dark whatever the guest's phone says, the
venue name and every section and dish name are set in Unbounded at its heaviest weight in capitals,
the spacing is tight and each line shows one line of description, so a long drinks list fits a screen
read standing up. Section names run as full-width bands, the section marks are pills on the header's
band, the bill alternates its rows, its lines are compact and the order bar is docked at the bottom of
the screen. It is the loudest Style in the set, and the one made for the pilot's room.

**What it sets, and why.**

| Page | Values | Why |
|---|---|---|
| General | the dark screen, Unbounded headings at Heavy, soft corners, light shadow, tight density, accent buttons | Dark and a display face at 880 is the club. Tight density is what fits a drinks list; the corners stay soft so the dark panels do not look cut out. |
| Header | the panel band, one line, medium title, large logo | The band stays on `panel`: on a dark screen the ink band is the light one, which would lay a white bar across the top. One line with a large logo is the club's door sign. |
| Navigation | pills on the header's band | A pill on a band takes the band's own pair, never the accent, so it reads in the dark. |
| Sections | on a band, large title, capitals, large strip cards | A full-width band in Unbounded capitals is the Style's one bold move. |
| Items | rows, large name at Heavy in capitals, price at the end, 1 description line, the list layout | Large heavy capitals read at arm's length in dim light; one description line keeps the list short. |
| Photos | square, fill the frame, panel backdrop, edge to edge, corners as in General | Square photos on the strip cards and the dish sheet; the list's own thumbnail is square anyway. |
| Labels | soft, numbers | A soft fill on a dark panel; numbers keep a line short. |
| Dish page | sheet, large photo | A sheet over the dark menu. |
| Sheets | panel | One step off the dark page. |
| Guest screens | tiles, alternating bill rows, compact lines, "+", a docked bar, tip chips, the logo on the receipt | Zebra rows and compact lines are what a long night's bill needs; the docked bar is always under the thumb. |

**Departures.** Two lines in the file, both about values the review removed: Club asked for method
tiles, the total at the top of the bill and a compact receipt, and gets the list of methods, the total
at the bottom and the detailed receipt that every Style now has; the pay scope, the promo field and
the status panel went the same way. None of the three is a look the renderer cannot draw — each is a
look the whole set lost, so none is a stop-and-ask.

## What Martin accepts

Each Style's checks are in section F of
[2026-10-30-menu-designer-acceptance-guide](2026-10-30-menu-designer-acceptance-guide.md). The three
tiles appear on the Design page beside Basic and Editorial with no further work: the page, the tests
and the seed all read the list of Style files.
