# Locks on the shared bag: a second opinion

Made by: Fable subagent for #37, 10-19.

**Verdict.** Martin and the Opus proposal are closer than the exchange suggests. The Opus proposal already *is* a lock architecture where a lock makes sense: Send holds the table's order turn and Pay holds the paid lines, both on the server, both with a deadline, and other phones already see "someone is paying (8 min left)". What it lacks, and what Martin is right to ask for, are three things: a **countdown that every phone shows from the same server deadline**, a way for the server to know **which phone holds the lock**, and a defined answer to **what the holder's screen does when the lock runs out** (today: the lines just come back, and the holder is left wherever it was). I recommend adding all three. I recommend *against* one reading of Martin's words: a lock taken while a guest *edits* (adds, removes, +1). A bag has no "I'm done editing" moment, so such a lock can only end by timeout, and while it is held the other seven phones at the table can do nothing. Every product that lets many hands edit one list (Google Docs, Toast's group check, Wolt's shared basket) does it without a lock and with instant merging; the products that do show a visible countdown lock use it for exactly one thing: the money step (Ticketmaster's checkout hold). So: **instant server-serialised taps for edits; visible, synced countdown locks for paying; Send keeps its server turn without a countdown; dialogs expire on their own.**

*Terms.* A **lock** here is a record on Restro's server saying "flow X is held by phone Y until time T"; nothing lives on the phone. **Serialised** means the server handles two taps that arrive together one after the other, in a hundredth of a second, so both count. A **holder token** is a random id the phone makes when it opens the guest page, kept only in its own storage.

## Martin's lock architecture made concrete

- **Who takes it, when.** The phone that starts a multi-step flow asks the server; the server grants the lock, writes the deadline and the holder token, and answers with the seconds left. The phone never "owns" anything; if it dies, the deadline ends the lock.
- **What others see.** There are no names (D111), so the message is "Someone at your table is paying · 1:42". The locked lines are greyed and the locked button is disabled. Every phone shows the same countdown because every state answer carries *seconds left* as the server counts them; the phone counts down locally between polls and corrects itself on each poll (2–3 s). Phones never use their own clock, so no two phones disagree by more than one poll.
- **On timeout.** The server releases the lock on its own clock (a command one second late is refused even if that phone showed 0:01). The holder's next poll or tap gets `lock_expired`; the face, which remembered its step with the lock id in storage, shows the *same screen* with a banner: "Your time ran out. Nothing was charged. The bag may have changed." and the action button again. Other phones see the countdown reach 0:00, the lines un-grey, the button come back.
- **No extension by the holder.** A fixed budget per flow (below). A guest who needs more starts again; the lines are still there.
- **Edits are not a flow.** Add, +1, −1, Remove, Undo and Restore are single taps. Each one *is* a lock, for about 10 ms, on the server. A longer one would block the table for as long as someone browses.

## The multi-step flows in the guest front end, as decided so far

| Flow | Lock? | Budget | Holder sees on timeout | Other phones see |
|---|---|---|---|---|
| Choosing options or a note, then Add | no (local until Add) | — | — | the line appears within 2–3 s |
| Add, +1, −1, Remove, Undo (5 s), Restore earlier bag | no; serialised | ~10 ms | — | the change within 2–3 s; a removed line is gone (no Undo for them) |
| **Send** (on-the-bill lines) | the table's **order turn** on the server, not a bag lock (D115; Opus) | ≤30 s call + ≤60 s check | Checking… then "Unconfirmed, please call a waiter" (D115), never a retry | the round "Sending…"; their own Send queues as "Sending…"; **editing stays free**. No countdown: it would promise a time the POS does not keep |
| Duplicate warning ("same order N min ago, send again?") | no | the dialog closes itself after 60 s | back to the bag: "the bag may have changed" | nothing; a Send after it still carries the line revisions, so a changed line refuses it |
| **Pay pay-first lines** (bag payment slot) | **yes, visible countdown**; the ticked lines are held by the holder token | 2:00 to open the bank page; then the venue's abandon time (~10 min) | bank page never opened: back on the Pay screen, lines released, banner + Pay again. Bank page opened: "Checking…" until the provider's notice, no retry (D112) | "Someone at your table is paying for these · m:ss", lines greyed, Pay disabled; +1/−1/Remove on those lines refused "someone is paying for these"; other lines editable |
| **Pay the bill** (split or whole; bill payment slot) | **yes, visible countdown**, same shape | same | same | "Someone is paying the bill · m:ss", Pay disabled; the bag is untouched |
| Declined → Try again / Pay later / Call a waiter | the same lock continues | the remaining budget | as above | the countdown continues |
| Cancel a payment | only the holder token may | — | — | the lock ends, lines return at once |
| "Your bill changed" knock before Pay (D111), location check before Send (#38) | no; a step inside the flow above | — | — | — |
| Call a waiter | no shared state; no lock | — | — | — |

## Where this agrees with the Opus proposal, and where it differs

**Agrees (most of it).** Every lock lives on the server with a deadline; Send and Pay are exactly those locks; other phones see "someone is paying"; a Send or Pay whose lines changed is refused with the fresh bag; expiry runs on the database's clock; one payment at a time per bag and per bill; only the paying phone may cancel (which quietly already needs a holder token: Opus keeps `py_` in the phone's storage for it).

