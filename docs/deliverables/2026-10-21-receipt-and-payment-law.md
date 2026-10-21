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
