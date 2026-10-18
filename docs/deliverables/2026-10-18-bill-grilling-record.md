# The grilling of "What is a bill in Restro?" (#35): every question, answer and where it landed

Made by: the #35 lead session (Opus), 10-18, from the session's transcript. For: Martin's review of #35, and any agent that needs the context behind D111–D114.

How to read it: each question has my recommendation (➡️), Martin's answer in his own words (quoted as written), and **where it landed**: a decision, a ticket or a file. ⚠️ marks a gap: something agreed that the decisions do not yet say, or say without its context. The gaps are collected at the end.

---

## Round 1: what a bill is

**Q1. What a bill is.** A bill is what a group owes: items in rounds plus payments, open until nothing is owed, then closed by the POS with a fiscal receipt. barsy (a сметка) and every other POS read work the same. Restro never has a bill of its own.
➡️ Yes.
**Martin:** "Yes. just its not always a group its a person or people"
**Landed:** D111 ("two words", "Restro never keeps a bill of its own"); GLOSSARY "POS bill". Martin's correction shaped the glossary's "Bill", which no longer says "group". ⚠️ The correction itself is recorded nowhere.

**Q2. Can a table hold several bills at once?** Yes in barsy (its own QR menu opens a new bill per order) and in Toast, Square, Lightspeed and Microinvest.
➡️ Yes.
**Martin:** "yes"
**Landed:** D111; GLOSSARY "POS bill".

**Q3. Must a bill belong to a table?** No: the table is an optional label in barsy and in general. In this map every guest order comes through a table code. A venue that wants ordering at the bar puts table codes on the bar counter.
➡️ Yes.
**Martin:** "yes"
**Landed:** D111 ("in this map every guest order comes through a table code"). ⚠️ The bar-counter idea is not in D111.

**Q4. What Restro keeps of a bill.** (a) its own orders, and the bill read back from the POS each time, or (b) a full synced copy.
➡️ (a).
**Martin:** "I would launch a fable to think this through. A short-lived session that jsut gives you the idea. we will talk from there"
**Landed:** Fable session → `2026-10-18-what-restro-keeps-of-a-bill.md`, which proposed a middle option (orders kept, one shared reading kept for minutes). Its sub-questions are Q4.1–Q4.5 below.

---

## Round 2: Fable's sub-questions, and payments

**Q4.1. Restro keeps its own orders and payments for good; of the POS bill only the latest reading.**
➡️ Yes.
**Martin:** "I am ok with the second part, but define what " own orders and payments " means"
Then, after the definition: "And we do all that keeping for what reason exactly?"
Then, after four reasons: "Bring that to a fable short session agent and ask it for opinion on both the reasons and the implications. If they agree assume i agree as well"
Then: "The agent should also find out if thats our or the POS and payment provider responsability"
Final version: kept 18 months (covers the 540-day card-dispute window), then totals; fee records kept apart; no phone, device or IP identifier past the night; erased on purge.
**Martin:** "ok"
**Landed:** D111 "What Restro keeps, and why" and "Whose records are whose"; `2026-10-18-why-restro-keeps-orders.md`, `2026-10-18-records-and-bill-closing.md`. ⚠️ D111 does not say the reasons were settled by Fable on Martin's delegation ("if they agree assume i agree"). Fable's 30-day raw log of what Restro exchanged with the POS was not in the final version and is not decided.

**Q4.2. Everyone at the table sees the same reading,** refreshed a few times a minute at most, shown with its time.
➡️ Yes.
**Martin:** "yes"
**Landed:** D111 "Reading the bill".

**Q4.3. When the POS does not answer,** the phone shows the last reading with its age, **plus the guest's own orders sent since**; ordering and paying pause; never a blank or a made-up total.
➡️ Yes.
**Martin:** "Yes, but that should be kept in a log or errors for each particular connector + send us a notification that smth is wrong"
**Landed:** D111 (error log per connector, team alert); #39 for how the alert reaches the team at night. ⚠️ D111 leaves out "plus the guest's own orders sent since".

