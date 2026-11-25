# Can a reservation's prepayment get an online receipt?

Date: 2026-11-25. For Martin's question of 11-25: "find out if we can send an online receipt like it would be ordering or prepaying for something online". It serves D136's Open line (the accountant) and reservations part 2 (#322). It builds on `2026-10-17-fiscal-rules-in-app-payments.md` (Q3 and L4–L6, L10 there), `2026-10-21-receipt-and-payment-law.md` (the electronic receipt, and the 10-28 addendum) and `2026-11-24-split-by-amount-bulgaria.md`, and repeats none of them.

> **Not legal advice.** The plain text of the law is researched here (Martin 10-18); what needs interpreting is worded as questions for the lawyer, and what only the venue's accountant or the POS provider knows is worded as questions for them.

**Marks.** **[LAW]** the text says it plainly. **[NRA]** an NRA page. **[SECONDARY]** an NRA opinion read only as a published abstract (full text paywalled). **[LAW, EU]** a judgment of the EU Court. **[READING]** our interpretation. **[LAWYER] / [ACCOUNTANT] / [POS]** a question for that party. **[UNKNOWN]** not found.

**Read on 2026-11-25:**
- Н-18, consolidated, downloaded whole and searched as text; latest amendment still ДВ 42/2025: [lex.bg](https://lex.bg/bg/laws/ldoc/2135540645).
- ЗДДС, consolidated, amendments to ДВ 69/2026: [lex.bg](https://lex.bg/laws/ldoc/2135533201).
- NRA, "Документи за продажба" (undated page): [nra.bg](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-zaprodajba-i-storno-operatsii/Dokumenti-za-prdajba).
- NRA opinion abstracts on kik-info.com (paywalled; lead paragraph only): [card payments through a virtual POS, hotel online bookings](https://kik-info.com/stanovishta-na-nap/1bc407b0b7627baaeac910c471121aa1) (no number or date shown); [a deposit kept after a cancelled hotel booking](https://kik-info.com/stanovishta-na-nap/80a96644f2e8c1730b497dca4d8bab77) (dated 26.10.2026, no number shown).
- CJEU C-250/14 and C-289/14, *Air France-KLM and Hop!-Brit Air*, 23.12.2015 ([curia press release](https://curia.europa.eu/jcms/jcms/P_188789/lt)); C-277/05 as cited in the 10-17 file.

## Verdict, in plain words

1. **Not the way a web shop does it.** A web shop that is paid by card online may send a plain "sales document" by email instead of a fiscal receipt. That route is open only when the goods or service are delivered **somewhere other than the seller's premises**. A table reservation is used at the club, so the route is closed. The NRA's published opinions on online hotel bookings paid by card come to the same answer: a fiscal receipt as a rule.
2. **But the receipt can still be online.** Since 2024–2025 the law lets the venue's **own fiscal receipt** be generated electronically by its fiscal device and emailed to the guest, with paper only if he asks. So an online receipt is possible. It is the venue's fiscal receipt, sent electronically. It is never a Stripe receipt or a document Restro draws.
3. **Three things decide whether a given venue can do it.**
   - **A legal door.** Either the venue's sales software (Mistral / Zamboo) is on the NRA's list, or the booking page counts as the venue's online shop. The second is likely, because a paid booking made online is a distance contract. It brings a duty: the venue declares the page to the NRA before it starts taking prepayments.
   - **The device.** The fiscal device must be a type approved for electronic receipts.
   - **The POS.** It must be able to issue that receipt at the moment the money is taken, at any hour, and hand it to Restro or email it. Only Mistral can answer this.
4. **Timing is strict either way.** The receipt is due **when the money is taken** (Confirm, or the booking itself where the venue confirms automatically), not when staff next open the till. D136's "to-do at the till" is late by the letter of the law whenever the money is taken while the club is closed. The accountant should be asked about that risk.
5. **On the night,** the advance is counted against the bill: the final receipt lists everything, then a discount equal to the prepayment (Н-18 чл. 26а). **A no-show:** the NRA's 26.10.2026 opinion (hotel deposit) treats money kept after a no-show as compensation outside VAT, but how the receipt already issued is corrected is not written anywhere. That is a question for the accountant, with the lawyer if needed. **A refund:** a storno from the device, at the refund.

**What this changes for #322:** half B's receipt step is built as "the POS issues the prepayment's fiscal receipt at capture, electronically and emailed where the venue's connector can do it". The till to-do stays as the fallback for a POS that can't. D136 says "a to-do at the till", so this needs a new decision for Martin's OK. Half B is still not switched on at a live venue until the accountant answers.

## 1. Fiscal device, or the web-shop document?

- **[LAW] The general duty.** Every sale "във или от търговски обект" is registered with a fiscal receipt, "освен когато плащането се извършва чрез внасяне на пари в наличност по платежна сметка, кредитен превод, директен дебит или наличен паричен превод, извършен чрез доставчик на платежна услуга …" (Н-18 чл. 3, ал. 1). A card payment through Stripe is not on that list (the 10-17 file, L1, on the "доставчик" clause).
- **[LAW] The other exemptions are narrow.** Н-18 чл. 3, ал. 1а allows a non-fiscal document only for recurring subscription payments by stored card, and for cash paid into an account at the payment provider's own terminal. Neither fits.
- **[LAW] The web-shop route.** "Лице по ал. 1, което извършва продажби на стоки и/или услуги чрез електронен магазин, може да регистрира и отчита тези продажби вместо с фискален или системен бон чрез документ … който не е издаден от ФУ или ИАСУТД, когато е извършено неприсъствено плащане с кредитна или дебитна карта" (Н-18 чл. 3, ал. 17; the law's basis is ЗДДС чл. 118, ал. 3б).
- **[LAW] The condition that closes it.** "Неприсъствено плащане" is a card-not-present payment over the internet "без едновременното физическо присъствие на продавача и купувача по продажби, при които предоставянето на стоките или услугите става на място, различно от търговския обект на търговеца" (ЗДДС § 1, т. 96). The club is the venue's trade site (ЗДДС § 1, т. 41).
- **[READING, strong]** The guest pays from home, so the first half holds. But the table, and whatever the prepayment is counted against, is delivered in the club, so the second half fails. The web-shop document is not available. This confirms the 10-17 file's correction of its own earlier leaning (Q3).
- **[SECONDARY] The NRA agrees for hotels.** The abstract: "при плащане с дебитна/кредитна карта задължително се издава фискален/системен бон … независимо че плащането е неприсъствено", about online hotel bookings paid through a virtual POS. A hotel room is the closest match to a table: booked and paid online, used on the premises.
- **For completeness, if the lawyer ever read it the other way.** The document would need the чл. 52о fields: a 10-digit running number, the seller's details, the order number, the transaction reference, the lines with VAT group, and a QR code with the e-shop's NRA number (ал. 1, т. 1–6). It would be sent electronically at the payment or the virtual POS's authorisation (ал. 5). The venue would also file the payment providers, Merchant ID and accounts (чл. 52р; Прил. 33, т. 7), and keep the money only in accounts in its own name (чл. 52п). The software would have to meet чл. 52с, including the monthly audit file. Restro would be that software. We do not recommend building for this branch.

## 2. The electronic fiscal receipt: the online receipt that is lawful

- **[LAW] The law allows it.** "Фискалният/системният бон … може да се генерира в електронен вид и да се предостави на получателя по електронен път, без да се издава хартиен документ" by persons who: "1. извършват продажби на стоки или услуги чрез електронен магазин; 2. са избрали да използват в търговски обект софтуер, включен в списъка …" (ЗДДС чл. 118, ал. 21). Paper is issued when the client asks (ал. 22).
- **Door A, listed sales software** (Н-18 чл. 3, ал. 18, from 2024). The venue uses software on the NRA list, has filed Прил. 32 with "ДА" for electronic receipts, and holds the guest's data for delivery. Delivery: "чрез изпращане на електронния му адрес или чрез съхраняване и визуализация в негов профил" (чл. 52з, ал. 17). The 10-21 file covers this door. Whether Mistral is listed under any name is open (Q84).
- **Door B, the booking page as the venue's online shop** (Н-18 чл. 3, ал. 19, new in ДВ 42/2025). **New here.** A person "което извършва продажби на стоки и/или услуги чрез електронен магазин … може да регистрира и отчита продажбите чрез издаване на фискален/системен бон, генериран в електронен вид". Its two conditions:
  - it has the client's data needed to deliver the receipt (by чл. 25, ал. 13: "чрез изпращане на електронния му адрес, чрез съхраняване и визуализация в профил … или по друг начин чрез изпращане по електронен път");
  - it "съхранява данни за начина, датата, часа и минутата на предоставяне на бона на клиента".
  - **[READING]** This door does not need listed software. It needs only that the page is an online shop, and the venue's fiscal device still generates the receipt.
- **[LAW] Is the booking page an online shop?** "Електронен магазин" is software reached over the internet "чрез който се извършва продажба на стоки/услуги посредством сключване на договор от разстояние по чл. 45 от ЗЗП", with a choice of goods "чрез потребителска кошница или по друг начин", contact details and a payment method (ЗДДС § 1, т. 87). A distance contract is one concluded without the simultaneous physical presence of trader and consumer (ЗЗП чл. 45).
  - **[READING]** A booking with a prepayment, made and paid on the page from home, looks like one. A booking without money sells nothing, so it does not. [LAWYER] P1 below.
- **[LAW] The cost of door B: the venue must declare the page to the NRA.** A seller through an online shop, "независимо дали използва собствен домейн, нает домейн или домейн на друго лице, предоставящо платформа", files Прил. 33 "преди започване на дейност" (Н-18 чл. 52м, ал. 1).
  - The filing names the platform: its name, web address, operator and the seller's link on it (Прил. 33, т. 4.1). Under т. 4.2 it would also name the hosting, the database location and the software instead.
  - [SECONDARY] The NRA abstract above: "Ако сайтът е 'електронен магазин', възникват и задължения по чл. 52м".
  - **[READING]** The duty follows from the page being a shop, whichever door is used. So a venue taking prepayments online probably has to file Прил. 33 even under door A. [LAWYER] P1.
- **[LAW] The device must be able to do it.** The fiscal device "трябва да осигурява запис в КЛЕН и на фискален бон, генериран в електронен вид". The file "трябва да бъде четим, да отговаря на хартиения образец и да съдържа реквизитите по чл. 26" except the graphic logo (Прил. 1, разд. VIб, т. 3–5). Paper or electronic is chosen per sale (Прил. 1, т. 15). The NRA's device types even include "ЕКАФП за електронен магазин" and "ФПр за електронен магазин" (Прил. 17, the device data sent to the NRA, FDType 11 and 21).
- **[LAW] Timing for a service sold online.** "В случаите на предоставяне на услуги бонът се издава и предоставя на клиента най-късно при плащане на услугата" (Н-18 чл. 25, ал. 8 for the electronic receipt, ал. 7 for paper). The general rule is the same: "при извършване на плащането … едновременно с получаване на плащането" (чл. 25, ал. 6).
- **[LAW] The guest's choice.** The guest keeps his right to withhold payment for a missing receipt unless "клиентът е заявил издаване на … бона в електронен вид" (ЗДДС чл. 118, ал. 1а, т. 2). **[READING]** So the page asks for it, not assumes it. The email is already required by D136, so a ticked line "Send my receipt to this email" is enough.
- **[READING] What it never is.** Stripe's email is the payment provider's record of a card charge, and D125 turns it off. A document Restro draws is not a receipt, and if it looked like one it would break Н-18 чл. 7а (the 10-28 addendum). Restro's own "prepayment taken" email is lawful only as a plain payment confirmation: no "бон", no form of "фискален", nothing shaped like a till slip.

## 3. A prepayment for a night not yet had

- **[LAW] VAT falls due when the money is received.** "Данъкът става изискуем при получаване на плащането (за размера на плащането)" (ЗДДС чл. 25, ал. 7).
  - **[READING]** A card hold is not money received. The receipt and the VAT come at capture, not at the hold. This is L7, still the lawyer's to confirm.
  - Under D136 that means: at Confirm where confirmation is mandatory, at the booking itself where the venue confirms automatically.
- **[LAW] Invoice.** An invoice is not required for a private guest unless one side asks (ЗДДС чл. 113, ал. 3, т. 1 and ал. 6). For a business, it is due within 5 days (ал. 4). The 10-17 file has this in Q3.
- **[LAW] On the night: the part payment and the discount.** The first receipt is registered in the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, with the goods or services named as free text between "#" signs. At the final payment "се регистрират всички стоки и услуги, след което се извършва стойностна отстъпка, равна на размера на частично заплатената … сума" (Н-18 чл. 26а, ал. 1–2). [NRA] The "Документи за продажба" page says the same.
  - **[READING]** So the later bill must net the advance on the till's own receipt. The POS has to support it, and the waiter has to know the table prepaid. Restro should show the prepayment wherever the bill is handled that night (Tonight, the table).
- **[SECONDARY] A no-show.** The NRA (26.10.2026, a hotel): "При първоначална резервация платеното капаро е аванс за облагаема хотелиерска услуга". When the booking is cancelled with no stay, the amount kept is "неустойка с обезщетителен характер, не е възнаграждение по доставка и не се облага с ДДС"; where an advance invoice was issued, a credit note follows. This matches CJEU C-277/05 (10-17 file).
  - **[LAW, EU] A competing line.** In *Air France-KLM* (C-250/14, C-289/14) the Court held that VAT is due on unused, non-refundable tickets: the price paid is consideration for the right to the service, whether or not it is used.
  - **[READING]** A table prepayment counted against the night's spend sits between the two cases. The NRA's own line for hotels is the one a Bulgarian accountant would apply.
  - [ACCOUNTANT] P5 below.
- **[NOT FOUND] Correcting the forfeited receipt.** No text says how the fiscal receipt issued at capture is corrected once the money becomes compensation. Н-18 чл. 31, ал. 1 lists the storno grounds as a complaint or return, an operator error, and a reduction of the tax base; forfeiture is none of them. The opinion names only the credit note for an invoiced advance. This is the old L6, still open.
- **[LAW] A refund** is a storno from the device, documented when the money is given back (Н-18 чл. 31, ал. 1–4). Whether a fiscal device (not an ИАСУТД) may storno a card refund is still L10. The refund itself stays in the venue's Stripe dashboard (D136).

## 4. A venue that already runs a fiscal device and listed software

- **[LAW] Money taken away from the till is still a sale of the trade site.** Only the payment ways in чл. 3, ал. 1 escape the receipt (§1). Taking the card through a page does not change that.
- **[LAW] On listed software, everything goes through it.** "Софтуерът задължително управлява всички работещи фискални устройства в този обект" (Н-18 чл. 52з, ал. 3). The venue must use "само този софтуер" (ЗДДС чл. 118, ал. 18).
  - Orders from an online shop may be imported into it: "се допуска направените поръчки в електронния магазин да се въвеждат (импортират) в използвания от лицето софтуер". The import must follow Прил. 42 in full and unchanged, and keep the source, the time and the external id (чл. 52з, ал. 11).
  - **[READING]** At such a venue, the prepayment's receipt must come from the POS's own software, fed from Restro as an import or through its API. A receipt typed at a second, unmanaged device is not an option.
- **[READING] Restro does not touch the device.** The receipt is the venue's, from the venue's device (Н-18 чл. 3, ал. 1). Restro passes the facts and, where the POS returns the file, carries it unchanged (#186's shape). Whether Restro may carry it is lawyer question 1 of the 10-21 file, unchanged.
- **[READING] Paying by bank transfer is the one lawful way around the receipt.** A prepayment paid by bank transfer needs no fiscal receipt (чл. 3, ал. 1; L5). It is slow and can't be held. We don't recommend it for the pilot; it is noted so nobody rediscovers it.

## 5. Who issues it, and what Restro supplies

- **[LAW] The venue issues it, never Restro.** The duty is "лицето по чл. 3" (Н-18 чл. 3, ал. 1). Restro holds no money (D98; Stripe direct charges on the venue's own account, D125), so Н-18 чл. 29 (collecting for another) doesn't reach it.
- **What Restro supplies, per prepayment, so the venue can issue it:**
  1. **The moment and the facts of the capture:** the date and time to the minute, the amount in euro cents, the payment way (card online), the provider's payment reference, and the reservation's own reference. For the free text: the night, the party size and the words of the venue's prepayment line.
  2. **The guest's email** and his choice to get the receipt electronically (ЗДДС чл. 118, ал. 1а, т. 2).
  3. **A request to the POS,** at capture and through the venue's service connector, to register the sale in "ЧАСТИЧНИ ПЛАЩАНИЯ", electronically where the connector declares `electronicReceipt` (#186). Where it doesn't, the till to-do is raised at once.
  4. **The delivery record** door B requires: the method, date, hour and minute the receipt reached the guest. Where Restro sends the POS's file, that is the email send's own time. Each reservation keeps its receipt number or УНП, as D136 already says.
  5. **On the night:** the prepayment shown on the table's bill handling, so the waiter applies the чл. 26а discount.
  6. **On a no-show or a refund:** the to-do for the correcting document (storno, credit note or whatever the accountant answers), as D136 already plans for refunds.
  7. **For the venue's NRA filing** (Прил. 33, т. 4.1), if the page is a shop: the platform's name (Restro), its web address and the venue's link on it, and Restro's operator name and ЕИК. Martin's company details go there; that is his step.
- **Already in the code:** the worker's Resend sender for a POS receipt file (`apps/worker/src/receipts/email-sender.ts`, #186) emails the file unchanged from the venue's name. It is off until `RESEND_API_KEY` and `RECEIPT_FROM_ADDRESS` are set.

## Questions

### For the lawyer (interpretation only)

**P1.** (ЗДДС § 1, т. 87; ЗЗП чл. 45; Н-18 чл. 3, ал. 19; чл. 52м, ал. 1)
- BG: Уеб страница за резервация на маса, хоствана от трето лице (Restro), на която гостът прави резервация и плаща предплата с карта от разстояние, „електронен магазин" на заведението ли е? Ако да, длъжно ли е заведението да подаде информация по приложение № 33 преди да започне да приема предплати, и може ли да издава за тях фискален бон, генериран в електронен вид, по чл. 3, ал. 19, без да ползва софтуер от списъка по чл. 118, ал. 16 ЗДДС?
- EN: Is a table-booking page hosted by a third party (Restro), where the guest books and prepays by card from home, the venue's "online shop"? If so, must the venue file Annex 33 before taking prepayments, and may it issue an electronic fiscal receipt for them under чл. 3, ал. 19 without NRA-listed sales software?

**P2.** (ЗДДС § 1, т. 96; Н-18 чл. 3, ал. 17)
- BG: Потвърждавате ли, че предплата за резервация на маса, платена онлайн с карта, не е „неприсъствено плащане", тъй като услугата се ползва в търговския обект на заведението, и затова документът по чл. 52о не може да замести фискалния бон? (Уточнява L4.)
- EN: Do you confirm that an online card prepayment for a table is not a "card-not-present payment", because the service is used at the venue's trade site, so the чл. 52о document cannot replace the fiscal receipt? (Sharpens L4.)

**P3.** (Н-18 чл. 25, ал. 6–8; ЗДДС чл. 25, ал. 7)
- BG: Когато предплатата се усвоява в момент, в който заведението е затворено, допустимо ли е фискалният бон да се издаде при следващото отваряне, или трябва да се издаде в момента на усвояването? Задържането (hold) на сумата по картата „получаване на плащане" ли е? (Уточнява L7.)
- EN: When the prepayment is captured while the club is closed, may the receipt be issued when it next opens, or must it be issued at the capture? Is the card hold itself "receipt of payment"? (Sharpens L7.)

### For the venue's accountant

**P4.** (Н-18 чл. 26а)
- BG: Ще отчитате ли предплатата с бон в департамент „ЧАСТИЧНИ ПЛАЩАНИЯ" и после с отстъпка в крайния бон на масата? Ако не, как?
- EN: Will you register the prepayment with a receipt in the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, then a discount on the table's final receipt? If not, how?

**P5.** (ЗДДС чл. 25, ал. 7; Н-18 чл. 31, ал. 1; становище на НАП от 26.10.2026)
- BG: При неявяване и задържане на предплатата: третирате ли я като неустойка извън ДДС, както НАП приема за капаро при хотели, и с какъв документ коригирате бона, издаден при плащането?
- EN: On a no-show where the prepayment is kept: do you treat it as compensation outside VAT, as the NRA does for hotel deposits, and which document corrects the receipt issued at payment?

**P6.** (D136, Open)
- BG: Ако POS системата не може да издаде бона автоматично в момента на плащането, достатъчна ли е задача за персонала да го издаде на касата при отваряне, и кой го издава, ако гостът не дойде?
- EN: If the POS can't issue the receipt automatically at the moment of payment, is a task for staff to issue it at the till on opening enough, and who issues it if the guest never comes? (D136's own question, now with P3's timing point.)

### For the POS provider (Mistral / Zamboo)

Asked through Martin, folded into the next letter; the letter itself is kept outside this repository (`docs/agents/domain.md` → Deliverables). These sharpen Q84.

- **M1.** Can your API register a sale with no table or bill, a reservation's prepayment, in a "ЧАСТИЧНИ ПЛАЩАНИЯ" department, with payment type card, at any hour?
- **M2.** Can the pilot's fiscal device issue that sale as an electronic receipt, and can your API pass the guest's email? Does your system send the receipt itself, or return the file?
- **M3.** Is the fiscal device reachable when the club is closed (cloud POS, device powered), or does a sale wait until opening?
- **M4.** On the night, can the table's final receipt take the чл. 26а discount for that prepayment, and can your API apply it, or does the waiter?
- **M5.** Storno: can your system storno a prepayment refunded to a card through the provider?

## Still unknown

- The full reasoning of the two NRA opinions (paywalled; only their lead paragraphs were read).
- Whether any Mistral product is on the NRA list (Q84), and whether the pilot's device can issue electronic receipts.
- L5, L6, L7 and L10 from the 10-17 file stay open; P2, P3 and P5 sharpen them.
