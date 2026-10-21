# Pay-first items in the shared bag: Martin's flow checked

Made by: Fable subagent for #37, 10-19.

**Verdict.** Martin's flow is more robust than D112's, and I recommend it with four fixes. It is better because the two halves no longer wait on each other: the on-the-bill round goes to the POS as a plain D115 order, and the pay-first items go as a plain D112 paid POS bill, each with its own reference and its own failure path. D112's "two-part order" (the round held back until the card settles, then two POS writes in a row) tied a Coke to a credit card: a declined or abandoned payment, or a 60-second "Checking…", blocked drinks that needed no payment at all, and needed an extra branch ("Order the rest without it"). The price of Martin's design is that pay-first lines now outlive Send, so they need a home, a lock and a reprice at the moment of paying. The fixes: (1) pay-first lines simply stay in the shared bag until paid: no new "pending" state; (2) one payment for the ticked selection, never one payment per item, because every payment is a fee, a fiscal receipt, a POS bill, a minimum amount and a turn in the one-at-a-time queue; (3) drop the yes/no question after Send: the "Added to your bill" screen itself carries "Pay X now" for the pay-first lines, one tap fewer and no "No" that reads like cancel; (4) "delivered the moment it is paid" means delivered once the POS has the paid, closed POS bill, which is after the bank's hold and before capture, and the phone says "Paid" only then (D72). Nobody researched does per-item payment modes in one bag, so there is no pattern to copy; the closest product (Qerko) says outright that prepaid items don't belong on a bill, which supports keeping the two halves apart.

## Martin's flow as I read it

