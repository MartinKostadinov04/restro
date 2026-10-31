# The menu designer: acceptance guide (for Martin)

> Filed 2026-10-30 by the agent building #171 (spec #168). For: Martin's acceptance of the menu designer stage on `st/foundation`. Each later ticket of the stage adds its own section here. The set-up is the same as the ordering guide's

Each check is one thing to see; if it is not as written, note it and go on.

## Before you start (once)

Follow "Before you start" in [the ordering guide](2026-10-30-ordering-acceptance-walk.md), on the branch `st/foundation`. Two things read differently from that guide now: there is no test template any more, and Demo Bar draws **Basic**, the plain Style every venue starts on. After `pnpm db:seed:dev`, publish Demo Bar once (Demo Bar › Composer › Publish).

## A. The renderer (#171): what you can see today

Every venue's menu is now drawn by one renderer, in a Style. Basic is a plain, readable menu; Editorial is the look the guest page had until now.

- **Basic on a phone:** open Demo Bar's guest page. A plain list: names, prices and allergens readable at a glance, nothing cut off, no sideways scrolling.
- **A phone, a tablet and a PC:** widen the browser window from phone width to full width. The menu stays readable and nothing sticks out.
- **Sold out leaves the menu (D131):** in the Composer, mark a drink sold out. Within 20 seconds it is gone from a guest page that is already open, with no reload, and no "Sold out" label is left in its place. Put it back on sale and it returns.
- **A POS item off sale:** an item the POS has off sale is not on the guest page either.
- **Old menus:** a menu published before this change still opens, and is drawn by the renderer.

To switch Demo Bar to Editorial, pick its tile on the Design page in the Studio (section D), press Done, then publish. The automatic tests check Editorial against today's look; its only differences are the ones written in its Style file, and the note, email and promo boxes growing from 15 to 16 px so a phone doesn't zoom in on them.

## B. Before any pilot: ordering and paying on the renderer (Martin 10-30)

