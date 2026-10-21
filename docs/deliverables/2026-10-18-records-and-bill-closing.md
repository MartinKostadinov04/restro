# Who keeps the records, and who closes a paid bill
Made by: research subagent (Sonnet) for #35, 10-18

Two questions from Martin. Primary sources only: the laws and rules as published, the vendors' own documentation, and barsy only through `docs/deliverables/2026-10-18-barsy-api-reference.md` (Restro's notes of the signed-in docs, not re-read). Tags: **[LAW]** text of a law or rule, **[RULES]** a card scheme's or provider's own published rules or contract, **[VENDOR DOC]** a POS vendor's own documentation, **[BARSY NOTES]** the barsy reference file, **[READING]** my interpretation, never fact. "Not stated" means the source was read and is silent. This is research, not legal advice; the legal points marked "lawyer" go to the lawyer (Q63, Q67, Q74 in the open list).

---

## The two answers in plain words

### Question 1: whose job is it to keep these records?

**The job is split four ways, and Restro's own legal duty is the smallest.**

1. **The venue** owns the record of the sale. The fiscal receipt, the fiscal device's memory, the daily reports and, if the venue chose NRA-listed sales software, that software's sales database are the venue's duty, kept 5 years (device and reports) or for the tax-document periods (software database). They live in the POS and the fiscal device. Restro needs no copy of them.
2. **The payment provider** (myPOS, Stripe, …) owns the record of the card payment itself. A provider must keep its records at least 5 years and must be able to prove every payment was authorised and recorded correctly. Restro needs no copy of the card side.
3. **The venue, as merchant,** must answer a card dispute with evidence. Card disputes normally arrive within 120 days, and for something not yet delivered (a reservation deposit) the Visa rules allow up to 540 days. The venue's own proof is the fiscal receipt and the provider's statement. Restro's order record is helpful extra evidence, but I found no law that forces Restro to keep it.
4. **Restro** has one record it must keep for the law: its own invoices to venues (the fee) and the books behind them, 5 to 10 years depending on which rule the lawyer applies. Everything else Restro keeps (orders, payments) is **optional**, kept as the venue's service provider and on the venue's instructions. In data-protection terms the venue decides what is kept and how long; Restro keeps it for the venue, must delete or hand it back when the venue leaves, and must not reuse it for its own purposes without becoming responsible for that use itself.

Consequence: Restro may keep order and payment copies, but only as long as the purpose needs. The one thing to keep longer is a thin fee ledger (amount, time, venue, fee), because Restro's own books need it.

### Question 2: does the POS close a fully paid bill, and does it check the amount?

**There is no common rule. Do not count on the POS to close the bill, and do not count on it to refuse a wrong amount.**

- **barsy:** the bill closes only when the integrator closes it (`Accounts_place` with `flag_close_account`, or `Accounts_close`). Payments passed with `Accounts_place` are "accepted only when the bill is closed". Whether barsy closes a bill by itself when `Payments_create` or the payment link pays it in full is **not stated**. What barsy does when the payments passed on close are less or more than the total is **not stated**.
- **Other POS systems:** Oracle Simphony closes the check in the same call when a full-payment tender is passed, and leaves it open if the payment is partial. Square closes an order only when the integrator calls `PayOrder` with payments that equal the total. Toast sets the check to CLOSED when nothing is due, but sometimes at a nightly batch, and it may flip back. Lightspeed K accepts a payment for delivery and applies it later, so "accepted" does not mean "applied". What each does with a payment that is too small or too large is mostly **not documented**.
- **So:** Restro must compute the amount itself from a fresh reading, send exactly that, and check the result itself. A simple "is the bill closed?" is **not enough**: after paying, read the bill back and confirm closed or zero remaining, **and** that our payment (by our reference) is on it for the amount we sent. If not, the case goes to a "paid but not settled" exception, never an automatic second charge.

---

# Part 1: who keeps which record

## 1.1 Facts, party by party

### The venue (the seller): sale records and fiscal documents