**Differs, and I side with Martin.** (1) The countdown: Opus words it "8 min left" on the other phones only; Martin wants it on every screen, including the holder's, from one server number. Cheap: the deadline is already in the state. (2) The holder: Opus has no holder record on the lock itself; add the holder token so the server, not the phone, decides who may cancel and who is "brought back". (3) Expiry for the holder: Opus returns the lines and says nothing about the holder's screen; the face must return the guest to the step with a banner. (4) Opus's open question 4 (a 2-minute lease before the checkout opens, cancel only by the holder) becomes simply "the Pay lock".

**Differs, and I side with Opus.** A lock over edits. Martin's "editing, adding, removing" are single taps on a shared list; serialising them is the lock, held for 10 ms, and the "refresh after release" is the version bump every phone polls. With a longer edit lock, two friends adding shots at once would see "someone is editing · 0:40" and wait for nothing.

## Trade-offs

- **A lock held while someone edits blocks everyone** for its whole life, and it has no natural end: the only end is a timeout, which is the worst of both (blocked, then surprised). Serialised taps lose nothing: both +1s land, a Remove of a line already gone is a no-op.
- **A phone that dies mid-lock.** With a server deadline it is just a timeout; the lines come back on the clock. A lock the phone had to keep alive (heartbeats) would need the same deadline anyway, so there is no design in which the phone truly holds it.
- **Clock sync.** Never needed between phones, only phone-to-server, and that is solved by sending *seconds left*, not a wall-clock time. A frozen tab (Safari suspends background pages) catches up on its first poll back, so a guest may see the countdown jump; that is correct, not a bug.
- **A countdown for Send** would be a promise ("your order lands in 0:45") the POS does not make; D115 already gives Send its own states. Keep it "Sending…".
- **Visible locks invite waiting.** That is the point: a guest who sees "paying · 1:42" waits or edits the other lines instead of fighting the lock.
- **Cost.** Seconds-left in the state, a holder token on the two payment slots, one `lock_expired` refusal code and one banner per Pay screen. Perhaps half a day on top of the Opus design. The holder token is random, lives for the bag's life and is never written on an order, a payment or a log, so D111 holds.
- **Revisions and locks together.** With the Pay lock, the line-revision check only guards the instant between ticking lines and the lock being granted. Keep it: it costs nothing and covers that gap.

## How comparable products do it

| Product | What they do | Status |
|---|---|---|
| Ticketmaster checkout | A countdown "at the top of every page in the checkout" holds the seats; when it runs out the cart is cleared ("Sorry… time's up") and the guest starts again. The closest thing to Martin's model, used for the money step only. | Verified: [Ticketmaster UK](https://help.ticketmaster.co.uk/hc/en-us/articles/360006439534), [AU](https://help.ticketmaster.com.au/hc/en-au/articles/360008668033-Why-is-there-a-time-limit-for-checking-out) |
| DoorDash group order | Everyone edits until the checkout deadline; after it "the cart… and any added items are locked". A deadline-lock on the list, set by a host; Restro has no host. | Verified: [DoorDash help](https://help.doordash.com/en-nz/business/article/group-order-auto-checkout) |
| Uber Eats group order | "Go to checkout to lock the order": the lock begins when the host checks out, not while people add. | Verified from Uber's partner guide: [PDF](https://static.carahsoft.com/concrete/files/4617/5978/2643/How_to_Setup_a_Group_Order_on_Uber_Eats.pdf), [Uber blog](https://www.uber.com/blog/business-meal-group-orders) |
| Toast group ordering | Many guests order "on a single check", each places their own items; no lock, timer or "someone is paying" documented. | Verified: [Toast overview](https://support.toasttab.com/en/article/Group-Ordering-on-Toast-Mobile-Order-PayTM-INTERNAL), [guest experience](https://support.toasttab.com/en/article/Guest-Experience-for-Toast-Mobile-Order-Pay) |
| Wolt group order | A shared basket everyone edits; the host taps checkout; no lock documented. | Verified absence: [Wolt](https://life.wolt.com/en/cyp/howto/group-order) |
| Google Docs | No lock; every keystroke merged on the server; presence shown as a coloured cursor per person. | Presence verified: [Google Drive blog 2010](https://drive.googleblog.com/2010/09/more-tools-for-viewing-document.html); merging method inferred from secondary sources: [overview](https://systemdr.substack.com/p/crdts-vs-operational-transformation) |

Pattern: a list many people edit is never locked while they edit; presence ("someone is here") replaces the lock. A visible countdown lock appears where money or inventory is reserved. Restro's bag is the first; its Pay is the second.

## Open questions for Martin ("yes" accepts)

1. **No lock over edits:** single taps are serialised on the server and every phone refreshes within 2–3 s. Recommend yes.
2. **Pay (bag and bill) is the visible countdown lock:** every phone shows "Someone at your table is paying · m:ss" with the lines greyed; the holder sees the same clock. Recommend yes.
3. **Budget:** 2:00 to open the bank page, then the venue's abandon time (default 10 min); no extension by the holder. Recommend yes.
4. **On timeout the holder is brought back** to the Pay screen with "Your time ran out. Nothing was charged." and Pay again; once the bank page has opened, "Checking…" until the provider's notice instead (D112). Recommend yes.
5. **Send shows "Sending…" with no countdown;** its deadline stays in the state so a template may show "up to 1½ min". Recommend yes.
6. **Dialogs expire:** the duplicate warning closes itself after 60 s and returns the guest to the bag. Recommend yes.
7. **A holder token** (random, phone storage, bag lifetime, never on orders, payments or logs) marks the two payment locks; only it may cancel. Recommend yes.
8. **The countdown comes from the server's seconds-left** in every state answer; phones never use their own clock. Recommend yes.
