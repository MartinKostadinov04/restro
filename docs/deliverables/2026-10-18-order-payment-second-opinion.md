# Ordering and paying: an independent second opinion (10-18)

Read for this: D72, D102, D110, A5 §5.1, the signed-in barsy API reading and the split-payments research. Nothing in the repo was changed.

## The short verdict
Most of what you decided today is right and matches what works elsewhere: one bill per table, "added" only once the POS has it, no step-by-step order tracking, and checking the bill before every payment. Three things need changing before they are built. **Take the money in the right order**, **don't let the phone be the one that finishes a payment**, and **watch out for the one barsy gap that could double a round of drinks**.

## 1. When a payment fails in a mixed bag

**Take the money in this order: reserve, then write to the POS, then charge.** A hold first reserves the amount on the guest's card. Then Restro writes the paid, closed POS bill into barsy. The card is charged only once barsy says yes. If barsy refuses, the hold is released and the guest was never charged. That removes "money taken, nothing in the POS" in almost every case. It is also the safer order for the tax rules: the research found that a receipt with no money behind it can be fixed by the venue (a storno), while money taken with no receipt carries the heavy fines. The lawyer should confirm that reading. If the venue's payment provider cannot hold, the card is charged first. A clear "no" from barsy then means an automatic refund. An unclear answer (a timeout) means **no** automatic refund: Restro checks first and alerts staff after about a minute, because the bill may in fact be in the POS. *Recommendation A: build every guest payment as hold, then POS, then charge; with no hold, refund automatically only after a clear "no".*

**Hold back the on-the-bill items until the payment is settled.** Don't send them at once. The guest asked for one order. "Order the rest without the bottle" only makes sense if the rest hasn't gone yet. And drinks arriving without the bottle they were meant to go with is confusing at the table. The wait is short, because the guest is actively paying. Once the payment is done, the paid POS bill goes in first and the round right after it. If the round alone then fails, the phone says "bottle paid and added; the rest didn't go through, call a waiter". *Recommendation B: hold the on-the-bill items until the pay-first payment is settled, then send both.*

**Your failure screen is right, with one split.**
- **The card said no** (declined, 3-D Secure failed): the main button is "Try again" (another card, or Apple/Google Pay), then "Order the rest without it", then "Call a waiter". A small "Back to my bag" acts as cancel.
- **Restro can't tell yet** (timeout, the POS is slow): show **no retry button**, because a retry here is how guests get charged twice. Show "Checking…" for up to about 60 seconds, then a problem message with "Call a waiter" and a short reference.

*Recommendation C: two failure screens, "declined" with retry, and "unclear" with no retry until checked.*

**The server finishes a payment, not the phone.** The most common bug in this niche: the guest pays, the bank page never sends them back, and the order is lost. Restro should learn the result from the provider's own notice or a status check, and carry on without the phone. If the guest closes the phone, reopening the page shows the true state. A payment the guest abandons (nothing completed within about 10 minutes, a venue setting) releases the hold and sends nothing. The bag stays on the phone. *Recommendation D: the server completes or abandons every payment on its own; the phone only displays it.*

**Double taps and two phones.** Each bag gets one action key (D72), and only one payment can be open per bag. On the table's bill, the moment one guest starts paying, the other phones see "someone at the table is paying" until that payment ends. The hold-first order also covers a waiter taking cash for the same lines at the same moment: when the lines are already gone, Restro releases the hold and shows the fresh bill. *Recommendation E: one open payment per bag and per table bill, shown to the rest of the table.*

## 2. What the others do
- **Pay at the table, reading the POS bill** (sunday, Qerko): scan, see the table's bill, pay all of it or chosen items, the payment is written onto the POS bill. This is your "pay on the bill". It works and is popular. ([Qerko, businessinfo.cz](https://www.businessinfo.cz/clanky/uz-zadne-dohromady-nebo-zvlast-cesky-startup-dobyva-restaurace-s-qr-kody/); [Toast pay-at-table via storekit](https://storekit.com/docs/guides/integrations/pos/toast/pay-at-table) notes that it breaks once staff split the check into several checks. Your one-bill-over-several-POS-bills view avoids that.)
- **Tabs with a card reserved** (Toast, me&u): the guest reserves a card, orders all night, and is charged at the end. Toast puts a token hold on the card and fires the order only after the hold succeeds ([Toast](https://support.toasttab.com/en/article/Setting-Up-Tabs-Pre-Authorization-for-Toast-Mobile-Order-Pay)). me&u holds a spend limit, and guests see the hold on their statements ([me&u](https://help.meandu.com/hc/en-us/articles/6539880778511)). Holds that sit on statements are the classic complaint. That is a later option for you, not now.
- **Pay as you order** (me&u "pay as you go", Square and Lightspeed's online ordering): every order is charged up front. This is fine at a bar counter, but it irritates table groups who order in rounds.
- **Delivery** (Wolt, Glovo): the amount is held at checkout and charged later. A rejected order is never charged ([Wolt help](https://wolt.com/en/kaz/karaganda/article/about-wolt-kz)). This is the same pattern as Recommendation A.
- **Bulgaria:** I can't name a local order-and-pay app with confidence. barsy's own payment link is the nearest local pattern.
- **What failed** (from my own knowledge, not checked today): apps that had to be downloaded lost to the web QR page; pure pay-up-front at full-service tables lowered tips and slowed rounds; and pay-at-table companies (sunday, Mr Yum/me&u) shrank or left markets in 2023. Paying at the table alone is a thin business, and ordering is where the value is.

*Recommendation F: copy the pay-at-table and delivery patterns above; leave card-reserved tabs for later.*

## 3. The architecture as a whole

**Agreed:** one bill per table over several POS bills, no "who ordered what", "added" only once the POS has it, no tracking stages, the check before paying, and paying exactly the lines that were shown (moved onto their own POS bill). A crash between "move the lines" and "pay" leaves an extra unpaid POS bill on the table. That is harmless, because the one-bill view still shows it.

**The biggest 2 a.m. risk: rounds added to an open POS bill can't be safely retried.** barsy refuses a second *new* bill with the same uuid, but nothing documented protects *adding a round* to an existing bill, and no bill can be read back by our id. A timeout followed by a retry can turn 4 drinks into 8 on the guest's bill. Until Lukanet confirms a duplicate guard for rounds, each guest order should go in as **its own new POS bill on the table**, carrying our uuid, so a retry is always safe. The guest still sees one bill, and waiters can merge bills with barsy's "merge by table". *Recommendation G: each guest order opens its own POS bill on the table, and we ask Lukanet (alongside Q82) about a duplicate guard for rounds.*

**The check before opening the bill should not hold up the screen.** Show the last known bill at once, refresh it within seconds, and share one check per table for a few seconds so 30 phones don't hit barsy together. Before *paying*, the check must finish first. *Recommendation H: the check waits only before payment.*

**A little over-built:** the "pay only the pay-first items, or the whole bag" choice. Keep it, but as one main button ("Pay 120 € now, the rest goes on your bill") with "pay everything now" as a small link. Also: a QR code with no table (bar counter, dance floor) has no bill to add to, so everything there must be pay-first. *Recommendation I: one default button for mixed bags, and places without a table are always pay-first.*
