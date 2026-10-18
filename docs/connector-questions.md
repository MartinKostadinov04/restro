# What Restro must find out about each POS

This is the checklist of what Restro must learn about a POS before ordering and paying can work with it. It is the POS-neutral list that map #29 "Ordering from the menu" promises, to be run on barsy now and on Mistral's documentation when T69 gets it.

It is a living file: when an answer arrives, replace the `open` text on that POS's line with the answer, the date and the source (a Lukanet reply, a docs page, a test run), and leave the question and its number as they are.

## How to read it

- **Blocking** means ordering or paying cannot be built without the answer. **Later** means the first build works without it.
- Words follow GLOSSARY.md. A **bill** is what the table sees; a **POS bill** is one bill as the POS holds it (a table can have several open at once); an **order** is what a guest sends from the phone; a **round** is what one order adds to a POS bill.
- `barsy:` says what is known and where it was read, or `open:` with how the question stands. `open: Q82.3` and `open: Q79` are the tracker entries of those numbers (docs/tracker.md); `open: Lukanet 5` is the fifth question in "Questions for Lukanet (barsy)" and `Mistral n` the same for Mistral, both in the requirements deliverable. A question written down is not a question answered; whether Martin has sent it is his to record. `open: not yet asked` means it is on no list yet.
- `Mistral:` is almost always `open: no public API (T69)`; the Mistral question number is added where one is drafted.
- Source names used on the `barsy:` lines, all in `docs/deliverables/`:

| Name | File |
|---|---|
| requirements | 2026-10-17-pos-integration-requirements.md |
| api-reference | 2026-10-18-barsy-api-reference.md (the signed-in reading of 10-18) |
| did-it-land | 2026-10-18-did-the-order-land.md |
| races | 2026-10-18-ordering-race-conditions.md (R and G numbers) |
| use-cases | 2026-10-18-ordering-use-cases-and-fails.md (case numbers) |
| processes | 2026-10-18-ordering-and-payment-processes.md |

## Decisions that shape the list

The list does not ask what these settle. Restro writes into a POS only as a waiter would (D110). No webhooks: Restro polls (D41). Approval at the bar and orders that arrive late are out of scope for now. A guest's on-the-bill order is added as a round to the table's oldest open POS bill, and opens a new POS bill stamped with Restro's code only when the table has none; a round that times out is checked by reading back, never resent (D115). The guest sees one bill per table: its open POS bills. A pay-first order is its own paid, closed POS bill. Paying early for chosen items is a split. Part payment of an amount on an open POS bill waits for the POS and fiscal answers. Refunds happen at the venue, not through Restro.

Summary: 52 questions, 38 blocking.

## 1. Connecting and setup

### C1. Does the POS give outside apps a way to read and write (an API), with written documentation, a way to sign in as a service, terms of use and a price?
**Blocking.** Nothing else can be built without it.
- barsy: known: yes. The reference is at docs.lukanet.com/barsy.api but its method pages need a sign-in that does not persist; Restro's notes of the 10-18 reading are in api-reference. Terms and price: not yet asked.
- Mistral: open: no public API found (T69); Mistral 2 asks whether one exists.

### C2. Can integrators get the written reference as a file (or an OpenAPI description) instead of through a login?
**Later.** It saves re-reading pages behind a login that does not persist.
- barsy: open: Q82.7.
- Mistral: open: no public API (T69).

### C3. Is there a test installation, separate from live venues, where Restro can order and pay without touching a real bar or a real fiscal device?
**Blocking.** Development and tests never run against a live venue's POS (CLAUDE.md rule 7), and the tax rules forbid test mode on a live system.
- barsy: open: Lukanet 13.
- Mistral: open: no public API (T69); Mistral 2 asks for a test installation.

