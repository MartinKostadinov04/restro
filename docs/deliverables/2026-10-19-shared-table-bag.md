# One shared bag per table: an opinion

Made by: Fable subagent for #37, 10-19.

**Answer up front.** One shared bag per table is sound, and it is what the products that offer group ordering actually do (Toast, Wolt, Uber Eats, Mews all keep one cart that everyone adds to and one person sends). It also fits D115 better than per-phone bags: one bag means one Send, so "one order in flight per table" falls out naturally instead of needing a queue of waiting phones. But every product that does this has a *host* who starts the group, is named, and pays; Restro has no host, no names and no opt-in: everyone who scans the table code is in, strangers included. So I recommend the hybrid: **one shared bag per table, where each line remembers which phone added it, only for the bag's lifetime** (a random token the phone made when it opened the page, never written on the order, gone when the bag is sent or dies). That tag costs almost nothing and is what makes "I wasn't done", "who pays for the pay-first line" and "a stranger added a bottle" visible and guardable. Two rules do most of the work: the bag is kept on the server (the phone only shows it, D72), and **Send moves the lines out of the bag into an order at once**, so a fresh, empty bag starts the moment someone sends and nobody edits an order in flight. The cost is real but bounded: a small bag store and API on Restro's own server, one more thing the phone polls (not the POS), and about half again the build of a per-phone bag.

## How other products do it

