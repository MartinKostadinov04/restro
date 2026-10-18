# #35 Q4: what does Restro keep of a bill? (Fable, 2026-10-18)

## 1. Recommendation

Keep three different things under three different rules. **For good:** what Restro itself did: every order a guest sent (lines, quantities, the prices shown, the time, which POS bill it went onto; later every payment, D32). **For minutes:** the last *reading* of the bill the platform fetched from the POS (lines, total, paid, still owed, open or closed, and the time it was read), overwritten by the next reading and served to every phone at the table. **For one payment:** a frozen copy of that reading, taken when a guest starts paying, kept with the payment. Restro never keeps a bill of its own: the POS is the only truth, a reading is a photo of it, and an order is Restro's own receipt of what it sent.

## 2. Why, against the alternatives

- **(a) "read it from the POS every time a guest looks"** is right about truth and wrong about traffic. The bill does not reach the phone from a published file (rule 4) but through an API (#40), so every phone at a busy table would hit the POS each time it refreshes. A table of eight refreshing every ten seconds is ~50 POS calls a minute for one table. With a reading kept for a short while, the platform asks the POS once and all phones read the same answer. barsy even helps: `Places_getlistwithaccountsonly` has a checksum, so "has anything changed?" is one cheap call per venue (connector detail, invisible to the platform).
- **(b) "a full synced copy"** turns a photo into a second bill. The moment Restro holds totals it did not just read, a waiter's hand-entered round, a discount or a cash payment at the till makes the two disagree, and someone has to say which wins. Martin already said the POS wins, so the copy can only ever be a cache; calling it "the bill" invites code to trust it.
- **The night test.** The POS is slow or down at 2 a.m.: the guest sees the last reading with its time ("as of 02:13") plus their own orders sent since, and ordering and paying pause (D102). Never a blank, never a total Restro computed itself. Under pure (a) the guest sees an error.
- **The payment test.** The later payment map needs a quote that does not move under the guest (D72). A frozen copy of a *fresh* reading is exactly that: pay from it, and right before the money moves re-read the bill; if it changed, the guest gets a new quote, never a silently different amount.
- **Fiscal traceability** is carried by Restro's own order record (our id, the uuid we sent, the POS's bill id and УНП read back, all backend-only, rule 3), not by the cache. That is why orders are kept for good and readings are not.
- **A POS that cannot read a bill back** (Mistral may not) is a capability flag on the connector, like orders today (A5 §5.1). Without it the guest page shows only "what you ordered through Restro", labelled as not the whole bill; paying *on the bill* is off there, pay-first items still work because their quote is Restro's own lines. The platform stays POS-blind.

## 3. What it implies for the later tickets

- **#36 table visit:** the visit is what links a table code to a POS bill pointer; with several open bills on one table, the guest sees the bill their own orders went onto. The pointer lives on the visit and on each order, backend-only.
- **#37 life of an order:** unchanged from A5 (pending → accepted → done); "accepted" is when the POS has it. The reading is how "served / delivered" reaches the phone later.
- **#39 failure:** three distinct answers: a stale reading is shown with its age; an unsent order is Restro's own record and is never lost; a payment with no fresh reading is refused, not guessed.
- **#40 guest page → platform:** one endpoint gives the bill view = latest reading + own orders newer than it, with the read time; the platform refreshes a reading on demand at most every N seconds (N is the lead's, ~10–20) and never hands the POS's JSON through. A waiter-entered line Restro cannot map to its own item shows the POS's public name, as D75 already allows.
- **Payment map:** quote = frozen reading + Restro's split; capture only after a re-read matches. The connector gains `bill: read | none`, and only `read` unlocks paying on the bill.

## 4. What Martin decides ("yes" accepts the recommendation)

1. Restro keeps its own orders and payments for good, keeps of the POS's bill only the latest reading, and never keeps a bill of its own. Yes?
2. Everyone at the table sees the same reading, refreshed by the platform a few times a minute at most, and the phone shows when it was read. Yes?
3. When the POS does not answer, the phone shows the last reading with its age plus the guest's own orders since, and ordering and paying pause, never a blank or a total Restro invented. Yes?
4. A payment goes from a frozen quote of a fresh reading; if the bill changed before the money moves, the guest gets a new quote. Yes?
5. On a POS that cannot read a bill back, guests see only what they ordered through Restro, labelled so, and paying on the bill is off there. Yes?

