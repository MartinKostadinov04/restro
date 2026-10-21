Made by: dispute traceability subagent (Opus), 10-21. For: Martin, and whoever writes D122 (board review TF6). Informs, never binds (D114).

# Can Restro answer a card dispute, and "who did what"?

## Short answer

Mostly yes, but not from the Log. The Log lives 31 days. Most card disputes arrive later, usually within 120 days of the payment. So the facts a dispute needs must sit on the order and payment records, which live 18 months. Most of them already do. Seven small additions close the gaps. None of them stores a phone, device or IP identifier.

## 1. The rules that matter

**How late a dispute can come.** Visa's rules (April 2026 edition) give the cardholder's bank:
- card-absent fraud (10.4): 120 days from processing;
- duplicate or paid by other means (12.6): 120 days;
- not received (13.1): 120 days from processing, or from the date the service was expected, never past 540 days;
- not as described (13.3): 120 days from processing or from receipt.

Then the venue answers (usually within 7–21 days) and the bank decides (60–75 days): 2–3 months in all (Stripe).

**Is 540 days right?** As a ceiling, yes. For drinks served that night the real limit is 120 days plus about 3 months, under a year. 540 days matters only for something sold for a later date, such as a booked table. D111's 18 months is safe, if counted from the service day and held while a dispute is open (M6).

**Mastercard:** its guide refused us (403). Second-hand pages give the same 120 and 540 days. **Unknown** from a primary source.

**3-D Secure.** A payment the guest's bank authenticated (Visa: ECI 5 with a CAVV; mostly also ECI 6 "attempted") makes a 10.4 fraud dispute invalid. It covers fraud only; the other types are argued on evidence. Catches: when the bank applies an exemption, there is no 3-D Secure and no shift (Stripe), and most bar payments are under €50, the low-value exemption. Even then the shift is expected, never guaranteed.

**Visa's newer fraud defence (Compelling Evidence 3.0)** needs the guest's IP or device ID from earlier payments. Restro never keeps them, by design, so it relies on 3-D Secure instead.

## 2. Who answers a dispute

The venue, as the merchant (D98). With Stripe direct charges the dispute lands on the venue's account and balance, and the venue answers in its dashboard (a platform can also answer through the API on its behalf). myPOS's terms also put the evidence on the merchant. Restro's job is to hand the venue the evidence, in one place, for 18 months.

## 3. Each dispute type

| Dispute | What wins it | Restro's record | Lives |
|---|---|---|---|
| Fraud, card absent (Visa 10.4, MC 4837); "unrecognised" (MC 4863) | 3-D Secure result; venue's trade name on the card statement | Payment: provider id, authorisation code. The 3-D Secure result is at the provider; Restro copies it (M2) | 18 months |
| Not received (13.1, MC 4853) | The sent order was on the right table's bill; the paid lines; the receipt | Sent order: table, time, items, the price shown, POS bill, final state. Payment: lines, receipt number (SS4) | 18 months |
| Not as described (13.3) | What the guest was shown before paying | Line names and prices, not the menu text. Old menu versions are purged after 30 days (D96) (M1) | 18 months, partly |
| Duplicate (12.6.1, MC 4834) | Each payment is separate: different provider ids, lines and receipts. A released hold was never charged | Payment ids and lines yes; hold and release times not yet (M2) | 18 months |
| Paid by other means (12.6.2) | The POS bill was closed by the app payment, with its receipt (TS4) | The close read-back is only in the Log (M2, M3) | **31 days** |

## 4. The owner's questions

| Question | Record | Lives | Enough? |
|---|---|---|---|
| Who sent this order? | Sent order: "a guest phone at table 7", time, reference, consent version | 18 months; step by step in the Log for 31 days | Yes, by design: never which phone or person (D111, D121). The provider knows the card; the POS knows a waiter's round |
| Who moved these lines? | Log: which lines, from where to where, who, when (SF1) | 31 days | Mostly. For a move in the POS, "who" needs the POS to report its user (**unknown**, like C52). Paid lines lose their origin at 31 days (M4) |
| Who resumed this table? | Log `table.resumed`: staff account, or which automatic trigger (D120) | 31 days | Yes: an operations question, asked the same week |
| Who changed a guard? | Log, with the values before and after (TS8) | 31 days | **No.** A guard switched off in March and still off in June has no author (M5) |
| Who pressed "Done"? | Log: the linked Restro account (TS7) | 31 days | For a money alert, **no** after 31 days (M3) |
| What did the guest see before paying? | The phone sends the lines it saw, and the worker checks them line by line (D121, SS1) | Only the payment total and "what it paid for" are kept | **Partly** (M1) |