### C4. Is the POS on the tax authority's (NRA) list of approved sales software, and which pilot venues run that version? If yes, does it accept an outside order as an import (who sent it, by which method, Restro's order code kept, declined orders kept, requested and confirmed items compared), at the latest when the venue accepts the order, and does its producer authorise outside apps?
**Blocking.** Decides how an order may enter the POS at all.
- barsy: open: Q79; Lukanet 1 and 2. A "barsy SUPTO" variant exists (requirements, Gate 1); which venues run it is unknown.
- Mistral: open: no public API (T69); Mistral 1 and 5.

### C5. What must the venue set up in the POS before Restro may write: a registered cash desk for the API user, an open cash period, a payment method, rights?
**Blocking.**
- barsy: partly known: writes need a registered cash desk assigned to the API user by the venue's admin, one per venue; `Poses_getcurrent` checks it (api-reference, "What a write needs"). Whether the cash desk also needs an open cash period: not yet asked (use-cases 8).
- Mistral: open: no public API (T69).

### C6. How does a call say which venue it acts in, and can one API user serve several venues?
**Later.** The pilot is one venue per connection.
- barsy: known: the call carries `barsy_id` in the URL, otherwise barsy picks a default (api-reference).
- Mistral: open: no public API (T69).

### C7. Before taking a guest's money, can Restro ask the POS whether it can take an order and a payment right now (cash desk present, period open, fiscal device ready to print)?
**Blocking.** Restro must not capture money the POS cannot register.
- barsy: partly known: `Poses_getcurrent` returns the cash desk and the fiscal printer's state (api-reference). Whether that is enough to promise a receipt will print: open: Lukanet 4.
- Mistral: open: no public API (T69); Mistral 4.

### C8. Which rights does a waiter need to add to, split, close and refuse rows on a POS bill that the API user opened? Can waiters take cash for it at the till?
**Blocking.** If waiters cannot, the pilot is blocked.
- barsy: open: not yet asked (use-cases 8; queued to add to Q82). Known so far: moving a bill to another staff member without the "direct transfer" right needs that member to accept it first (api-reference, `Accounts_move`).
- Mistral: open: no public API (T69).

### C9. Which rights does the API user need to read, split, merge and close POS bills that staff opened?
**Blocking.** "Pay all" works on the POS bills the guest sees, whoever opened them.
- barsy: open: not yet asked.
- Mistral: open: no public API (T69).

## 2. Sending an order

### C10. Can Restro open a new POS bill in one call with the chosen items and quantities, a table, a title and free text that staff see, and Restro's own unique order code, and get the POS bill's id back?
**Blocking.**
- barsy: known: `Accounts_place` without `account_id` creates a bill. Rows carry `article_id` and `amount`; the bill carries `place_id`, `account_alias` (title), `notes` (not printed), `description` (printed on the receipt) and `uuid` (the unique code); it returns the bill's number (api-reference). Open: what `external_source`, `client_order_id` and `additional_data` accept: Q82.6.
- Mistral: open: no public API (T69); Mistral 3.

### C11. Can an order row carry the guest's choice of option, extra or combo part?
**Blocking.** Menu items with options cannot be ordered without it.
- barsy: partly known: `modificators` and `supplements` exist on a row; the modifier type and description are undescribed, and whether modifier text prints on the bar ticket is unknown (api-reference; did-it-land section 4, item 9). Not yet asked.
- Mistral: open: no public API (T69).

### C12. Does the POS price each row itself (Restro sends no price), and can the price it applies differ from the menu's at the moment of ordering (happy hour, price lists, discounts)?
**Blocking.** The guest must pay what they were shown.
- barsy: partly known: with no price sent, the current price is used (api-reference). Time-based prices such as happy hour: not yet asked (processes, open points 3 and 10).
- Mistral: open: no public API (T69).

### C13. Can an order go to a table (or to none), and can one table hold several open POS bills at once?
**Blocking.** The guest sees one bill per table made of several POS bills.
- barsy: known: yes to both. `place_id` is optional, and `Places_getlistwithaccountsonly` counts open bills per table (api-reference).
- Mistral: open: no public API (T69); Mistral 3.