**Q4.4. No silently different number between steps.**
➡️ A payment goes from a frozen copy of a fresh reading, re-read just before money moves.
**Martin:** "It has to be designed so it doesn't show 2 different values in the same session between steps of the ordering -> billing process. Thats bad user experience. Ask same fable for ideas"
Fable's five ideas (Q4.4a–e) and Martin's answers:
- **a)** list changes line by line. **Martin:** "I think that displaying changes is kinda stupid and puts load on our systems and development because we have to store session and a snapshot of the order - i push back on that - you decide if its reasonable". I agreed: one short message instead.
- **b)** refuse an order if prices changed since the guest saw them. **Martin:** "anycase i dont see antything practical where prices change during an order anyways". I challenged with happy hour. **Martin:** "Keep that as a further improvement upon request for now i havent received a request for a happy hour. [...] Keep within-day time-related price changes as something explicit for development upon request"
- **c)** a pay-first order is paid before it reaches the POS. **Martin:** "That I agree but we should decide what happens if the person orders multiple things and clicks pay only the required now" (answered by Q13 and Q20).
- **d)** pay exactly the lines shown. **Martin:** "i would just integrate a back process that before every action knowcks on the bills door and asks "hey, are you the same" if not the user receives a message that more things were added while he refreshed. I think that would be a cheaper and more efficient way"
- **e)** stop before money moves if the lines are gone. **Martin:** "I think that the thing i described in d) plus a question before each door knocking that asks "is this bill still open" to the POS tackles all of this. WDYT?"
I agreed with d) and e) and added "pay exactly the lines shown".
**Landed:** D111 "No value changes under the guest" and "Prices that change within the night"; D112 "Exactly what was shown". ⚠️ D111 says the line list was "rejected as cost without value" but not Martin's reason (storing what each phone saw).

**Q4.5. A POS that cannot read a bill back** (Mistral may be one): show only Restro's own orders, labelled not the full bill; paying on the bill off; pay-first still works.
➡️ Yes.
**Martin:** "I didnt really get that part". After a re-explanation: "keep that in mind somewhere but until we find out no need to panic or workaround"
**Landed:** D111 last line (noted, no workaround); `docs/connector-questions.md`.