- The venue must register each sale in the shop with a fiscal receipt from a fiscal device, or a system receipt from an integrated system; the customer may withhold payment if none is issued. [LAW] ЗДДС чл. 118, ал. 1 and 1а.
- The venue (лицето по чл. 3) keeps, for **5 years**: the reporting documents, the daily financial report books, the approved block diagrams and the electronic control tape (КЛЕН). [LAW] Н-18 чл. 42, ал. 7. The КЛЕН and the daily report data are what the fiscal device writes; that is the device's storage, held by the venue.
- If the venue chose NRA-listed sales software (СУПТО), the venue is responsible for the integrity and storage of that software's database, current and archive, "in the periods of ДОПК чл. 38, ал. 1" (below), wherever it is hosted. [LAW] Н-18 чл. 52к, ал. 1. When that software receives information from other software or modules, the venue keeps what those create, for the same periods, and gives the tax authority read and export access. [LAW] Н-18 чл. 52к, ал. 3.
- Such software must not offer a way to delete records of closed sales, must allow a storno that keeps the reversed data, and must keep complete data of cancelled open sales. [LAW] Н-18 приложение № 29, т. 12 and 13.
- When such software imports an outside order, it stores for every import, **including requests that are refused**: the outside source's own identifier, the date and time (to the second) of import, the source, the way of import, and the full sale data; and it links each import to the sale number (УНП). [LAW] Н-18 приложение № 42, т. 1.4 and 2.3 to 2.5. [READING] So on a venue that uses listed software, the POS side already keeps the record of what Restro sent; Restro's copy is not the legal one.
- Whether Restro's ordering counts as "sales software" is defined broadly: any software or module used to process information for sales that need a fiscal receipt. [LAW] ЗДДС § 1, т. 84. Н-18 § 1, т. 19 defines managing sales through listed software as automated processing and storage of data, at least type, count and unit price of goods or services, to follow a sale "from the client's request until it is provided or paid", and excludes storage done only to issue tax documents later, to keep accounting registers or to track physical movement. [LAW] Whether Restro is such software, and whether it must be listed, is unresolved (listing is voluntary for a producer per the earlier research; the venue's duty applies only to a venue that chose listed software). [READING] and **lawyer**: Q63, Q74 (see `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`, L11).
- Tax documents issued and received (invoices and the like) are kept **until 5 years after the limitation period** of the public obligation they certify, in original form. [LAW] ЗДДС чл. 121, ал. 1. The limitation period is 5 years from 1 January of the year after the payment was due (ДОПК чл. 171, ал. 1), so about 10 years in total. [LAW] ДОПК чл. 171, ал. 1, with чл. 38, ал. 1, т. 3 below. [READING] on the sum.

### The accounting rules (venue and Restro, each for its own books)

- Accounting information is kept in the enterprise on paper or electronic media: payroll 50 years; **accounting registers and financial statements, including documents for tax control, audit and later financial inspections, 10 years**; **all other carriers 3 years**, each counted from 1 January of the period after the one they relate to. [LAW] Закон за счетоводството чл. 12, ал. 1, т. 1 to 3.
- The tax-procedure code sets the same list for "accounting and commercial information and all other data and documents relevant to taxation": payroll 50 years, registers and statements 10 years, **tax-control documents 5 years after the limitation period ends**, **all other carriers 5 years**; where the person uses information systems, the data are kept in electronic form for those periods. [LAW] ДОПК чл. 38, ал. 1 and 3. [READING] The two laws disagree on "all other" (3 against 5 years); the longer one is safe. Lawyer to confirm which rule governs Restro's supporting data.
- A fiscal or system receipt can stand in for a primary accounting document for a sale, unless the receiver asks for one. [LAW] ЗСч чл. 7, ал. 2 and 4. [READING] So for a venue the fiscal receipt is the accounting document of the sale; Restro's order record is not.
- The manager of the enterprise organises the accounting. [LAW] ЗСч чл. 16, ал. 1. The Act applies to "enterprises"; Restro's legal form is **unknown** to me, so I assume a company that keeps books and issues invoices.
- Restro's fee is a service sold to the venue and invoiced to it (ЗДДС чл. 113; see the 10-17 fiscal research, L11). Restro therefore holds issued invoices and the registers that book them: [LAW] ЗДДС чл. 121 (5 years after limitation) and ЗСч чл. 12 (10 years for registers).

### The payment provider