### C14. Does an outside order reach the bar and kitchen screens and printers the way a waiter's order does, and does it print anything on the fiscal device?
**Blocking.** The bar must see the order, and the law forbids a service slip on the fiscal device.
- barsy: partly known: a new bill goes to the screens and printers set for new orders in the venue's settings; the setting "print fiscal total" prints a total-only receipt plus a service note (requirements, P6.6 and G5). Whether a bill made by the API follows it: not yet asked.
- Mistral: open: no public API (T69).

## 3. Not sending twice

### C15. If the same order is sent twice with the same unique code, does the POS refuse the second and create nothing? Does it also honour a standard idempotency header?
**Blocking.** This is what makes a resend after a timeout safe.
- barsy: known: `account.uuid` must be a valid UUID; a second request with the same one returns an error and creates nothing. An idempotency header: not stated, assume no (api-reference; did-it-land section 4).
- Mistral: open: no public API (T69).

### C16. What exactly does that refusal look like (status, code, text), can it be told from every other error, and does it name the POS bill that already exists?
**Blocking.** "Refused as a duplicate" must mean "the first one landed".
- barsy: open: not yet asked (did-it-land section 7, question 2).
- Mistral: open: no public API (T69).

### C17. Is the duplicate check safe when two identical requests arrive together? How long is a code remembered, does it cover closed POS bills, and is it per venue or global?
**Blocking.**
- barsy: open: not yet asked (did-it-land section 7, question 3).
- Mistral: open: no public API (T69).

### C18. If a call fails or is cut off inside the POS, is it all-or-nothing? How long can a call run, and does the POS finish a call after the sender has hung up?
**Blocking.** Decides how long Restro waits before treating "no sign of it" as final.
- barsy: open: not yet asked (did-it-land section 7, questions 5 and 6).
- Mistral: open: no public API (T69).

### C19. How does the POS say yes, no and failed: what status and body for success, for a refused request and for an internal failure?
**Blocking.** Restro must tell a definite "no" from "unknown".
- barsy: open: not yet asked (did-it-land section 7, question 9). The notes name methods, not a status contract.
- Mistral: open: no public API (T69).

### C20. Can a round be added to an open POS bill with the same protection: the code checked on additions, or a marker that groups the rows of one call as one round, or a conditional write (a version on the POS bill)?
**Later.** Rounds go onto the table's open POS bill (D115). Without a guard, a timed-out round is checked by reading back (C52); a yes here makes a resend safe instead.
- barsy: known: `Accounts_place` with `account_id` adds orders to an open bill. Whether a repeat is refused: not yet asked (did-it-land section 7, questions 1, 7 and 8; races R1; processes, open point 1).
- Mistral: open: no public API (T69).

### C21. Can Restro set its own id on a POS bill and on a row, read it back and filter by it?
**Later.** It would replace matching by rows, POS user and time (C52) with an exact match, so a timed-out round leaves no doubt (D115).
- barsy: open: Q82.3. The fields `ref_id` (bill) and `order_ref_id` (row) exist; how they are set is not stated (api-reference).
- Mistral: open: no public API (T69).

### C52. After a round times out, can Restro tell for certain whether it landed by reading the table's open POS bills: does each row read back with the POS user who entered it and the time, is a call all-or-nothing, and can a row still land after Restro has looked for a minute?
**Blocking.** D115's check for a timed-out round rests on this: Restro's own POS user, one order in flight per table, a minute of reading back, never a resend. It is Restro's design, not a documented feature, so it must be proven on the POS's test installation before ordering is built.
- barsy: partly known: each row carries `user_name` (who placed it) and `date`, and `Accounts_getlist` filters a table's open bills (api-reference). All-or-nothing and late landing: not yet asked (close to C18). Test on the test installation: not yet run. Q82.3 (C21) would make the match exact.
- Mistral: open: no public API (T69).

## 4. Reading a bill back

### C22. Can Restro read all open POS bills of a table with their rows, totals, what is paid, what is still owed, and whether each is open or closed?
**Blocking.** The bill screen and every payment start from this reading.
- barsy: known: `Accounts_getlist` filtered by `place_id` and open status; each bill reads back with total, discount, `total_real` (final), `total_paid`, `total_remain` (owed), `status` and `is_locked`. `Places_getlistwithaccountsonly` lists only tables with open bills (api-reference).
- Mistral: open: no public API (T69); Mistral 8 asks about polling for status.