1. **Bag.** The table's shared bag holds on-the-bill lines and pay-first lines. Pay-first lines are marked and show a Pay button beside them. *Ambiguous:* whether that button pays the one line (a payment per item) or opens the selection screen with that line ticked.
2. **Send.** The on-the-bill lines go to the POS at once as one order (a round on the table's POS bill, D115). Guest sees "Sending…" then "Added to your bill". *Ambiguous:* Martin says the question comes "once the order is about to be placed", so it may come just before the round goes. Either way the round never waits for a card.
3. **Question.** "Pay the pay-first items now?" **No** → a screen confirms the on-the-bill items were ordered; the pay-first items are listed as waiting, with Pay. Nothing pay-first reaches the POS until paid. **Yes** → a list of the pay-first lines, all ticked, with the total; the guest pays.
4. **Paid.** The paid lines become their own POS bill, opened, paid and closed in one call with its fiscal receipt (D112); the bar delivers. Unpaid pay-first lines keep waiting.
5. *Not said:* where "waiting" lines live (bag? order?), whether other phones see and can pay them, what happens at the bag's timeout, and whether a bag of only pay-first lines still sees a question.

## How others do it

| Product | What they do | Status |
|---|---|---|
| Toast Mobile Order & Pay | At the start the guest picks "pay as you go" or "start a tab"; the choice is for the whole order, nothing per item. With pre-auth, the card is taken before the first order goes to the kitchen. | Verified: [staff guide](https://support.toasttab.com/en/article/Staff-Training-Guide-Toast-Mobile-Order-and-Pay), [tabs](https://support.toasttab.com/en/article/Setting-Up-Tabs-Pre-Authorization-for-Order-Pay) |
| Qerko | Three order kinds: "to table" (prepaid, or postpaid), "to bill" ("never paid in advance, because it does not make sense to add prepaid items to a bill"), "by customer" (always prepaid). A mixed order is not documented. | Verified: [docs](https://docs.qerko.com/docs/flows) |
| sunday | Two separate products: Pay at Table (pay at the end) and Order & Pay (everything prepaid, "never worry about walkouts"). | Verified: [sunday](https://sundayapp.com/order-and-pay-at-the-same-time/) |
| Zii POS, Qamarero, Lightspeed Order Anywhere | Prepay is a venue-wide or per-table switch: "sent to the kitchen after customers pay" or not; "order only / pay at the end / pay instantly" per table; deferred payment per store. | Inferred from search snippets: [Zii](https://support.ziicloud.com/knowledge-base/online-order-management-how-to-set-to-pay-in-advance-or-not-for-qr-orders), [Qamarero](https://qamarero.com/en/order-and-pay/), [Lightspeed](https://www.lightspeedhq.co.uk/pos/restaurant/order-ahead/) |
| me&u, Mr Yum | Tabs secured by one card; nothing per item. | Inferred; me&u page refused (403): [Mr Yum](https://www.eposnow.com/au/resources/mr-yum/) |
| Stadium and club apps (SwipeStation, Q App, Tablelist) | Everything is prepaid at order time; bottle service is prepaid before the night. | Inferred from snippets: [SwipeStation](https://www.safc.com/news/club-news/2017/october/swipestation), [Q App](https://www.healthclubmanagement.co.uk/health-club-management-news/UK-Premier-League-club-West-Bromwich-Albion-trials-Q-App-for-mobile-food-ordering/308049), [Tablelist](https://apps.apple.com/us/app/id1012471579) |
| Fees per payment | Stripe EEA cards about 1.5% + €0.25 (Stripe's own 2022 notice: 1.4% + €0.25), minimum charge €0.50; myPOS lists €0.30 per online payment. A 6 лв shot paid alone costs the venue about 10% in fees. | Verified: [Stripe minimum](https://docs.stripe.com/currencies), [Stripe EEA](https://support.stripe.com/questions/pricing-updates-for-businesses-based-in-the-european-economic-area-(eea)), [myPOS](https://mypos.com/en-bg/pricing-and-fees/fees); rate is third-party: [comparison](https://ecomcalctools.com/blog/fees-stripe/stripe-europe-fees/) |

Pattern: the payment mode is chosen once, per venue, table or order, and prepaid orders never mix with a tab. Restro's per-item mode (D113) is new ground. Martin's split into two independent orders is the closest thing to what the market does; D112's chained two-part order was the odd one out.

## Risks and guards (most harmful first; "yes" accepts the guard)

**P1. Two phones pay the same pay-first line.** Shared bag, no tags; both tap Pay, both hold. — **G1:** Pay takes the bag's payment slot (D112: one payment at a time per bag) and moves the ticked lines out of the bag into the payment's order in the same step; other phones see those lines greyed, "someone is paying for these"; a decline or abandon puts them back; a POS "yes" removes them for good. The bag's version check (shared-bag opinion, G3) refuses a Pay against a bag that changed.

**P2. "Paid" shown before the POS has it.** The bar hands over a bottle to a phone screen, the POS write then fails; or the guest waits for a Pay screen while the bar already poured. — **G2:** the phone says "Paying…" through hold and POS write, and "Paid. Your receipt is at the bar" only on the POS's yes; the bar delivers on its own receipt and POS bill, never on a guest's screen; a timeout is "Checking…" for ~60 s with no retry, the lines stay locked until a person settles it. Capture follows the POS's yes as today; nothing changes in hold → write → capture.

**P3. One payment per item.** Per-item Pay buttons mean a fee, a fiscal receipt, a closed POS bill on the table, a minimum-amount check and a wait in the one-at-a-time queue for every line; a guest with three shots pays three times. — **G3:** there is one payment for a selection; a line's Pay button only opens the selection screen with that line ticked; the total is in the button ("Pay 240 лв"). The composer warns when an item marked pay-first costs less than the venue's minimum card amount.

**P4. The Coke arrives, the vodka was never paid.** The round is on the bill; the pay-first line waits or is declined; the venue sold a mixer and no bottle. — **G4:** accept it, as at the bar. The Added screen lists the waiting lines plainly ("2 items are not ordered until paid") with Pay; a declined card offers Try again / Pay later (lines stay in the bag) / Call a waiter; "Order the rest without it" is dropped (the rest already went). A venue that wants mixers only with the bottle marks the mixers pay-first too.

**P5. Price or availability changes while a line waits.** The bag is not a quote. — **G5:** at Pay the server reprices every ticked line from the live menu and checks it is still on sale; a sold-out line shows "sold out" and cannot be ticked; a price change refuses the Pay once with "the menu changed, check your bag" (races G8). The hold is always for the price at Pay time.

**P6. Waiting lines die with the bag.** Idle timeout or the table's POS bills closing wipes the bag, and with it a bottle someone meant to pay in half an hour. — **G6:** accept it: the lines are re-added in seconds. Make "wiped when sent" precise: Send removes only the lines it sent; the idle clock restarts at Send. A bag of only pay-first lines is never "sent", so a group that only prepays is wiped by idle time alone.

**P7. Paying twice for the same bottle.** The lines leave the bag when paid, so a second payment needs re-adding them; the bank page shows the amount. — **G7:** the "you ordered the same N minutes ago, continue?" warning applies to Pay as well as Send; it is cheap and the item is dear.

**P8. Paying for a stranger's bottle.** All lines ticked by default in a shared bag. — **G8:** accept Martin's default; the Pay screen shows each line with its price and the total in the button, and the bank's page shows the amount again; unticking is one tap. Nothing more without tags.

**P9. The order lock and the duplicate warning.** Does Pay take the table's one-order-at-a-time slot? — **G9:** no. The slot exists for D115's read-back of rounds on open POS bills; a pay-first order is a new closed POS bill under our uuid, retry-safe and never read back by rows. Send and Pay may run at once; the payment slot per bag (G1) is separate from the order slot. The duplicate warning compares a Send with the last Send and a Pay with the last Pay.

**P10. "Disable prepayments" flipped while lines wait.** — **G10:** races G9: a payment already started finishes as it started; waiting lines become on-the-bill lines and go with the next Send, and the bag says so.

## What this changes in D112

The sentence "If the bag also holds on-the-bill items, the guest chooses between paying only the pay-first items and paying the whole bag. The on-the-bill items wait until the payment settles, then go to the POS right after the paid POS bill" is replaced by: Send sends the on-the-bill lines at once; pay-first lines stay in the bag until paid in one payment for the ticked selection; "Pay everything" and "Order the rest without it" go. The process map's §3 (mixed bag) collapses into §1 plus §2. The "two parts, one order, one reference" becomes two orders with their own references and one payment.

## Open questions for Martin

1. **Do pay-first lines stay in the bag after Send, with no separate "pending" list?** Recommend yes: it is the one design that needs no new state, and the bag's rules (shared, versioned, wiped) already cover them.
2. **One payment for the selection; a line's Pay button only pre-ticks that line?** Recommend yes (P3).
3. **Drop the yes/no question; the Added screen carries "Pay X now"?** Recommend yes: the same two taps for "yes", one fewer for "no", and the amount is visible before the guest decides. A bag with only pay-first lines shows "Pay X and order" and no Added screen; a bag with only on-the-bill lines is unchanged.
4. **Pay does not take the table's order slot, only the bag's payment slot?** Recommend yes (P9).
5. **The composer warns when a pay-first item is priced under the venue's minimum card amount?** Recommend yes; it costs an hour and prevents P3's worst case.
6. **The duplicate warning on Pay too?** Recommend yes (P7).
