# Fiscal rules for card payments through the app, deposits and paid song requests
### Preparation for the lawyer (open items Q74, Q75; issue #8)

> **Not legal advice.** This file prepares questions for the lawyer. It settles nothing. Every `[READING]` line is my interpretation, not a fact. The lawyer answers, and on anything uncertain the lawyer or a written NRA opinion decides.

*Researched 2026-10-17 against primary sources only. It extends Part 2 of `docs/research/2026-10-17-mypos-and-fiscal-receipts.md` and does not repeat it. The payment providers themselves are researched in issue #9.*

## How to read this document

- **[LAW]** the text of the law as published: consolidated texts on lex.bg (they republish the State Gazette), or the State Gazette itself. Quoted in Bulgarian with article, paragraph and point.
- **[NRA]** stated on a page of the National Revenue Agency (nra.bg).
- **[LAW, EU]** a judgment of the Court of Justice of the EU (binding on how Bulgarian VAT law is read).
- **[READING]** my interpretation. Not a fact.
- **[NOT FOUND]** the primary source is silent, or the page could not be reached.

**Versions read.** The lex.bg pages were downloaded whole and searched as text, so the quotes are exact rather than summaries.
- Наредба № Н-18 от 13.12.2006, consolidated text; latest amendment in it: ДВ бр. 42/2025. The State Gazette entry for that amendment matches it (`dv.parliament.bg`, idMat=235038, ДВ бр. 42 от 23.5.2025). https://lex.bg/bg/laws/ldoc/2135540645
- ЗДДС, consolidated text; amendments up to ДВ бр. 69/2026. https://lex.bg/bg/laws/ldoc/2135533201
- ППЗДДС, consolidated text; the latest amendment seen is ДВ бр. 54/2024. https://lex.bg/bg/laws/ldoc/2135534826
- Закон за защита на потребителите (ЗЗП), consolidated text. https://lex.bg/laws/ldoc/2135513678
- **[NOT FOUND]** No amendment of Н-18 published in 2026 was found. Note that ЗДДС чл. 118, ал. 4, т. 10 (new, in force 01.01.2026) tells the ordinance to regulate "комуникацията между ФУ/ИАСУТД и информационни системи/софтуери"; the consolidated Н-18 has no such chapter yet. The lawyer should confirm whether a 2026 amendment is published or pending (L12).

Abbreviations: ФУ = fiscal device; ИАСУТД = integrated automated system that issues system receipts; СУПТО = sales-management software; УНП = unique sale number. Restro terms follow `GLOSSARY.md`: hold, capture, release, refund, payment provider, payment account.

---

## Summary

