# Fiscal, receipt and tip questions: answers from the texts (10-28)

Made by: research agent (Opus) for #52, 10-28. For: the Ordering lead and Martin.

> **Not legal advice.** This is research for Martin. It answers, from the texts, the questions the 10-26 file left for the lawyer (5, 6) and the accountant (1–4), and narrows what is left. Every **[READING]** is our interpretation, not a fact.

**Builds on** `2026-10-26-pilot-law-working-answers.md` (the 10-26 file), `2026-10-25-tips-research.md`, `2026-10-21-pilot-law-working-answers.md`, `2026-10-21-receipt-and-payment-law.md`, `2026-10-17-fiscal-rules-in-app-payments.md`, D125 and D127. It does not repeat them.

**Marks.** **[TEXT]** = the rule's own words, quoted or paraphrased, with article. **[PRACTICE]** = an NRA opinion, a court ruling or official guidance. **[READING]** = our reasoning. **[UNKNOWN]** = searched for, not found.

**Read on 2026-10-28.** Every source below was read on that date. Н-18 (to ДВ 42/2025), ЗДДС (to ДВ 69/2026), ДОПК (to ДВ 85/2026), ЗДДФЛ (to ДВ 85/2026), КТ (to ДВ 89/2026), КСО (to ДВ 68/2026) and ЗКПО (to ДВ 55/2026) were downloaded whole from lex.bg and searched as text. The NRA tips letter was read in full this time, all 11 pages, from its text layer.

## Summary

| # | Question | Answer | How sure | Still needs a professional? |
|---|---|---|---|---|
| L5 | May the venue rely on the NRA tips letter (ВК-30-14766/23.10.2025)? | Yes in substance. The letter is an internal explanation, binding on no one, but what it asks follows from ЗДДС and Н-18 and the EU Court. It names payment "през платформа" too. Following it records more, never less. | Medium-high | No for the pilot. One optional question kept, on protection if the NRA changes its view. |
| L6 | Is a receipt printed at close, after the card hold and before capture, issued "при извършване на плащането"? Is a storno the fix if capture then fails? | (a) Yes: for card payments Н-18 itself treats the authorisation as the moment of payment. (b) If the guest then pays another way, the text gives the fix: a storno for operator error on the payment type, by the 7th of next month. If the guest has gone, no text says. | (a) Medium-high. (b) Medium / unsettled | (a) No. (b) Yes, a narrow and rare case. |
| A1 | Day-end summary receipt for in-app tips? | No. An in-app tip is chosen before payment, which is the letter's case А: on the same receipt, or on a separate tip-only receipt **at the same moment**. A daily summary is tolerated only when the guest has left. | Medium-high | No |
| A2 | Tips through payroll; Stripe's fee on the tip part | Tips are the venue's revenue (gross) and, once handed to staff, employment income: payroll, 10% tax, full contributions. Stripe's fee is one expense on the whole charge, with nothing to split. Cash paid out from the till is a "служебно изведена сума". | High (payroll), medium (fee VAT class) | No. One optional question, only if the venue wants to pay staff the tip net of the fee. |
| A3 | A "Card online" payment type, and reconciling with Stripe payouts | Allowed, if it maps to the device's single card register (SCards). Never map it to "банка" or a "резерв" type. Reconcile per payment using Stripe's itemized payout report, booking gross revenue, fee and payout separately. | High | No |
| A4 | Restro's fee: fiscal receipt or invoice? | An invoice, always, but it doesn't replace a receipt. With no receipt needed: bank transfer or SEPA direct debit (Н-18 чл. 3, ал. 1), or a recurring card charge on a saved card with a document (Н-18 чл. 3, ал. 1а, т. 1). A card payment the venue makes itself, at checkout, needs a fiscal receipt from Restro. | Medium-high | No |

