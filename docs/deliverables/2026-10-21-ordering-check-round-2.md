# Ordering check, round 2: Martin's answers on the 9–11 review, and the verdicts

Made by: the lead session (Opus), 10-21, for Martin. It follows `2026-10-20-ordering-review-merged.md` (the three reviews of sections 9–11) and the caveats the lead raised on it.

Sources:
- Martin's answers of 10-21;
- `2026-10-21-venue-pause-lift-opinion.md` (an independent agent, given both designs neutrally);
- `2026-10-21-payment-numbers-check.md` (an independent agent, checking the numbers against primary sources);
- `2026-10-21-card-last4-third-opinion.md` (a third opinion on the one point two reviewers disagreed on).

Martin's process for items 4 and 5:
1. A fresh agent with an unbiased prompt reasons on the options.
2. The lead compares its answer with his own view, written down before the agent reported.
3. A third opinion is called wherever the two disagree.

## 1. "What does the waiter have to do with it?" (choice B, the order of steps in 8.1)

Paying itself is between the guest's phone and the systems; no waiter takes part. The waiter matters only because **the table's bill is shared.** Restro can't lock a bill inside Mistral, so staff can edit the same table at the same time: void a drink keyed by mistake, move the bill, add a round.

- In Martin's order (move, then confirm), the guest confirms lines that are already on the virtual table. There is no gap.
- In the proposed order (confirm, card, then move), the bank check sits between the confirmation and the move. If someone at the bar edits one of those exact lines in that minute, what is moved differs from what was confirmed. The rule covers the money: Restro never takes more than the guest confirmed, only the same or less, and the "Paid" screen shows the amount actually taken.

Choice B is **still open**, waiting on Martin's yes.

## 2. Alerts (choice C): decided

Telegram is a **supplementary** channel: one group per venue with the owner, the manager and the Restro team. The main surface is an **alert panel inside the platform**, an alerts page in the venue admin. Push notifications from an installed panel stay **later**.

Two things from the merged review still apply:
- Money alerts are urgent: sent at once, repeated every 5 minutes until someone taps "Done", and sent outside quiet hours too.
- Telegram messages carry no order notes and no guest data.

## 3. Turnstile (choice D): decided

Invisible (non-interactive) mode for the pilot. **Managed mode comes back if abuse is seen.**
- A phone that clearly fails gets "please call a waiter".
- If Cloudflare itself can't be reached, the phone is let through and counted, as D119 says.

## 4. How a venue pause lifts: verdict

**The lead's view before the opinion:** take the simpler design B, with one light guard against flickering.

**The independent opinion:** a mix:
- design A's lifting rules, made faster;
- design B's scope: one pause per POS login;
- a fix for a slow POS, which neither design handled.

**Comparison:** both agree on the scope and on keeping order checks running while paused. The opinion argues that dropping A's guard leaves a flickering POS to be held by hand at night, which won't happen. The lead agrees and drops his simplification. **There is no remaining disagreement, so no third opinion.**

**The design, adopted (it refines D120):**
1. One pause state per POS connection (per bar login). A table can order only when its connection is open. The venue-wide banner shows when all connections are paused. With one login it is simply the venue pause.
2. The minimum pause is 60 s.
3. **The probe** is one cheap read through the same login and path as an order. It counts as good **only if it answers correctly within 3 s**.
4. While failing, probes go out at 15 s, 30 s, then every 60 s, each ±20% random. After a refused login: 60 s, 2 min, then every 5 min, plus at once when the login is changed or the Restro team presses "check now".
5. **Lifting:** after the first good probe, Restro probes every 15 s. It lifts after 3 good probes in a row, about 90 s after the POS recovers. One bad probe goes back to step 4.
6. **A 5-minute watch after lifting:**
   - probes continue every 15 s;
   - one Unconfirmed order, or 2 failed calls in a row, pauses again at once;
   - only one order write is in flight per connection, and the others wait;
   - display reads restart spread over 30 s.
7. The third automatic pause within 30 minutes holds at least 10 minutes and alerts the Restro team. The count resets after 30 calm minutes.
8. During a pause, checks of orders already sent and payment undo steps keep running (every 30 s, up to 2 min). Display reads stop. A successful check counts as a good probe.
9. **New, adopted by the lead from the opinion's last point:** after one order write times out, the connection holds the next order (it waits) until a probe succeeds. Most Unconfirmed orders come from the first minute of an outage, before any pause starts. This stops one timeout becoming several.
10. It is built as one pure function: state, event and time go in; the new state and actions come out. The clock is injected, and every scenario is a test with a fake clock.

