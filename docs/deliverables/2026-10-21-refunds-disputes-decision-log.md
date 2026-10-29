# Decision log: "How a refund and a dispute show up in Restro" (#54)

Made by: the ordering lead session (Opus), 10-21. For: anyone who needs #54's decisions at a glance, and the Tonight redesign (#50). Map #29 "Ordering from the menu".

#54 is a task, not a grilling: the lead decides and reports, and the wording goes to Martin. Each row has a **status**:
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** names the binding text. Only D-numbers bind, and this log is the index to them.

**Built on, and not re-asked:**
- refunds are made at the venue: in its provider's dashboard, and as a storno in the POS (D112);
- Restro's key can't refund (D122 §8, merged fix 9);
- no refunds at night (TF4: later);
- "payment unconfirmed" is answered "Receipt printed" or "No receipt" (merged fix 1);
- a failed capture is retried, then reversed by a storno (merged fix 2);
- the end-of-night reconciliation (merged fix 27);
- the dispute records and their retention (`2026-10-21-dispute-traceability.md` M1–M7, D122 §8).

## 1. A refund made in the provider's dashboard

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | **Restro learns of a refund from the provider's signed refund notice**, stored once by its id like every notice. Where the provider declares no refund notice (a new capability flag, "notifies refunds"), a worker job asks for the status of each payment captured in the last 30 days, once a day. | Restro never makes refunds, so it can only learn of them. A daily check is enough: a refund is not urgent, and the storno has a deadline in weeks (see 1.5). | firm | D122 §8 |
| 1.2 | **The refund is a step on the payment record**: the amount, full or partial, the time, and the provider's refund id. The record shows "Refunded €12.00" or "Partly refunded: €12.00 of €46.00". It is written through the service-data write path (#55), and a Log entry says "Refund of €12.00 made in the payment provider's dashboard". | One record holds the whole story of a payment for 18 months, and the Log keeps 31 days. | firm | D122 §8 |
| 1.3 | **The storno reminder is a to-do, not a repeating alarm.** "Refund of €12.00 for Table 7 (receipt 0001234). Make the storno in the POS now." It stays in Tonight's actions for managers and owners, and on the end-of-night page, until someone taps "Storno done". Telegram gets it once, not every 5 minutes. | The venue made the refund itself, by day (no refunds at night). The money is already back with the guest; what is left is the paperwork. A 5-minute alarm is for money at risk tonight. | firm | D122 §8 |
| 1.4 | **"Storno done" is a person's answer,** with the PIN on a shared device. Its who, what and when are copied onto the payment record (dispute check M3). Restro does not detect the storno itself. | Reading stornos back needs "read closed bills" and receipt data that no POS has confirmed yet (Mistral questions 24 and 39). | firm | D122 §8 |
| 1.5 | **The reminder shows the storno deadline** that merged fix 2 cites (Н-18 чл. 31, ал. 3–4: the 7th of the next month). Whether that deadline applies to a refund made days later is for the accountant. | It turns a vague to-do into a dated one. *Replaced 10-29 by 5.5: no deadline on a refund's storno.* | out | 5.5 |
| 1.6 | **Restro checks for a storno automatically** once a POS declares "read closed bills" and receipt data. | Saves the tap, where the POS allows it. | later | #48 |

## 2. Disputes: how the venue gets the evidence

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | **The provider's signed dispute notice marks the payment "Disputed"** and holds its retention until 6 months after the dispute closes (M6). Where no notice comes, an owner or manager taps "Mark as disputed" on the payment. *10-29: the tap comes only with a provider that sends no dispute notice (5.15).* | The provider's notice is the reliable trigger; the tap covers providers without one. | firm | D122 §8 |
| 2.2 | **A new dispute is a to-do for managers and owners** in Tonight's actions and on the end-of-night page, and is sent to Telegram once: "Card dispute on a payment of €46.00 (Table 7, 21 Oct). See the evidence." *10-29: the Telegram message names no amount (5.8).* | A dispute has a deadline in days, never minutes. | firm | D122 §8 |
| 2.3 | **The evidence is a section on the payment's page,** "Dispute evidence", for managers and owners. It holds every field of D122 §8: the lines and prices the guest confirmed, each step with its time, the real table, the payment table and the bar, the money-alert answers, the 3-D Secure result, the provider's payment id and authorisation code, the receipt number and the fiscal memory number. It has "Copy as text" and a print layout, so the browser saves it as a PDF. | The venue answers the dispute in its provider's dashboard and needs the facts in one place. | firm | D122 §8 |
| 2.4 | **The venue finds a payment by the provider's payment id,** which is what the provider's dispute shows, or by date and amount, or by the guest's reference. | Those are the handles a venue actually holds. | firm | D122 §8 |
| 2.5 | **Restro never answers a dispute itself,** never through the API either. | The venue is the merchant (D98). Restro's key creates, captures and cancels only. | firm | D122 §8 |
| 2.6 | **A generated "dispute pack" PDF.** | The print layout covers the pilot. | later | D122 §8 |