- **Payment institutions must keep all appropriate records for at least 5 years.** [LAW] Directive (EU) 2015/2366 (PSD2) Art. 21.
- If a payer denies a payment or says it was wrongly executed, it is for the provider to prove it was **authenticated, accurately recorded, entered in the accounts and not affected by a technical breakdown**. [LAW] PSD2 Art. 72(1). The payer must notify without undue delay and no later than **13 months** after the debit date, except where the provider failed to give the required information. [LAW] PSD2 Art. 71(1). An unauthorised payment is refunded by the payer's provider by the end of the next business day. [LAW] PSD2 Art. 73(1).
- Anti-money-laundering: obliged entities keep customer-due-diligence documents and transaction records **5 years** after the end of the relationship or the occasional transaction, then delete personal data unless national law says otherwise, with a possible extension of up to 5 more years. [LAW] Directive (EU) 2015/849 Art. 40(1). Obliged entities include credit and financial institutions; of traders in goods, only those who take or make **cash** payments of EUR 10,000 or more. [LAW] same directive, Art. 2(1). [READING] A club taking card payments through a provider is not, by that rule alone, an obliged entity, and Restro, which never holds money, is probably not one either. The directive text read is the 2015 original; a newer EU regulation on money laundering exists but its text could not be retrieved, so its retention rule is **unchecked**.
- Providers may "access, process and retain personal data necessary for the provision of their payment services, with the explicit consent of the payment service user", and may process data for fraud prevention. [LAW] PSD2 Art. 94.

### The merchant's part in a card dispute

- Card networks "typically allow cardholders to initiate disputes within 120 days"; some situations get more time, and when a customer pays for a future event or service "the dispute window starts on the event date, not the payment date". After a chargeback the merchant has "usually 7-21 days" to respond; the issuer then takes "usually 60-75 days"; the whole cycle "can take 2-3 months". [VENDOR DOC] Stripe, How disputes work. Stripe is one provider's own documentation of the card networks' behaviour.
- Visa's own published rules (18 April 2026 edition): the issuer may start an "other fraud, card-absent" dispute within **120 calendar days** of the processing date; for "merchandise/services not received" a dispute must be processed within 120 calendar days of the processing date or of the last date the cardholder expected the service, **not exceeding 540 calendar days** from the processing date. [RULES] Visa Core Rules and Visa Product and Service Rules, Dispute Conditions 10.4 and 13.1 (time limits). The public rules also oblige the acquirer, not the merchant, to keep merchant files for at least 2 years after the merchant agreement ends. [RULES] same, 1.5.2.2. I found **no merchant record-keeping period** in Visa's public rules.
- Mastercard's own chargeback guide could not be fetched (access denied), so Mastercard's windows are **unchecked** here; only second-hand pages mention 120 days.
- A provider's contract puts the evidence on the merchant. myPOS: the merchant is liable for any payment that is reversed, and myPOS will help challenge a chargeback "provided you supply us with the information we request". [RULES] myPOS Legal Agreement (myPOS Payments Ltd, UK, updated 16.10.2025), clause 12.1. A Bulgarian venue may contract with a different myPOS entity; the other entities' terms were not read.

### Restro and personal data (GDPR)

- A **controller** decides purposes and means; a **processor** processes on its behalf. [LAW] GDPR Art. 4(7), 4(8). The roles follow what each party actually does, not what the contract calls them. [LAW/GUIDANCE] EDPB Guidelines 07/2020, para. 12.
- A processor handles data only on the controller's documented instructions, and at the controller's choice **deletes or returns** all personal data after the services end and deletes copies, unless EU or Member State law requires storage. [LAW] GDPR Art. 28(3)(a) and (g).
- A processor that goes beyond the instructions and decides its own purposes is treated as a controller for that processing. [LAW] GDPR Art. 28(10); EDPB 07/2020, para. 81.
- Personal data may be kept in identifiable form only as long as necessary for the purpose. [LAW] GDPR Art. 5(1)(e). Erasure on request does not apply where processing is needed for a legal obligation or for legal claims. [LAW] GDPR Art. 17(3)(b) and (e). GDPR itself sets **no** retention number.
- A bank paying out on an employer's instruction decides itself what data it needs and how long to keep it, and is therefore a separate controller; the hand-over is a disclosure between two controllers. [GUIDANCE] EDPB 07/2020, "Example: Bank payments". [READING] A payment provider stands in the same position for the card side.
- [READING] **Who is who for Restro:** the venue is the controller of guest order and payment data (it sells, it needs the evidence). Restro is its **processor** for the order and payment copies and acts on the venue's retention instructions. Restro is a **controller** for its own invoices and billing ledger (legal obligation), and for anything it uses for its own purposes, such as Restro-wide analytics, product improvement or fraud scoring across venues. The decisions record D98 (the venue is the merchant) fits this reading. **Lawyer** to confirm, together with the processing agreement (Q67).