## 5. What is missing

| # | Smallest addition | Where |
|---|---|---|
| M1 | The payment keeps the exact lines the guest confirmed: each name and options as shown, quantity, unit price, line total, guest or staff round, the reading's time and the confirmed total | D122, sharpening D111's "what it paid for" |
| M2 | The payment keeps its milestones: held, written to the POS, the close read-back (closed or not, payment type, amount, receipt and fiscal memory number), captured or released with the reason; plus the 3-D Secure result and ECI. Round 2 already adds the provider id and the authorisation code | D122 |
| M3 | A money alert's outcome is copied onto its payment: who pressed Done, when, and what they did (released, refunded, storno) | D122 (TS7) |
| M4 | A paid line that was moved keeps its first table and the POS bill it was paid on | D122 (SF1) |
| M5 | Guard and permission changes are kept 18 months, not 31 days (a handful a year). Each sent order also records whether the location check passed, was off at the venue, or was not needed | D122 (TS8); a line in D119 |
| M6 | The 18 months count from the service day. A disputed payment is held until 6 months after its dispute closes. The hold is set by the provider's signed dispute notice (SS3), or by the owner's tap where none comes | D122, amending D111 |
| M7 | Ask for 3-D Secure on every in-app payment, so the fraud shift applies to small payments too. The cost is some extra taps at the bank | The payment map (phase 2); recommend yes |

Not record gaps: the venue's trade name on the card statement (a setup checklist item), and a printable "dispute evidence" page from M1–M3, the cheap form of the staff review's dispute pack (4.9), later as F23 says.

**Privacy check:** M1–M7 add no phone, device or IP identifier; M3 and M5 name staff accounts, as the Log already does.

## 6. Unknowns

- Mastercard's time limits, from the primary source.
- Whether Mistral or barsy report which POS user moved or closed a bill.
- Whether the chosen provider (D98 still open) applies the low-value exemption by default, and whether that can be turned off.
- A refund or terms line at Pay: Stripe's evidence form asks for one; nothing is designed yet.

## Sources

- Visa Core Rules and Product and Service Rules, 18 April 2026, sections 11.7.5 (10.4), 11.9.5 (12.6), 11.10.2 (13.1), 11.10.4 (13.3): https://usa.visa.com/dam/VCOM/download/about-visa/visa-rules-public.pdf
- Visa disputes FAQ (540-day cap): https://usa.visa.com/dam/VCOM/global/support-legal/documents/faq-apr-disputes.pdf
- Stripe, dispute categories and evidence: https://docs.stripe.com/disputes/categories
- Stripe, how disputes work: https://docs.stripe.com/disputes/how-disputes-work
- Stripe, 3-D Secure and liability shift: https://docs.stripe.com/payments/3d-secure/authentication-flow
- Stripe, exemptions and no shift: https://docs.stripe.com/strong-customer-authentication/sca-enforcement
- Stripe, Visa Compelling Evidence 3.0: https://docs.stripe.com/disputes/api/visa-ce3
- Stripe, disputes on Connect: https://docs.stripe.com/connect/disputes
- Mastercard 4853, second-hand: https://kount.com/chargeback-reason-codes/mastercard/cardholder-dispute-goods-or-services-not-provided
- myPOS terms clause 12.1, as read in `2026-10-18-records-and-bill-closing.md`
- Repo: D98, D111, D112, D116, D119, D120, D121; `2026-10-21-board-review-answers.md`; `2026-10-21-ordering-check-round-2.md` 5.3 and 5.6; `2026-10-20-service-log-design.md`