## 3. The end-of-night page's contents (for #50)

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | **One page per service day, also as CSV** (merged fix 27). It lists, in order:<br>1. the problems: the mismatch list;<br>2. sent orders: Added, Not sent and Unconfirmed, each Unconfirmed one with its answer;<br>3. payments: the amount, the tip, the bar, the real table, the payment table, the provider's reference and the receipt number, and whether it was captured, released or unconfirmed;<br>4. money alerts and their answers: who, what, when;<br>5. refunds seen that day, and every storno still pending from earlier days;<br>6. disputes opened that day, and the count still open;<br>7. totals: card payments captured, tips, and the number of payments. | Problems first: what needs a tap comes first on every operational screen (D123). | firm | #50 |
| 3.2 | **The mismatch list:**<br>- a payment captured with no receipt number;<br>- a capture still pending or failed;<br>- a payment unconfirmed and unanswered;<br>- a refund with no storno done;<br>- a payment table left with lines;<br>- a sent order still Unconfirmed. | Each is something staff can fix with a tap or a POS action. | firm | #50 |
| 3.3 | **At the end of the service day, the totals and the mismatch list go to the Telegram group** (merged fix 27). Nothing personal is sent. | As decided in D122 §7. | firm | D122 §7 |
| 3.4 | **Who sees it:** managers and owners see the whole page. Staff see sections 1–3 without the tips total. | The default roles of D122 §7. Tips per person are not shown to staff. Custom roles are #55. | firm | #55 |

## 4. Wording for Martin

The strings above (BG and EN) go to Martin with Tonight's screen plan (#50), where they are seen in place. Until he accepts them, they are drafts.

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | The refund to-do, the dispute to-do, "Storno done", "Mark as disputed" and "Dispute evidence". | Wording is Martin's. The 10-29 drafts are in #222. | open | #222 |

## 5. Grounded in what's built (the part 2 lead, Martin's answers 10-29)

Drafted on #54 10-29 by an Opus agent, reviewed by the part 2 lead; Martin answered Q1–Q4 yes on 10-29 ("Yes, all of them"). The strings are in the build ticket, #222, and stay drafts until Martin sees them in place, as section 4 says.

