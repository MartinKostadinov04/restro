# Ordering review: law, privacy and money (sections 9–11)

Made by: reviewer (Opus), 10-20, for Martin's check of sections 9–11

Read against `2026-10-20-ordering-what-we-decided.md` as amended by `2026-10-20-ordering-check-round-1.md` (round 1 wins). Law re-read on lex.bg today: Н-18 (to ДВ 42/2025) and ЗДДС (to ДВ 69/2026). Marks: [LAW] a text says it, [READING] my interpretation, [PRACTICE] common practice.

## Findings, most important first

**1. Once the close call has left, the hold must never be cancelled automatically.** Items 6.8, 8.1, 8.4, round 1 "6.8". **Must fix before the pilot.**
- Round 1 says: "If the POS refuses or doesn't answer, the reservation is cancelled". 8.4 says: "On a mismatch the hold is released".
- Story: Restro closes table QR-3 with the card payment. Mistral prints the fiscal receipt, but the answer is lost (a timeout). Restro cancels the hold. The venue has a receipt and a sale in its Z-report, and no money.
- [LAW] Undoing a receipt takes a storno (a reversal document from the fiscal device), done by hand (Н-18 чл. 31, ал. 1).
- Recommendation:
  - Treat the close like a round (5.6). A clear "no" means cancel the hold.
  - A timeout means "unknown": read the virtual table back for about a minute. Restro holds that table alone, so "empty after the close" means "closed".
  - Still unknown means a new state, **payment unconfirmed**. Keep the hold and alert staff. Staff answer in the operations panel: "receipt printed" captures the money; "no receipt" releases it and moves the lines back.
  - On a mismatch, capture what the receipt shows if it is within the hold. Never release.

