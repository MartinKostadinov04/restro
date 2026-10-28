# Receipt, payment type and allergens for a phase-2 app payment

Date: 2026-10-21. For GF7, TF2, TF3 (`2026-10-21-board-review-answers.md`), Q16 and Q17 (`2026-10-21-board-review-final.md`), research sections 7 and 11. It builds on `2026-10-17-fiscal-rules-in-app-payments.md`; L-numbers below are that file's lawyer questions.

**Marks.** **[RULE]** = the text says it plainly. **[READING]** = our reading, not a fact. **[LAWYER]** / **[ACCOUNTANT]** = needs interpretation. **[UNKNOWN]** = not found.

**Sources** (texts read on 2026-10-21):
- Н-18, consolidated, last change ДВ 42/2025: [lex.bg](https://lex.bg/bg/laws/ldoc/2135540645) (read through the kik-info.com copy).
- ЗДДС: [lex.bg](https://lex.bg/laws/ldoc/2135533201).
- Food-information ordinance, ПМС 97/2021, ДВ 25/2021: [DV text via FAOLEX](https://faolex.fao.org/docs/pdf/bul201767.pdf).
- Reg. (EU) 1169/2011: [eur-lex](https://eur-lex.europa.eu/legal-content/BG/TXT/?uri=CELEX:32011R1169).

## 1. The electronic receipt

**Plain rule.**
- [RULE] An electronic fiscal receipt has been lawful since 2024, with no paper printed. The bon may be "генерира в електронен вид и да се предостави на получателя по електронен път" (ЗДДС чл. 118, ал. 21). For a venue with a fiscal device, the route is ал. 21, т. 2: the venue chose sales software on the NRA list (СУПТО).
- [RULE] On paper when asked: "при поискване от клиент фискалният/системният бон се издава на хартия" (ЗДДС чл. 118, ал. 22).
- [RULE] Н-18 sets two conditions (чл. 3, ал. 18):
  - т. 1: the venue uses listed software and has filed Приложение № 32. Since 2024 that filing has the line "В обекта се издават фискални бонове в електронен вид: ДА/НЕ" (Прил. 32, т. 2а).
  - т. 2: it "разполага с данни за клиента, необходими за предоставяне на фискалния бон в електронен вид".
- [RULE] Delivery: "чрез изпращане на електронния му адрес или чрез съхраняване и визуализация в негов профил" on a website or mobile app (Н-18 чл. 52з, ал. 17). The wider "по друг начин" in чл. 25, ал. 13 covers only an ИАСУТД or ЕСФП, not a fiscal device.
- [RULE] It must be the device's own receipt:
  - The fiscal device generates it and stores it in its electronic journal (КЛЕН), marked as electronic (Прил. 1, разд. VIб, т. 1–4).
  - It must "отговаря на хартиения образец и да съдържа реквизитите по чл. 26", the fiscal logo excepted (т. 5; чл. 26, ал. 8). That includes the QR code (чл. 26, ал. 1, т. 16) and the sale number УНП (т. 17).
  - The device type must be approved for electronic receipts. Paper or electronic: "Изборът се прави при регистрирането на продажбата" (Прил. 1, т. 15).
- [RULE] Consent: the guest loses the right to withhold payment when "клиентът е заявил издаване на ... бона в електронен вид" (ЗДДС чл. 118, ал. 1а, т. 2). [READING] So the guest chooses electronic. That fits an email field or a "Send me the receipt" choice.
- [RULE] Without the electronic route, the venue must hand over the paper "едновременно с получаване на плащането" (Н-18 чл. 25, ал. 6). The guest "е длъжен да получи" the receipt and keep it until leaving (ЗДДС чл. 118, ал. 1).
- [RULE] Penalties:
  - Not issuing the receipt: 1,000–4,000 лв for a company (ЗДДС чл. 185, ал. 1; amounts as printed on lex.bg).
  - The premises can be sealed for up to 30 days (чл. 186, ал. 1, т. 1, буква "а").

**Verdict on Martin's position.** His model, electronic receipt plus paper on request, is the model the law itself sets. It is enough **only if all five hold**:
1. Mistral is on the NRA list, and the venue declared "ДА" for electronic receipts in Прил. 32.
2. The venue's fiscal device is approved for electronic receipts, and Mistral can register *this* sale as electronic.
3. The PDF is the fiscal device's receipt, with every чл. 26 field, the QR code and the УНП. A PDF that Restro draws from the bill is **not** a receipt.
4. It reaches the guest by email or through a "профил" in a site or app. A one-off download on an anonymous page is not clearly a profile ([LAWYER], L3).
5. Paper is printed when the guest asks at the bar.

If any of these fails, the default applies: paper, handed over at payment. "Printed at the bar, collect it if you want" then does **not** meet чл. 25, ал. 6, and the PDF does not cure it.

[READING] Practical shape: an optional email at payment. With it, Mistral issues the sale as electronic and the device's receipt is emailed. Without it, paper, and the waiter brings it (merged Law 4, Q16).

## 2. Who issues, and is it "неприсъствено"

- [RULE] The issuer is the seller, "лицето по чл. 3": the venue (Н-18 чл. 3, ал. 1). Restro issues nothing, provided it never holds the guest's money (D98).
- [RULE] "Неприсъствено плащане" fits the technique: a card read by a virtual POS over the internet. It also requires delivery "на място, различно от търговския обект на търговеца" (ЗДДС § 1, т. 96). A drink served in the club fails that clause. An "електронен магазин" also needs a distance contract (§ 1, т. 87).
- **Verdict:** [READING, strong] the e-shop route (Н-18 чл. 3, ал. 17; чл. 52о) does not apply to a venue: no alternative document. The СУПТО route matters only as the gate to the electronic receipt (section 1). Confirmation is L2.
- [RULE, side effect] On a listed СУПТО, the venue may not add external modules without the producer's authorisation (Н-18 чл. 52з, ал. 5). Прил. 32, т. 17 asks for links to other systems. Restro's link to Mistral needs Mistral's written OK and, probably, a line in the venue's Прил. 32 filing (L11).

## 3. The payment type

- [RULE] Confirmed. The software keeps a list of "видове плащания - код, наименование" (Прил. 29, т. 18.9). Each payment record carries "вид на плащането - съгласно номенклатурата в софтуера" (Прил. 29). Nothing limits how many card types the software list may hold.
- [RULE] The closing payment can be card. A card payment is a normal fiscal-receipt payment (ЗДДС чл. 118, ал. 3), and the receipt shows "начин/и на плащане" (чл. 26, ал. 1, т. 8).
- [RULE] The fiscal device has **one** card total. The daily report sent to the NRA has a single field, "Сума по кредитни/дебитни карти" (SCards) (Прил. 17). So "Card online" can exist only in Mistral's list and must map onto the device's card register. Whether a given device can name two card types is device-specific [UNKNOWN; ask Mistral].
- [RULE] Declaring the provider's account as a virtual POS (чл. 52п, 52р) applies only to the e-shop route of чл. 3, ал. 17. [READING] Under the fiscal-receipt route we found no duty to declare it. [UNKNOWN] whether some other NRA rule asks a venue to report card acquirers.
- **Verdict on Q17 / TF2:** the proposal stands: close as card, with an optional "Card online" type in Mistral that counts as card.

## 4. Allergens in a phone menu

- [RULE] Allergen information is mandatory for food that is not prepacked (Reg. 1169/2011, Art. 44(1)(a)). Each country sets how it is given (Art. 44(2)).
- [RULE] Bulgaria's measure, ПМС 97/2021:
  - чл. 5: for non-prepacked food, the allergen information under Art. 9(1)(c) is given, plus name, date and operator under 9(1)(а), (е), (з).
  - чл. 6: the information is in Bulgarian. For food eaten in the venue it is given "при поискване на клиента" (т. 3).
- [UNKNOWN] The ordinance was amended in ДВ 35/2025, and we did not read that amendment. A 2026 draft touches only чл. 4, ал. 8. Check чл. 6 on lex.bg.
- [RULE] For non-prepacked food sold "by means of distance communication", the Art. 44 information must be available "before the purchase is concluded" (Art. 14(2) with 14(1)(a)). Distance means without both parties present (Art. 2(2)(u)).
- **Verdict:**
  - [READING] For a guest in the venue, the Bulgarian duty is allergen information **on request**, in Bulgarian. The phone menu is not obliged to show it, but D42's allergen display goes beyond the duty, which is fine.
  - [LAWYER] Whether a QR menu at the table is "distance communication". If it is, the menu must show allergens before the order, for every item.
  - [READING] No text makes a free-text note a channel the venue must honour. The risk is civil (a promise not kept). So keep research §7: hide the note when the POS can't print it, and say "Allergies? Tell the staff".

## Questions to send

**For the lawyer**
1. (ЗДДС чл. 118, ал. 21–22; Н-18 чл. 3, ал. 18; чл. 52з, ал. 17)
   - BG: Достатъчно ли е заведение със СУПТО по списъка да изпрати по имейл фискалния бон, генериран в електронен вид от ФУ, като го доставя чрез уеб приложение на трето лице (Restro) от името на заведението, и да отпечата бона на хартия само при поискване?
   - EN: Is it enough for a venue on listed software to email the fiscal device's electronic receipt, delivered by a third party's web app (Restro) on the venue's behalf, and print paper only on request?
2. (Н-18 чл. 25, ал. 6; Прил. 1, т. 15)
   - BG: Ако ФУ отпечата хартиен бон на бара, който гостът не взема, а гостът получи PDF копие, изпълнено ли е задължението за предоставяне?
   - EN: If the device prints a paper receipt at the bar that the guest doesn't collect, and the guest gets a PDF copy, is the duty to hand over met?
3. (Рег. 1169/2011, чл. 2(2)(u), чл. 14(2))
   - BG: QR меню на масата, чрез което гостът поръчва и плаща, докато персоналът е в заведението, „средство за комуникация от разстояние" ли е?
   - EN: Is a QR menu at the table, used to order and pay while staff are present, a "means of distance communication"?

**For the venue's accountant**
4. (Прил. 29, т. 18.9; Прил. 17)
   - BG: Може ли в Mistral да има втори вид плащане „Карта онлайн", отчитан във ФУ като карта, и как да се равнява с изплащанията от доставчика?
   - EN: May Mistral hold a second payment type "Card online", counted as card on the fiscal device, and how should it be reconciled with the provider's payouts?

**For Mistral** (connector questions)
5. Is Mistral on the NRA's СУПТО list, and can its API register a sale as an electronic receipt and pass the guest's email?
6. Can the API return the receipt's data (number, УНП, QR content) or the device's electronic receipt file?
7. Can the pilot's fiscal device issue electronic receipts, and can it have two card payment types?
8. Does Mistral authorise Restro as a linked module (чл. 52з, ал. 5)?

L3 (an anonymous session as a "профил") stays open as worded in the 10-17 file.

## 2026-10-28: electronic receipts, payment confirmations and the POSes

Added 10-28 for Martin's question: do the POSes already issue electronic receipts, and may Restro give the guest any document if it is not NRA-approved software? Same marks as above. It adds to §1–2 and to `2026-10-26-pilot-law-working-answers.md` §1–2, and repeats neither.

**Read on 2026-10-28:**
- Н-18 and ЗДДС, consolidated, downloaded whole from lex.bg and searched as text ([Н-18](https://lex.bg/bg/laws/ldoc/2135540645), last change still ДВ 42/2025; [ЗДДС](https://lex.bg/laws/ldoc/2135533201)).
- The NRA register of sales software, [portal.nra.bg](https://portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home), all rows, no sign-in.
- The NRA news page on checking receipts: [nra.bg](https://nra.bg/wps/portal/nra/actualno/potrebiteli-mogat-da-proveriavat-istinki-li-sa-koasovite-belejki) (the page carries no date; it speaks of 01.01.2024 as past).
- The pilot POS vendor's public pages: [zamboo.bg/pos](https://www.zamboo.bg/pos.html), [web-menu](https://www.zamboo.bg/web-menu.html), [zamboo-web](https://www.zamboo.bg/zamboo-web.html), [pricing](https://www.zamboo.bg/pricing-zamboo.html), [help.zamboo.bg/restaurant](https://help.zamboo.bg/restaurant), [mistral.bg Н-18](https://mistral.bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8F-%D0%BD-18/), [mistral.bg e-commerce](https://mistral.bg/e-commerce-%D0%B8%D0%BD%D1%82%D0%B5%D0%B3%D1%80%D0%B0%D1%86%D0%B8%D1%8F-3/).
- barsy's public help: the 115 pages its search index lists for електрон\*, фискал\*, email, QR, SUPTO or Н18 ([docs.lukanet.com/barsy.help](https://docs.lukanet.com/barsy.help/100-about/index.html)).
- Stripe: [Receipts and paid invoices](https://docs.stripe.com/receipts).
- Glovo's Bulgarian help: [glovoapp.com/docs/bg/faq](https://glovoapp.com/docs/bg/faq).

### Short answer

- **Martin is right about the fiscal receipt.** Only the venue's fiscal device (or an ИАСУТД) issues one, on paper or electronically. No software issues it on its own, listed or not, so Restro can't either.
- **He is not right about a payment confirmation.** No text forbids non-fiscal software, or the venue through it, from giving the guest a confirmation that a card payment went through. Н-18 чл. 7а only limits what such a document may look like and say.
- **Whether either POS can issue an electronic receipt is unknown.** The NRA register has no row under their names (checked 10-28), an electronic receipt needs listed software, and neither vendor's public pages offer it. A listing may sit under another product or company name, so this is asked of each provider (open-items Q84; Martin 10-28: "dont assume they are not").

### 1. A document about the card payment that is not the receipt

- [RULE] The duty to issue sits on the seller, through its device: "чрез издаване на фискална касова бележка от фискално устройство (фискален бон) или чрез издаване на касова бележка от [ИАСУТД] (системен бон), независимо от това дали е поискан друг данъчен документ" (ЗДДС чл. 118, ал. 1). So the law expects other documents to exist alongside the receipt, and none of them replaces it.
- [RULE] Н-18 чл. 7а, read whole (new in ДВ 10/2019; ал. 3 from 26.02.2021). It binds "лице по чл. 3", the seller:
  - ал. 1: no document with the running total of a bill that resembles a fiscal, system or service receipt "визуално или по съдържание" (already in the 10-17 file, L9);
  - ал. 2: "Не се допуска издаване на служебен бон при извършване на продажби и за направени клиентски поръчки." **New here.** A служебен бон is a device document: the ordinance uses the term only for what the ФУ prints (duplicates, settings, reports). [READING] It doesn't reach an app screen. It does mean the device must never print the guest an order or payment slip in place of the receipt;
  - ал. 3: no document other than the fiscal receipt, given to customers "при извършване на продажби", may contain "Фискален", "Фискална", "Фискално", "Фискални" "или производни словосъчетания". Only the seller's name and the kind of goods are exempt.
- **[RULE, new] ал. 3 also catches a disclaimer.** "Това не е фискален бон" itself contains "фискален". The usual "This is not a fiscal receipt" line is therefore the one wording the text rules out in Bulgarian. [READING] The English "fiscal" is not one of the listed words, but it translates them. Avoid it in both languages.
- [RULE] Card slips and payment-provider receipts: Н-18 has no rule on them. It mentions a "ПОС терминал" only to define it by Наредба № 3/2018 (Н-18 § 1, т. 25) and in the cash-deposit exemption (чл. 3, ал. 1). [READING] A terminal slip, or a Stripe receipt, is the payment provider's record of a card transaction. It sits beside the fiscal receipt, never instead of it.
- [RULE] Breaking чл. 7а is breaking "нормативен акт по [прилагането на чл. 118]". The fine falls on the venue: BGN 6,000–20,000 for a company, or BGN 1,000–4,000 when no revenue goes unrecorded (ЗДДС чл. 185, ал. 2; in euro at 1.95583, see the 10-26 file §1).
- [READING] Restro draws the screen, but the payment is a direct charge on the venue's account (D125 3.4), and the screen speaks for the venue. Treat whatever the guest gets as the venue's document under чл. 7а.
- [READING] What keeps a payment confirmation lawful:
  - it is plainly about a card payment, and its title says so;
  - it carries no QR code, УНП, receipt number or fiscal memory number;
  - it has no receipt layout: no ЕИК/ДДС header, no VAT-group lines, no "ОБЩА СУМА" footer;
  - it uses neither "бон" nor any form of "фискален".

  [LAWYER] Whether showing the venue's receipt number would make it resemble the receipt "по съдържание". We recommend not showing it, so the question need not be asked.
- **Delivery platforms (Glovo, Wolt, Foodpanda/Takeaway).**
  - [VENDOR PAGE] Glovo's Bulgarian help says invoices for products come from the store ("свържете се директно с обекта"). Glovo invoices only its own fees.
  - [READING] These are distance sales delivered elsewhere, the e-shop regime that the 10-17 file ruled out for a guest at the table. They are no model for Restro.
  - [UNKNOWN] Their order-confirmation wording was not read.

### 2. The electronic fiscal receipt: conditions and who delivers it

- [RULE] **D122 §8's five conditions are right**, checked against the text on 10-28:
  1. Н-18 чл. 3, ал. 18, т. 1, with Прил. 32, т. 2а ("В обекта се издават фискални бонове в електронен вид: ДА/НЕ");
  2. Прил. 1, т. 15 ("Изборът се прави при регистрирането на продажбата");
  3. Прил. 1, разд. VIб, т. 5 ("да отговаря на хартиения образец и да съдържа реквизитите по чл. 26");
  4. чл. 52з, ал. 17;
  5. ЗДДС чл. 118, ал. 22.

  Two details the five leave implicit:
  - the receipt is still generated at payment ("се извършва съгласно чл. 25, ал. 6", чл. 52з, ал. 17);
  - the venue must already hold the client data it sends the receipt to (чл. 3, ал. 18, т. 2).
- [RULE] **Who issues:** the fiscal device generates the receipt and keeps it in its КЛЕН (Прил. 1, разд. VIб). Listed software must be able to send it: "изпращане на генерираните в електронен вид бонове на електронен адрес на клиента или към негов профил в интернет сайт или мобилно приложение" (Прил. 29, т. 24.1).
- [RULE] **Who may deliver:** чл. 52з, ал. 17 names the channel, not the sender: the client's email address, or "негов профил" in a site or app. Nothing in it says the site or app must be the venue's or the POS's.
  - [READING] The text doesn't exclude Restro forwarding the device's own file, unchanged, to an email the guest typed.
  - [LAWYER] This is question 1 above. It is not new, and it is still unanswered.
  - [READING] Restro may never redraw the receipt from its data. That would make a second document containing "ФИСКАЛЕН БОН" (чл. 7а, ал. 3; чл. 26, ал. 1, т. 10), as the 10-20 review found.
- **The receipt's QR code and the NRA check.**
  - [RULE] The QR code holds `<fiscal memory number>*<document number>*<date>*<time>*<total>`. Прил. 1's example: "01234567*0000000123456789*2017-05-20*12:45:56*45.89".
  - [NRA] A guest can check a receipt with the free NRA Mobile app (iOS, Android): "необходимо е потребителите да сканират отпечатания на бележката QR код".
    - The app shows the amount, date, time and number encoded in the code.
    - A further check, "дали конкретната касова бележка е получена в сървърите на приходната агенция", takes "няколко минути" and shows green when all is well.
  - [READING] An electronic receipt carries the same QR code (чл. 26, ал. 1, т. 16 applies through VIб, т. 5), so it can be checked the same way.

### 3. Do the POSes already do it?

- [RULE] **The register, re-checked on 10-28:**
  - It still holds 130 entries. The newest is №1101 SATISLY MONEY (included 11.09.2026).
  - No row is barsy, Lukanet, Mistral, Мистрал, Zamboo or Замбу.
  - [READING] If neither POS is listed under any name, a venue running it with no other listed software can't issue an electronic fiscal receipt (ЗДДС чл. 118, ал. 21, т. 2). Whether they are is asked of each provider (Q84).
- [VENDOR PAGE] **Mistral / Zamboo.**
  - No page read mentions an electronic fiscal receipt, sending a receipt by email, or a receipt link or QR code for guests. Pages read: POS, Web Menu, Zamboo web, pricing, the restaurant help, e-commerce integration.
  - The restaurant help covers the fiscal device only for Z reports and storno receipts.
  - mistral.bg's "Информация Н-18" page is the Прил. 32 filing for listed software. Its title: "Информация, подавана от лицата по чл. 118, ал. 18 от ЗДДС за използвания софтуер в търговски обект". Yet no Mistral product is listed.
  - [UNKNOWN] Whether any Mistral product can generate electronic receipts. The public pages are silent; asked (Q84).
- [DOC] **barsy.**
  - The public help describes an electronic **invoice**, not a receipt: "Освен да бъде разпечатана и изпратена по e-mail, фактурата може да достигне до клиента и чрез споделени ресурси … сканирането на фактура чрез QR, или изтеглянето ѝ чрез линк" ([Фактура в електронен вид](https://docs.lukanet.com/barsy.help/110-admin/165-docs/100-invoices/6-e-invoice.html)).
  - An invoice never replaces the fiscal receipt (ЗДДС чл. 118, ал. 1: "независимо от това дали е поискан друг данъчен документ").
  - No page found offers an electronic fiscal receipt.
  - The help claims "barsy SUPTO … изпълнени всички изисквания на Наредба Н18", and the rights list has "Заявка за ъпгрейд към SUPTO". Neither is on the register.

### 4. Does taking the card through Restro change who issues the receipt?

- Nothing new beyond §2 and the 10-17 file:
  - the venue is the seller and issues the receipt (Н-18 чл. 3, ал. 1);
  - Restro holds no money (D98, D125 3.4), so чл. 29 doesn't apply;
  - whether Restro is "sales-management software" is still L11, and it matters only at a venue on listed software.
- [RULE] Being on the NRA list would not let Restro issue receipts either. The list is of software that **manages** sales; the receipt still comes from the device that software drives (Н-18 чл. 52з, ал. 3; Прил. 1, разд. VIб).
- [DOC, Stripe] Stripe's own receipts:
  - "Stripe creates receipts for all successful payments", each with a `receipt_url`;
  - on direct charges they carry the connected account's branding and public details, so the venue's;
  - the links "expire after 30 days". Stripe then "asks the customer to provide the email address associated with the original transaction". Restro passes none (D125 3.7), so after 30 days the link is a dead end for the guest.

### What this means for the guest's Paid screen

**Recommendation.**
1. **Show a payment confirmation, and let the guest save it.** It is lawful (§1) and guests expect one.
   - **Title:** "Потвърждение за плащане" / "Payment confirmation".
   - **Content:** the venue's trade name, date and time, the lines paid, the tip, the total in euro, "Платено с карта" / "Paid by card", and Restro's payment reference.
   - **"Запази" / "Save":** the phone makes an image or PDF of the same content. Never a lasting link.
2. **Wording:** never "бон", and never any form of "фискален", not even in a disclaimer.
   - "Това не е касова бележка. Касовата бележка за плащането ви носи сервитьорът." / "This is not your receipt. Your waiter brings the venue's receipt."
   - Optional: "Можете да я проверите с приложението НАП Мобайл." / "You can check it in the NRA's mobile app."
3. **Leave off:**
   - the receipt number, УНП, fiscal memory number and any QR code;
   - the venue's ЕИК/ДДС header and VAT-group lines;
   - anything shaped like a till slip.

   The venue's legal details stay behind a link, as in the 10-26 file's recommendation 4.
4. **Use Restro's own confirmation, not Stripe's `receipt_url`.** Stripe's link expires after 30 days and then asks for an email the guest never gave. This follows D125 3.7 ("Restro's own"). D122 §8 still says "the provider's payment confirmation", so the lead should align D122 with D125's wording.
5. **The venue's electronic receipt:** Restro is built for it (Martin 10-28, D127 "The venue's electronic receipt"); whether each POS supports it is asked of its provider (Q84). Until a connector declares it, the receipt is paper, and the waiter brings it (D122 §8).
   - **At a venue whose connector declares "electronic receipt":** the pay screen offers an optional email field. The POS issues the sale as electronic, and the device's own file goes to that address.
   - Whether Restro may carry that file is lawyer question 1 above. The receipt is never redrawn.

### Still unknown

- Whether barsy or any Mistral product can generate electronic receipts (Q84).
- How Wolt and Foodpanda word their order confirmations (not read; the recommendation doesn't need it).
- [LAWYER] Question 1 above (Restro delivering the device's file) and L3 (an anonymous session as a "профил"). Neither applies at the pilot.

### Corrections and alignments

- `2026-10-20-ordering-review-law-money.md` finding 4 gives the чл. 185 fine for a receipt not handed over, and is right for that case. A confirmation that breaks чл. 7а falls under чл. 185, ал. 2 instead: BGN 6,000–20,000, or 1,000–4,000 when no revenue goes unrecorded (§1 above). That file is not edited; this line records the difference.
- Nothing read on 10-28 proves a line wrong in the 10-17, 10-18 or 10-26 files, in D122 §8 or in D125 3.7. D122's "provider's payment confirmation" against D125's "Restro's own" is a wording mismatch (item 4 above).