What exists: `payment.observe` (`packages/core/src/service/payment-observe.ts`) records the provider's **absolute** refund total (`payments.refunded_minor`) and dispute state (`payments.dispute`: `open` / `won` / `lost`), from the worker's `provider-notices` job, which reads the charge or dispute back from Stripe (`packages/payments/stripe/src/provider.ts`, `STRIPE_CAPABILITIES.refundNotices: true`). It writes no step, Log entry, to-do or time. Nothing records "Storno done". The purge keeps a payment only while its dispute is `open` (`apps/worker/src/jobs/purge.ts` `paymentDue`); nothing keeps it for M6's 6 months after the dispute closes.

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | **Each rise in the refund total that Restro reads is one refund row** on the payment: the increase in minor units, when it was seen, and that service day (the venue's day, ending 07:00). It is written through `applyService` in the same transaction as `payment.observe`, in a new table `payment_refunds`. Two refunds read back in one reading make one row. | `payment.observe` stores totals, which is right for repeated and out-of-order notices (D125 3.8), but the storno is per refund. `payment_steps` is the route's write journal, which the recovery job resumes from, so it isn't the place. | firm | D122 §8, #222 |
| 5.2 | **The payment's page shows "Refunded {amt}" or "Partly refunded: {amt} of {total}"**, every refund row with its time, and "Storno done · {who}, {time}" once answered. The Log gets "Refund of {amt} made in {provider}" as a `record` entry (18 months). | Log row 1.2, now with a home. | firm | D122 §8 |
| 5.3 | **The storno to-do is read from the refund rows, not from an alert.** Tonight's "Needs you" shows one row per refund with no storno, in "Later" (rank 5), for managers and owners. On the bar tablet it asks a manager's PIN; it isn't shown on a staff member's own phone (screen 1 Q7). An alert kind `payment_refunded` only carries the Telegram message: sent once with no reminder and no push, and closed when the row is answered. Day close may clear the alert; the row stays. | Same rule as #115/#162: lists read payment records by their state, never alerts, so a cleared alert never hides money work. | firm | D122 §8, #222 |
| 5.4 | **"Storno done" is a command (`payment.storno_done`)** on one refund row, under `money.follow_up`. It saves at once, with an Undo toast for 8 s (`payment.storno_undo`), as screen 1 S6 has it. It records who and when on the row (dispute check M3) and adds a Log entry. A second answer is refused with "Someone already answered". Restro never checks the POS for a storno (rule 7; log 1.4, 1.6). | Screen 1 S6 and pattern "A single reversible write". | firm | D122 §8 |
| 5.5 | **No deadline on the storno to-do.** A storno after a refund is made at the refund (Н-18 чл. 31, research of 10-17, P5.3). "By the 7th of next month" is the operator-error storno of L6b and stays on `mf_storno` only. Whether a fiscal device may storno a refund paid back to a card stays the lawyer's L10. | Closes log row 1.5 (open, #52) without a date that belongs to another case. | firm (Martin Q1, 10-29) | D122 §8 |
| 5.6 | **The to-do carries what the storno needs:** the receipt number, its date and time, and the fiscal memory number (D127 4.5 stores them). | A storno in the POS asks for the original receipt's number, date, time and fiscal memory number (Н-18 чл. 31, ал. 1–2; research 10-17, P5.1). | firm (Martin Q1, 10-29) | #222 |
| 5.7 | **A refund total that falls** (a refund that failed at the provider) marks its refund row "didn't go through". The row's storno to-do leaves if it wasn't answered yet. If it was answered, managers and owners get a to-do: "check with your accountant". | `payment.observe` already accepts a lower total. Whether Stripe lowers `amount_refunded` on `refund.failed` isn't in our knowledge file: the build checks it in the sandbox [UNKNOWN]. | firm | #222 |
| 5.8 | **The Telegram group gets no amounts.** The storno and dispute messages name the table and the day only. | Martin 10-27: counts only. This replaces log row 2.2's "€46.00" in the group message (amounts stay on Tonight). | firm | D122 §7 |
| 5.9 | **A dispute records when it opened, when it closed and the provider's answer-by date** (Stripe: `evidence_details.due_by` on the dispute, [DOC] docs.stripe.com/api/disputes/object). New nullable columns on `payments` are set by `payment.observe`. The provider seam's reading gains `disputeDueAt`. | Needed for "opened that day" (end of night, section 6), for Q2's date and for M6. | firm | #222 |
| 5.10 | **M6 in the purge:** when a dispute closes, `retain_until` becomes the later of itself and 6 months after the close. | D122 §8 binds it, but the code keeps only `open` disputes. | firm | #222 |
| 5.11 | **The dispute to-do** (`d_t`, `d_d`, `d_ok`) shows "Answer in {provider} by {date}". It leaves by itself when the reading says `won` or `lost`. Telegram is told once through an alert kind `payment_disputed`, which closes itself. | Toast's and Square's dashboards lead with the deadline, and a missed one loses the dispute (Toast). | firm (Martin Q2, 10-29) | D122 §8 |
| 5.12 | **The evidence section** ("Dispute evidence") is on the payment sheet (#115's "Everything about one thing"), for `money.follow_up`. It holds D122 §8's list: lines and prices confirmed, each step with its time, real table, payment table and bar, money-alert answers (who, what, when), 3-D Secure result, provider payment id and authorisation code, receipt and fiscal memory number. Plus refunds and stornos. One pure function in core builds the text, so Copy and Print match. It contains no links: banks don't review outside content (Stripe best practices). | D122 §8, row 2.3. | firm | D122 §8 |
| 5.13 | **"Copy as text" in the screen's language plus "Copy in English"**; "Print" uses a print stylesheet (the browser saves a PDF). A generated PDF stays F23. | Every word exists in both languages. Stripe states no language rule [NOT FOUND]. | firm (Martin Q3, 10-29) | #222 |
| 5.14 | **Finding the payment:** the Log's search (P12) also accepts a provider payment id typed exactly, for `money.follow_up` only, besides date and amount and the guest's payment number. | Row 2.4. The provider id stays backend and admin-only (rule 3 concerns guest surfaces). The CSV keeps Restro's id only (end-of-night plan §6). | firm | D122 §8 |
| 5.15 | **"Mark as disputed" isn't built while the provider sends dispute notices.** It comes with the first provider whose capabilities lack them. | Stripe sends `charge.dispute.*` (knowledge file S26, sandbox S27). A manual mark would also fight the absolute reading of `payment.observe`. | later (Martin Q4, 10-29) | D122 §8 |
| 5.16 | **A lost dispute** shows "Dispute lost: the money went back to the guest's bank. Ask your accountant whether a storno is needed." | No source says whether a chargeback needs a storno [UNKNOWN]: a question for the accountant (#52), not a legal gate. | open | #52 |
| 5.17 | **End of night:** section 5 lists the refunds seen that service day, then every refund from earlier days with no storno. Section 6 lists the disputes opened that day, each with its answer-by date, then "{n} still open". "To fix" has one line per refund with no storno, from any day (`nt_fix_pay` + `nt_fix_storno`), on Telegram too, without amounts. The CSV rows use `what` = `refund` / `dispute`. Sections 5–6 are for `night.view_full` only. | Plan sections 5–6 and #115's rules. | firm | #115, #222 |

**How comparable systems do it** (fetched 10-29):
- **me&u:** only manager PINs refund. me&u doesn't update the POS, and venues record the refund in the POS by hand [vendor help].
- **sunday:** an admin refunds from its dashboard. Its Toast guide says to void or adjust in the POS first, then refund [vendor help]. A search summary says sunday handles chargebacks for the venue [unverified].
- **Toast:** chargeback emails go to the finance contact, the owner and the general manager. The dashboard shows amount, reason, check time, card and deadline, with "View receipt". A missed deadline is accepted automatically [vendor help].
- **Square:** disputes reach the seller by email and on a Disputes dashboard, with a due date [vendor docs, via search summary].

In none of them does a dashboard refund correct the POS automatically. Staff do it, and that is the to-do.
