# Menu template functionality

What a guest can do in a menu. The `template-design` skill reads this file first and the `template-review` skill checks against it first (D105). The designer guide (`docs/guides/shell-handoff/visualization-shell.md`) holds the *how*; this file holds the *what*, with a pointer per entry.

**The rule (D105).** A template draws every entry whose status is `supported` or `drawn, platform parked`; a brief may exempt entries, each named explicitly. A case this file leaves open is a stop-and-ask, and a template missing a required entry stays hidden (D69).

**Statuses.** `supported`: the platform runs it today. `drawn, platform parked`: templates draw it and guests see it once the platform supports it (D71). `decided, not in the contract yet`: decided, no face contract; not drawn. `planned`: a direction only; not drawn.

`scripts/menu-template-functionality.test.ts` fails when the shell knows a feature key this file lacks, a status is outside the four, or a drawn entry names no guide section or decision. When the test and this file disagree, fix this file.

## Browsing

### Browse sections and sub-sections
- **Shell key:** none (always drawn)
- **Status:** supported
- **Drawn means:** every section with its title, its own items first and then its sub-sections, in view-model order, with a way to jump between sections.
- **Where:** §5.2 R2, §7.3, §9.5; D69

### Read an item
- **Shell key:** none (the `item.*` slots)
- **Status:** supported
- **Drawn means:** name, price, description (cut only with a way to read the rest), photo, portion, dietary labels, tags, badges, extra fields and the choices an item offers; an empty optional slot collapses; the dish page opens at `#item-<id>`, from a control marked `item.open` (a template without a dish page draws none).
- **Where:** §7.2, §7.3, §5.2 R7 to R10 and R12, §9.5; D69

### See whether an item can be had (sold out, scheduled, unavailable)
- **Shell key:** none (slot `item.state`)
- **Status:** supported
- **Drawn means:** each state is visibly different and legible, with the shell's label (a scheduled item shows when it opens), and the menu says when the whole menu is closed (`menu.schedule`); a sold-out item stays visible, with no order control.
- **Where:** §5.2 R1 and R5, §7.2, §9.5, App. C 5; D69

### Find allergens
- **Shell key:** none; has no switch of any kind
- **Status:** supported
- **Drawn means:** every item that lists allergens shows them, or a visible control that opens them, in the mode the manifest declares, with the codes explained, in every layout and on every screen size, and never dependent on hover or on a feature.
- **Where:** §5.2 R6, §7.5, App. A; D71

### Browse a horizontal section
- **Shell key:** none (`hints.layout` of a section)
- **Status:** supported
- **Drawn means:** a section the composer marks horizontal is a row the guest scrolls sideways; any other section is the usual list. Native scrolling of a focusable row counts as the tap-and-keyboard alternative; no drag code is needed.
- **Where:** §8.1, App. C 19; D92

### Change the menu layout
- **Shell key:** none (`view.layout` of the menu)
- **Status:** supported
- **Drawn means:** the page starts in the layout the composer set (list, one column or two columns); when `guestSwitch` is true the guest can switch layout, and the choice is kept for the visit.
- **Where:** §8.1, App. C 19; D92

### Filter the menu
- **Shell key:** `filters` (manifest `filters`, slot `menu.filters`)
- **Status:** supported
- **Drawn means:** a control to narrow the menu by dietary label and tag, drawn only when `view.features.filters` is on, with a way to reset; when nothing matches, the message `strings.noMatches` with a reset control labelled `strings.clearFilters`; it needs no table code.
- **Where:** §5.5, §7.2, §7.3; D71

### Switch the language
- **Shell key:** none (host prop `languages`)
- **Status:** supported
- **Drawn means:** a language switch, marked `menu.language`, when the menu has two or more languages, calling `onLanguageChange`; text in another language than the page's carries `lang`.
- **Where:** §5.2 R3, §7.5, §7.6; D69

### See the table code
- **Shell key:** none (host prop `tableLabel`)
- **Status:** supported
- **Drawn means:** the confirmed table's label shown as the shell's "Table 12" string; nothing when there is none.
- **Where:** §7.6, §9.1; D71

## Services

A service control is drawn only when its `view.features` field is on, and carries its `menu.*` slot (§5.5). Each acts on a table, so it needs a confirmed table code (D71, D100). All of them follow D72: the template draws the host's state and sends commands, and shows pending, then accepted or rejected.

### Call a waiter
- **Shell key:** `callWaiter` (manifest `call_waiter`, slot `menu.call_waiter`); request kinds `waiter`, `bill`, `water`, `cutlery`, `terminal`, `other`
- **Status:** drawn, platform parked
- **Drawn means:** a control that offers the request kinds the venue allowed, a note, the state of each request and a way to withdraw it.
- **Where:** §5.5, §10.2, §10.3; D71, D72

### See the bill
- **Shell key:** `bill` (slot `menu.bill`)
- **Status:** drawn, platform parked
- **Drawn means:** the table's bill as the host holds it (rounds from guests and staff, line statuses, total); the template adds up nothing.
- **Where:** §5.5, §10.2, §10.3; D71, D72

### Order from the phone
- **Shell key:** `ordering` (slot `menu.bag`)
- **Status:** drawn, platform parked
- **Drawn means:** a control on each orderable item, marked `item.add`, that puts the dish in the bag; the bag with the item's choices (modifier groups and options), quantities and a note, a send that waits for the host's answer, and a rejected order that keeps the bag.
- **Where:** §5.5, §7.2, §10.2, §10.3, §10.5; D71, D72

### Pay
- **Shell key:** `pay` (slot `menu.pay`)
- **Status:** drawn, platform parked
- **Drawn means:** the choice of scope (all, a share, only mine), tip and promo code, and method, drawn from the host's quote, each method control marked `pay.method`; the template computes no total, tip, VAT or split.
- **Where:** §5.5, §10.2, §10.3; D71, D72

### Get the receipt
- **Shell key:** none; a screen of the pay feature (`#receipt`)
- **Status:** drawn, platform parked
- **Drawn means:** the paid receipt as the host issued it (marked `pay.receipt`, reached from a `pay.receipt_open` control on the paid screen), with a button only for each action the receipt supports.
- **Where:** §10.1, §10.2; D71, D72

## Later

### Request a song from the DJ
- **Shell key:** none yet
- **Status:** decided, not in the contract yet
- **Drawn means:** nothing yet; the slot and contract wait for the song-request port (T82, Q78).
- **Where:** D99, D100

### Reserve a table
- **Shell key:** none yet
- **Status:** planned
- **Drawn means:** nothing; reservations are a hosted page first, after ordering from the menu.
- **Where:** D101

---

Revised by: `build.md`, `change.md`, `decide.md` and `ship.md` of the `restro-flow` skill, whenever a step adds, changes or removes something a guest can do in the menu, in the same change; `template.md` when a template's brief exempts an entry.