## 1.2 Conclusion: who keeps what, and for how long

| Record | Whose job | Law or rule | Period | Copy at Restro? |
|---|---|---|---|---|
| Fiscal receipt, fiscal memory, control tape, daily reports | Venue (device in the venue) | Н-18 чл. 42(7) | 5 years | No |
| Sales database of NRA-listed POS software, incl. imported and refused outside orders | Venue, through the POS | Н-18 чл. 52к; прил. 29, 42 | Periods of ДОПК чл. 38(1) | No |
| The venue's tax documents and accounting registers | Venue and its accountant | ЗДДС чл. 121; ЗСч чл. 12; ДОПК чл. 38 | 5 years after limitation; 10 years for registers | No (offer an export) |
| Card payment record, authentication proof, settlement | Payment provider | PSD2 Art. 21, 72; AML directive Art. 40 | At least 5 years | No |
| Evidence in a card dispute | Venue, with the provider's help | Visa rules; provider contract | Window 120 days, up to 540 days for undelivered services, plus 2-3 months of process | May help; not required |
| Restro's invoices to venues and the books behind them | **Restro** | ЗДДС чл. 113, 121; ЗСч чл. 12; ДОПК чл. 38 | 5 to 10 years, lawyer to choose | **Yes, must** |
| Guest-level order record (items, quantity, price shown, time, table, POS bill) | Venue as controller; Restro as its processor | GDPR Art. 5(1)(e), 28 | Set by purpose; no law found fixes it | **May**, short |
| Guest-level payment record (amount, what for, provider reference, receipt reference) | Venue as controller; Restro as its processor | GDPR Art. 5(1)(e), 28; card windows | At least the dispute window; see below | **May** |
| Raw POS exchange log | Restro (debugging) | None found | Short (Fable proposed 30 days) | May |

**Retention I would recommend (all [READING]; nothing here is a legal minimum except the fee row):**

- **Orders:** the night for the "did it land" check; 13 months is a choice, not a legal number, and fits the PSD2 13-month window and a year-on-year view for insights. After that, totals only.
- **Payments, guest level:** not shorter than the dispute window. For ordinary table payments, 13 months covers Visa's 120 days, the 2-3 month cycle and the PSD2 13 months. For reservation deposits or anything paid for a future date, plan for the 540-day Visa cap plus the 2-3 month cycle, about 2 years, counted from the payment.
- **Fee ledger:** a thin record per capture (venue, time, amount, fee, provider reference) or per day per venue, kept for the longest period the lawyer names for Restro's tax-control documents (up to about 10 years). This is the only record with a legal minimum for Restro, and it should sit **outside** a venue's purge (D83), as the Fable review already says. If guest-level provider references are not needed in the long ledger, the long-lived part holds no personal data.
- **Venue leaves or purge:** at the venue's choice, Restro deletes or returns guest-level data (GDPR Art. 28(3)(g)), except what the law makes Restro keep: its own invoices and ledger.

**Where the Fable review's proposal stands:** orders 13 months then totals, no device or IP identifier beyond the night, purge on the venue's instruction: consistent with what I found. "Payments for the bookkeeping period" needs a split: the guest-level payment record is bounded by the dispute window; only the thin ledger needs the long bookkeeping period.

## 1.3 What I could not establish