### C23. Per row, can Restro read the item, quantity, price, who placed it and when, and whether it was served, so it can tell its own rounds from staff's?
**Blocking.**
- barsy: known: each row has `article_id`, `amount`, `current_price`, `date`, `user_name` (who placed it), `status`, `served_date`; `orders_history` returns every row (api-reference).
- Mistral: open: no public API (T69).

### C24. When staff refuse or remove a row on an open POS bill, how does it read back: a negative row, a grouped row net of the refusal, a status?
**Blocking.** Otherwise a guest could be asked to pay for something the bar removed.
- barsy: open: Q82.2 (use-cases 9).
- Mistral: open: no public API (T69).

### C25. When staff move, merge or split a POS bill, can Restro still find it, or the POS bill that replaced it, by the id Restro holds?
**Later.** The guest's bill is rebuilt from the table's current reading, so ids are history only (races G12).
- barsy: partly known: a move keeps the bill and changes its table; a merge closes the others empty into the oldest; a split makes a new bill (api-reference). Whether reading a merged-away bill points to the survivor: not yet asked (use-cases 7).
- Mistral: open: no public API (T69).

### C26. How often may Restro read, is there a limit, and can a read return only what changed?
**Later.** Restro polls (D41), so the rhythm matters at a busy club.
- barsy: partly known: `Places_getlistwithaccountsonly` supports a checksum for incremental refresh (api-reference). Limits: not yet asked.
- Mistral: open: no public API (T69).

## 5. Splitting, merging and moving POS bills

### C27. Can Restro move chosen items and quantities from an open POS bill onto a new POS bill, so one guest can pay their own part?
**Blocking.** Paying early for chosen items is a split.
- barsy: known: `Accounts_divide` takes the old bill and the rows with quantities, creates a new bill with them and returns its id (api-reference).
- Mistral: open: no public API (T69).

### C28. If the quantity is already gone (another phone paid it, or staff took it), does the split refuse, move less, or move it twice?
**Blocking.** Two guests paying the same drink must not both succeed.
- barsy: open: not yet asked (races R4, G4).
- Mistral: open: no public API (T69).

### C29. Can the split and the close of the new POS bill be one request? If they are two, what state remains if the second fails, or a waiter closes the original POS bill in between? What does "locked" mean for a write?
**Blocking.** A guest's money is held while this runs.
- barsy: known: they are separate methods, `Accounts_divide` and `Accounts_close` (api-reference). Whether the pair is atomic, and what `is_locked` means for a write: not yet asked (races R5, G5).
- Mistral: open: no public API (T69).

### C30. Can Restro merge several open POS bills of one table into one? What are the limits: which one survives, what happens to discounts, bills of other owners, locked or already receipted bills, and can it be undone?
**Blocking.** Needed if "pay all" is done by merging first (see C37).
- barsy: partly known: `Accounts_merge` and `Accounts_mergebyplaceid` move rows into the oldest bill and close the others empty; closed or fiscally marked bills cannot be merged (api-reference). Locked, other owner, undo: not yet asked.
- Mistral: open: no public API (T69).

### C31. If a split, merge or move times out, can Restro tell whether it happened (for example a stamp on the resulting POS bill), and is a repeat harmless?
**Later.** The first build reads the table back instead.
- barsy: partly known: `Accounts_divide` takes no code of ours; `Accounts_save_notes` can write notes afterwards (api-reference). Not yet asked (processes section 9).
- Mistral: open: no public API (T69).

## 6. Paying and closing

### C32. Can Restro close an open POS bill with a card payment, and does the POS then print the receipt on the venue's fiscal device?
**Blocking.**
- barsy: known: `Accounts_close` with `payments` prints the fiscal receipt on the configured fiscal device, returns nothing, and leaves the bill read-only (api-reference). Which device prints for a close by the API: see C42.
- Mistral: open: no public API (T69); Mistral 4.