**Q4.6 (Martin's own point, on the conflict "each phone sees only its own bill" vs "everyone sees every bill").**
**Martin:** "There should be a centralized bill that shows the accumulation of all orders. Mark that we will have to design how does the user story , interface and workflow looks for the bill review (questions like do we see paid and unpaid part of the bill, how do we handle group payments, etc will be discussd there)"
**Landed:** D111 (one bill per table); ticket #45 (the bill screen).

**Q5. A pay-first order gets its own POS bill,** opened, paid and closed at once (the whole bag paid first).
➡️ Yes.
**Martin**, five points:
1. "I think we should give the choice to the person to pay only the item or all, and that decides what item goes into a new bill"
2. "I don't really care how many bills you open as long as the customer sees the full bill and knows what's paid and what's not"
3. "I want the restaurant also to have the flexibility to keep the pay-first rule for some tables but for others to turn it off. So basically the payment rule stays within Restro as a gatekeeper; upstream bill is bill and payment is payment"
4. "sometime in the future I want to allow split payments (basically the payment provider receiving the full amount from multiple cards) - i would launch an agent that uses Anthropic's deep research Skill [...] some sort of meta-architecture that works as a hypothesis until verified both from a technical perspective(talking to payment processors) and a practical perspective (seeing if people want to do it)"
5. "I would launch an opus worktree for that issue: the opus should launch its own short-lived fable agent to give its opinion while the opus researches the rest."
**Landed:** D112 "Paying first" (the choice); D111 (one bill however many POS bills); D113 (per-table switch, gatekeeper); #43 and `2026-10-18-split-payments.md`.

**Q6. Paying early for your own items is a split** onto a new POS bill, paid and closed with its own receipt (avoids Н-18 чл. 26а).
➡️ Yes.
**Martin:** "Yes. 100%"
**Landed:** D112 "Your own items early"; GLOSSARY "Split".

**Q7. Paying an amount or a share** (part payment) fits the model but is not offered until barsy's receipt behaviour and the fiscal form are confirmed.
➡️ Yes.
**Martin:** "This question comes back to 5.4. I mentioned "some point in the future," but if you manage to figure everything out, we do it in this feature set"
**Landed:** D112 "Part payment" and "Group payment" (designed into this map, built once verified); GLOSSARY "Part payment", "Group payment".

**Q8. Who may see a bill:** everyone at the table sees every open POS bill, own orders marked.
➡️ Yes.
**Martin:** "I would remove that complexity from the guest page - at the end of the day people are there to relax and to probably drink. Looking at separate bills is going to be tiring; I think that a central screen with cumulative bill plus what's paid and what's not is enough. On the other hand, keeping who ordered what is going to increase the development on our side without much value (i would keep it as a potential further improvement). I allow you to challenge me on this if necessary"
**Landed:** D111 (one bill, no "who ordered what", a later improvement).

**Q9. Anyone who can see a bill may pay it.**
➡️ Yes.
**Martin:** "Yes. OtIerwise, it becomes very complex"
**Landed:** D111.

**Q10. Glossary terms** (round, order, bag, payment mode, split, part payment).
➡️ Yes.
**Martin:** "Yes, review it based on the rest of the answers i provided in this output as well"
**Landed:** GLOSSARY "Ordering and bills" (nine terms, revised by the later answers).

**Q11. D-numbers** for the bill, paying, and payment mode, superseding D5.
➡️ Yes.
**Martin:** "yes, review it based on the rest of the answers i provided in this output as well". Revised version: "Yes".
**Landed:** D111, D112, D113; D5 superseded.

---

## Round 3: two words, paying first, the table switch, the order's life

**Q12. Two words: "bill" (the guests' one per table) and "POS bill" (the POS's).**
➡️ Yes.
**Martin:** "yes"
**Landed:** D111 "Two words"; GLOSSARY "Bill", "POS bill".

**Q13. Paying first: the guest's choice, and what happens when payment fails.**
➡️ Pay the bottle only or everything; nothing sent until the payment succeeds.
**Martin:** "Payment fails and user is prompted if it wants to try again + options to order the rest without it or call a waiter, of course somewhere in a small variant there is cancel but we dont really want that as a priority action. Get an independent opiunion from opus subagent on that just in case. Maybe the apps in our niche alredy know how to approach this [...] still good to read a second opinion on our architecture"
Written-out flow: "yes".
**Landed:** D112 "Payment declined"; `2026-10-18-order-payment-second-opinion.md`.

**Q14. Pay-first per table:** three settings per area with a table override.
➡️ Yes.
**Martin:** "Simplier - a switcher where the qr codes are called disable prepayments. everything works like intended. What do you think". I agreed. **Martin:** "yes"
**Landed:** D113.

**Q15. My challenge: each phone follows its own order's progress** ("sent", "being prepared").
➡️ Yes.
**Martin:** "in general for now i wouldnt go to multiple stages like a online ordering (like the ones in glovo) it adds multiple steps for the waiters and more load on our systems - you order, waiters bring, if something fails it will appear during the ordering stage and asks to call a waiter [...] If something is ordered its added on the bill and thats it - the rest is identifiable on the ordering screen and there is no space where a system error can prevent a waiter to see an order or the client to think that an order is placed while it isnt". Then: "yes"
**Landed:** D112 "No delivery-style stages". ⚠️ Martin's reasons (extra steps for waiters, load on our systems) are not in D112.

**Q16. A new ticket for the bill screen.**
➡️ Yes.
**Martin:** "yes"
**Landed:** #45.

**Q17. Group payment in this feature set:** designed now, built once the provider has holds and Lukanet confirms; part payment by amount out until Lukanet and the lawyer answer. **The cheapest test of demand needs no code: count how often the pilot venue's bills are already paid with two or more cards.**
➡️ Yes.
**Martin:** "Sure. I dont mind you telling me that we can research everything on our own - if i dont pay to a lawyer for something that doesnt require legal interpretation but its a plain set of rules i dont think we need them"
**Landed:** D112 "Group payment"; the lawyer rule is in the lead's memory as a standing preference. ⚠️ The demand test (count bills already paid with two or more cards) is recorded nowhere.

**Q18. D30's 3 minutes for others to pay** is too short for a group; decide it with the bill screen.
➡️ Yes.
**Martin:** "I have forgotten about this batch of decisions and I dont remember when did i answer to them, whatever we design right now has higher priority". Then: "yes"
**Landed:** D30 reopened by D112; #45.

---

## Round 4: the Opus second opinion

**Q19. Hold the money, write to the POS, then take it.** With a provider that cannot hold, refund only on a clear POS "no".
➡️ Yes.
**Martin:** "yes. check with a fable subagent if we have forgotten about a usecase. introduce him all of the fails we ahve thought through. ask him on how would anything they come up with be approached"
**Landed:** D112 "Hold, write, capture"; `2026-10-18-ordering-use-cases-and-fails.md`.

**Q20. Mixed bag: the on-the-bill items wait until the payment settles.** Two failure screens: "Card declined" and "Can't tell yet" (about 60 s of "Checking…", no retry button, then "call a waiter"), **because a retry button there risks paying twice.**
➡️ Yes.
**Martin:** "yes"
**Landed:** D112 "Paying first". ⚠️ The reason for no retry button is not in D112.

**Q21. The server finishes every payment, not the phone;** an unfinished payment is dropped after about 10 minutes (a venue setting).
➡️ Yes.
**Martin:** "yes. All of this processes should be mapped in detail with the steps form a fable subagent as well"
**Landed:** D112 "The server finishes each payment"; `2026-10-18-ordering-and-payment-processes.md`.

**Q22. One payment at a time per bill;** other phones see "someone is paying", **so two people never pay the same drinks.**
➡️ Yes.
**Martin:** "I would also map out all potential race conditions with another fable subagent"
**Landed:** D112 "One payment at a time"; `2026-10-18-ordering-race-conditions.md`. ⚠️ The reason is not in D112.

**Q23. A repeated round could double the drinks;** each guest order opens its own POS bill.
➡️ Yes.
**Martin:** "Didnt really quite get the usecase here". After the beer story: "I dont think that for now (until we see this issue being real) Restro should send something twice. If i am not mistaken APIs do work in a standartised way where you can figure out if a post was receive or something failed? can you check that with a /research subagent?"
Research: a timeout tells you nothing; the standard fix is a stamped request that the receiver de-duplicates; barsy does this for a new bill only. Revised: one stamped POS bill per order; resend only the identical stamped request for about a minute, then "call a waiter".
**Martin:** "You will have to check if barsy has something for this in its docs". Martin signed in, and the lead read barsy's pages on 10-18: the guard covers only a new bill.
**Landed:** D112 "Sending an order"; `2026-10-18-did-the-order-land.md`. ⚠️ D112 says "Restro never sends a second order" as a permanent rule; Martin said "for now (until we see this issue being real)".

---

## Round 5: closing, records, and the rest

**Q24. Paying the whole bill over several POS bills:** merge, then close once; else close each.
➡️ Yes.
**Martin:** "We should figure out for each specific POS how does that work. note it in the POS connector questions (i think we had some resource like that, and if its not up to date with this current chat add the rest of the things we have to figure out)"
**Landed:** D112 "The whole bill over several POS bills"; `docs/connector-questions.md` (C1–C51).

**Q25. A safety net: read the total back before closing.**
➡️ Yes.
**Martin:** "You have to research if that is not a job of the pos [...] if that is the case we solve everything through the "is this bill still open" question. Does the bill get closed automatically after paying everything or an action has to happen on our side?"
Research: in barsy the POS never closes a paid bill by itself, and only Square documents refusing a wrong amount. Final: the knock before, close in the paying call, read back after, release and alert on a mismatch.
**Martin:** "ok"
**Landed:** D112 "Closing"; `2026-10-18-records-and-bill-closing.md`.

**Q26. The remaining findings go to their tickets.** Martin's answers:
1. Table moves and a guest at the wrong table: "if that is possible that happens through a waiter anyways, for now is out of our scope. We are just another entity that reads and brings actions to the bill, doesnt mean a waiter cant still do whatever they could do in prior". **Landed:** D111 ("waiters keep every power"); note on #36. ⚠️ "Table moves are out of scope" is not in a decision.
2. Late orders: "whatever was discusseed in our grilling round is what we are going to do, late orders is not something you can define at this point". **Landed:** D112 (out of scope); note on #37.
3. Approvals: "Approvals are out of scope now". **Landed:** D112; note on #38.
4. Receipts and the printer out of paper: "I dont think that is even related. as we discussed we are providing a pdf copy of the receipt and if they want a physical one they go to the bar or call a waiter, challenge me if you think something else is in our scope". I agreed, noting that whether an electronic copy counts as handing over the fiscal receipt (Н-18 чл. 25) is a plain-rules question to research. ⚠️ **Not recorded in any decision**, nor is the Н-18 чл. 25 check.
5. Payment window: "left for futher discussions soon - keep that in mind". **Landed:** D30 reopened; #45.
   Minimum spend: "miniumum spend for card payments should be a venue-wide setting". **Landed:** D112. I read the finding as a different thing (a VIP table's minimum spend for the night) and took that as out of scope. ⚠️ Not recorded.
   Refused items: "i have no clue what refused item on the bill is (its either in the menu or no - we are not designing for the menu ordering refusals)". ⚠️ **Not recorded.**
6. Tips, refunds, the Instagram browser: "Tips are going to be figured out after we finish with the ordering, refunds dont happen through us based on what i imagine, I allow you to challenge; I dont remember ever discussion something called instagram browser?". **Landed:** D112 (tips later; refunds at the venue, Restro keeps the provider's reference). The Instagram browser was dropped: guests scan with the camera, which opens their normal browser.

**Payment links.** barsy's own payment links were left off the POS question list; I asked whether to bring them back. Martin's "ok ok" answered Q4.1 and Q25 and did not mention them, so they stay off (`docs/connector-questions.md`, "Left out on purpose").

**Deliverables (Martin's own point).**
**Martin:** "All deliverables by wroktrees and subagents (including the past ones related to that session) are kept in workplot/subagent deliverables. Decide on that and make it part of the claude md. the architecture works like our decision architecture but with delvierables that can be revisited."
**Landed:** D114; CLAUDE.md; `docs/deliverables.md`.

**Confirmation.** **Martin:** "Yes, that's the shared understanding. Commit, push and close #35." Commit 82c10e2.

---

## Gaps to fix

Not recorded in any decision:
1. **Receipts:** a PDF copy in the app; paper at the bar or from a waiter. Check Н-18 чл. 25 (does an electronic copy count as handing over).
2. **Table moves** are out of scope, done by a waiter (only in a note on #36).
3. **Refused items:** not designed for; an item is either on the menu or not.
4. **Demand test for group payment:** count how often the pilot venue's bills are already paid with two or more cards.
5. **POS down:** the phone also shows the guest's own orders sent since the last reading.

Recorded without their context:
6. **"Never send a second order"** is "for now, until we see this issue being real".
7. **Reasons:** no stages (extra steps for waiters, load on our systems); no line list (storing what each phone saw); no retry on "can't tell yet" (risk of paying twice); one payment at a time (two people paying the same drinks).
8. **Keeping records:** the reasons were settled by Fable on Martin's delegation.
9. **Smaller points:**
   - Martin's "a person or people, not always a group";
   - table codes on the bar counter for ordering at the bar;
   - a VIP table's minimum spend for the night is out of scope;
   - Fable's 30-day raw log is not decided.

All nine were written into D111 and D112 after Martin's review (10-18).