**Do this once the Style tiles are in (#175), and before any pilot.** Your acceptance of the ordering and paying guides covered how they behave on the old test template. This is the same walk on the screens real guests will see.

Run it **twice, once with Demo Bar on Basic and once on Editorial** (pick the Style in the Studio, then publish). Each round, at a table, as a guest on a phone and as staff on the bar tablet:

**As a guest:**

- **The order:** the ordering guide's Section D: add items, a second phone on the table sees the same order, raise a quantity, remove a line, Undo, Send, and the line moves to the bill.
- **When something goes wrong:** the ordering guide's Section E: a Send the POS doesn't answer, and the reference to show a waiter.
- **The location check:** the ordering guide's Section G: the question, Allow, a phone that is too far away, Call a waiter and Cancel.
- **Paying:** the paying guide's Section C: the bill, choosing lines, the tip, the card form, Paid and the Payment confirmation.
- **Pay first at Send (once #258 lands):** the paying guide's Section D, "What you check on the renderer": Send reads "Send and pay {x}", one tap sends the rest and opens the payment, the tip row sits on the order screen, and "Pay later" keeps the line as "Not ordered until paid".

**As staff:**

- **Tonight before guests:** the ordering guide's Section C on the bar tablet: open a table, and the guest's order reaches the table.
- **Tonight during the night:** the ordering guide's Section F: sent orders, calls from guests, pausing a table.
- **Tonight and payments:** the paying guide's Section E: the table's payments as staff see them, on the tablet and a manager's phone.

**On both Styles, look at:** every sheet (the bag, the bill, Pay, Call a waiter, the Payment confirmation) reads well on the phone and every button is easy to tap. Note anything that works on one Style and not the other: that is a bug in the renderer, not a Style's choice.

## C. The browsing pages' options (#172): what you can see today

The renderer now draws the options of the browsing pages. Choosing them comes with the Advanced pages of the Studio in a later ticket (#176), so until then you see them in two places: **Basic** on Demo Bar, which changed once with this ticket (see the first check), and the look of **Editorial**, which did not change at all. To see any other value now, ask the lead for a preview of it.

**What changed on Basic, once, for good:**

- Bars and sheets are lighter: the header and the rail sit on the page colour, the sheets on the panel colour.
- A photo fills its box with no frame around it, and a dish name and its price stand on one line.
- Section titles have a thin line above them.
- A dish page opens with the photo right at the top of the screen, in its own 4:3 shape, and the name and price bar stays at the bottom of the screen.

**What the options do, with a value you can look for:**

- **Header:** on a band of the panel or dark colour; title centred or on one line with the logo; title and logo in four and three sizes.
- **Navigation:** the current section underlined or a filled pill; the rail on the header's band. A pill on a band always reads in the band's two colours, never the accent.
- **Sections:** the title ruled, plain, centred or on a band that runs to the screen's edges; three sizes; capitals. Strip cards in three sizes.
- **Items:** rows, cards or open; name in three sizes and weights, in capitals; the price at the end of the line or under the name; a portion beside the price or on its own line; one, two, three or all description lines; the layout and the guest switch.
- **Photos:** four shapes; cover or contain; four backdrops; bleed or inset; corners. A section's image stays 16:7 with the design's corners whatever these say, and a list's small photo stays square at the end of the row.
- **Labels:** outlined, soft or plain words, on the dish and in the filter sheet.
- **Dish page:** a large photo, or a small square one at the name's end.
- **Sheets and footer:** panel, page or dark colour.

**Checks you can do today:**

- **Basic on a phone:** open Demo Bar's guest page at phone width. The names and prices read at a glance, each price on its name's line, nothing cut off, no sideways scrolling. Open a dish: the photo reaches the top of the screen, and the bar with the name and price sits at the bottom.
- **A long label:** nothing on a Basic row runs off the screen, and a price at the end of a row is always there to read.
- **The layout switch:** tap the three layout icons on a section. Every vertical section changes; a strip that scrolls sideways does not.
- **Editorial is the same as before:** a venue on Editorial looks exactly as it did before this ticket.
- **The layout for all menus:** it is on the Design page now (section D), and the guest page follows after you publish.

## D. The Studio and the Design page in Simple (#175)

Open Demo Bar in the admin, on a computer first, in English and then in Bulgarian.

- **The tabs:** the first tab reads **Studio**. Inside it are **Structure** and **Design**. Structure is the screen you know, with the Guest functions card under it, and no "Layout" in its menu bar.
- **The page:** Design opens a full page: the editing panel on the left, the preview on the right, on a phone's width. "Back to the Studio" is at the top.
- **The widths:** tap Phone, Tablet, PC. The menu lays itself out as it would on that device, shrunk to fit. Open a dish: its sheet stays inside the preview.
- **A Style:** there are two tiles, Basic and Editorial, each a little picture of your menu in your colours. Tap Editorial: the preview changes at once, and your colours, logo and body font stay.
- **Colours and fonts:** change the brand colour, then the body and heading fonts. The preview follows each change at once, and "Unsaved" shows beside the buttons.
- **Undo:** tap Undo. The last change goes back; tap it until it greys out, and you are where you started.
- **Cancel:** change a few things and tap Cancel. Everything since the last save is gone, without asking.
- **Leaving:** change something and tap "Back to the Studio": it asks first, and "Keep editing" keeps your changes. Closing the browser tab warns too.
- **Done:** change the Style and tap Done. A message says guests see it on the next publish. Open the guest page: **still the old look**. Publish: now it has the new one.
- **Two people at once:** open the Design page in two browser windows. Change something in each. Tap Done in the first, then in the second. The second says someone else saved, stays on the screen until you close it, and shows the first one's design.
- **A plain member:** sign in as someone who is a member and not an owner or admin. The page opens, says only owners and admins can change the design, every control is greyed out, and there is no Done or Cancel.
- **On a phone:** open it at phone width. The preview is under the panel and scrolls inside itself. Done and Cancel stay at the bottom of the screen wherever you scroll. Nothing runs off sideways, including the long Bulgarian words.
- **A venue from the till and a venue made by hand:** both get the same page.

## What to report

For each check: as written, or what you saw instead, and on which Style.