### C33. Can Restro open a new POS bill with its items, the payment and the close in one call (a pay-first order)?
**Blocking.**
- barsy: known: `Accounts_place` with `payments` and `flag_close_account`; payments are accepted only when it closes the bill (api-reference).
- Mistral: open: no public API (T69).

### C34. Does a POS bill close by itself once it is fully paid, or must the integrator close it?
**Blocking.** (Martin, 10-18.)
- barsy: partly known: through `Accounts_place` and `Accounts_close` the caller closes the bill, and payments come with the close. A payment added to an open bill with `Payments_create`: open: not yet asked (touches Q82.1).
- Mistral: open: no public API (T69).

### C35. Does the POS refuse a payment that does not equal the bill's total (less, more, or off by a rounding step)?
**Blocking.** (Martin, 10-18.) The hold is for the price shown; the POS prices the rows itself (processes, open point 3).
- barsy: open: not yet asked.
- Mistral: open: no public API (T69).

### C36. Can Restro open a POS bill with the rows, read its total back (after prices and discounts), and only then close it with a payment of exactly that total?
**Blocking.** It is the guard against paying a total the guest did not see.
- barsy: known in shape: `Accounts_create` (or `Accounts_place` without the close), a read, then `Accounts_close` (api-reference). Not yet tried against a test installation.
- Mistral: open: no public API (T69).

### C37. When several POS bills sit behind one table and the guest pays the whole bill, how does the POS handle it: merge them and close once with one receipt, or close each POS bill separately (several receipts)? Can one payment cover several POS bills?
**Blocking.** (Martin, 10-18; processes, open point 2.) Decides whether the guest gets one capture and one receipt.
- barsy: partly known: merge by table, then one close, or one close per POS bill; `Payments_create` spreads a sum over the remainders of the bills it lists (api-reference). Whether a merged close prints one receipt, and whether a spread payment prints at all: not yet asked (close to Q82.1).
- Mistral: open: no public API (T69).

### C38. Does the POS have a payment type for "card paid in the app": fiscal, kept apart from card at the bar, listed by the API, and able to carry the payment provider's reference with the payment?
**Blocking.** Every paid POS bill names a payment type.
- barsy: partly known: `Paymentmethods_getlist` lists the types (including "card not present") with a fiscal flag; a payment carries `transaction_id` and `ref_num` (api-reference). How the type "Карта(неприсъствена)" (card not present) is fiscalised: open: Lukanet 9.
- Mistral: open: no public API (T69).

### C39. If the close with a payment times out and is sent again, is the second refused and nothing paid twice? Can Restro tell that the first one landed?
**Blocking.** A card capture after an unknown POS answer is the worst case (races R3).
- barsy: open: not yet asked.
- Mistral: open: no public API (T69).

### C40. Can an amount be paid against an open POS bill without closing it, each payment with its own receipt, and does that follow the fiscal rule for partial payments (a dedicated register department; the rest never closed as "deferred")?
**Later.** Part payment of an amount waits for this answer.
- barsy: open: Q82.1; Lukanet 5 and 6. `Payments_create` exists; whether it prints a receipt, leaves the bill open and counts as a partial payment is not stated (api-reference).
- Mistral: open: no public API (T69); Mistral 6.

### C41. If the fiscal device cannot print when a POS bill closes (no paper, switched off, no link), does the POS refuse, close with no receipt, or say "closed" with nothing printed?
**Blocking.** Money taken with no receipt is the worst outcome in the map (use-cases 1).
- barsy: partly known: in the staff screens the bill closes only after the print succeeds (requirements, G2). For a close by the API: not documented; queued to add to Q82 (use-cases 1; Lukanet 3).
- Mistral: open: no public API (T69).

### C42. Which fiscal device prints for a close made by the API user (through which cash desk), and where does the paper come out?
**Blocking.** "Your receipt is at the bar" depends on it.
- barsy: open: Lukanet 3. The `print_receipt` flag was read as a local print of a slip for the order (api-reference).
- Mistral: open: no public API (T69).

