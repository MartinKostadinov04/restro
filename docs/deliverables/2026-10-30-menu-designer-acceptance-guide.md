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

You can't switch Demo Bar to Editorial from the Design tab yet: the Style tiles come with the Studio (#175). The automatic tests check Editorial against today's look; its only differences are the ones written in its Style file, and the note, email and promo boxes growing from 15 to 16 px so a phone doesn't zoom in on them.

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

## What to report

For each check: as written, or what you saw instead, and on which Style.