- No law read obliges a **platform that is not a POS and not a payment provider** to keep order records. Whether Restro is "sales software" under ЗДДС § 1, т. 84 and Н-18 § 1, т. 19, and so falls under Н-18 чл. 52к when a venue uses listed software, is open (lawyer).
- Restro's legal form, and so exactly which accounting rules bind it: unknown.
- Mastercard's and other schemes' windows and merchant record-keeping rules: unchecked. A provider's own contract may demand longer; read the contract of the provider chosen.
- Bulgaria's national payment-services law (the PSD2 transposition) was not read. The directive's text is the authority I used; a stricter national rule is possible.
- Whether the tax authority treats a hand-held list of card captures as a "document for tax control" (5 years after limitation) or an "other carrier" (3 or 5 years): lawyer.

---

# Part 2: who closes a fully paid bill

## 2.1 barsy (only from `2026-10-18-barsy-api-reference.md`)

**Stated**

- `Accounts_place` "creates a new bill or continues an existing one"; `flag_close_account` is an int, default 0, "close the bill in this call". `payments` are "accepted only when the bill is closed". It returns the bill's number. (`methods/accounts/place.html`)
- `Accounts_close` closes an **open** bill with `payments` (cash, card, cheque, voucher, mixed, several currencies), **prints the fiscal receipt on the configured fiscal device**, updates stock; afterwards the bill is read-only for ordinary users. It returns nothing. barsy points integrations to `Accounts_place` instead. (`methods/accounts/close.html`, `create.html`)
- `Accounts_create` leaves the bill open for more orders, payments and edits. (`create.html`)
- `Payments_create` registers a payment and, through its `accounts` list, "spreads the paid sum over those bills' remainders". (`methods/payments/create.html`)
- `Accounts_getpaymentlink` makes a one-time public URL that pays the remainder, or a smaller `request_sum`, online. (`getpaymentlink.html`)
- A bill reads back with `status` (0 open, 1 closed), `total_real` (final total after discount), `total_paid`, `total_remain` (still owed), `payments` (grouped) and `payments_history` (every payment). A payment reads back with `paid_sum`, `ref_num`, `transaction_id`, `fx` (1 = performs a fiscal operation), `type_id` (5 card present, 6 card not present), `delete_flag`, `paid_used` and `available_sum`. A payment passed on `Accounts_place` can carry `ref_num` and `transaction_id`. (`get.html`, `getlist.html`, `place.html`)
- A write needs a registered cash desk for the venue. (`faq/91-posnotfound.html`)

**Not stated**

- Whether barsy closes a bill by itself once `total_remain` reaches zero, through `Payments_create` or the payment link. The notes say only that whether `Payments_create` needs an open bill, and whether it prints a fiscal receipt, is "not stated".
- What barsy does when the payments passed with `flag_close_account` = 1 or with `Accounts_close` add up to **less** or **more** than `total_real`: refuse, close with a remainder, record change, keep the surplus as an unused payment. (The fields `paid_used` and `available_sum` suggest a payment can be partly unused; this is [READING], not stated.)
- What happens to `payments` sent with `flag_close_account` = 0: "accepted only when the bill is closed" says they are not accepted; whether the call errors or silently drops them is not stated.
- Whether a payment made through the payment link prints a fiscal receipt and closes the bill.
- Whether a bill with a payment linked through `Payments_create` can be closed by a waiter, and what the waiter sees.

**Answer for barsy:** the documented way to get a **paid and closed** bill is to do it in one call: `Accounts_place` with the payments and `flag_close_account` = 1 (or `Accounts_close`). So **the integrator closes**. Nothing stated says barsy closes by itself, and nothing stated says barsy checks the paid sum against the total. Treat both as unknown until Lukanet answers (questions below).

## 2.2 Other POS systems, from the vendors' own documentation