## 7. Receipts and fiscal

### C43. After a close or a pay-first order, what comes back, and when can Restro read the receipt reference (sale number, receipt number, date and time, device number)?
**Blocking.** Restro captures only when the POS's answer carries a receipt reference (use-cases 1).
- barsy: partly known: `Accounts_place` returns the bill's number and `Accounts_close` nothing. The sale number (`unp`) reads back on the bill, and receipt print data on payments (api-reference). Whether they are readable at once after the close: open: not yet asked (use-cases 1).
- Mistral: open: no public API (T69).

### C44. Can the POS issue an electronic receipt to the guest?
**Later.** The pilot is a bar receipt only (processes, open point 10).
- barsy: open: Lukanet 11. The public help mentions e-mail only for invoices.
- Mistral: open: no public API (T69); Mistral 8.

### C45. Which operator is recorded on the bills and payments the API user creates (it goes into the sale's unique number)?
**Later.**
- barsy: open: Lukanet 12.
- Mistral: open: no public API (T69).

## 8. Refusals and cancelling

### C46. When the POS refuses a write, does it say why in a form Restro can read: bill closed, bill locked, item gone, no cash desk, period closed, item not sellable, payment not equal to the total, fiscal device unavailable?
**Blocking.** Each reason has its own safe next step (release the hold, show the fresh bill, call a waiter). C19 covers the status; this covers the reason.
- barsy: open: not yet asked.
- Mistral: open: no public API (T69).

### C47. If one row cannot be sold (sold out since the last sync), does the POS refuse the whole call or drop that row, and does the error name the item?
**Blocking.** Decides whether a guest sees "couldn't send" for a round that only needed one item removed.
- barsy: open: not yet asked (use-cases 10; queued to add to Q82).
- Mistral: open: no public API (T69).

### C48. Can Restro, as a waiter would, refuse a row or cancel an open POS bill it opened, and what does the bar see?
**Later.**
- barsy: partly known: `Accounts_place` takes a `reason_id` (from `Reasons_getlist`, which says whether the item still leaves stock). How a refusal is sent, for example a negative row, is open: Q82.2.
- Mistral: open: no public API (T69).

### C49. Can a POS bill that was opened but never completed (declined or cancelled) be annulled and kept for the audit trail?
**Later.**
- barsy: open: Lukanet 12.
- Mistral: open: no public API (T69).

## 9. Anything else

### C50. What happens at the end of the POS's cash period (the service day) to open POS bills and to a write in flight?
**Later.**
- barsy: open: not yet asked (races R14).
- Mistral: open: no public API (T69).

### C51. Can Restro tell staff inside the POS, by a message to the hall tablet or a note on the POS bill, that a payment or an order needs a person?
**Later.**
- barsy: partly known: `Messages_create` sends internal messages to staff, and the title and notes of a bill are writable (api-reference). Whether a message reaches the hall tablet: open: Q48.
- Mistral: open: no public API (T69).

## Left out on purpose

These came up in the sources and are not in the list, because a decision settles them or they are not about ordering and paying from the menu. Say if one should come back.

- Approval at the bar (Q82.4 and Q82.5, processes open point 4, the status part of races G15) and orders that arrive late: out of scope for now.
- Webhooks, POS registration and subscribing to POS events: D41, D110.
- Refunds, storno, credit notes and a refund to a card without cash in the drawer (Lukanet 8; requirements F5): refunds happen at the venue.
- Payment links made by the POS (Lukanet 10): not something a waiter does, and the money would bypass Restro's payment provider. This is a product choice for Martin, not a question for a POS.
- Reservation deposits (Lukanet 7, requirements F3) and paid song requests as POS articles (requirements F4): not part of ordering from the menu. Add them if deposits or paid requests ever reach the POS.
- Tips: none in the pilot.
- Questions for the lawyer (L numbers) and the tax audit export (requirements G7): legal work, not a POS capability Restro builds on.