## Q4.4: one value per session

**Where a number is shown and when it may move.** (1) Bag total: Restro's own sum of menu prices; moves only when the guest edits the bag. (2) "Order sent": the order's own lines and prices, Restro's record, frozen for good. (3) Bill view: the cumulative reading of all POS bills behind the table (ordered, paid, owed); the only number with a life of its own, because waiters add rounds and take cash. (4) "Pay": the quote. (5) The payment page: the provider fixes the amount when the checkout opens; it cannot move there. (6) Receipt: the POS's, after the payment. So the risk sits in two seams: bag → bill (the POS prices a line differently) and bill view → quote → receipt (a waiter's change lands in between). Everything below closes those two seams.

**Options.**

1. **Quote by amount, held for a fixed time.** "Pay 48 lv" holds for, say, 5 minutes; a round that lands meanwhile makes it a part payment of a bigger bill. Simple, but a part payment by amount is the case Bulgarian fiscal rules handle specially (чл. 26а, research 10-17), and neither barsy nor Mistral documents printing it. Not recommended as the main path.
2. **Quote by named lines, paid as a split.** The quote is *these lines, this total*, taken from a fresh reading when the guest taps Pay. At payment the platform has the POS move exactly those lines onto their own bill and pays and closes it (barsy: `Accounts_divide` then pay; when the quoted lines are the whole bill, pay the bill itself). A waiter's round that lands meanwhile is simply not in the quote: it stays on the table's bill and appears afterwards as "added since you paid". The number cannot move by construction, and paying by named lines is the fiscal-clean route. **Recommended for paying on the bill.**
3. **Pay-first = paid before it exists in the POS.** A pay-first order is quoted from the bag (Restro's own lines), paid, and only then placed, as a bill created and closed with its payment in one call (own receipt). Nothing in the POS can change under it because it is not there yet; the cumulative view shows it as paid. **Recommended for pay-first.** "Pay only the pay-first items" is then exactly this; "pay the whole bag" is this plus option 2 for the rest.
4. **Read only at fixed points, show changes as lines.** The bill view refreshes when the guest opens it, pulls to refresh, gets an order accepted or taps Pay, never on a timer while they look. What changed since they last looked is listed as lines ("+1 Vodka tonic, 14 lv, added by your waiter"), with the new total under them, not a silently new total. Complements 2 and 3.
5. **Lock the bill in the POS while paying.** No POS read (barsy included) documents a lock an outside app can take. Rejected.
6. **Hold first, capture after the POS says yes** (payment map, D98 capability "hold"). Money is reserved on the guest's card, the POS does the split and payment, then the hold is captured; if the POS refuses (lines settled at the bar, bill moved or closed), the hold is released and the guest sees why. Makes every refusal cost nothing. Recommended with 2.

**Bag → bill seam.** An order is accepted only at the prices the guest saw: the request names the snapshot version; if the menu re-published with other prices, the order is refused with that reason and the bag is kept (D72), not repriced in silence. If the POS prices a line *lower* (happy hour, discount), the bill view shows it as a discount line, never a different line price.

**A waiter's change mid-payment.** Round added: not in the quote; shows afterwards as "added since". Cash taken at the bar for some quoted lines, or the bill moved or closed: the split fails, the hold is released, the guest sees "your bill changed at the bar" and a fresh reading; the one case where a number changes, and it is explained before any money moves.

**Recommendation.** 3 for pay-first, 2 + 6 for paying on the bill, 4 for the bill view, 1 only as a fallback on a POS without a split by lines (capability flag; or no paying on the bill there).

**Martin decides ("yes" accepts).**
1. A number the guest sees moves only when the guest acts (opens the bill, refreshes, sends an order, taps Pay), never on its own, and what changed since is listed as lines. Yes?
2. An order is accepted only at the prices the guest saw; otherwise it is refused with the reason and the bag is kept. Yes?
3. A pay-first order is paid before it reaches the POS and lands there as its own paid, closed bill with its own receipt, shown inside the one cumulative bill. Yes?
4. Paying on the bill means paying the lines the guest was shown: they are moved onto their own bill and paid; a round landing meanwhile stays on the table's bill and shows afterwards as "added since". Yes?
5. If the POS can no longer give those lines, the payment stops before any money is taken and the guest sees why. Yes?