| POS | Does a fully paid bill close by itself? | Does the POS refuse a payment that does not match? | Source |
|---|---|---|---|
| **Oracle Simphony** (Transaction Services API) | Yes, inside the call. A tender with full payment makes the check "created and changed to a Closed state at the end of the call". A partial payment leaves the check **Open**; another tender for the balance can be added later with `AddToExistingCheckEx`. A tender of type Service Total creates an open check. For cash, `TmedPartialPayment` left empty means paid in full. | Not stated in the guide (no text on over- or under-tender found). | [VENDOR DOC] Oracle, Simphony Transaction Services API guide, rel. 19.2, ch. 7 (Post Transaction) and structure reference |
| **Square** (Orders API) | Only when the integrator asks. `PayOrder` collects the listed payments; it sets the order to `COMPLETED` "provided that" the sum of payments equals the order total and the order has no fulfilments; with fulfilments you must call `UpdateOrder` afterwards. After a cash payment is recorded, "the order isn't paid until you call the `PayOrder` endpoint". | The rule is stated twice: "The total of the payment_ids listed in the request must be equal to the order total"; a single `CreatePayment` on an order "must match the order total". The error for a mismatch is **not documented**. | [VENDOR DOC] Square, Pay for orders; PayOrder reference |
| **Toast** (Orders API) | Automatic, but with caveats. Check `paymentStatus`: OPEN "There is an outstanding balance"; PAID "A credit card payment was applied, but the tip has not been adjusted"; CLOSED "There is no remaining amount due". `closedDate` is set when payment and tip are added, or, for orders without tips, **during the nightly closeout batch**. "Toast does not prevent a CLOSED check from transitioning back to OPEN or PAID." Two Toast pages word OPEN differently ("until a payment is applied" and "outstanding balance"). | Not stated: the payments page says nothing on payment against the total. | [VENDOR DOC] Toast, Order object summary; Check schema; Adding payments to a check |
| **Lightspeed K-Series** (Order and Pay) | Not stated in the spec read. `POST /o/op/1/pay` "Add a payment to an existing order" returns `ok` meaning "the payment was accepted for delivery to the POS", not that it was applied. The result comes later through a webhook keyed by `thirdPartyPaymentReference`; a reused reference is a 400 ("reference has already been used"). A POS device processes it; `taskTtlInMs` caps delivery time. | Partly. The order record has `onlinePaymentCorrectedDifference`: "difference of online payment comparing to order's total due … positive if payment was higher", so the POS compares and corrects, but the rule is not described. | [VENDOR DOC] Lightspeed, Online Ordering API spec (source.json) |
| **uTill** | Paying part of a bill leaves "the remainder open"; the table stays open. | Not stated. | [VENDOR DOC] per `2026-10-18-bill-in-pos-systems.md` (not re-read) |
| **Microinvest, Mistral/Zamboo** | Unknown: no public API found (see `bill-in-pos-systems.md`). | Unknown. | — |

**What the pattern shows [READING]**

- There are two designs. In one, **closing is part of the paying call** (Simphony, barsy's `Accounts_place`, Square's `PayOrder`). In the other, the **POS sets the status later by its own logic** (Toast's batch and tip step, Lightspeed's device queue).
- Only Square states in writing that the sum must equal the total. Nobody documents the error text of a mismatch. A POS that refuses a wrong amount is a feature to ask for, not a thing to assume.
- A closed status can be reached by someone else's action (a waiter takes cash on the same bill) or can move back (Toast). So "closed" proves nothing about **our** payment.

## 2.3 What Restro must do itself, and what it can rely on the POS for

**Restro must do itself (POS-neutral)**

1. **Compute the amount from a fresh reading of the bill** and send exactly that. The platform already plans a frozen quote with a re-read before the money moves (`2026-10-18-what-restro-keeps-of-a-bill.md`). Never rely on the POS to refuse a wrong amount.
2. **Send a reference that is unique per attempt** and ask the POS to keep it (barsy `ref_num` / `transaction_id`; Lightspeed `thirdPartyPaymentReference`, which rejects a reuse; Square `idempotency_key`). It makes a retry safe and lets the read-back find our payment.
3. **Settle in one call where the POS allows it:** pay and close together (barsy `flag_close_account` = 1; Simphony full tender; Square `PayOrder`). Where it is asynchronous (Lightspeed), wait for the result event or poll.
4. **Verify after paying, with a read-back:** (a) bill closed, or remaining = 0; (b) paid total ≥ bill total; (c) **our payment is on the bill**, found by our reference, for the amount we sent; (d) the receipt or fiscal marker exists where the POS reports one. All four, not only "closed".
5. **Handle the mismatches itself:** bill still open with our payment on it; bill closed without our payment (a waiter closed it at the bar); our payment on it but total changed; no answer. Each is a "paid but not settled" state: never a second charge, a visible state for the venue, and a refund or a manual fix by a person.
6. **Never present a bill as paid** to the guest until the read-back passes (D72: no local success).

