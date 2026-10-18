# Use cases and failures not yet covered in ordering and paying

Made by: Fable subagent for #35, 10-18.

What a packed club at 2 a.m. still throws at the design after the #35 decisions (points 1–22), the second opinion and the race-conditions note (R1–R16). What those settle is left out. Most important first; each case ends with a recommendation worded so that "yes" accepts it, and its ticket. **[Lukanet]** = add to Q82; **[lawyer]** = for the lawyer. Words as in GLOSSARY.md.

## A. Money and receipts

**1. The fiscal device cannot print when a paid POS bill closes** (no paper, switched off, no link to the NRA). Restro holds the card and asks barsy to close the paid POS bill. Does barsy refuse, close without a receipt, or say "closed" with nothing printed? Paper runs out at 2 a.m. in every bar; the outcome is the worst in the map: money taken with no receipt (the heavy ЗДДС fine; the guest may lawfully refuse to pay). — *Capture only when the POS's answer carries a receipt reference (УНП or receipt number); "closed" without one is "unclear": no capture, read the POS bill back, alert staff within a minute. Ask what `Accounts_place` with `flag_close_account` returns when the device cannot print.* **[Lukanet]** Payment map.

**2. Tips.** Guests and staff will want tips on the phone. A tip is money the venue takes, so it needs a receipt line or a surplus the POS can book; Visa in the EEA forbids capturing more than the hold, so a tip must be chosen before the hold. How a tip is fiscalised is unknown. — *No tip in the first payment build; the quote gets a tip line only once the lawyer says how it is booked, and then always chosen before the hold.* **[lawyer]** Payment map.

