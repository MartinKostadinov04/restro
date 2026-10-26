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
- **Status:** supported
- **Drawn means:** a control that offers the request kinds the venue allowed, a note, the state of each request and a way to withdraw it.
- **What the platform does (#81, D122 §4):** the host answers a `service.request` as one call for the table. The request kind and the note are not kept: it keeps no text and no identity. It needs the table open for phones, not a location pass. A second tap while a call is open returns that call. The call appears in `state.requests` as one request (`kind: waiter`): `sent` while open, `done` when staff mark it Handled, and `rejected` when nobody answered in the venue's time (15 minutes by default), which the template words as "Ask your waiter". The host refuses `calls_off` where the venue has not switched the service on: the template draws the still card "Please order from your waiter" there, never a button. Withdrawing a call (`service.cancel`) is not built.
- **Where:** §5.5, §10.2, §10.3; D71, D72, D122 §4

### Confirm being at the table (the location check)
- **Shell key:** none (host `services.state.location` and `services.location`)
- **Status:** drawn, platform parked
- **Drawn means:** (the platform runs it since #76, on the hidden reference template only) where the venue checks location, a phone needs a pass from the table's current sitting before it sees the table's order and bill or adds to or changes a line on the bill; removing a line, Undo and paying never need one. The host asks and checks; the template only draws what `location.prompt` says, with the shell's words:
  - `consent`: the consent text (`locationConsent`, naming the venue from `location.venueName`) with "Allow" (`allow()`) and "Not now" (`decline()`), never a promise of anything else; nothing is asked before the guest tries something that needs it;
  - `checking`: "Checking your location…" while the phone reads its position;
  - `failed`: "We could not confirm you are at the venue" with why, and two ways on: where the venue takes waiter calls (`view.features.callWaiter` is not null), "Call a waiter" (sends a `waiter` request, then `dismiss()`); where it does not, the still card "Please order from your waiter" (`locationOrderFromWaiter`), never a button; and always "Cancel" (`dismiss()`);
  - while `location.state` is `needed` and no prompt is up: why the order and the bill are hidden, and the guest's own "Allow location" (`reopen()`), which brings the consent back after a "Not now";
  - the position never reaches the template: it goes from the host to the server and nowhere else, and the template stores, logs and shows none of it.
- **Where:** §10.2, §10.3; D72, D118, D122

### See the bill
- **Shell key:** `bill` (slot `menu.bill`)
- **Status:** drawn, platform parked
- **Drawn means:** the table's bill as the host read it from the POS (#74), the template adds up nothing; where the venue checks location, only once the phone holds a pass (see the location check):
  - its lines, from guests and staff alike, nothing marking a line as "from your phones": the name of our own item, or "Other item" (worded by the shell) where the POS line is no item of ours; the quantity as the POS gives it, which may be a decimal ("0.5"); the POS's own signed amount, so a discount shows negative and a free line at 0, as the POS gives them;
  - the POS's total, what is paid and what is still owed, and a part being paid marked as such;
  - when it was read. When the latest reading failed, the last good bill is drawn marked as not up to date, never an empty bill. Opening the bill asks the host for a fresh reading when the one shown is older than 15 seconds.
- **Where:** §5.5, §10.2, §10.3; D71, D72, D111

### Order from the phone
- **Shell key:** `ordering` (slot `menu.bag`)
- **Status:** drawn, platform parked
- **Drawn means:** (the platform runs the shared order since #75, on the hidden reference template only; Send follows in #77; where the venue checks location, adding and changing lines and seeing the order need a pass, #76) a control on each orderable item, marked `item.add`, that puts the dish in the table's order; the order (the bag) with each line's choices (modifier groups and options), quantity and note; a send that waits for the host's answer, and a rejected send that keeps the order. The order is the table's, not the phone's:
  - every phone at the table sees and edits the same lines (`services.state.order`); a line someone else added is drawn like one's own, and the template marks no line as "mine";
  - a line the host is still saving (`pending`) is drawn as such; a refused edit goes back to what the server holds and shows the shell's words for its refusal code (`refusals`), never a success of its own;
  - a line being paid (`held`) has no controls; a pay-first line (`mode: pay_first`) says "Order this from your waiter" (`orderFromWaiter`);
  - a removed line stays for 10 seconds with Undo (`removed`, `undoSeconds`), and an order left idle for 30 minutes is set aside as the "Earlier order" with Restore (`earlier`);
  - when the host says ordering is paused or the table closed (`ordering.state`), or that the phone is offline (`offline`), the template says so with the shell's words.
- **Where:** §5.5, §7.2, §10.2, §10.3, §10.5; D71, D72, D117, D121

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