**Restro can rely on the POS for**

- The bill's own truth: totals, remainder, status, the fiscal receipt. Restro reads them; Restro's own copy is only a photo.
- The fiscal receipt itself, issued by the venue's device when the POS records the payment (barsy `Accounts_close` states it prints one; whether `Payments_create` does is not stated).
- Duplicate protection on bill creation (barsy `account.uuid`), but not on payments (not stated).

**Is a simple "is this bill still open / closed and paid?" check enough?** No. It misses three cases: the bill closed by someone else; a payment accepted but not yet applied (Lightspeed); a status that changes back (Toast). The check that is enough is the four-part read-back in point 4, plus a time limit after which an unsettled case becomes an exception.

## 2.4 Open points for Question 2

- barsy: everything under "Not stated" above.
- The behaviour of the Mistral and Microinvest systems: unknown.
- Whether any of these POS systems print the partial-payment department under Н-18 чл. 26а for an API payment smaller than the bill: unknown (already open in the 10-17 fiscal research).

---

# Questions for the POS vendors

POS-neutral wording first; the barsy form (Lukanet) follows where it differs.

## Closing and matching

1. **Does the POS close a bill by itself when the payments recorded on it equal the total?** Through which calls (payment call, payment link, close call)? Is it immediate, or a batch or a device step?
   *barsy:* Does `Payments_create` with `accounts` set to a bill, or a payment through `Accounts_getpaymentlink`, close that bill when `total_remain` becomes 0? Or must the integrator then call `Accounts_close` or `Accounts_place` with `flag_close_account` = 1?
2. **What does the POS do when the payments given with a close request add up to less than the total? To more than the total?** Refuse with which error, close with a remainder, record change, keep an unused surplus?
   *barsy:* For `Accounts_close` and for `Accounts_place` with `flag_close_account` = 1: what happens when the sum of `payments` is below or above `total_real`? Which error codes? Does an excess become an unused payment (`available_sum`)?
3. **What happens to `payments` sent when the bill is not being closed?**
   *barsy:* `Accounts_place` with `flag_close_account` = 0 and `payments` set: error, or ignored?
4. **Can an outside system pay part of an open bill?** Does the bill stay open, and is a partial-payment fiscal receipt printed?
   *barsy:* Does `Payments_create` linked to an open bill print a fiscal receipt, leave the bill open, and count as a partial payment under Н-18 чл. 26а?
5. **Is a status ever reversed** (closed back to open) by the POS or by a waiter, after an outside payment? Which events cause it?

## Reading back and idempotency

6. **Can an outside system set its own reference on a payment and read it back?** Is it unique, and what does a repeat do (reject, return the first result)?
   *barsy:* Are `ref_num` and `transaction_id` stored from `AccountPaymentInputData` and returned in `payments_history`? Is a repeated `ref_num` or `transaction_id` rejected?
7. **Is a payment call synchronous?** If the POS answers "accepted", is the payment already applied to the bill, or is it queued for a device?
8. **How does the outside system learn the final outcome** of a payment (read-back only, or an event)? Which fields prove it: status, remaining amount, receipt or fiscal marker?
   *barsy:* After `Accounts_place` or `Accounts_close`, which bill fields prove that the fiscal receipt printed (`unp`, `payments.fx`, receipt data), and where is the receipt number?

## Fiscal and records

9. **Which payment types print a fiscal receipt when recorded by an outside system?**
   *barsy:* Is it exactly the methods with `fx` = 1 in `Paymentmethods_getlist`? Can a method for Restro's provider be set up so that it prints at once?
10. **What does the POS store about an order that came from an outside system, and for how long?** Does it store refused or unconfirmed orders (Н-18 прил. 42)? Can the venue export them for the tax authority?
11. **Is the POS listed as sales software (СУПТО) with the NRA, and does it hold the database under Н-18 чл. 52к for the venue?**
12. **Does the POS keep the bill's history readable** (orders, payments, deletions, who and when) for the venue for the legal periods, and is it exportable?

---

# Sources