## 5. The payment numbers: verdict

**The lead's view before the check:** the numbers hold, and the storno for an uncaptured payment is a lawyer's question.

**Comparison:** the check agrees on the numbers and on the lawyer. It corrects three design steps with evidence; the lead accepts each, because they are facts from primary sources, not judgement calls. One point was disputed between earlier reviewers, the card's last 4 digits. It went to a third opinion (5.6).

**5.1 Authorisation validity.** Visa allows 10 days for an online payment the guest starts, and Mastercard 7. Stripe applies 7 to both. myPOS's "30 days" is for terminals, not online. **Plan for 7 days.**

**5.2 A capture that fails: changed.**
- The same idempotency key is reused **only while the outcome is unknown** (a timeout, a dropped connection). Stripe replays a stored error for the same key and forgets keys after 24 hours, so blind retries with one key do nothing.
- After a clear error, Restro reads the payment's status first. If it can still be captured, Restro tries again with a new key (the payment id plus the attempt number).
- Retries are counted **from the authorisation**, not the service day: at 1, 5, 15 and 30 minutes, then hourly up to 48 hours.
- There is no attempt within 12 hours of the provider's own deadline. On Borica, a second completion is never sent.
- The team is alerted after 1 hour, and **at once** on an error that won't go away: the authorisation expired or was cancelled, or a Borica completion failed.
- **A storno after 4 days is the venue's decision**, with the reason prefilled, never automatic. Two questions go to the lawyer: does an uncaptured card payment allow a storno for "операторска грешка" (Н-18 чл. 31, ал. 3)? If not, does the sale stay on the receipt and get written off in the books?

**5.3 Disputes (chargebacks).**
- The main limit is 120 days. 540 days applies only to something paid now and delivered later, which drinks are not.
- The evidence stays **18 months from the service date**, and while a dispute is open plus 6 months after it closes.
- It is copied onto the payment record when the money is taken.
- Added to the evidence: the provider's payment id and authorisation code, and the fiscal memory number next to the receipt number.
- **Rejected:** "the time the order was marked served, and by which staff account". Restro has no "served" state (5.12), and the bar throws its tickets away. The evidence for "I never got it" is: the round entered on the right table's bill, the bar ticket's printing, and the guest's own confirmation.

**5.4 Separate authorise and capture.** All five candidate providers support it. It stays a go/no-go, **answered by the provider in writing**, to four questions:
1. Is it approved for a bar (MCC 5813)?
2. How many days is an online authorisation valid?
3. Can a failed capture be retried?
4. How is a payment's status read?

**The risk: myPOS** grants it mainly to hotels, car rentals and cruise lines, so a nightclub may be refused.

**5.5 The job system (pg-boss 12.35.1): changed.**
- `retryLimit: 0`.
- A real crash detector: `heartbeatSeconds: 10` and `superviseIntervalSeconds: 15`, so a crash is noticed in about 10–25 s.
- A `deadLetter` recovery queue, whose handler is the read-first step.
- Every POS or provider call times out within 20 s. The handler checks the job's cancel signal before each write, and the job expires at 2 minutes.
- Restro's own sweep runs every 60 s, only for payment records left with no job at all.

**5.6 The card's brand and last 4 digits: third opinion.**
- The law reviewer said: don't store them.
- The numbers check said: store them, as standard dispute evidence.
- **The third opinion: don't store them.**
  - PCI is not the deciding reason: a last 4 alone is not card data, so the venue's PCI self-check stays the shortest one (SAQ A) either way.
  - The deciding reason is data minimisation (GDPR Art. 5(1)(c)). A dispute arrives tied to the provider's payment reference, so the last 4 isn't needed to match it.
  - If staff need the brand and last 4 on screen, Restro fetches them from the provider by that reference when the record is opened, and doesn't save them.
- **Adopted.**
- The third opinion was written without web research, so its citations (PCI FAQ 1091, the 2025 SAQ A revision) are checked before phase 2 is built.

## 6. Still open from rounds 1 and 2

- **Choice A** (ordering first, paying as phase 2) and **choice B** (8.1 order): waiting on Martin.
- **The lawyer:** the two storno questions (5.2), plus the earlier ones.
- **The provider's written answers** (5.4).
- **Mistral questions 1–29.**