**3. Refunds and chargebacks after a paid, closed POS bill** (wrong bottle, a dispute with the bank weeks later). A refund needs a storno in the POS (irreversible, a manager's action) and a refund at the provider, in step. A chargeback lands on the venue (D98), which must answer with evidence. A few a month per venue; mostly the venue's harm. — *First build: refunds happen outside Restro (POS storno plus the provider's dashboard); Restro records the refund from the provider's notice and shows it on the payment. An "evidence" view per payment in the admin: what the guest confirmed, the 3-D Secure result, hold and capture times, the receipt reference (D32).* Payment map.

**4. A release or refund call fails, or Restro restarts mid-payment.** The hold sits on the guest's card (Visa wants it reversed within 24 h; myPOS charges the venue for holds it cancels itself). A few times a year; blocked money and a fee. — *Every capture, release and refund is a worker task retried until the provider confirms it; at start-up and every minute the worker re-checks every payment in flight against the provider; a hold older than an hour that is neither captured nor released alerts.* Payment map.

**5. The receipt for a pay-first order** prints at the cash desk while the guest sits across the room; by law it is handed over when the payment is made. — *The printed receipt comes to the table with the drinks (an onboarding instruction); the phone shows only the receipt reference and amount. Whether an electronic receipt may replace paper is Q64.* **[lawyer]** Payment map.

## B. The POS and the venue's staff

**6. The order the guest gave up on arrives anyway.** The phone said "We couldn't send your order, please call a waiter" (point 17); the guest orders from a waiter; then the stuck call lands, or staff approve the waiting POS bill late. Eight drinks, two POS bills. Very likely, because "couldn't send" appears exactly when barsy is slow. — *After "couldn't send" Restro keeps checking that order for the rest of the service day; if the POS turns out to have it, the admin's orphaned-orders list marks it "arrived late" and the phone changes to "Added to your bill (late)", so guest and staff can refuse the double. A POS bill "waiting for approval" shows "waiting for the bar", never "couldn't send".* Tickets #37, #39.

**7. A waiter moves a POS bill to another table** (`Accounts_move`: the group changed tables). The old table code now reads an empty bill; the next order opens a new POS bill on the old table while the guests sit at the new one. Every weekend. — *Restro keeps the POS bill ids its orders went onto (point 4); when a table's reading no longer shows them it looks them up by id, and if the POS bill is open on another table the phone says "your bill moved to table 9: scan the code there" and ordering from the old code pauses for that phone.* Ticket #36.

**8. POS bills owned by the API user, and the venue's rights.** Every POS bill Restro opens belongs to the API user and its cash desk. barsy's move method says a staff member without the "direct transfer" right must first accept a bill from another user; if the same holds for editing or closing, waiters cannot take cash for a Restro-opened POS bill at the till. The API user's cash desk may also have no open cash period, or be un-assigned. Unknown; if true it blocks the pilot. — *Ask which rights a waiter needs to add to, split, close and refuse rows on a POS bill opened by the API user, and whether its cash desk needs an open cash period. Before go-live and every few minutes Restro checks `Poses_getcurrent`; a missing cash desk or closed period pauses ordering with a plain reason the owner sees.* **[Lukanet]** Ticket #39.

**9. The bar refuses an on-the-bill item after "Added"** (ran out). Staff refuse the row in the POS; the guest learns nothing until "your bill changed". Nightly. — *The bill screen shows a quiet line when a reading has fewer lines than Restro's own orders for the table ("staff removed 1 × Gin tonic"); the reading uses grouped rows net of refusals, tested on the test installation. Ask how a refused row reads back.* **[Lukanet, Q82.2]** Bill-screen ticket.

**10. One line in an order is no longer sellable** (sold out since the last sync). Does barsy refuse the whole call or drop the row? If the whole call fails, the guest sees "couldn't send" for a round that only needed one item removed. Nightly with limited stock. — *A refusal that names the article marks it sold out in the live overlay at once and tells the guest which line to remove, bag kept (D72); a refusal that names nothing is "couldn't send". Ask what error a non-sellable article returns.* **[Lukanet]** Ticket #37.

**11. Minimum spend and table deposits.** Club tables are sold with a minimum consumption and often a deposit at booking. The guest sees 500 owed, not "500 minus the 200 I paid at the door". Very likely at the pilot venues; confusion at the moment of paying. — *The bill shows exactly what the POS shows; onboarding tells the venue a deposit must be booked on the POS bill to appear on the phone. "Minimum spend" is a named later improvement (D101 keeps reservations out).* Bill-screen ticket.

**12. Stale table links.** A table renamed, moved or deleted in the POS; "New code" pressed mid-night; a table deactivated with guests at it. Rare, admin-made. — *The writer refuses to send when the table's POS link is missing or not confirmed by the latest full read ("call a waiter"); "New code" and deactivating warn that guests at that table must scan again, and the bill stays readable by the old code for 30 minutes.* Tickets #36, #40.

**13. barsy's own QR ordering at the same venue** opens a POS bill per order on the same tables. — *Onboarding asks the venue to switch it off for tables carrying Restro's codes.* Ticket #36.

## C. Guests

**14. Wrong table, and two groups on one table.** A photo of table 5's code scanned at table 12; last week's link; strangers sharing a table. Orders reach the wrong table, or the other group's lines sit on the bill everyone sees (point 1). Very likely. — *The first order from a phone confirms the table in one tap ("You're at table 12, right?"), and the POS bill's alias carries the table and a short code so the waiter spots a mismatch; the bill screen never pre-selects lines: the guest ticks lines or "everything", and "everything" states how many rounds it covers. Seeing another group's lines is accepted (no names).* Tickets #36, #38, bill-screen ticket.

**15. The guest page opened inside Instagram or Facebook.** Links shared in stories and DMs open in in-app browsers that break Apple Pay, Google Pay and many bank 3-D Secure redirects. Likely for most guests under 25; payment fails for no visible reason. — *Before any payment the page detects an in-app browser and shows "open in Safari or Chrome to pay" with one tap; ordering on the bill still works there.* Payment map.

**16. "I never ordered that."** Restro knows the time and the guest session, no identity. Nightly, as with waiters today. — *Staff see per round the time and "from a phone at this table"; nothing more is promised. The real guard is #38's table confirmation.* Ticket #38.

**17. "I paid, but a round landed meanwhile."** The guest pays everything shown and leaves; a friend's round arrived after the knock and stays open (point 9); nobody knows. — *The success screen says it: "Paid 140 €. A round of 45 € was added after, still on the bill."* Bill-screen ticket.

**18. Dead phone, second phone, private browsing.** The bill is per table and a payment in flight finishes on the server (points 1, 20); only the bag and "my orders" are lost. — *Accepted; the guest text says the bill screen is the recovery path.* Ticket #40.

## What to accept now
Cases 1, 6, 7 and 8 shape the engines (the capture rule, late reconciling, bill lookup by id, the cash-desk check) and belong in the tickets before code. Cases 1, 8, 9 and 10 add four questions to Q82. Cases 2–5 and 15 are the payment map's and cost nothing now beyond being written down.