**Bulgarian law** (consolidated texts downloaded and searched as text, 2026-10-18; lex.bg returns windows-1251 text):
- Наредба № Н-18 от 13.12.2006: https://lex.bg/bg/laws/ldoc/2135540645 (чл. 42, ал. 7; чл. 52з, 52к; § 1, т. 19; приложения № 29 и № 42). Latest amendment seen in the text: ДВ бр. 42/2025.
- ЗДДС: https://lex.bg/bg/laws/ldoc/2135533201 (чл. 118, ал. 1, 1а, 18; чл. 121; § 1, т. 84).
- ДОПК: https://lex.bg/laws/ldoc/2135514513 (чл. 38, ал. 1 to 3; чл. 171, ал. 1 and 2).
- Закон за счетоводството, consolidated text through ДВ бр. 72/2024: https://trudipravo.bg/znanie-za-vas/zakon-za-schetovodstvoto/ (чл. 6, 7, 11, 12, 16). A publisher's copy of the statute; the official lex.bg and minfin.bg copies refused access. Check the retention article (чл. 12) against the State Gazette or lex.bg before relying on it in a contract.

**EU law and guidance** (EUR-Lex text downloaded and searched):
- PSD2, Directive (EU) 2015/2366: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32015L2366 (Art. 21, 71, 72, 73, 94).
- Directive (EU) 2015/849: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32015L0849 (Art. 2, 40). Original 2015 text, not the amended version.
- GDPR, Regulation (EU) 2016/679: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679 (Art. 4, 5(1)(e), 17(3), 28).
- EDPB Guidelines 07/2020 on controller and processor, v2.1: https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf (para. 12, 81, example "Bank payments").

**Card schemes and providers**
- Visa Core Rules and Visa Product and Service Rules, 18 April 2026: https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf (1.5.2.2; Dispute Conditions 10.4 and 13.1 time limits).
- Stripe, How disputes work: https://docs.stripe.com/disputes/how-disputes-work
- myPOS Legal Agreement, myPOS Payments Ltd UK, 16.10.2025: https://merchant.mypos.com/en-gb/legal_docs/download/data:WyIwMTAiLCJHVEMiLCJHVEMxODIwNiIsIjAwMyIsbnVsbCwiTGVnYWwgQWdyZWVtZW50IGZvciBteVBPUyBTZXJ2aWNlIGJ5IG15UE9TIFBheW1lbnRzIixbXSwiZXJ6WHFKZkl2K1M5aHA2b3M3R3J4TG15dzRhdXVjeTZ1TmFwc3NPR3Jybk11cmpXcWJMRGhxNjV6THE0Il0= (clause 12.1).
- Mastercard Chargeback Guide: not retrieved (access denied).

**POS vendors**
- Square, Pay for orders: https://developer.squareup.com/docs/orders-api/pay-for-orders ; PayOrder: https://developer.squareup.com/reference/square/orders-api/pay-order
- Toast, Order object summary: https://doc.toasttab.com/doc/devguide/apiOrdersOrderObjectSummary.html ; Check schema: https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Check/ ; Adding payments: https://doc.toasttab.com/doc/devguide/apiAddingPaymentsToACheck.html ; Orders API overview: https://doc.toasttab.com/doc/devguide/portalOrdersApiOverview.html
- Lightspeed K-Series API spec: https://api-docs.lsk.lightspeed.app/source.json (`/o/op/1/pay`, `apeStandalonePayment`, `apePaymentBadRequestError`, `order-payBackofficeOrderDto`)
- Oracle Simphony Transaction Services API guide, rel. 19.2: https://docs.oracle.com/cd/F32325_01/doc.192/f32377.pdf (ch. 7 Post Transaction; `TmedDetailItemEx`)
- uTill payment: https://docs.untill.com/mikel/payment (via `2026-10-18-bill-in-pos-systems.md`, not re-read)
- barsy: `E:\Restro\docs\deliverables\2026-10-18-barsy-api-reference.md` only (base `https://docs.lukanet.com/barsy.api/`).

**Repo documents used:** `2026-10-18-why-restro-keeps-orders.md`, `2026-10-18-what-restro-keeps-of-a-bill.md`, `2026-10-18-bill-in-pos-systems.md`, `2026-10-17-fiscal-rules-in-app-payments.md`.