**What's new against the earlier files.**
1. **The letter is a "разясняване", not an "указание".** It is issued under ЗНАП чл. 10, ал. 1, т. 10 ("организира разясняване"), not т. 4 (binding instructions). It is addressed to the NRA's own appeals directorate. ДОПК чл. 17, ал. 4 says such general opinions must be published; this one was not.
2. **The letter covers in-app tips expressly.** Its last paragraph says payment "през платформа" changes nothing. Its case А is a percentage the guest picks before the bill closes: exactly D127's 5/10/15 % row.
3. **Storno for a wrong payment type is in the text.** Н-18 чл. 31, ал. 3 names "операторска грешка, включително по отношение начина на плащане", and ал. 4 allows it until the 7th of the next month.
4. **Group А items must be programmed by name and unit price** (Н-18 чл. 27, ал. 3, т. 1), and a storno is refused for items not programmed that way (чл. 31, ал. 7). The tip article must be set up so, which is a POS question.
5. **A card subscription can avoid a receipt** under Н-18 чл. 3, ал. 1а, т. 1 (recurring card payments made with the client's prior consent). Earlier files missed this.

## L5. May the venue rely on the NRA's tips letter?

**Answer.** Yes, in substance. The letter binds neither the venue nor the courts. But its conclusions follow from rules that do bind, and it covers in-app tips by name. A venue that follows it records more income on the fiscal device, never less. The one open point is whether the venue would be protected from a fine if the NRA later took a different view. That matters only if the NRA reversed itself, and the VAT point rests on an EU Court ruling.

**What the letter is.**
- [TEXT] It opens "На основание чл. 10, ал. 1, т. 10 от [ЗНАП] изразявам следното становище", is addressed "ДО ДИРЕКЦИЯ ОДОП" ("Уважаеми колеги") and is signed by deputy executive director В. Петкова. Every page is marked "Ограничено ползване – TLP-AMBER" (letter, pp. 1–2, 11).
- [TEXT] ЗНАП чл. 10, ал. 1 gives the executive director two different powers:
  - т. 4: "дава задължителни указания на органите на агенцията за единното прилагане на данъчното и осигурителното законодателство";
  - т. 10: "организира разясняване на данъчното и осигурителното законодателство".

  The letter rests on т. 10. (Read in kik-info.com's copy of ЗНАП, to ДВ 55/2026; lex.bg refused the download.)
- [READING] So the letter is an explanation, not a binding instruction even inside the NRA. It is the NRA's view, weighty in practice, but not binding on the venue or the courts.
- [TEXT] ДОПК чл. 17, ал. 4: "Указанията за единното прилагане на законодателството … както и всички отговори или становища с общ методологичен характер … се публикуват", on the administration's website.
- [READING] The letter answers inquiries "постъпват" in general (p. 1), so it is of a general methodological kind. Not publishing it sits badly with ал. 4, but that is the NRA's problem, not the venue's.

**What it says that matters for Restro** [TEXT, letter]:
- **Payment by platform is covered.** "начинът на плащане на бакшишите (в брой, през ПОС-терминал, през платформа и т.н.) … не променя третирането им" (p. 11).
- **Case А, the tip before the receipt.** The guest names a sum or a percentage "(например 5%, 10%, 15% и т.н.)", and it "следва да се отрази във фискалния бон" in group "А". A department "БАКШИШ" with the article "бакшиш" "би било удачно", which means recommended, not required. "Допустимо е да се издаде и отделен фискален бон само за размера на бакшиша" (p. 9).
- **VAT.** A voluntary tip, in an amount the client decides and not set by the venue as due, is not part of the consideration and carries no VAT (pp. 4–5, citing ЗДДС чл. 26, ал. 2 and CJEU C-404/99).

**Why relying on it is safe** [READING]:
- **VAT.** The no-VAT point is the EU Court's (C-404/99), which binds Bulgarian authorities and courts on VAT. Group А is the device group "за продажби, за които не се начислява ДДС" (Н-18 чл. 27, ал. 1, т. 1) [TEXT].
- **The receipt.** Putting the tip on the device follows from the rules themselves: a fiscal receipt for each payment (Н-18 чл. 25, ал. 1, т. 1), issued at payment (ал. 6) [TEXT]. Leaving the tip off would make the card total on the receipt smaller than the amount captured.
- **The only alternative reading,** a tip as a service charge in group Б, would apply only if the venue set the tip as due. D127's tip starts at zero and is never called a service charge, which is the letter's own test.

**Protection if the NRA changes its view.**
- [TEXT] ДОПК чл. 17, ал. 3: when a person acts on "писмени указания от министъра на финансите, орган по приходите или публичен изпълнител", which later prove unlawful, interest is not due "а определената от закона санкция не се налага".
- [PRACTICE, secondary] Courts are split on what counts as "писмени указания" under ал. 3. One decision required instructions aimed at an unspecified group and published on the NRA's site (Решение № 2262/01.04.2019). Others accepted earlier NRA acts toward the same taxpayer (ВАС Решение № 817/18.01.2011, as summarised). Source: balans.bg (P. Stefanov, 30.09.2022), read only to locate the rulings, which were not read at the source.
- [READING] An unpublished letter addressed to the NRA's own directorate is a weak basis for ал. 3. A written answer to the venue's own inquiry is a strong one.
- [UNKNOWN] Whether ал. 3 reaches fines under ЗДДС чл. 185, which are imposed under ЗАНН. No ruling was found.
- [UNKNOWN] No court ruling on tips under ЗДДС or Н-18 was found. The NRA has published nothing on tips on nra.bg (searched 10-28).

**How sure:** medium-high that following the letter is lawful and safe. Low on how ДОПК чл. 17, ал. 3 would apply.

**What it changes.** Nothing in D127. Recommendation: before the first live tip, the venue's accountant sends the NRA a short written inquiry describing D127's tip (chosen before payment, same receipt, group А) and asks for confirmation. The answer then becomes the venue's own written basis under ДОПК чл. 17, ал. 3. This is a step for the venue, not a lawyer question.

**Still needs a lawyer:** no for the pilot. Optional, for the record:
- BG: Ако заведение отразява бакшишите съгласно писмото на НАП ВК-30-14766/23.10.2025 (непубликувано, адресирано до дирекция ОДОП), а впоследствие НАП приеме друго, защитава ли го чл. 17, ал. 3 ДОПК от имуществена санкция по чл. 185 ЗДДС?
- EN: If a venue records tips as the NRA letter ВК-30-14766/23.10.2025 says (unpublished, addressed to the ОДОП directorate), and the NRA later takes another view, does ДОПК чл. 17, ал. 3 protect it from a fine under ЗДДС чл. 185?

## L6. The receipt at close, before capture

**Answer.**
- **(a)** Yes. For card payments, Н-18 treats the bank's authorisation as the moment of payment, and the NRA letter does the same. A receipt printed at close, after the hold and seconds before capture, is issued "при извършване на плащането".
- **(b)** If the capture then fails while the guest is still there and pays another way, the fix is a storno for operator error on the payment type, followed by a new receipt. If the guest has gone, no text says what to do. That case is rare, and it is the only part left for the lawyer.

**(a) The moment of payment.**
- [TEXT] "Фискалната касова бележка … се издава при извършване на плащането", and is handed over "едновременно с получаване на плащането" (Н-18 чл. 25, ал. 6).
- [TEXT] For an e-shop's card document, the ordinance fixes the moment as "при извършване на плащането с дебитна или кредитна карта/авторизацията на нареждането за плащане от виртуалния ПОС" (Н-18 чл. 52о, ал. 5). That puts paying by card and the authorisation on the same footing.
- [PRACTICE] The tips letter speaks of a guest who "е напуснал след авторизацията на плащането" (p. 10), treating the authorisation as the end of the payment.
- [READING] A physical card terminal works the same way: approval at the table, money settled later in the terminal's day-end batch. A D127 hold is that approval, and the capture follows within seconds of the close.
- [READING] The paper receipt is printed at the bar and the waiter brings it, as in any table service. D122 §8 already plans this.

**(b) A capture refused after the receipt.**
- [TEXT] A storno after the bill is closed is allowed for "рекламация или връщане на стока, … операторска грешка или … намаление на данъчната основа" (Н-18 чл. 31, ал. 1).
- [TEXT] The usual check for enough cash in the till does not apply to "сторно операция при операторска грешка, включително по отношение начина на плащане" (чл. 31, ал. 3).
- [TEXT] A storno for operator error is made "до 7-о число на месеца, следващ месеца, в който е допусната грешката" (чл. 31, ал. 4).
- [READING] **The guest is still there and pays by cash or another card:** a storno for operator error on the payment type, then a new receipt with the right type. The text names this case. Without it, the device's card total would overstate the card takings.
- [READING] **The guest has gone:** the sale was made and VAT is due on it (ЗДДС чл. 25, ал. 2: the tax event is the supply). A storno for "operator error" would erase a real sale. So the receipt should probably stand, and the venue books an unpaid receivable. No text and no NRA practice was found on this. [UNKNOWN]
- [READING] **How rare:** a capture within seconds of a valid hold almost never fails. D127 3.14 already alerts the owner when it does.

**How sure:** (a) medium-high. (b) medium where the guest pays again; low where the guest has gone.

**What it changes.**
- D127 stays as written.
- Add to the owner's alert for D127 3.14: "If the guest pays another way: storno for operator error on the payment type, by the 7th of next month, then a new receipt."

**Still needs a lawyer:** only the narrow case.
- BG: Плащането с карта е одобрено (блокирана сума), фискалният бон е издаден с начин на плащане „карта", но усвояването (capture) след това е отказано и гостът вече е напуснал. Остава ли бонът (продажбата е извършена, вземането е несъбрано), или следва сторно по чл. 31, ал. 1 от Н-18 като операторска грешка?
- EN: The card payment was approved (amount held) and the receipt was issued with payment type "card", but the capture is then refused and the guest has left. Does the receipt stand (the sale was made, the money is owed), or must it be stornoed as an operator error under Н-18 чл. 31, ал. 1?

## A1. A day-end summary receipt for in-app tips

**Answer.** No. An in-app tip is chosen before the bill closes and is paid with it. That is the letter's case А: the tip goes on the same receipt or on a separate tip-only receipt, issued at payment. The daily summary is the letter's fallback only for a guest who has already left. A guest who tips in the app is still at the table, so the fallback doesn't apply.

**Basis.**
- [PRACTICE] Case А (letter, p. 9): a tip given before the bill closes, as a sum or a percentage, "следва да се отрази във фискалния бон". A separate receipt for the tip alone is allowed.
- [PRACTICE] Case Б (p. 10): a tip after the receipt needs a second receipt. A receipt summing several tips is no breach only "[в] случай че клиентът е напуснал търговския обект", because the receipt "очевидно няма да бъде предоставен на клиента".
- [TEXT] Н-18 чл. 25, ал. 6: a receipt at payment, handed over with it.
- [READING] The letter's examples of a guest who has left are cash left on the table, and a terminal tip where the guest left after authorisation. An in-app tip is neither: the guest pays from the table, and the waiter brings the receipt there.

**The fallback when the POS can't add a tip line.** A separate tip-only receipt at the same moment, in group А.
- [TEXT] The tip article must be programmed "с наименование и единична цена" (Н-18 чл. 27, ал. 3, т. 1), and items not programmed so cannot be stornoed (чл. 31, ал. 7).
- [READING] At a POS whose API can't add the tip line, staff could ring the tip-only receipt by hand when bringing the main receipt. Restro would show the waiter the amount. Whether that is workable on a busy night is the venue's call. D127 currently offers no tip there, which stays the safe default.

**How sure:** medium-high. The letter is practice and the facts fit it closely.

**What it changes.** D127's open line "The venue's accountant: is a day-end tip receipt acceptable?" can close as "no". The open item becomes an option for Martin: allow the tip at a POS without a tip line only if the venue agrees to ring a tip-only receipt at payment.

**Still needs a professional:** no.

## A2. Tips through payroll, and Stripe's fee on the tip

**Answer.**
- The venue books the whole tip as revenue when paid.
- What it passes to staff is extra pay, run through the monthly payroll: 10% income tax withheld, and full social and health contributions up to the monthly maximum.
- Stripe takes one fee on the whole charge. It is one expense, with nothing to split or book separately for the tip part.
- Tips handed out in cash from the till must be recorded on the device as cash taken out.

**Revenue and expense.**
- [PRACTICE] The tip is revenue of the venue, and the amounts passed to staff are an expense "за допълнителни възнаграждения", deductible in the general case (letter, p. 6).
- [TEXT] No offsetting: the venue "не извършва прихващания между активи и пасиви или приходи и разходи" (ЗСч чл. 26, ал. 1, т. 7, read in kik-info.com's copy). So the revenue is gross, before Stripe's fee.
- [TEXT] An expense counts for tax only if backed by a primary accounting document (ЗКПО чл. 10, ал. 1; чл. 26, т. 2).

**Payroll.**
- [PRACTICE] For employees, tips are "доход от трудови правоотношения". How the employer shares them out is "решение на конкретния работодател" (letter, p. 7). It is still extra pay from the employer (pp. 7–8).
- [TEXT] The employer works out the advance tax monthly on the monthly tax base (ЗДДФЛ чл. 42, ал. 1) and withholds it at the final payment for the month (чл. 42, ал. 5). The rate is 10% (чл. 48), as the letter says.
- [TEXT] Contributions are due on all pay (КСО чл. 6, ал. 2), up to the monthly maximum insurable income (чл. 6, ал. 3), plus supplementary pension and health insurance (КСО чл. 157, ал. 6; ЗЗО чл. 40) (letter, pp. 10–11).
- [TEXT] Cash paid out of the till is not a sale. "[В]сяка промяна на касовата наличност … се регистрира във ФУ чрез операциите 'служебно въведени' или 'служебно изведени' суми" (Н-18 чл. 33, ал. 1).
- [READING] If staff get card tips in cash at night, the payout is a "служебно изведена сума", and the same amounts then go into that month's payroll.

**Stripe's fee.**
- [READING] Stripe charges one fee per charge on the whole amount. No rule asks for it to be split between bill and tip: both are the venue's revenue, and the fee is the venue's cost of being paid.
- [PRACTICE, vendor] Stripe supplies from Ireland and "does not charge VAT on Stripe fees" to European account holders, except in Ireland, Norway, Switzerland/Liechtenstein and the UAE. It mentions possible self-accounting ("reverse charge").
- [TEXT] Transactions "свързана с платежни сметки, платежни услуги, електронни пари, плащания" are exempt supplies (ЗДДС чл. 46, ал. 1, т. 3). Reverse charge under чл. 82, ал. 2 applies only to a taxable supply.
- [READING] So the venue most likely books the fee as an exempt service received, with no VAT to self-assess. This is the accountant's routine classification, not an open legal question.
- [UNKNOWN] Whether Stripe issues monthly fee invoices to Bulgarian accounts. Its pages say only "certain countries". The venue checks Dashboard → Documents. Without one, the itemized payout report (A3) is the supporting document.

**Passing the fee on to staff (optional).**
- [TEXT] Without the employee's consent, no deductions may be made from pay except advances, technical over-payments, taxes, contributions, garnishments and чл. 210, ал. 4 cases (КТ чл. 272, ал. 1).
- [READING] A fee is not on that list. But the tip is the employer's revenue, and how much of it goes to staff is the employer's decision (letter, p. 7). A share defined in advance as "tips net of card fees", in the venue's pay rules or the employment contracts, sets the amount of extra pay. It is not a deduction from pay already owed. Deducting a fee from a share already promised gross would be a deduction.

**How sure:** high on payroll and booking. Medium on the fee's VAT classification and on the net-of-fee share.

**What it changes for Restro.**
- Restro's reports should give the venue, per service day, the tip total and the tip per payment, so the accountant can feed payroll. D127 4.2 already keeps the tip in minor units.
- Restro promises nothing about who gets the tip (D127: "goes to the venue").

**Still needs a professional:** no. One optional question, only if the venue wants to pay staff net of the fee:
- BG: Може ли работодателят да определи предварително във вътрешните си правила за заплатите, че на персонала се разпределят бакшишите, платени с карта, след приспадане на таксата на доставчика на платежни услуги, без това да е удръжка по чл. 272 КТ?
- EN: May the employer set in advance, in its pay rules, that staff receive card tips net of the payment provider's fee, without that being a deduction under КТ чл. 272?

## A3. A "Card online" payment type, and payouts

**Answer.** Yes. The POS may hold its own "Card online" type, provided it prints and counts as card on the fiscal device. The device has a single card register. Reconcile per payment, not per day: Stripe's itemized payout report lists each payment with gross, fee and net.

**Basis.**
- [TEXT] A fiscal receipt registers a sale paid "в брой, с чек, с ваучер, с банкова кредитна или дебитна карта или с други заместващи парите платежни средства" (ЗДДС чл. 118, ал. 3).
- [TEXT] The device's daily report to the NRA has one field, "Сума по кредитни/дебитни карти" (SCards). Its other fields are cash, cheques, vouchers, external vouchers, packaging, internal service, damage, bank transfers (SW) and two reserve fields (Н-18 Прил. 17).
- [TEXT] The reserve types already have fixed meanings: "резерв 1" for НЗОК or deferred payment, "резерв 2" for internal use or deferred payment (Н-18 чл. 3, ал. 2, 7, 15; чл. 25, ал. 5; чл. 26б).
- [TEXT] Listed sales software keeps its own list of "видове плащания - код, наименование" (Прил. 29, т. 18.9). Nothing limits a POS's own names.
- [TEXT] Н-18 asks an e-shop to declare its virtual POS and merchant ID (Прил. 33, т. 7). Nothing asks a venue with a fiscal device to declare a card acquirer.
- [READING] So "Card online" in the POS, mapped to the device's card register, is lawful. Mapping it to "банка" (SW) would misreport: bank transfers don't even need a receipt (Н-18 чл. 3, ал. 1). Mapping it to a reserve type would misuse a type with a fixed meaning.

**Reconciliation** [READING, with Stripe's docs]:
- **Book gross, not net** (ЗСч чл. 26, ал. 1, т. 7):
  1. at the sale: revenue and VAT against a "Stripe" receivable;
  2. at each payout: the bank against that receivable;
  3. the fee: an expense against the receivable.
- **Use Stripe's report.** The itemized payout reconciliation report lists every charge, refund, dispute and fee in each payout, with `gross`, `fee`, `net`, `payment_intent_id` and `payment_metadata[key]` [PRACTICE, vendor, docs.stripe.com].
- **Match by payment.** If Restro writes its payment id (`py_…`) and, after the close, the receipt number into the Payment Intent's metadata, the accountant can match each Stripe line to a fiscal receipt. D127 4.5 already stores the receipt number.
- **Day boundaries differ.**
  - The Z report follows the device's day.
  - Stripe reports in UTC unless a time zone is chosen.
  - D127's service day ends at 07:00.

  Pick the venue's time zone in the report, and expect night-time payments to fall on the next calendar day.
- **Keep the two card totals apart.** A separate POS type keeps app payments out of the terminal's batch totals, and that is the reason to have one.

**How sure:** high.

**What it changes.**
- D125's check "the card payment type is chosen in the till" should say "a card type that counts as card on the fiscal device".
- Proposed new small ticket: Restro writes its payment id and the receipt number into the Payment Intent's metadata. The lead decides; it touches D127's write order only after the close.

**Still needs a professional:** no.

## A4. Restro's fee: fiscal receipt or invoice?

**Answer.** Restro always invoices, but an invoice does not replace a fiscal receipt. Whether a receipt is needed depends on how the venue pays:
- **Bank transfer or SEPA direct debit:** no receipt.
- **Monthly card charges on a card the venue saved in advance, made by Restro (or Stripe) without the venue present:** no receipt, if the venue gets a document with the listed data. The invoice can serve.
- **The venue pays by card itself, at checkout:** Restro needs a fiscal receipt from its own device.

This assumes Restro is a Bulgarian business selling from Bulgaria. [UNKNOWN] Restro's legal form.

**Basis.**
- [TEXT] The receipt is due "независимо от това дали е поискан друг данъчен документ" (ЗДДС чл. 118, ал. 1). So an invoice never replaces it.
- [TEXT] No receipt is needed when payment is made "чрез внасяне на пари в наличност по платежна сметка, кредитен превод, директен дебит или наличен паричен превод, извършен чрез доставчик на платежна услуга" (Н-18 чл. 3, ал. 1). A card payment is not on the list (the 10-26 file, L1).
- [TEXT] **New here: the subscription exception.** No receipt is needed "при плащане по продажба на комунални и други абонаментни услуги с повтарящо се изпълнение" when "плащането се извършва неприсъствено с кредитна или дебитна карта … чрез даване на предварително съгласие от страна на клиента на доставчика на платежни услуги да нарежда плащането" (Н-18 чл. 3, ал. 1а, т. 1). The client must get "документ, съдържащ най-малко информацията по чл. 52о, ал. 1, т. 1 и 5, както и идентификационни данни на търговеца".
- [TEXT] That data is:
  - т. 1: name, number and date of the document, the number having 10 digits and rising by one;
  - т. 5: the items with tax-group code, quantity, value, unit price, total, and the payment method (чл. 52о, ал. 1).
- [READING] A monthly SaaS fee is an "абонаментна услуга с повтарящо се изпълнение". Charges on a card the venue saved, made without the venue present, fit the wording. A Bulgarian invoice already has a 10-digit rising number. Adding the tax group ("Б" for 20 % VAT, Н-18 чл. 27, ал. 1) and "платено с карта" lets it serve as the ал. 1а document.
- [READING] The venue's first payment, typed in at checkout, is not made "неприсъствено … чрез … предварително съгласие": it is the venue paying. To stay inside ал. 1а, save the card first (a setup with no charge) and take every charge afterwards without the venue present, or bill the first month by transfer.
- [READING] The e-shop regime (Н-18 чл. 3, ал. 17) doesn't help. An e-shop needs a consumer distance contract under ЗЗП чл. 45 (ЗДДС § 1, т. 87), and Restro's customers are businesses.
- [UNKNOWN] No NRA opinion on ал. 1а for SaaS was found. The kik-info opinions on online card payments are behind a paywall and older than ал. 1а (2020).

**How sure:** high on transfer and direct debit. Medium-high on ал. 1а for automatic card charges.

**What it changes.** Recommendation for Restro's own billing, later and outside the pilot:
1. invoice monthly;
2. collect by SEPA direct debit or bank transfer, or by automatic charges to a card saved in advance with the ал. 1а data on the invoice;
3. never take a card at checkout without a fiscal device.

**Still needs a professional:** no.

## Questions left

**For the lawyer (one, rare):**
- L6(b), the failed capture after the receipt with the guest gone (BG and EN under L6).

**Optional, for the record:**
- L5, protection under ДОПК чл. 17, ал. 3 (BG and EN under L5).
- A2, tips net of the card fee (BG and EN under A2), only if the venue wants it.

**Steps for the venue, not questions:**
- The accountant's own written inquiry to the NRA on D127's tip (L5).
- Programming the "БАКШИШ" article in group А with name and price (A1).
- The "Card online" type mapped to card (A3).
- Checking for Stripe fee invoices in Dashboard → Documents (A2).

**Questions for Mistral** (connector list, not legal):
- Can its API add a group-А tip article, with a variable price, on the close?
- Can it storno on operator error for the payment type?

## Sources

All read on 2026-10-28.

**Laws, downloaded whole from lex.bg and searched:**
- Наредба № Н-18/2006, to ДВ 42/2025 (чл. 3, ал. 1, 1а, 17; чл. 25, ал. 1, 6; чл. 27, ал. 1, 3; чл. 31, ал. 1, 3, 4, 7; чл. 33, ал. 1; чл. 52о; Прил. 17, 29, 33): https://lex.bg/bg/laws/ldoc/2135540645
- ЗДДС, to ДВ 69/2026 (чл. 25, 26, 46, 82, 118, ал. 1, 1а, 3, 3б; § 1, т. 41, 84, 87, 96): https://lex.bg/laws/ldoc/2135533201
- ДОПК, to ДВ 85/2026 (чл. 17, ал. 3–4): https://lex.bg/laws/ldoc/2135514513
- ЗДДФЛ, to ДВ 85/2026 (чл. 42): https://lex.bg/laws/ldoc/2135538631
- Кодекс на труда, to ДВ 89/2026 (чл. 272; no mention of "бакшиш"): https://lex.bg/bg/laws/ldoc/1594373121
- КСО, to ДВ 68/2026 (чл. 6, ал. 2–3): https://lex.bg/bg/laws/ldoc/1597824512
- ЗКПО, to ДВ 55/2026 (чл. 10, ал. 1; чл. 26): https://lex.bg/bg/laws/ldoc/2135540562

**Laws read in kik-info.com's copies** (lex.bg refused the download):
- ЗНАП, shown as to ДВ 55/2026 (чл. 10, ал. 1, т. 4 and 10): https://kik-info.com/normativna-baza/zakoni/znap/
- Закон за счетоводството, shown as to ДВ 67/2026 (чл. 26, ал. 1, т. 7): https://kik-info.com/normativna-baza/zakoni/zsch/

**NRA practice:**
- The tips letter ВК-30-14766/23.10.2025 (TLP-AMBER), all 11 pages read from its text layer, as republished: https://accountingnews.bg/userfiles/ВК-30-14766+от+23_10_2025+г.pdf
- nra.bg searched for tips: nothing published.
- kik-info.com NRA opinions on card payments online (ОУИ Пловдив 471/07.12.2011; 865/01.04.2022): titles only, full text paywalled.

**Secondary, used only to locate rulings:**
- balans.bg, "Характеристика на Указанията и Становищата, издавани от НАП" (P. Stefanov, 30.09.2022). It cites ВАС Решение № 817/18.01.2011 and Решение № 2262/01.04.2019; neither was read at the source. https://balans.bg/statiya/harakteristika-na-ukazaniyata-i-stanovishtata-izdavani-ot-nap

**Vendor pages:**
- Stripe, Global taxation of Stripe fees: https://support.stripe.com/questions/global-taxation-of-stripe-fees
- Stripe, Tax invoices: https://support.stripe.com/questions/tax-invoices
- Stripe, Payout reconciliation report: https://docs.stripe.com/reports/payout-reconciliation

**EU case law:**
- CJEU C-404/99, Commission v France (service charges and tips), cited through the letter; EUR-Lex did not load on 10-28: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:61999CJ0404

**Not found:**
- a court ruling on tips under ЗДДС or Н-18;
- an NRA opinion on Н-18 чл. 3, ал. 1а for SaaS;
- any 2026 change to Н-18 (still ДВ 42/2025).
