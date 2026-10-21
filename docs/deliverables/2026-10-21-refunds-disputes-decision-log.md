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
| 1.5 | **The reminder shows the storno deadline** that merged fix 2 cites (Н-18 чл. 31, ал. 3–4: the 7th of the next month). Whether that deadline applies to a refund made days later is for the accountant. | It turns a vague to-do into a dated one. | open | #52 |
| 1.6 | **Restro checks for a storno automatically** once a POS declares "read closed bills" and receipt data. | Saves the tap, where the POS allows it. | later | #48 |

## 2. Disputes: how the venue gets the evidence

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | **The provider's signed dispute notice marks the payment "Disputed"** and holds its retention until 6 months after the dispute closes (M6). Where no notice comes, an owner or manager taps "Mark as disputed" on the payment. | The provider's notice is the reliable trigger; the tap covers providers without one. | firm | D122 §8 |
| 2.2 | **A new dispute is a to-do for managers and owners** in Tonight's actions and on the end-of-night page, and is sent to Telegram once: "Card dispute on a payment of €46.00 (Table 7, 21 Oct). See the evidence." | A dispute has a deadline in days, never minutes. | firm | D122 §8 |
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
| 4.1 | The refund to-do, the dispute to-do, "Storno done", "Mark as disputed" and "Dispute evidence". | Wording is Martin's. | open | #50 |
