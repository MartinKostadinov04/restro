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
- **Shell key:** `callWaiter` (manifest `call_waiter`, slot `menu.call_waiter`); request kinds `waiter`, `bill`, `ice`, `water`, `glasses`, `clean_table`, `terminal`
- **Status:** supported
- **Drawn means:** a control that offers the request kinds the venue allowed and the state of the table's call. Decided in #45 (D127, "The guest's bill screen", not in the contract yet; #180 builds it): the venue ticks options from Restro's fixed list `waiter` (always on), `bill`, `ice`, `water`, `glasses`, `clean_table`, `terminal` (off by default), which replaces today's kinds; with only `waiter` ticked it is a single button that calls at once; otherwise "Call a waiter" opens "What do you need?" with the ticked options. One open call per table: a later option is added to it, and the guest sees "Waiter called: Ice, Water" with "Something else". No note and no withdraw. It is also the way on from every failure screen of paying. Words: "Guest words: the bill and paying" below.
- **What the platform does (#81, #180, D122 §4):** the host answers a `service.request` as a request of one kind for the table; the note is not kept: it keeps no text and no identity. It needs the table open for phones, not a location pass. There is one open call per table: a later request of another kind is added to it, and a repeat of a kind changes nothing. The call appears in `state.requests` as one request per kind (`kind` the asked kind, all with the call's status and the call's id as `actionId`): `sent` while open, `done` when staff mark it Handled (once, for every kind), and `rejected` when nobody answered in the venue's time (15 minutes by default, counted from the newest request), which the template words as "Ask your waiter". The host refuses `calls_off` where the venue has not switched the service on: the template draws the still card "Please order from your waiter" there, never a button. It refuses `kind_not_offered` when the venue's list does not hold the kind. Withdrawing a call (`service.cancel`) is not built.
- **Where:** §5.5, §10.2, §10.3; D71, D72, D122 §4

### Confirm being at the table (the location check)
- **Shell key:** none (host `services.state.location` and `services.location`)
- **Status:** drawn, platform parked
- **Drawn means:** (the platform runs it since #76, on the hidden reference template only) where the venue checks location, a phone needs a pass from the table's current sitting before it sees the table's order and bill or adds to or changes a line on the bill; removing a line and Undo never need one. The host asks and checks; the template only draws what `location.prompt` says, with the shell's words:
  - `consent`: the consent text (`locationConsent`, naming the venue from `location.venueName`) with "Allow" (`allow()`) and "Not now" (`decline()`), never a promise of anything else; nothing is asked before the guest tries something that needs it;
  - `checking`: "Checking your location…" while the phone reads its position;
  - `failed`: "We could not confirm you are at the venue" with why, and two ways on: where the venue takes waiter calls (`view.features.callWaiter` is not null), "Call a waiter" (sends a `waiter` request, then `dismiss()`); where it does not, the still card "Please order from your waiter" (`locationOrderFromWaiter`), never a button; and always "Cancel" (`dismiss()`);
  - paying needs a pass too (#45, D127): without one the phone sees no bill and no order, so it has nothing to pay;
  - while `location.state` is `needed` and no prompt is up: why the order and the bill are hidden, and the guest's own "Allow location" (`reopen()`), which brings the consent back after a "Not now";
  - the position never reaches the template: it goes from the host to the server and nowhere else, and the template stores, logs and shows none of it.
- **Where:** §10.2, §10.3; D72, D118, D122

### See the bill
- **Shell key:** `bill` (slot `menu.bill`)
- **Status:** drawn, platform parked
- **Drawn means:** the table's bill as the host read it from the POS (#74), the template adds up nothing; where the venue checks location, only once the phone holds a pass (see the location check):
  - its lines, from guests and staff alike, nothing marking a line as "from your phones": the name of our own item, or "Other item" (worded by the shell) where the POS line is no item of ours; the quantity as the POS gives it, which may be a decimal ("0.5"); the POS's own signed amount, so a discount shows negative and a free line at 0, as the POS gives them;
  - the POS's total, what is paid and what is still owed, and a part being paid marked as such: a bill or a line with `beingPaid` is in some phone's payment that isn't final (#110), drawn greyed with no controls and nothing else, never who pays, how much or for how long; it ungreys when that payment ends;
  - when it was read. When the latest reading failed, the last good bill is drawn marked as not up to date, never an empty bill. Opening the bill asks the host for a fresh reading when the one shown is older than 15 seconds.
  - **Paid in the app (#197):** `tableBill.paidLines` (`PaidLineView`: the name per language, `null` for "Other item"; the quantity; the amount; no id, never who paid) holds the lines the POS closed on the sitting's captured payments, at what it closed them for (`payment_lines.closed_minor`, set by the last check: a voided or dropped line is not paid and never shows, a lower POS price shows at the POS's price), oldest payment first, at most `PAID_LINES_MAX`. Every phone at the table draws them greyed (the muted colour, no `aria-disabled`) under "Paid in the app", after the lines and the choosing. They leave with the sitting (a new sitting starts with none). When nothing is free to pay and paid lines exist, "Nothing on your bill yet" and the whole choosing block ("What are you paying for?", the totals, Pay) go: the bill shows what was paid. Decided in #45 (D127, "The guest's bill screen"; #114): lines paid in the app stay on the bill until the sitting ends; "Left to pay" is the total of the rest; "Nothing on your bill yet" when nothing is on it; a "Pay" button opens choosing (below), or the line "Ask your waiter to pay." where the venue does not take payments in the app; Call a waiter at the foot. Without a location pass: "The bill shows only at the table", why, "Allow location" and Call a waiter.
- **Where:** §5.5, §10.2, §10.3; D71, D72, D111, D127

### Order from the phone
- **Shell key:** `ordering` (slot `menu.bag`)
- **Status:** drawn, platform parked
- **Drawn means:** (the platform runs the shared order since #75 and Send since #77, on the hidden reference template only; where the venue checks location, adding and changing lines and seeing the order need a pass, #76) a control on each orderable item, marked `item.add`, that puts the dish in the table's order; the order (the bag) with each line's choices (modifier groups and options) and quantity, and a note only where notes reach the POS's ticket (`services.state.ordering.notesAndOptions`, see Send's guards); a send that waits for the host's answer, and a rejected send that keeps the order. The order is the table's, not the phone's:
  - every phone at the table sees and edits the same lines (`services.state.order`); a line someone else added is drawn like one's own, and the template marks no line as "mine";
  - a line the host is still saving (`pending`) is drawn as such; a refused edit goes back to what the server holds and shows the shell's words for its refusal code (`refusals`), never a success of its own;
  - a line being paid (`held`) has no controls; a pay-first line (`mode: pay_first`, an item the guest pays for before it goes, #113) is paid at Send where the host says pay-first is on (`ordering.payFirst` `on`), and says "Order this from your waiter" (`orderFromWaiter`) where it is `off` (the POS can't open a bill for a first round, paying is off, or the venue doesn't use pay-first at this table); while it is `paused` the line stays and is not sent;
  - a removed line stays for 10 seconds with Undo (`removed`, `undoSeconds`), and an order left idle for 30 minutes is set aside as the "Earlier order" with Restore (`earlier`);
  - when the host says ordering is paused (`ordering.state` `paused`, #79: staff paused all bars or this table's bar, Restro paused the venue's connection to its POS, or this table is paused after an order it could not confirm), the template says "Ordering is paused right now, please order from a waiter" (`orderingPaused`) and keeps the order as it is: the lines stay, Send is not offered, and no cause or countdown is shown. A sent order waiting to go when the pause starts comes back Not sent with its lines back on the order; one already being sent finishes and shows its own state. When the pause lifts the template offers Send again with nothing to do on the phone;
  - the venue's night (#82, D122 §4): the host's `ordering.night` says where the night stands. From 10 minutes before last orders (`last_orders`) the template shows "Last orders at 04:30" (`lastOrdersAt`, the time the host names in `at`) and Send still works. After last orders, and all night on a weekday the venue is closed (`closed`), it shows "Ordering from phones has closed for tonight" (`orderingClosedTonight`); before the venue opens (`opens_later`) it shows "Ordering from phones opens at 22:00" (`orderingOpensAt`). In both of those Send is not offered and the order is kept as it is; a Send that still arrives is refused `ordering_closed`. The bill, Call a waiter and paying are not touched. At the venue's closing hour every table closes (the template's usual "table is not taking orders" state, and its order is emptied). A venue that has not set its hours is never gated, and the host says `open`;
  - when the table is closed (`ordering.state` `closed`), the template says so with the shell's words;
  - when the phone has a weak signal (`services.state.offline`), the template says "Weak connection. Nothing new was sent yet, we keep trying." (`offline`) and claims no success: nothing on the phone changes until the host answers again;
  - Send (#77) says how many items go ("Send 3 items", `sendItems`), sends the on-the-bill lines no payment holds as an `order.send`, and draws nothing new until the host answers; there is no cancel after Send (D116). A refused Send keeps the order and shows the refusal's words; `item_unavailable` names the item (`subjectId`, `itemUnavailableNamed`);
  - Send with pay-first lines (#113, D113): one tap. One Send carries both parts: the on-the-bill lines go as above, and the pay-first lines, as the phone saw them, go in the same `order.send` as its `payFirst` part with an optional tip, under the one Turnstile token, which opens their payment at once. The tip is offered only where the POS records one on closing (as under Pay; the host says so in `ordering.tips`, and the tip row shows only when it is true): 5, 10 and 15 % of the paid lines and "Other amount", none chosen to start with (`tipPercent` or `tipMinor`). Pay-first lines alone are a Send too (`lines` empty): when the guest leaves the card form, the pay-first lines stay on the order marked "not ordered until paid", with D117's "Pay 24 EUR" button (the ticked pay-first lines' amount) to try again, which is such a Send. The pay-first part becomes a payment: the host answers a payment handle as `pay.start` does, the lines stay on the order held for it (`held`), and the paying phone follows it through `GET /api/guest/payment` and the card form exactly as under Pay. Its states are Pay's, with `entered` (the round is on the POS) in place of `isolated`; the template draws one waiting state before `captured`. In the table's sent orders a pay-first round shows only once it is Added: while it waits, and when it is Not sent or unconfirmed, the host leaves it out of the list and its payment speaks for it. It ends `captured` (the round is on the bill of a payment table, closed and paid; the round shows in the table's sent orders as Added), `released` before the round reached the POS (its lines are back on the order: `below_minimum`, `busy`, `item_unavailable`, `paying_paused`, or the guest's `pay.cancel`), or `unconfirmed` once the round may be on the POS (`enter_unknown`, `entered_check_failed`, `close_unknown`): staff check it, the hold is never released on its own, and the template asks nothing more of the guest. A POS total lower than the hold is captured as the POS has it; a higher one is never charged. A Send whose pay-first part names a line that is not one of the order's free pay-first lines, or names one twice or with another quantity, is refused `order_changed`; a Send of pay-first lines alone may name some of them (the others stay for a later "Pay"), while "Send and pay" (with on-the-bill lines) names every one the phone has, else `order_changed`. A tip where the POS can't record one is refused `tip_not_offered`; where pay-first is not offered or paused it is refused `paying_not_offered` or `paying_paused` with the whole order kept. Pay-first rounds are paid before they go, so the cap, the pace and the duplicate question don't apply to them;
  - Send's guards (#78, D117, D118): a line whose item the live overlay shows sold out stays on the order, marked "Sold out" (`lineSoldOut`), and is not sent; the send then says "Send the other 4" (`sendOthers`). A round with the same items and quantities as one the table sent in the last 15 minutes is refused with `duplicate_order`, its `subjectId` naming that sent order: the template asks "Same as 4 minutes ago. Send another?" (`duplicateAsk`, counting from that sent order's `sentAt`), with Send another (`sendAnother`) and Cancel (`duplicateCancel`), and closes the question after 60 seconds. Send another is a new `order.send` with `confirmDuplicateOf` set to that sent order. A round over the venue's cap or past its pace is refused with `guard_tripped`: the template shows its words, and the host's state then says ordering is paused until staff resume the table. Where the venue's POS takes no notes or options on its ticket (`services.state.ordering.notesAndOptions` is not true; absent means not), the template draws no note field, shows "Allergies or special requests? Tell the staff." (`notesAtStaff`) under the order, and an item with a required choice shows "Order this from your waiter" (`orderFromWaiter`) instead of Add; a round that still carries one is refused with `order_from_waiter`, its `subjectId` naming the item. Where only a waiter opens the POS bill and the table has none yet, Send is refused with `needs_first_item` ("Ask your waiter to put your first item on");
  - the table's sent orders (`services.state.sentOrders`, newest first) show on every phone with their state: "Sending…" (`sendingNow`) only where `mine` is true, "Being sent" (`beingSent`) on the other phones, then "Added to your bill", "Waiting for the bar to take it" (only where the POS approves at the bar), "We couldn't send your order, please call a waiter" (Not sent; its lines are back on the order; "Ask your waiter to put your first item on" where only a waiter opens the POS bill, `sentNotSentFirstItem`), or "Not confirmed: show K7Q to your waiter" (`sentUnconfirmed`, for 15 minutes; the table's ordering pauses);
  - out of stock at Send (#80): when the POS says an item ran out, nothing of that order is sent; it ends Not sent with the reason `item_unavailable` and "Nothing was sent: something ran out. Send the rest when you're ready." (`sentNotSentOutOfStock`), and the run-out lines are flagged (`outOfStock: true` on the sent order's lines). On the order, the run-out line is drawn as a sold-out line (`isOutOfStock`: flagged on the newest sent order, `refusedOutOfStock`, or sold out on the menu): greyed with "Sold out" (`lineSoldOut`), left out of the next Send, and "Send the other N" (`sendOthers`) sends the rest with one more tap. The item turns sold out on the menu at the phones' next poll;
  - any phone can open "Show this to your waiter" (`showWaiter`, closed with `showWaiterClose`) for a sent order: its reference at least 40 px and at least 7:1 contrast, the time it was sent and its items (D120).
- **Where:** §5.5, §7.2, §10.2, §10.3, §10.5; D71, D72, D113, D116, D117, D118, D120, D121, D122, D124, D127

### Pay
- **Shell key:** `pay` (slot `menu.pay`)
- **Status:** drawn, platform parked
- **Drawn means:** (the shell contract is D127's since #114: the commands `pay.start`, `pay.returned` and `pay.cancel`, the bill `state.tableBill`, paying `state.paying`, this phone's payment `state.payment` and the form slot `services.payForm`; the old scopes, promo code and method controls are gone) the template computes no total, tip, VAT or split beyond the shell's preview of the choice (`choosePay`). Decided in #45 (D127, "The guest's bill screen"; #114, #113):
  - **The contract (#114, reviewed):** the tip is none where `ordering.tips` is not true (`choosePay` and `payStartCommand` take the flag), the ticks are not reconciled while this phone has a payment and "Pay again" only goes back to choosing (Pay then takes the guarded path), `unconfirmed` is read on until a manager answers ("Back to the bill" there keeps the handle), the form slot is given the guest's language and a failure word, `refusalText` words every refusal (`below_minimum` with the venue's own smallest payment, `rate_limited` on a pay command as "Too many tries"), the Paid screen shows the table, the no-location-pass screen shows why with Allow location and Call a waiter, and Call a waiter is on the card screen and every failure screen.
  - **Pay-first, ended "No receipt" (Martin 10-29):** the payment says `mode` (`bill` or `pay_first`); a released `pay_first` payment with the reason `no_receipt` is a round that reached the till and was not paid, so its screen says the order went through and the waiter takes the payment (`pay_first_unpaid`), and that round's line in the sent orders (`unpaid`) says "Ordered, not paid: pay your waiter" instead of "Added to your bill". On the bill the same answer stays "The payment wasn't completed"; "Not on the till" (the round never went) stays that too.
  - **The contract (#114):** `state.tableBill` is the POS's own bill (each line's `amountMinor`, `beingPaid`); `state.paying` is `on`, `paused` or `off` (no ids) with the smallest card payment (`minCardMinor`), who processes it (`processor`) and the last payment of this phone (`recent`, for "Same amount as 4 minutes ago"); `electronicReceipt` is reserved for #186 and false until a connector declares it. The shell's `choosePay`, `payBlock`, `payStartCommand`, `reconcilePicks` and `payScreen` (`@restro/shell`) are the same rules for every template: nothing ticked, presets 5, 10, 15 % of the ticked lines rounded half-up, the reason Pay is greyed, the `pay.start` with each line as the phone saw it, the ticks kept when a friend's round arrives, and which screen a payment shows. A template never loads a provider library (D72): while `payment.form` is set it puts an empty element where the card form belongs and gives it to `services.payForm.mount(element, { label, buttonClass })`, unmounting it when the form goes; the page fills it with the provider's form, which shows the provider's own text for a card error and sends `pay.returned`. "Back to the bill" is `services.payControls.dismiss()`. Contract tests for every template: `payScenarios()` in `@restro/shell/testing`.
  - **Choosing** ("What are you paying for?"): the lines free to pay, nothing ticked; "The whole bill"; a tick per line; a quantity menu (default "all") only where the connector can move part of a line; lines being paid greyed and not tickable ("Someone is already paying for this line." if tapped); the tip row; "Your items", "Tip", "Total"; the Pay button with the live total ("Pay 27,50 EUR"), greyed with its reason (the smallest card payment, a failed reading, card payments paused, ordering paused); the law lines (prices in EUR with VAT, complaints and refunds to the venue, "Payment processed by Stripe for [venue]", links to the venue's details and privacy); Call a waiter.
  - **The tip:** "Tip: goes to the venue" with 5 %, 10 %, 15 % (of the chosen lines) and "Other amount"; nothing selected; tapping a chosen one clears it; no tip row where the till can't record one. For pay-first lines the tip row sits on the order screen above "Send and pay 24 EUR".
  - **Pay-first:** Send with pay-first lines reads "Send and pay 24 EUR": one tap sends the rest and opens the pay-first payment. A guest who taps "Pay later" finds the pay-first lines in the order, "Not ordered until paid", with "Pay 24 EUR".
  - **While paying:** "Preparing your bill…" with "Pay later"; then the lines, tip, total, Stripe's card form (with Apple Pay and Google Pay) and "Pay 27,50 EUR" with "Pay later"; the bank's check inside the page; one waiting state "Processing your payment…". Card errors are Stripe's own text in its form. After the card is held there is no cancel.
  - **Same amount again:** within 15 minutes of this phone's payment of the same amount, "Same amount as 4 minutes ago. Pay again?" with "Yes, pay" and "Back".
  - **Paid:** "Paid", "Payment number" with the number in large type (at least 40 px, 7:1), the table, the lines, tip and total, "Show this number to your waiter. Your waiter brings your receipt.", "Payment confirmation" (see Get the receipt) and "Back to the bill". A closed or reloaded page comes back here.
  - **Ends:** "can't tell", `stranded` and `capture_failed` show "The venue is checking the payment" and "You don't need to do anything…"; each `released` reason has its own line (words below), with "Pay again" after `busy`, `check_failed` and a timed-out card form, always "Back to the bill" and Call a waiter. "Nothing was charged" wherever true; never a step of the till.
- **Platform (#110, D127; not wired to a template yet):** the guest API runs paying by card on the hidden reference path:
  - `pay.start` picks whole lines of the bill, or the whole bill, sends each picked line as the phone saw it (the knock, D111), an optional tip (an amount or a percent, starting at none), and Turnstile's token; it greys the lines for every phone (`beingPaid`) and answers a payment handle;
  - only the paying phone holds the handle and sends it in `X-Restro-Payment`, never in an address; the page keeps it in the browser's local storage for the sitting (per table code, until the service day ends, cleared when the server does not know the payment or the guest leaves a final screen), so a page closed and opened again finds its payment; `GET /api/guest/payment` answers that phone alone the payment's state, lines, amount, tip and, only while the guest is at the card form, the provider's form values;
  - `pay.returned` after the card form, and `pay.cancel` before the hold is made, which ungreys the lines;
  - the refusals the template words through the shell (#45): `paying_not_offered`, `paying_paused`, `being_paid`, `bill_changed`, `below_minimum`, `ask_waiter_to_split` (part of a line, a part-paid bill or a whole-bill discount), `turnstile`, `rate_limited`, `sitting_ended`, `too_late`, `unknown_payment`;
  - the hold is the POS's own amounts plus the tip, and a tip is offered only where the POS can record one on closing the bill (`ordering.tips`; the tip row shows only when it is true, and a tip elsewhere is refused `tip_not_offered`). No local success (D72): the template draws what the host's payment answer says.
  - after the hold the payment moves on with no guest step (#111), and the paying phone's payment answer says where it stands: `held` and `queued` (waiting for a payment table, at most a minute), `isolated` and `checked` (the lines left the table's bill and were checked), `closed` (the POS closed their bill), then `captured`, the paid screen ("Paid"). The template draws one waiting state for everything before `captured`, with no step of the till named. It can also end:
    - `released` (the hold is let go, the lines ungrey) with a reason the template words: `busy` (no payment table freed in a minute), `paying_paused`, `bill_changed`, `ask_waiter_to_split`, `check_failed` (the bill changed at the last check) or `isolate_refused`;
    - `unconfirmed`: the till didn't confirm the close; staff check it, so the template says the venue is checking the payment and asks nothing more of the guest. A manager's "Receipt printed" moves it on to `captured`, "No receipt" to `released`;
    - `stranded` (the lines could not go back to the table; staff are told) and `capture_failed` (the bill closed but the card was not charged; the owners are told): the template never asks the guest to pay again;
  - paying pauses with ordering (the venue's, its bar's, the table's or the connection's pause): a `pay.start` is refused `paying_paused`, and a payment still waiting for a payment table ends `released` `paying_paused`. A payment whose lines already moved runs to its end.
- **Where:** §5.5, §10.2, §10.3; D71, D72, D127

### Get the receipt
- **Shell key:** none; a screen of the pay feature (the Paid screen's "Payment confirmation")
- **Status:** supported
- **Drawn means:** the Paid screen's "Payment confirmation" button opens the page (`confirmationOf`, shell `confirmation.ts`; a captured payment only), with "Save" (`saveConfirmation`: the image through the phone's share sheet, else a `blob:` file revoked right after; no server, no lasting link). The time is the payment's `paidAt` on the venue's `timeZone`, the venue name is `paying.venueName`, and the line under it is "This is not your receipt…" (the emailed variant is `confirmReceiptEmailed`, for #186). The page opens over the Paid screen with the focus on its heading; its first control is "Back" (the guide's `same_no`, pending Martin's word for closing it), the opening button names it in `aria-controls`, and a failed Save shows the one line `confirm_save_failed`. The image is drawn as the page opens, so the Save tap can use the phone's share sheet; a download link is revoked after 40 s. The old receipt screen is gone since #114: no `receipt.action`, no `ReceiptView`, no `pay.receipt` marker, and no template draws a fiscal number, VAT lines or a receipt number (D127 1.4). Decided in #45 (D127): the venue issues the fiscal receipt and, at the pilot, the waiter brings it on paper; the Paid screen's "Payment confirmation" opens Restro's own page (#45 log 1.4): the venue's name, date and time, the lines, tip, total, "Paid by card" and the payment number, with "Save" (an image or PDF kept on the phone, never a lasting link) and "This is not your receipt. Your waiter brings the venue's receipt." It never looks like a receipt (no ЕИК/ДДС header, VAT lines, receipt number, УНП or QR code), never uses Stripe's receipt link, and no word of it is "бон" or any form of "фискален", in either language (Н-18 чл. 7а). **The venue's electronic receipt** (D127, Martin 10-28): where the venue's connector declares `electronicReceipt`, the pay screen offers an optional email; filled, the POS's own receipt goes to that address, and the Paid screen and the confirmation say so: "was sent" where Restro sends the POS's file, "was requested" where the POS sends it itself (Martin 10-29), and nothing of an email where none went out (the waiter brings paper). The field shows only where `ordering.receiptEmail` is true (the connector declares `electronicReceipt`, and, where it returns a file, a sender is configured); the host keeps the address typed with the payment's handle, never sent to the page's server again. Restro never draws the receipt. Until a connector declares it (each POS provider is being asked), no email field shows.
- **Where:** §10.1, §10.2; D71, D72, D127

## Guest words: the bill and paying

Decided in #45 (D127, "The guest's bill screen"; Martin read them in the prototype, 10-28). In the shell since #114 as `strings.services.paying` and the pay refusals (Bulgarian first). Martin approved the last ten rows on 10-29. Where the shell already has a word for the same thing (ordering's pause, weak connection, "Order this from your waiter"), the shell's word stays. `{x}` is an amount ("27,50 EUR" in Bulgarian, "27.50 EUR" in English), `{n}` a number, `{min}` the venue's smallest card payment, `{venue}` the venue's legal name, `{email}` the address the guest typed for the receipt. The Call a waiter options use #180's ids.

| Name | Where | Български | English |
|---|---|---|---|
| `tab_menu` | Phone tabs | Меню | Menu |
| `tab_order` | Phone tabs | Поръчка | Your order |
| `tab_bill` | Phone tabs | Сметка | Bill |
| `table` | Header | Маса {n} | Table {n} |
| `bill_title` | Bill | Сметката на масата | Your table's bill |
| `updated` | Bill: reading age | Обновено преди {n} сек. | Updated {n} s ago |
| `stale` | Bill: failed reading | Не е актуална · обновена преди {n} сек. | Not up to date · updated {n} s ago |
| `other_item` | Bill: a POS line that is none of ours | Друг артикул | Other item |
| `being_paid` | Bill: line in a payment | Плаща се | Being paid |
| `left_to_pay` | Bill: total | За плащане | Left to pay |
| `paid_in_app` | Bill: paid lines section | Платено в приложението | Paid in the app |
| `empty` | Bill: nothing owed | Все още няма нищо в сметката | Nothing on your bill yet |
| `pay_open` | Bill: opens choosing | Плати | Pay |
| `ask_waiter_to_pay` | Bill: paying is off at this venue | За да платите, попитайте сервитьора. | Ask your waiter to pay. |
| `pick_title` | Choosing | Какво плащате? | What are you paying for? |
| `whole_bill` | Choosing | Цялата сметка | The whole bill |
| `qty_all` | Choosing: quantity | всички ({n}) | all ({n}) |
| `tip_label` | Tip | Бакшиш: отива за заведението | Tip: goes to the venue |
| `tip_other` | Tip | Друга сума | Other amount |
| `your_items` | Totals | Избрано | Your items |
| `tip` | Totals | Бакшиш | Tip |
| `total` | Totals | Общо | Total |
| `pay_x` | Pay button | Плати {x} | Pay {x} |
| `legal_1` | Pay screen, law checklist | Цените са в EUR с ДДС. Рекламации и връщане на пари: заведението. | Prices in EUR incl. VAT. Complaints and refunds: the venue. |
| `legal_2` | Pay screen, law checklist | Плащането се обработва от Stripe за {venue}. | Payment processed by Stripe for {venue}. |
| `legal_links` | Pay screen, law checklist (links) | Данни за заведението · Поверителност | About the venue · Privacy |
| `below_minimum` | Pay greyed | Плащането с карта е от {min}. Добавете артикул или попитайте сервитьора. | Card payments start at {min}. Add an item or ask your waiter. |
| `not_up_to_date` | Pay greyed | В момента не можем да прочетем сметката. Опитваме отново. | We can't read the bill right now. We keep trying. |
| `cards_paused` | Pay greyed; ended: paying_paused | Плащането с карта е спряно в момента. Попитайте сервитьора. | Card payments are paused right now. Ask your waiter. |
| `ordering_paused` | Banner; Send and Pay greyed | Поръчването е спряно в момента. Моля, поръчайте от сервитьор. | Ordering is paused right now. Please order from a waiter. |
| `nothing_picked` | Pay greyed | Изберете поне един ред. | Choose at least one line. |
| `paying_not_offered` | Refusal | За да платите, попитайте сервитьора. | Ask your waiter to pay. |
| `being_paid_refused` | Refusal: ticking a greyed line | Някой вече плаща този ред. | Someone is already paying for this line. |
| `bill_changed` | Refusal | Сметката ви се промени, откакто я отворихте. | Your bill changed since you opened it. |
| `menu_changed` | Refusal at Send / pay-first | Менюто се промени, проверете поръчката си. | The menu changed, check your order. |
| `ask_waiter_to_split` | Refusal / ended | Помолете сервитьора да раздели сметката. | Ask your waiter to split this bill. |
| `too_late` | Refusal: cancel after the hold | Вече е късно за отказ: плащането се обработва. | Too late to cancel: the payment is being processed. |
| `rate_limited` | Refusal | Твърде много опити. Изчакайте малко и опитайте отново. | Too many tries. Wait a moment and try again. |
| `turnstile` | Refusal | Не успяхме да проверим заявката. Опитайте отново. | We couldn't check this request. Try again. |
| `unknown_payment` | Refusal | Не намираме това плащане. Попитайте сервитьора. | We can't find this payment. Ask your waiter. |
| `weak` | Banner | Слаба връзка. Още нищо ново не е изпратено, опитваме отново. | Weak connection. Nothing new was sent yet, we keep trying. |
| `same_q` | Friendly check | Същата сума като преди {n} мин. Да платите ли отново? | Same amount as {n} minutes ago. Pay again? |
| `same_yes` | Friendly check | Да, плати | Yes, pay |
| `same_no` | Friendly check | Назад | Back |
| `preparing` | Paying | Подготвяме сметката ви… | Preparing your bill… |
| `pay_later` | Paying (before the card) | Плати по-късно | Pay later |
| `declined` | Inside Stripe's form (Stripe's own text) | Картата е отказана. Опитайте с друга карта. | Your card was declined. Try another card. |
| `waiting` | Paying: one waiting state | Обработваме плащането… | Processing your payment… |
| `paid` | Paid | Платено | Paid |
| `paid_ref_label` | Paid | Номер на плащането | Payment number |
| `paid_receipt` | Paid | Покажете този номер на сервитьора. Сервитьорът ще ви донесе касовата бележка. | Show this number to your waiter. Your waiter brings your receipt. |
| `confirm_title` | Paid (button) and the confirmation page | Потвърждение за плащане | Payment confirmation |
| `paid_by_card` | Confirmation page | Платено с карта | Paid by card |
| `confirm_not_receipt` | Confirmation page | Това не е касова бележка. Касовата бележка за плащането ви носи сервитьорът. | This is not your receipt. Your waiter brings the venue's receipt. |
| `confirm_save` | Confirmation page | Запази | Save |
| `confirm_save_failed` | Confirmation page, a Save that failed (the lead's words, awaiting Martin 10-30; no "Saved" line exists: the phone's share sheet or download already shows it worked) | Не успяхме да запазим. Опитайте отново. | Couldn't save. Try again. |
| `receipt_email` | Pay screen, only where the POS can issue an electronic receipt | Касова бележка по имейл (по желание) | Receipt by email (optional) |
| `paid_receipt_emailed` | Paid, when an email was given (replaces `paid_receipt`'s second sentence) | Касовата бележка е изпратена на {email}. | Your receipt was sent to {email}. |
| `confirm_receipt_emailed` | Confirmation page, when an email was given (replaces `confirm_not_receipt`'s second sentence) | Касовата бележка е изпратена на {email}. | Your receipt was sent to {email}. |
| `email_invalid` | Pay screen, under the receipt field when an address is typed and is not valid (the lead's words, awaiting Martin; Pay stays greyed) | Проверете имейл адреса | Check the email address |
| `paid_receipt_requested` | Paid, where the POS sends the receipt itself (Martin 10-29; replaces `paid_receipt`'s second sentence) | Поискахте касова бележка на {email}. | Your receipt was requested to {email}. |
| `confirm_receipt_requested` | Confirmation page, where the POS sends the receipt itself (Martin 10-29; replaces `confirm_not_receipt`'s second sentence) | Поискахте касова бележка на {email}. | Your receipt was requested to {email}. |
| `back_to_bill` | Buttons | Към сметката | Back to the bill |
| `checking_title` | Can't tell / stranded / capture failed | Заведението проверява плащането | The venue is checking the payment |
| `checking_body` | Can't tell / stranded / capture failed | Не е нужно да правите нищо. Ако имате въпрос, повикайте сервитьор. | You don't need to do anything. If you have a question, call a waiter. |
| `r_busy` | Ended: busy | Плащането в приложението е заето. Опитайте след минута или повикайте сервитьор. | Paying in the app is busy, try again in a minute or call a waiter. |
| `r_paying_paused` | Ended: paying_paused | Плащането с карта е спряно в момента. Картата ви не е таксувана. Попитайте сервитьора. | Card payments are paused right now. Nothing was charged. Ask your waiter. |
| `r_check_failed` | Ended: check_failed / bill_changed | Сметката се промени точно преди плащането. Картата ви не е таксувана. Проверете сметката и опитайте отново. | Your bill changed just before paying. Nothing was charged. Check the bill and try again. |
| `r_isolate_refused` | Ended: isolate_refused | Не успяхме да подготвим плащането. Картата ви не е таксувана. Попитайте сервитьора. | We couldn't prepare this payment. Nothing was charged. Ask your waiter. |
| `r_no_receipt` | Ended: manager said "No receipt" | Плащането не беше завършено. Картата ви не е таксувана. Ако банката е запазила сума, тя ще бъде освободена. | The payment wasn't completed. Nothing was charged. Any amount your bank reserved will be released. |
| `r_expired_session` | Ended: time ran out | Времето изтече. Картата ви не е таксувана. | Your time ran out. Nothing was charged. |
| `r_cancelled` | Ended: the guest cancelled (Martin 10-29) | Плащането е отменено. Картата ви не е таксувана. | Payment cancelled. Nothing was charged. |
| `r_enter_refused` | Ended: pay-first, the till didn't take the round (Martin 10-29) | Не успяхме да изпратим поръчката. Картата ви не е таксувана. Моля, повикайте сервитьор. | We couldn't send this order. Nothing was charged. Please call a waiter. |
| `r_item_unavailable` | Ended: pay-first, something ran out (Martin 10-29) | Нещо се изчерпа, затова нищо не е изпратено и картата ви не е таксувана. Платете останалото, когато сте готови. | Something ran out, so nothing was sent and nothing was charged. Pay for the rest when you're ready. |
| `r_below_minimum` | Ended: released below the minimum after pricing (Martin 10-29) | Плащането с карта е от {min} нагоре. Картата ви не е таксувана. Добавете артикул или попитайте сервитьора. | Card payments start at {min}. Nothing was charged. Add an item or ask your waiter. |
| `r_paying_off` | Ended: released because card payments were turned off (Martin 10-29, the lead 10-29) | За да платите, попитайте сервитьора. | Ask your waiter to pay. |
| `r_pay_first_unpaid` | Ended: pay-first round that reached the till, the manager said "No receipt" (Martin 10-29) | Картата ви не е таксувана. Поръчката е приета, сервитьорът ще вземе плащането. | Nothing was charged. Your order went through, and your waiter will take the payment. |
| `sent_unpaid` | Order: that round's line in the sent orders, instead of "Added to your bill" (Martin 10-29) | Поръчано, без плащане: платете на сервитьора | Ordered, not paid: pay your waiter |
| `tip_too_big` | Pay greyed: the tip is more than the amount (Martin 10-29) | Бакшишът не може да е повече от сумата за плащане. | The tip can't be more than the amount you're paying. |
| `tip_not_offered` | Refusal (Martin 10-29) | В момента не може да се добави бакшиш. Платете без бакшиш. | A tip can't be added right now. Pay without a tip. |
| `card_form_failed` | Card form (Martin 10-29) | Формата за карта не се зареди. Опитайте отново или попитайте сервитьора. | The card form didn't load. Try again or ask your waiter. |
| `pay_again` | Buttons | Плати отново | Pay again |
| `sitting_ended` | Sitting ended | Посещението ви на тази маса приключи. Ако сте още тук, сканирайте кода отново. | Your visit at this table has ended. If you're still here, scan the code again. |
| `location_title` | No location pass | Сметката се вижда само на масата | The bill shows only at the table |
| `location_body` | No location pass | Разрешете местоположение, за да знаем, че сте на масата. Иначе сервитьорът ще ви каже сумата. | Allow location so we know you're at the table. Otherwise your waiter tells you the total. |
| `allow_location` | No location pass | Разреши местоположение | Allow location |
| `order_title` | Order | Вашата поръчка | Your order |
| `on_bill` | Order: line kind | към сметката | onto the bill |
| `not_until_paid` | Order: pay-first line | Не е поръчано, докато не се плати | Not ordered until paid |
| `send` | Order | Изпрати | Send |
| `send_and_pay` | Order: with pay-first lines | Изпрати и плати {x} | Send and pay {x} |
| `order_from_waiter` | Order: pay-first not offered | Поръчайте това от сервитьора | Order this from your waiter |
| `order_empty` | Order | Поръчката е празна | Your order is empty |
| `call_btn` | Call a waiter | Повикай сервитьор | Call a waiter |
| `call_sheet` | Call a waiter: options | Какво ви трябва? | What do you need? |
| `k_waiter` | Call option | Повикай сервитьора | Call the waiter |
| `k_bill` | Call option | Донесете сметката | Bring the bill |
| `k_ice` | Call option | Лед | Ice |
| `k_water` | Call option | Вода | Water |
| `k_glasses` | Call option | Чаши | Glasses |
| `k_clean_table` | Call option | Почистете масата | Clean the table |
| `k_terminal` | Call option | ПОС терминал | Card terminal |
| `call_sent` | Call a waiter: sent | Сервитьорът е повикан | Waiter called |
| `call_more` | Call a waiter: sent | Още нещо | Something else |
| `call_done` | Call a waiter: handled | Повикването е прието. | Your call was handled. |
| `call_rejected` | Call a waiter: nobody answered | Никой не отговори. Моля, попитайте сервитьор. | Nobody answered. Please ask a waiter. |
| `no_calls` | Staff screen takes no calls | Моля, поръчайте от сервитьора | Please order from your waiter |
| `cancel` | Call sheet | Затвори | Close |


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