**2. A capture that fails after the receipt printed needs a defined path.** Items 6.8, 9.11. **Must fix before the pilot.**
- Story: the provider is down for 20 minutes right after the close.
- [PRACTICE] An authorisation for a guest-started online card payment lasts 7 days at Visa and Mastercard (Stripe's published table). myPOS says "typically up to 30 days", by type of business.
- Recommendation: retry the capture with the same key through the service day, and alert the Restro team after 1 hour. If it is still not captured after 4 days, the venue does a storno.
- [LAW] A storno for "операторска грешка, включително по отношение начина на плащане" is allowed even when the cash drawer is short, and must be done by the 7th of the following month (Н-18 чл. 31, ал. 3–4). [READING] Whether a payment that never arrived fits that wording is a narrow lawyer question.

**3. "Download receipt" must not be a copy of the fiscal receipt.** Items 7.3, 8.7. **Must fix before the pilot.**
- [LAW] A fiscal receipt is issued "в един екземпляр за клиента" (Н-18 чл. 25, ал. 9). The only allowed duplicate is one printed "ДУБЛИКАТ", made by the device right after the original (Annex 1).
- [LAW] No other document given to customers may contain "Фискален/-а/-о/-и" (чл. 7а, ал. 3). Yet every receipt must show "ФИСКАЛЕН БОН" (чл. 26, ал. 1, т. 10).
- [READING] So a PDF that Restro builds from the receipt's data breaks чл. 7а, and the venue is the one fined.
- Recommendation: the download is the provider's **payment confirmation** ("Потвърждение за плащане"): venue, date, amount, the lines paid and the provider's reference. It must not use "фискален" or "бон", must not look like a receipt, and is given once on the paying phone, never as a lasting link.

**4. The paper receipt must reach the guest. It must not wait "at the bar".** Items 6.9, 6.10, 7.3, 8.7. **Must fix before the pilot.**
- [LAW] The venue hands over the receipt "едновременно с получаване на плащането" (Н-18 чл. 25, ал. 6). The guest must take it and keep it until leaving (ЗДДС чл. 118, ал. 1, second sentence; round 1 cites ал. 1а, which is the guest's right to withhold payment).
- [LAW] What it costs:
  - issued but not handed over: 1,000–4,000 лв (converted to euro) for a company (ЗДДС чл. 185, ал. 2, last sentence → ал. 1);
  - not issued at all: up to 30 days' sealing of the club (чл. 186, ал. 1, т. 1 "а").
- Story: an NRA inspector makes a test purchase (контролна покупка) through the app, and the receipt sits at a bar 20 m away.
- Recommendation:
  - The waiter brings the receipt with the drinks (pay-first) or to the table, as with a card terminal today. The screen says "Your waiter brings your receipt".
  - This makes 6.10 (a), virtual tables per bar, a fiscal need as well as a service one.

**5. Require two-step payment (authorise, then capture) for the pilot's provider.** Round 1 "6.8". **Must fix before the pilot.**
- The fallback for providers without it: charge first, refund "only on a clear no".
- Story: a close times out and the POS never closed. The guest has paid, and no receipt exists. That is money without a receipt, the case that can seal a club.
- Recommendation: make "can authorise and capture" a go/no-go line for the provider. myPOS has it, but its support must switch it on.

**6. "Closed" must also mean "the fiscal receipt printed".** Items 8.4, 8.1. **Should fix.**
- Story: the fiscal printer runs out of paper. The POS marks the bill paid, and no receipt exists.
- Recommendation: store the receipt number on the payment record (1.10's "receipt reference"). Ask Mistral whether a close returns it, and whether a close can succeed while the printer fails. A close with no receipt number alerts staff: "Print the receipt for QR-3".

**7. Paying on a virtual table raises no fiscal issue if three things hold.** Items 2.8, 1.10, 8.1. **Should fix.**
- [LAW] A receipt has no table field (Н-18 чл. 26, ал. 1, т. 1–17). With unlisted software it has no sale number (УНП) either.
- [READING] Paying on "QR-3" is what the venue's waiters already do. It is a whole sale with its own receipt.
- The three things:
  1. Restro closes with the **card** payment type, never cash. Otherwise the Z-report expects cash in the drawer that isn't there.
  2. Each payment record links the real table, the virtual table, the receipt number and the provider's reference.
  3. The venue can match the provider's payouts against the card totals of its Z-reports.
- Add a Mistral question: which payment type an outside close uses.

**8. Deadlines and the provider's late approval.** Round 1 "6.6" and "payment queue"; 9.1. **Should fix.**
- Story: Restro's deadline passes in the same second the provider approves. The lines go back to table 7 while money is reserved.
- Recommendation:
  - On a deadline, cancel the provider's payment session first, and move the lines back only after the provider confirms.
  - An approval that arrives after a cancel is voided at once.
  - Each step changes the payment record in one atomic step that names the expected earlier state, so only one path wins.
  - A venue pause stops *new* payments only; payments already running still finish or undo.

**9. Refunds, storno, and Restro's key to the venue's provider account.** Item 8.8. **Should fix.**
- [LAW] A refund needs a storno "в момента на възстановяване" (Н-18 чл. 31, ал. 4). Only an integrated system (ИАСУТД) is expressly allowed a storno for a card refund (ал. 3а). For an ordinary fiscal device, it is lawyer question L10.
- Recommendation:
  - Restro reads the provider's refund notice, marks its payment record "refunded", and reminds staff: "Make the storno in the POS now".
  - Restro's key may create, capture and cancel payments only, never refund or pay out.

**10. Chargebacks: the evidence must outlive the Log.** Items 9.10, 10.1. **Should fix.**
- The venue is the merchant of record, so a dispute (chargeback) is charged to its provider account. Disputes usually arrive 30–120 days later, after the Log is erased at 31 days.
- [PRACTICE] Disputes are won with: the confirmed lines and total, the confirmation and capture times, the strong-authentication (3-D Secure) result and the receipt number.
- Recommendation: keep these on the 18-month payment record. The card statement should show the venue's trade name ("unrecognised payment" is the commonest dispute).
- The likeliest "not received" dispute: a pay-first drink taken to the wrong table (6.10).

**11. Restro becomes a controller where it uses orders for its own ends.** Items 10.4, 1.10. **Should fix.**
- [LAW] A processor that sets its own purposes is a controller for them (GDPR Art. 28(10)). D111 names Restro's fee and insights (D32) as reasons to keep orders.
- Recommendation: use only totals with no payment reference for these, or name Restro as controller in the privacy notice.
- [LAW] At the end of the contract, Restro returns or deletes the data (Art. 28(3)(g)). Offer the venue an export of payments before a purge (D83).

**12. Leaks through error reports and logs.** Items 3.1, 3.6, 1.10. **Should fix.**
- [PRACTICE] Sentry can attach request headers and bodies to an error. pino logs what it is given. Railway's HTTP logs record client IPs.
- Story: one crash sends the table-code header and a guest's coordinates to Sentry, against D118 ("never written") and 3.1.
- Recommendation:
  - Strip request bodies and the table-code header in Sentry's `beforeSend` and in pino's redaction.
  - Write down Railway's log retention, and say in the privacy notice that backups keep erased rows for 30 days.

**13. Order notes can be health data.** Items 4.2, 9.8. **Should fix.**
- [READING] "No nuts, allergy" is health data (GDPR Art. 9), and today it stays on the 18-month order.
- Recommendation: erase notes after 31 days, with the Log, and never put them in an alert. Telegram gets every alert and has no processing agreement (DPA) with Restro.

**14. Card data (PCI scope).** Items 6.6, 11.1. **Should fix.**
- [PRACTICE] With the provider's hosted iframe or redirect, the venue qualifies for the shortest self-check (PCI DSS SAQ A). Its 2025 revision asks the merchant to confirm that the payment page is safe from injected scripts, and Restro hosts that page.
- Recommendation:
  - Card fields only in the provider's iframe, with a strict content policy (CSP) and few scripts on the pay screen.
  - Never store the card number, expiry date or CVC, and not the last four digits either.
  - Give venues a one-page PCI statement.

**15. Smaller points.** **Nice to have.**
- [LAW] Restro stays outside payment licensing only while it never holds the money (PSD2 Art. 3(j)). Invoice its fee separately; never deduct it from guest payments.
- [LAW] Strong authentication binds the amount (PSD2 RTS Art. 5). A later tip must be added before the guest pays, never at capture.
- [LAW] The euro is the currency: "Pay €24", not "24 лв" (items 6.2, 6.5). Check whether showing both currencies still applies: it ran to 08.08.2026, and an extension to 31.12.2026 was reported.

## Martin's question (7.3/8.7): is "Download receipt" plus the paper at the bar all the law needs?

**Not quite.**
- [LAW] The law needs the **paper fiscal receipt, handed to the guest at the payment** (Н-18 чл. 25, ал. 6).
- [LAW] An electronic receipt may replace the paper only for a venue that chose software from the NRA list, filed Annex 32 and holds the guest's contact data (Н-18 чл. 3, ал. 18). Mistral is not on the list (#33), so at the pilot that route is closed.
- So:
  - (a) the waiter brings the paper receipt to the guest (finding 4);
  - (b) "Download receipt" is a courtesy: the provider's payment confirmation, never a copy of the receipt (finding 3).
- **For the lawyer:**
  - whether a receipt brought a few minutes later still counts as "at the same time";
  - L3 (an anonymous app session as a "profile"), for listed-software venues later;
  - the operator-error storno in finding 2;
  - L10.

## What is sound

- Restro writes to the POS only after approval, and captures only after the POS confirms. Released holds need no document [READING, L7].
- The guest confirms the bill as read back from the virtual table, so strong authentication covers exactly what the POS holds.
- A split is a whole sale with its own receipt, which avoids чл. 26а's part-payment form. Paying an amount stays out.
- The saga record per payment, the recovery job, and virtual tables that are locked and checked empty before use.
- Restro never holds money. The venue is the merchant, and the provider keeps the card data.
- The location check: consent asked first, nothing stored, other ways to order, a revocable pass, and proof of consent without an identifier (D119, D121).
- The Log holds no phone, IP or position, and is erased after 31 days. Owners see their own venue only.
- Retention of 18 months matches the 540-day dispute window, and the 5-year fiscal record stays in the POS.
- Alerts carry no guest identity, and the watchdog gets no personal data.