| Product | What they do | Status |
|---|---|---|
| Toast Mobile Order & Pay | Guest picks "Order on my own" or "Order as a group". In a group, guests "share the same cart so that their orders are sent to the kitchen together"; one member "needs to put down a card and place the order for everyone's items"; that member is responsible for the bill, others can pay for their own items before. Guests see a list of active groups at the table and join one; group ordering is a venue setting. | Verified: [guest experience](https://support.toasttab.com/en/article/Guest-Experience-for-Toast-Mobile-Order-Pay), [overview](https://support.toasttab.com/en/article/Mobile-Order-and-Pay-Overview) |
| Wolt group order (delivery) | Host starts it, shares a link or QR; participants "add items to a shared basket"; "the order host handles payment" and sees each participant's share; split payment in some countries. Nothing on removing others' items or on a lock. | Verified: [Wolt help](https://life.wolt.com/en/cyp/howto/group-order), [press](https://press.wolt.com/en-WW/267274-no-more-one-person-picking-up-the-bill-wolt-launches-split-payments-for-ordering-together-globally/) |
| Mews order at table (hotels) | The order is "opened for the table, rather than for individual customers"; "anyone who scans the QR code provided can gain access to the opened order"; lines sit in time order, the same item from two people is two lines; staff split, then each pays their part. Closest to Restro: table-level, no host. | Verified: [Mews help](https://help.mews.com/s/article/multiple-customers-on-the-same-order) |
| Uber Eats group order | Organizer shares a link; everyone adds to one cart; the organizer places it and either pays all or each pays "for the items they added". | Inferred from search snippets of Uber's own blog, page not opened: [Uber](https://www.uber.com/en-US/blog/business-meal-group-orders/) |
| me&u group tabs | One shared tab; owner's card secures it with a spend limit; "everyone orders from their own device"; the owner "can see who ordered what". | Inferred from help-centre snippets, page refused (403): [me&u](https://help.meandu.com/hc/en-us/articles/14308746839055-Boost-revenue-with-me-u-Group-Tabs) |
| Mr Yum social tabs | One guest starts a tab; others join by scanning a QR on the friend's phone; all order against that tab. | Inferred, secondary source: [Epos Now](https://www.eposnow.com/au/resources/mr-yum/) |
| Deliveroo, Bolt Food | No group-order documentation found. | Not found |
| sunday, Qerko | Pay-the-bill products; ordering stays with staff or the POS; nothing on group carts. | Not found; see `2026-10-18-how-qr-apps-write-orders-into-pos.md` |

Pattern: one shared cart, one sender, the sender pays (or each pays their own lines because the cart knows who added what). Nobody documents a shared cart with no host and no names. The per-line "who added it" tag is how Uber Eats and me&u make the money question answerable; Restro needs it for the same reason, just without a name behind it.

## The races, with the guard to accept

Words: *bag* (unsent lines, now one per table on the server), *order* (what Send makes), *tag* (the random per-phone token on a bag line, bag lifetime only), *version* (a counter the bag's version goes up by one on every change). Most harmful first.

**S1. Two phones press Send at once.** Two orders, the round doubled on the bill; or the second Send hits D115's one-in-flight rule and shows "couldn't send" for nothing. Likely with a group. — **G1:** Send carries the bag's version and the phone's actionId; the server takes the table's one slot, moves the bag's lines into one order and empties the bag in one step; a second Send against a bag that is already empty or a stale version is not an error: the phone shows the same order's state ("Sending…"). The bag's own Send is the one order in flight, so D115's read-back can never see two.

**S2. A pay-first line in a shared bag: who pays.** A bottle (pay first) added by phone A, Send pressed by phone B: B pays for A's bottle, or the bottle silently goes nowhere. — **G2:** Send always sends every on-the-bill line. Pay-first lines go only if the sender pays them: the sender's own pay-first lines are ticked by default, pay-first lines with another tag are shown as "added by someone else at your table" and go only if the sender ticks them. Unticked pay-first lines stay in the (new) bag for whoever added them. This is D112's "pay-first only / whole bag" choice with one more row. No tag, no choice: then the sender pays for everything or pay-first lines cannot be shared at all.

**S3. Send while another phone is still adding.** The sender presses Send with 5 lines in view; a sixth lands a second before; it goes out unseen (harm: an item nobody meant to send yet) or lands after and is lost from the order (harm: "where is my drink", then a second order and a second wait). — **G3:** Send carries the version the phone last showed; a changed version refuses the Send with "your table's bag changed", the phone refreshes and the guest taps again (rare: only when someone added in the last poll interval, 2–3 s). A line that lands after the Send simply starts the next bag; nothing is lost.

**S4. "I wasn't done": someone sends my lines.** Phone A is still choosing a mixer; B sends A's vodka. Toast and Wolt accept this: one member fires everyone's items. — **G4:** accept it, but make it visible: the Send button reads "Send 5 items (2 added by others)"; after Added, every phone sees the round on the bill within seconds (already decided). A "not yet / hold mine" switch per line is possible later; I would not build it now.

**S5. Two phones edit the same line at once.** A taps +1, B taps +1 on the same line, or B removes it while A adds one: a quantity is lost or a removed line comes back. — **G5:** edits are commands (add 1, remove 1, remove line), each with an actionId, applied on the server in arrival order on the bag's version; never below zero; removing a line that is gone is a no-op; the phone shows the server's bag back, never its own guess (D72: pending, then the result). Quantity is never "set to N" from a phone.

**S6. A stranger or a second group at the same table.** Someone who sat down for a minute adds a bottle; someone removes a line from the other group. Accepted for the bill (D111); the bag is the same risk one step earlier. — **G6:** the location check before Send (#38); lines with another tag are marked "added by someone else"; removing one asks once ("Remove an item someone else added?"); the bag dies fast (S8). Nothing more: a shared table is a shared table.

**S7. One phone mid-payment while others keep editing.** A paid part being held and written while the bag changes under it. — **G7:** none needed once Send moves lines out of the bag: the payment runs on the order, the bag is already a new one. The order in flight blocks only Send on the new bag ("an order from your table is on its way"); editing stays free. D112's one payment per bill is unchanged.

**S8. The bag across the service day, or left over from the last group.** A new group scans and finds four unsent shots from an hour ago; or a bag from last night. — **G8:** a bag dies when it is sent, when it becomes empty, after 30 minutes with no change (Martin's number), when the reading shows the table's POS bills went from some to none (the group paid and left), and at the end of the service day. A phone that opens the page later sees whatever bag is alive. The bag is never kept across days.

**S9. A phone offline or with a stale bag.** It shows lines that were sent or removed minutes ago; its Send or edit is based on them. — **G9:** the phone's copy is a cache with a time ("as of 20:14"); every edit and Send carries the version, a stale one is refused and the phone refreshes; with no connection the bag shows its age and edits are disabled, not queued.

**S10. Load and freshness of syncing the bag.** A second thing to poll beside the reading. — **G10:** one "table state" call returns the reading and the bag with their versions, answered with "unchanged" when nothing moved (tiny); the phone polls about every 2–3 s on the bag screen, 10 s on the menu, nothing in the background. Peak: 8 phones × a call every 2–3 s ≈ 3–4 calls/s per table, all on Restro's own server, none on the POS. Whether this becomes push is #40's.

**S11. Privacy.** The tag could become a per-phone identifier. — **G11:** the tag is random, made by the phone when it opens the page, kept in the phone's own storage and on bag lines only; it is never written on the order, the payment or any log; it is gone when the bag dies. Nothing per phone survives the bag, let alone the service day.

**S12. The same phone twice (R11).** Unchanged: one actionId per Send; a repeated one gets the first result all service day.

## What it costs, compared with per-phone bags

| | Per-phone bag | Shared bag with tags |
|---|---|---|
| Where the bag lives | the phone (today's design) | Restro's server, per table code |
| New pieces | Send endpoint; a queue so a second phone's order waits for the slot; "Sending…" wait screen | bag store (in memory or a small table, nothing in `field_values`); bag API: add, remove, send, read; version and tag rules; lifetime job; the "added by others" and pay-first tick rows; a merged table-state poll |
| Build | about 1 unit | about 1.5–2 units (the bag API and its tests are the bulk; the face gets simpler, it only draws state) |
| Load | one Send per phone | one more thing polled, on our server only; roughly doubles guest API calls per table unless merged into one call (G10) |
| Races | S12 only, plus the waiting queue | the list above, each with a cheap guard |
| Fit with D115 | needs a queue and "your order waits" | one bag = one Send = one order in flight, no queue |
| What the guest gets | their own list, surprises when another phone orders | the table orders together, as a waiter would take it |

A per-phone bag plus a shared *view* of what others are about to send gives most of the sync cost and little of the benefit: the table still sends several orders and the queue stays. A Toast-style opt-in group (start a group, join it) is cleaner for money but adds steps and a host Restro does not have; rejected.

## Open questions for Martin

1. **May anyone remove a line another phone added?** Recommend yes, with one confirm; it is one table. The alternative (only your own) blocks fixing a stranger's bottle.
2. **Do the sender's pay-first choices default to "mine only"?** Recommend yes (G2); others' pay-first lines are ticked in by choice and otherwise stay in the bag.
3. **Bag lifetime:** 30 minutes idle, dies when the table's POS bills all close, and at service-day end. Recommend all three; the minutes are a venue setting later if needed.
4. **Send with a changed bag:** refuse and refresh (G3), or send what the server holds? Recommend refuse: one extra tap, rarely, never a surprise line.
5. **"Send 5 items (2 added by others)" on the button:** recommend yes; it is the whole cost of the tag made visible.
6. **One table-state call for reading and bag** (G10): recommend yes, and leave poll-vs-push to #40.