1. **Card payment in the app at the table:** the default is a fiscal receipt from the venue's ФУ (Н-18 чл. 3, ал. 1; чл. 25, ал. 1, т. 1). Besides the "different place" clause Part 2 found (ЗДДС § 1, т. 96), two more texts point away from the alternative regime. An e-shop needs a distance contract (ЗДДС § 1, т. 87), and a distance contract needs the trader and the consumer to be not physically present at the same time (ЗЗП чл. 45). [READING]
2. **One payment, one fiscal document**, issued "при извършване на плащането" and handed over with it (Н-18 чл. 25, ал. 6). A plain fiscal receipt has no field for the payment provider's reference. The link between them is the sale number (УНП) when the venue uses listed sales software (Annex 29, т. 9), plus Restro's own record.
3. **Deposits:** VAT is chargeable when the deposit is received (ЗДДС чл. 25, ал. 7). Н-18 has a ready mechanism for a deposit counted against the bill: the "ЧАСТИЧНИ ПЛАЩАНИЯ" department, then a value discount on the final receipt (чл. 26а, ал. 1–2). For a deposit kept after a no-show, the EU Court treats it as compensation, not consideration (C-277/05); Bulgarian law has no text on it.
4. **Even a deposit paid from home** may fall outside the alternative regime. The service is delivered at the club, which is the venue's trade site (§ 1, т. 96). This corrects the leaning of the earlier note (Part 2, (b)). [READING]
5. **Refunds** are a "сторно" from the device that issued the receipt (Н-18 чл. 31). The text is written around cash. Only an ИАСУТД is expressly allowed to storno a refund paid back to a card (чл. 31, ал. 3а, new in 2025). A released hold is never a payment, so no document is issued. [READING]
6. **Restro and the sales-software rules:** the law defines sales software as "всеки софтуер или модул от софтуер" that processes sale information in a trade site (ЗДДС § 1, т. 84). Restro's ordering probably fits that. The decisive rule is on the venue side: a venue that chose listed software must manage its sales "само ... този софтуер" (ЗДДС чл. 118, ал. 18) and may not add external modules without the producer's authorisation (Н-18 чл. 52з, ал. 5). Orders may come in only as an import (чл. 52з, ал. 10–11, Annex 42).
7. **New constraints on the guest screens:** a document showing the running total of a bill must not resemble a receipt. It must follow Annex 39 and say "НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ" (Н-18 чл. 7а, ал. 1; чл. 26, ал. 6). No document other than a fiscal receipt may contain the word "фискален" (чл. 7а, ал. 3).
8. **A possible design lever:** money paid by credit transfer is outside the fiscal-receipt duty (Н-18 чл. 3, ал. 1). Whether a "pay by bank" payment through a payment provider counts as a credit transfer is a lawyer question (L5) and a provider question (issue #9).

---

## Findings by question

### Q1. Card payment through the app inside the venue

Part 2 (a)–(c) already sets out the general rule, the alternative regime and its conditions (чл. 3, ал. 17; чл. 52м–52у; ЗДДС чл. 118, ал. 3б; § 1, т. 87, 96). New here:

- **[LAW]** A fiscal receipt is required "за всяко плащане", except the payments listed in чл. 3, ал. 1. Н-18 чл. 25, ал. 1, т. 1.
- **[LAW]** The receipt "се издава при извършване на плащането"; the seller must hand it to the client "едновременно с получаване на плащането". Н-18 чл. 25, ал. 6.
- **[LAW]** An e-shop is software through which goods or services are sold "посредством сключване на договор от разстояние по чл. 45 от Закона за защита на потребителите". ЗДДС § 1, т. 87.
- **[LAW]** A distance contract is concluded "без едновременното физическо присъствие на търговеца и потребителя, чрез изключителното използване на едно или повече средства за комуникация от разстояние". ЗЗП чл. 45.
- **[READING]** A guest at a table, served by the venue's staff, is in the trader's physical presence, so the order is arguably not a distance contract. Restro's guest page would then not be an "електронен магазин", and чл. 3, ал. 17 would not open. Together with § 1, т. 96 ("на място, различно от търговския обект"), three texts point the same way: the venue's ФУ must issue a fiscal receipt for an in-venue app payment.
- **[LAW]** The trade site is "всяко място, помещение или съоръжение ... във или от което се извършват продажби". ЗДДС § 1, т. 41. The club is the venue's trade site.
- **[LAW]** If the receipt is not issued, the guest may withhold payment. ЗДДС чл. 118, ал. 1а. [READING] With a card payment in the app, the money moves before a receipt can exist, so the receipt must follow the capture within the same moment (L2).
- **[LAW]** An electronic fiscal receipt instead of paper: the venue must have chosen listed sales software and have the client data the ordinance requires. Н-18 чл. 3, ал. 18. The receipt is sent "на електронния му адрес" or kept "в негов профил в интернет сайт или мобилно приложение". Н-18 чл. 52з, ал. 17. Paper on request (same).
- **[LAW]** The other electronic route (чл. 3, ал. 19, new in ДВ 42/2025) covers an e-shop, an ИАСУТД or an ЕСФП, not a ФУ driven by unlisted software. The delivery channels are the same (чл. 25, ал. 13).
- **[NRA]** The NRA page "Документи за продажба" still says an electronic fiscal receipt "може да се издава само за ... продажби чрез електронен магазин". That is older than чл. 3, ал. 18–19 (2024 and 2025). Source: https://nra.bg/wps/wcm/connect/agency/site/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-za-prodajba.storno.operacii/dokuenti.prodajba
- **[READING]** Restro's guests have no accounts and leave no email (D99). Whether an anonymous guest session counts as a "профил в ... мобилно приложение" is open (L3). If it does not, the receipt is paper and must reach the guest at the table.
- **[NRA vs LAW]** The same NRA page lists the exemptions as separate bullets: "чрез внасяне на пари в наличност по платежна сметка, кредитен превод, директен дебит или наличен паричен превод;" / "чрез доставчик на платежна услуга по смисъла на Закона за платежните услуги и платежните системи,". Read alone, the second bullet suggests that any payment through a payment provider is exempt. In the ordinance it is one sentence, in which the provider clause qualifies the cash transfer: "... или наличен паричен превод, извършен чрез доставчик на платежна услуга ..." (Н-18 чл. 3, ал. 1). The law text wins. The discrepancy is raised in L1 so that nobody relies on the NRA page's bullets.
- **[READING]** Software conditions and СУПТО for the alternative regime are in Part 2 (c). They matter only for payments that really are "неприсъствени" (see Q3).

### Q2. Who issues what when the POS prints the receipt and the payment goes through the app

- **[LAW]** The duty to issue the receipt is the seller's, "лицето по чл. 3": the venue. Н-18 чл. 3, ал. 1.
- **[LAW]** The alternative document is issued "вместо" a fiscal receipt. Н-18 чл. 3, ал. 17; ЗДДС чл. 118, ал. 3б. [READING] For one sale there is one fiscal document, never both.
- **[LAW]** A fiscal receipt must show "обща сума за плащане и начин/и на плащане". Н-18 чл. 26, ал. 1, т. 8. Its required fields (т. 1–16) contain no payment-transaction reference. Only the alternative document has "референтен номер на финансовата трансакция" (чл. 52о, ал. 1, т. 4).
- **[LAW]** When a ФУ is driven by listed sales software, the receipt carries the УНП, generated when the sale is entered (Annex 29, т. 9 and 9.1). [NRA] The same is said on the NRA "Документи за продажба" page.
- **[LAW]** For one sale paid in parts, the ФУ may be set up with a "ЧАСТИЧНИ ПЛАЩАНИЯ" department (чл. 26а, ал. 1–2; see Q3). [READING] This is relevant when part of a bill is paid in the app and part at the bar.
- **[READING]** Under the fiscal-receipt route, the venue's POS (barsy or Mistral) prints one fiscal receipt with payment type card when the app payment is captured. Restro stores the payment provider's transaction reference against the POS's receipt number or УНП. That is the "receipt reference" D98 asks for. Nothing in the law requires the link; it is Restro's own audit trail.
- **[NOT FOUND]** Whether barsy is on the NRA list of sales software. The NRA public list (`inetdec.nra.bg`, REGREPSOFT) returned 404 on 2026-10-17. Ask Lukanet (Q8, Q24) or the lawyer.

### Q3. Deposits for reservations

- **[LAW]** The tax event is the date the service is performed (ЗДДС чл. 25, ал. 2). For an advance payment before that, "данъкът става изискуем при получаване на плащането (за размера на плащането)", and the VAT is taken to be included in it. ЗДДС чл. 25, ал. 7. [READING] A deposit counted against a later bill is an advance payment.
- **[LAW]** An invoice is due for an advance payment within 5 days of receiving it (ЗДДС чл. 113, ал. 1 and 4). It need not be issued when the recipient is a non-taxable individual (чл. 113, ал. 3, т. 1), unless one side asks (ал. 6). If the advance covered the whole supply and was invoiced, no new invoice is needed at the supply (ППЗДДС чл. 79, ал. 8).
- **[LAW]** Н-18 has no deposit rule as such (Part 2 (d)). The fiscal receipt is due "за всяко плащане" (чл. 25, ал. 1, т. 1) and "при извършване на плащането" (чл. 25, ал. 6). [READING] No exception for advance payments was found, so a deposit paid by card needs a fiscal receipt when it is received, unless the alternative regime applies.
- **[LAW]** The mechanism for a deposit counted against the bill: "За продажби, за които лице по чл. 3 приема частични плащания, се допуска ФУ/ИАСУТД да се програмира така, че продажбите да се регистрират в департамент с обобщено наименование 'ЧАСТИЧНИ ПЛАЩАНИЯ'". At the final payment, all goods and services are registered, followed by "стойностна отстъпка, равна на размера на частично заплатената/заплатените сума/и", explained in free text between "#" signs. Н-18 чл. 26а, ал. 1–2. [NRA] The same is repeated under "Частични плащания и отложено плащане" on the NRA page above.
- **[READING]** This gives a clean flow: receipt 1 (department ЧАСТИЧНИ ПЛАЩАНИЯ) when the deposit is captured, and receipt 2 (the whole bill, minus the deposit) at the end of the night. Both are issued by the venue's ФУ. The POS has to support both steps; whether barsy does is a Lukanet question.
- **[LAW]** "Неприсъствено плащане" needs the goods or services delivered "на място, различно от търговския обект на търговеца". ЗДДС § 1, т. 96. [READING] A table reservation is used at the club, which is the venue's trade site, wherever the guest pays from. Read literally, a deposit paid from home is therefore not "неприсъствено" either, and the alternative regime does not reach it. Part 2 (b) leaned the other way; this reading corrects it. Lawyer question L4.
- **[LAW]** A deposit paid by credit transfer needs no fiscal receipt (Н-18 чл. 3, ал. 1). [READING] If a payment provider offers "pay by bank" (a payment initiation that ends as a credit transfer), a deposit paid that way might fall outside the fiscal-receipt duty. Lawyer question L5; the provider side belongs to issue #9.
- **[LAW, EU]** For a deposit kept after a cancellation, the EU Court held that a deposit retained under a hotel contract is "a fixed cancellation charge paid as compensation for the loss suffered as a result of client default", with "no direct connection with the supply of any service for consideration", and is not subject to VAT. CJEU C-277/05, *Société thermale d'Eugénie-les-Bains*, 18.07.2007, operative part and paras 25–35. https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62005CJ0277
- **[NOT FOUND]** A Bulgarian text or NRA opinion on how to correct the VAT charged at receipt (ЗДДС чл. 25, ал. 7) once a deposit is forfeited. Н-18 чл. 31, ал. 1 lists the storno grounds as "рекламация или връщане на стока", "операторска грешка" and "намаление на данъчната основа"; forfeiture is not named. ЗДДС чл. 115, ал. 2 covers a credit note for an invoiced advance, issued within 5 days of the "връщането, прихващането или уреждането по друг възмезден начин" of the advance. Lawyer question L6.
- **[LAW]** A refunded deposit (the venue cancels, or a cancellation within the free window) is a storno at the moment of refund (Н-18 чл. 31, ал. 4; see Q6), plus a credit note within 5 days if an invoice was issued (ЗДДС чл. 115, ал. 2).
- **[READING]** Who issues: always the venue, which is the merchant (D98). Restro issues nothing to the guest.

### Q4. Paid song requests

- **[LAW]** "Доставка на услуга е всяко извършване на услуга." ЗДДС чл. 9, ал. 1. Standard VAT rate 20% (ЗДДС чл. 66, ал. 1). The reduced 9% rate (чл. 66а) lists accommodation, books and baby food, not this. [READING] A paid request is a service sold by the venue, with VAT at 20%, unless the DJ is a separate business that sells the service in its own name (L8).
- **[LAW]** The receipt follows the payment: it is issued "при извършване на плащането" (Н-18 чл. 25, ал. 6), and VAT on an advance becomes chargeable "при получаване на плащането" (ЗДДС чл. 25, ал. 7). [READING] A hold is a reservation of money on the guest's card, not a payment received by the venue. So no receipt and no VAT at the hold; the receipt is due at capture (when the DJ accepts). This reading needs the lawyer's yes (L7).
- **[READING]** Several backers on one request means several captures, so a receipt for each payment (чл. 25, ал. 1, т. 1 "за всяко плащане"). A busy night may mean hundreds of small receipts from the venue's ФУ. Without guest email or profiles (D99), they are paper receipts (Q1), which a guest who is not at a table may never collect. This is a design tension for Martin as much as for the lawyer.
- **[READING]** A request made "online" without a table (D100) still concerns a service performed in the club (the song is played there), so § 1, т. 96 points to a fiscal receipt here as well.
- **[READING]** Skip after accept means a refund of a captured payment, documented as a storno at the moment of refund (Q6). With the fallback provider (D98: charge on request, refund on skip), there is a receipt at the charge and a storno at the refund.
- **[NOT FOUND]** Any NRA text on paid music requests, auctions or bidding for a service in a venue.

### Q5. Restro's own obligations

- **[READING]** Restro never receives guest money (D98). So Н-18 чл. 29 (a person who "събира суми от името и за сметка на друго лице" registers the sales on the principal's or its own ФУ) does not apply. Restro would fall under it only if it ever collected money for venues. The account rule of чл. 52п points the same way (Part 2 (c)).
- **[READING]** Restro's fee is a business-to-business service invoiced to the venue (ЗДДС чл. 113, ал. 1). Paid by credit transfer, it needs no fiscal receipt (Н-18 чл. 3, ал. 1). Paid by card, see L11.
- **[LAW]** "Софтуер за управление на продажби в търговски обект" is "всеки софтуер или модул от софтуер, независимо от технологиите за реализацията му, използван за обработка на информация за извършване на продажби на стоки и/или услуги в търговски обект, за които е налице задължение за издаване на фискален бон". ЗДДС § 1, т. 84. [NRA] The NRA's СУПТО page quotes the same definition: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/supto
- **[READING]** Restro's ordering and its bill screen process sale information for sales that need a fiscal receipt, so Restro probably meets the definition, as a "модул". The definition alone creates no duty. Listing is voluntary for a producer (ЗДДС чл. 118, ал. 14), and no duty on an unlisted producer was found (Part 2 (c)).
- **[LAW]** The venue side is what binds Restro. "В търговски обект, в който лицето е избрало да ползва софтуер, включен в списъка по ал. 16, за управление на продажбите е длъжно да ползва само този софтуер." ЗДДС чл. 118, ал. 18. That software "задължително управлява всички работещи фискални устройства в този обект" (Н-18 чл. 52з, ал. 3), and the venue may not "без оторизация от производителя/разпространителя на софтуера ... добавят външни модули към него" (чл. 52з, ал. 5).
- **[LAW]** "Управление на продажби чрез СУПТО" covers the sale "от заявяването от страна на клиентите на доставка на стоки/услуги до предоставянето/заплащането им". The request counts as made at the latest when the venue "поема ангажимент към клиента", including tacitly. Н-18 § 1, т. 19 of the additional provisions; [NRA] quoted on the СУПТО page above.
- **[LAW]** The way in for outside orders: a venue on listed software may import into it sales from "други източници и софтуери" and orders from an e-shop (Н-18 чл. 52з, ал. 10–11). The import must meet Annex 42: "в пълен обем и с непроменено съдържание"; the УНП is generated at import or at confirmation; the software keeps the time of import, the source ("ЕИК/идентификатор и наименование на заявител"), the external request id and the method ("API, електронен портал, импорт от файл"), and keeps declined requests too (Annex 42, т. 2.1–2.5).
- **[READING]** If a venue's POS is listed software, a Restro order must enter the POS as an Annex 42 import **before or when the venue accepts it**, not after it is served or paid. Restro is then a "source", not a second sales system. This is a constraint on the ordering design (T83), and the open Lukanet questions (Q8, Q24) decide whether barsy supports it.
- **[LAW]** Guest-facing documents in a venue:
  - "Не се допуска лице по чл. 3 да предоставя документ с информация за текуща сума по сметка, наподобяващ визуално или по съдържание на фискален, системен или служебен бон." Н-18 чл. 7а, ал. 1.
  - A requested document showing the bill's running total follows Annex 39 and carries, in bold capitals at least twice the size of the other text, the words that no payment is due on it. Н-18 чл. 26, ал. 6; Annex 39 (title "ИНФОРМАЦИЯ ЗА ТЕКУЩА СУМА ПО СМЕТКА", sum in euro, the words "По този документ НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ").
  - No document other than a fiscal receipt may contain "Фискален", "Фискална", "Фискално", "Фискални" or derived words. Н-18 чл. 7а, ал. 3; the same rule for listed software is in Annex 29, т. 14.
- **[READING]** The guest template's bill and receipt screens (D71) are what these rules aim at. Whether a screen in the app is a "документ" under чл. 7а and чл. 26, ал. 6 is open. If it is, the bill screen would have to follow Annex 39 and say that no payment is due on it, which sits oddly with a "Pay" button on the same screen (L9). Until the lawyer answers, the safe reading for design is: never call any Restro screen a receipt ("бон", "касова бележка", "фискален"), and keep the bill screen visually unlike a receipt.
- **[READING]** If a venue does use the alternative regime through Restro, the venue registers the e-shop (Н-18 чл. 52м, ал. 1 applies "независимо дали използва ... домейн на друго лице, предоставящо платформа"). Restro's software would then have to generate the чл. 52о document and the monthly Annex 38 file (which marks a platform with E_SHOP_TYPE "2 - онлайн платформа"), and give tax inspectors "пълен достъп до административния панел" (чл. 52с, ал. 3).

### Q6. Refunds and reversals

- **[LAW]** A refund after the client's bill is closed is a storno, documented "чрез издаване на документ от ФУ или ИАСУТД". Н-18 чл. 31, ал. 1. The storno document contains the receipt fields т. 1–11, the number, date and time of the original receipt, the reason and the word "СТОРНО". With listed software it also contains the УНП of the original sale. Чл. 31, ал. 2.
- **[LAW]** Timing: a storno for a return or reduction of the tax base "се документира в момента на възстановяване изцяло или частично в брой на заплатената от клиента сума". Чл. 31, ал. 4.
- **[LAW]** "Не се допуска извършване на сторно операция при недостатъчна касова наличност", except for operator error. Чл. 31, ал. 3. But "Допуска се чрез ИАСУТД да се документира сторно операция, по която връщането на сумата се извършва чрез банков превод или по кредитна/дебитна карта", even with insufficient cash. Чл. 31, ал. 3а (new, ДВ 42/2025). A storno may carry more than one payment method in an ИАСУТД (чл. 31, ал. 2б).
- **[NOT FOUND]** A text that expressly lets a ФУ (as opposed to an ИАСУТД) document a storno refunded to a card, or that says when such a storno is made (the refund request, the provider's refund call, or the money reaching the card). [READING] Practice probably exists; the text is cash-shaped. Lawyer question L10.
- **[LAW]** For an invoiced sale, the correction is a credit note (ЗДДС чл. 115, ал. 1 and 3), within 5 days (ал. 2). A ФУ may issue the credit note only "ако се възстановява сума в брой в момента на издаване на известието" (Н-18 чл. 31, ал. 9); an ИАСУТД also for a card or bank refund (ал. 9а).
- **[LAW]** In the alternative regime, no separate refund document is defined in чл. 52м–52у. The monthly audit file reports returned orders: R_ORD (count of fully or partly returned orders), R_ORD_N, R_AMOUNT ("Върната сума на клиента - в евро"), R_DATE, R_PAYM, R_TOTAL. Н-18 Annex 38.
- **[READING]** A released hold was never a payment received by the venue, so no receipt, no storno and no VAT. For listed sales software, an opened sale that is cancelled is kept in the database as annulled (Annex 29, т. 12). For an Annex 42 import, declined requests are kept too (т. 2.3). The order record stays; no fiscal document is issued.
- **[READING]** A provider's "reversal" (the same capture cancelled before settlement) is, for fiscal purposes, a refund of a payment already registered. If the receipt was issued at capture, a storno is needed even though the guest's card shows nothing. Lawyer question L10.

---

## Payment type → document → who issues → when → source

| Payment type | Document | Who issues | When | Source |
|---|---|---|---|---|
| App payment of the bill or a round, guest at the table, card | Fiscal receipt, payment type card (paper; electronic only under чл. 3, ал. 18–19) | Venue, from its ФУ (through its POS) | At the payment (capture), handed over with it | Н-18 чл. 3, ал. 1; чл. 25, ал. 1, т. 1 and ал. 6; ЗДДС § 1, т. 87, 96; ЗЗП чл. 45 [READING: alternative regime does not apply] |
| Same, if the lawyer holds it is "неприсъствено" | Alternative sales document (чл. 52о), sent electronically | Venue, through the e-shop software (Restro would generate it) | When the virtual POS authorises the payment | Н-18 чл. 3, ал. 17; чл. 52о, ал. 5 |
| Part of the bill paid in the app, the rest at the bar | Fiscal receipt per payment; may use department ЧАСТИЧНИ ПЛАЩАНИЯ | Venue, ФУ | At each payment | Н-18 чл. 25, ал. 1, т. 1; чл. 26а [READING] |
| Reservation deposit, card, counted against the bill | Receipt 1 in department ЧАСТИЧНИ ПЛАЩАНИЯ; final receipt with a value discount equal to the deposit. Invoice only if asked (individual) or within 5 days (business) | Venue, ФУ | Receipt 1 at capture of the deposit; final receipt at the final payment. VAT at receipt of the deposit | ЗДДС чл. 25, ал. 7; чл. 113, ал. 3–4, 6; Н-18 чл. 26а [READING on how the regime applies, L4] |
| Reservation deposit by credit transfer (or, if confirmed, "pay by bank") | No fiscal receipt; invoice rules as above | Venue | VAT at receipt | Н-18 чл. 3, ал. 1; ЗДДС чл. 25, ал. 7 [L5] |
| Deposit refunded (cancellation) | Storno; credit note if invoiced | Venue, ФУ (ИАСУТД expressly allowed for card refunds) | At the refund; credit note within 5 days | Н-18 чл. 31, ал. 1–4, 3а; ЗДДС чл. 115, ал. 2 [L10] |
| Deposit forfeited (no-show) | Not settled: likely outside VAT as compensation; the correction of receipt 1 is open | Venue | Open | CJEU C-277/05; [NOT FOUND] Bulgarian text [L6] |
| Song request: hold placed | None | — | — | [READING] ЗДДС чл. 25, ал. 7; Н-18 чл. 25, ал. 6 [L7] |
| Song request: capture on accept (each backer) | Fiscal receipt per captured payment, VAT 20% | Venue, ФУ | At capture | Н-18 чл. 25, ал. 1, т. 1 and ал. 6; ЗДДС чл. 9, ал. 1; чл. 66, ал. 1 [READING, L7, L8] |
| Song request: skipped after accept (refund) | Storno | Venue, ФУ | At the refund | Н-18 чл. 31 [L10] |
| Song request: hold released at close of the queue | None (the request stays in Restro's record) | — | — | [READING] Annex 29, т. 12; Annex 42, т. 2.3 |
| Refund of any app payment | Storno; credit note if invoiced | Venue, the device that issued the receipt | At the refund | Н-18 чл. 31; ЗДДС чл. 115 [L10] |
| Restro's fee to the venue | Invoice (no fiscal receipt if paid by transfer) | Restro | Within 5 days of the tax event | ЗДДС чл. 113, ал. 1, 4; Н-18 чл. 3, ал. 1 [L11] |

---

## Questions for the lawyer / Въпроси към юриста

Each question can be answered yes or no, or by naming the condition. L1–L4, L7 and L9 sharpen Q74; L4–L8 and L10 sharpen Q75. L11–L12 concern Restro itself.

**L1.** (Н-18 чл. 3, ал. 1)
- BG: Изключението по чл. 3, ал. 1 обхваща ли плащане с карта чрез доставчик на платежни услуги, или „извършен чрез доставчик на платежна услуга" се отнася само до наличния паричен превод? Страницата на НАП „Документи за продажба" изброява „чрез доставчик на платежна услуга" като отделно изключение.
- EN: Does the exception in чл. 3, ал. 1 cover a card payment through a payment provider, or does "through a payment service provider" qualify only the cash transfer? NRA's "Документи за продажба" page lists the provider as a separate exemption.

**L2.** (ЗДДС § 1, т. 87 and 96; ЗЗП чл. 45; Н-18 чл. 3, ал. 17)
- BG: Когато гост в заведението поръчва и плаща с карта през уеб приложение на заведението и се обслужва на масата, налице ли е „неприсъствено плащане с кредитна или дебитна карта" и „електронен магазин"? Ако не, длъжно ли е заведението да издаде фискален бон от своето ФУ за всяко такова плащане, в момента на плащането (чл. 25, ал. 6)?
- EN: When a guest in the venue orders and pays by card in the venue's web app and is served at the table, is that a remote card payment through an e-shop? If not, must the venue's ФУ issue a fiscal receipt for each such payment at the moment of payment (чл. 25, ал. 6)?

**L3.** (Н-18 чл. 3, ал. 18–19; чл. 52з, ал. 17; чл. 25, ал. 13)
- BG: Може ли фискалният бон в електронен вид да се предостави на гост без акаунт и без имейл, чрез показване в анонимна сесия на уеб приложението? Ако да, при кои условия (избран СУПТО по списъка, съхранение на данни за предоставянето)?
- EN: May the electronic fiscal receipt be given to a guest with no account and no email, by showing it in an anonymous session of the web app? If yes, under which conditions (listed sales software chosen, delivery data stored)?

**L4.** (ЗДДС § 1, т. 96; Н-18 чл. 3, ал. 17; чл. 26а)
- BG: Депозит за резервация на маса, платен с карта онлайн от дома на госта, е ли „неприсъствено плащане", при положение че услугата се ползва в търговския обект на заведението? Ако не, правилно ли е депозитът да се отчете с фискален бон в департамент „ЧАСТИЧНИ ПЛАЩАНИЯ" при получаването му, а при окончателното плащане с отстъпка по чл. 26а, ал. 2? Кое ФУ издава бона, ако плащането е извън работното време?
- EN: Is a table deposit paid by card online from home a remote card payment, given that the service is used at the venue's trade site? If not, is it right to register the deposit with a fiscal receipt in the ЧАСТИЧНИ ПЛАЩАНИЯ department when it is received, and to apply the чл. 26а, ал. 2 discount at the final payment? Which ФУ issues the receipt if the payment arrives outside opening hours?

**L5.** (Н-18 чл. 3, ал. 1; ЗДДС чл. 25, ал. 7)
- BG: Плащане, инициирано от госта през доставчик на платежни услуги и изпълнено като кредитен превод („плащане от банкова сметка"), попада ли в изключението „кредитен превод" по чл. 3, ал. 1, така че да не се издава фискален бон?
- EN: Does a payment the guest initiates through a payment provider and that is executed as a credit transfer ("pay by bank") fall under the credit-transfer exception of чл. 3, ал. 1, so that no fiscal receipt is issued?

**L6.** (ЗДДС чл. 25, ал. 7; чл. 115, ал. 2; Н-18 чл. 31, ал. 1; CJEU C-277/05)
- BG: При неявяване (no-show) и задържане на депозита: облагаем ли е задържаният депозит, или е обезщетение извън обхвата на ЗДДС (C-277/05)? Ако е обезщетение, с какъв документ се коригира начисленият при получаването данък: сторно по чл. 31 („намаление на данъчната основа"), кредитно известие, или друг?
- EN: When a guest does not show up and the deposit is kept, is it taxable, or compensation outside VAT (C-277/05)? If compensation, which document corrects the VAT charged at receipt: a storno under чл. 31 ("reduction of the tax base"), a credit note, or something else?

**L7.** (ЗДДС чл. 25, ал. 7; Н-18 чл. 25, ал. 6)
- BG: Блокиране на сума по карта (hold), което после се усвоява или освобождава, „получаване на плащане" ли е? Правилно ли е фискалният бон да се издава едва при усвояването (capture), а при освобождаване да не се издава документ?
- EN: Is a card hold, later captured or released, a "receipt of payment"? Is it right to issue the fiscal receipt only at capture, and no document when a hold is released?

**L8.** (ЗДДС чл. 9, ал. 1; чл. 66, ал. 1; Н-18 чл. 25, ал. 1, т. 1)
- BG: Платената заявка за песен услуга на заведението ли е, със ставка 20%, включително когато диджеят е отделно лице по договор със заведението? При няколко плащащи за една заявка издава ли се отделен фискален бон за всяко плащане?
- EN: Is a paid song request a service of the venue at 20% VAT, including when the DJ is a separate business under contract with the venue? With several backers on one request, is a separate fiscal receipt due for each payment?

**L9.** (Н-18 чл. 7а, ал. 1 и 3; чл. 26, ал. 6; приложение № 39)
- BG: Екран в уеб приложението, който показва текущата сума по сметката на масата и бутон за плащане, „документ с информация за текуща сума по сметка" ли е по чл. 7а и чл. 26, ал. 6? Ако да, трябва ли да следва образеца по приложение № 39 с надпис „НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ"?
- EN: Is an app screen that shows the table's running bill and a Pay button a "document with information on the current amount of the bill" under чл. 7а and чл. 26, ал. 6? If yes, must it follow Annex 39 with the words "НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ"?

**L10.** (Н-18 чл. 31, ал. 1–4, 3а, 9)
- BG: Може ли сторно операция да се документира от ФУ (не ИАСУТД), когато сумата се връща по карта чрез доставчика на платежни услуги? В кой момент: при нареждане на връщането или при постъпването на сумата? Нужно ли е сторно, когато доставчикът отменя транзакцията преди сетълмент (reversal)?
- EN: May a ФУ (not an ИАСУТД) document a storno when the money goes back to the card through the payment provider? At which moment: when the refund is ordered, or when the money arrives? Is a storno needed when the provider cancels the transaction before settlement (a reversal)?

**L11.** (ЗДДС § 1, т. 84; чл. 118, ал. 14 и 18; Н-18 чл. 52з, ал. 3, 5, 10, 11; § 1, т. 19; приложение № 42)
- BG: (а) Restro, който приема поръчки от гости и ги предава към софтуера на заведението, „софтуер за управление на продажби" ли е по § 1, т. 84, и възникват ли за производителя му задължения, ако не е деклариран по чл. 118, ал. 14? (б) Ако заведението е избрало СУПТО по списъка, достатъчно ли е поръчките от Restro да се импортират по приложение № 42 преди потвърждаването им, или това е недопустим „външен модул" по чл. 52з, ал. 5? (в) Таксата на Restro, платена от заведението с карта, изисква ли фискален бон?
- EN: (a) Is Restro, which takes guest orders and passes them to the venue's software, "sales-management software" under § 1, т. 84, and does its producer have any duty if it is not declared under чл. 118, ал. 14? (b) If the venue chose listed software, is it enough that Restro's orders are imported under Annex 42 before they are confirmed, or is that a forbidden "external module" under чл. 52з, ал. 5? (c) Does Restro's fee, paid by the venue by card, need a fiscal receipt?

**L12.** (ЗДДС чл. 118, ал. 4, т. 10)
- BG: Обнародвано ли е или предстои ли изменение на Наредба Н-18 по чл. 118, ал. 4, т. 10 ЗДДС (комуникация между ФУ/ИАСУТД и информационни системи, в сила от 01.01.2026), което да засяга софтуер като Restro?
- EN: Has an amendment of Н-18 under ЗДДС чл. 118, ал. 4, т. 10 (communication between fiscal devices and information systems, in force 01.01.2026) been published or announced that would affect software like Restro?

---

## Sources

- Н-18, consolidated (lex.bg): https://lex.bg/bg/laws/ldoc/2135540645 — чл. 3, ал. 1, 1а, 17–19; чл. 7а; чл. 25; чл. 26, ал. 1, 6, 7; чл. 26а; чл. 29; чл. 31; чл. 52з; чл. 52м–52у; § 1, т. 19; приложения № 29, 38, 39, 42.
- State Gazette, ДВ бр. 42 от 23.5.2025 (latest Н-18 amendment): https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=235038
- ЗДДС, consolidated (lex.bg): https://lex.bg/bg/laws/ldoc/2135533201 — чл. 9, 25, 26, 66, 66а, 113, 115, 118; § 1, т. 41, 84–87, 96.
- ППЗДДС, consolidated (lex.bg): https://lex.bg/bg/laws/ldoc/2135534826 — чл. 79, ал. 8.
- ЗЗП, consolidated (lex.bg): https://lex.bg/laws/ldoc/2135513678 — чл. 45.
- CJEU C-277/05, Société thermale d'Eugénie-les-Bains, 18.07.2007: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62005CJ0277
- NRA, Документи за продажба: https://nra.bg/wps/wcm/connect/agency/site/fiskalni-ustroystva-supto-i-e-magazini/dokumenti-za-prodajba.storno.operacii/dokuenti.prodajba
- NRA, СУПТО: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/supto
- NRA, Алтернативен режим: https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/page.turgovia-v-internet-i-e-magazini/page.lternativen-rejim-za-registrirane-i-otchitane-na-prodajbite
- Not reachable: the NRA public list of sales software, `https://inetdec.nra.bg/pls/pub/home.html#/goto:dec2009.REGREPSOFT.home` (404 on 2026-10-17). The NRA pages answer automated downloads with a bot check; they were read in a browser, with no check to pass and no sign-in.
