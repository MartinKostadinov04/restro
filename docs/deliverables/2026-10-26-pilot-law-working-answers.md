# Pilot law, round 2: working answers for #52 (10-26)

Made by: research agent (Opus) for #52, 10-26. For: the Ordering lead and Martin.

> **Not legal advice.** This is research for Martin. It prepares the questions he takes to a lawyer or the venue's accountant, who interpret. Every **[READING]** is our interpretation, not a fact.

**What this file is.** The first round of #52 is `2026-10-21-pilot-law-working-answers.md` (the 10-21 file). It already answers Q63, tips, privacy and payment terms, with 29 questions. This round does not repeat it. It re-checks what has moved since, answers the points the 10-21 file left open (allergens, L3, Q74, the NRA list), and corrects two of its recommendations. Other files built on: `2026-10-21-receipt-and-payment-law.md` (the receipt file), `2026-10-17-fiscal-rules-in-app-payments.md` (L1–L12), `2026-10-20-location-check-law-deep-research.md` (the location file), `2026-10-18-nra-sales-software-list.md` (the list file), `2026-10-25-tips-research.md`, and D98, D110, D111, D119, D122, D125–D127.

**The pilot POS** is named here only generically, as the brief asks.

**Marks.** **[TEXT]** = the text says it. **[READING]** = our reading. **[LAWYER]** / **[ACCOUNTANT]** = needs their interpretation. **[UNKNOWN]** = not found.

**Read on 2026-10-26.** Unless noted, every source below was read on that date. The lex.bg texts were downloaded whole and searched. EUR-Lex opened in the browser this time, so the EU articles the 10-21 file could only cite are now read at the source.

## Summary

1. **The pilot POS is still not on the NRA list** (130 entries, the newest from 11.09.2026). So the venue can't break ЗДДС чл. 118, ал. 18 through Restro, and Q63 doesn't bite at the pilot. The 10-21 file's "written authorisation from the POS producer" gate has no legal basis for an unlisted POS.
2. **No electronic fiscal receipt at the pilot.** That route needs listed software (ЗДДС чл. 118, ал. 21, т. 2). The receipt is paper, handed over at payment, so L3 is moot for the pilot.
3. **Allergens must be in the menu.** Since 27.07.2025 the food-information ordinance has required allergen information for dishes eaten in a venue "in the menu", no longer "on request" (ПМС 97/2021, чл. 6, т. 3). The receipt file still said "on request". This should change D42 and the V4 check.
4. **Whether a QR menu is "distance communication"** (Art. 14(2)) now matters little. Either way the allergens must be in the menu. Working answer: it isn't, because staff are physically present.
5. **Card payments in the app need the fiscal receipt.** Н-18 чл. 3, ал. 1 exempts cash deposits, credit transfers and direct debits only, not cards (L1). A receipt printed at close, after the card hold and seconds before capture, fits "при извършване на плащането" (L7).
6. **Payment terms.** The Commission's guidance says a restaurant's identity and address are normally "apparent from the context". So the pay screen needs less than the 10-21 list. The guest pages are probably not an "e-commerce service" under the Accessibility Act: it covers only services "at a distance".
7. **Privacy.** Stripe's Connect terms call the platform a "data controller" instructing Stripe. The venue agreement must settle that Restro acts there on the venue's instructions. The EDPB wants the full sub-processor list "readily available" to the venue. The Digital Omnibus is not law.
8. **Tips: no change in the law since 23.10.2025.** The NRA letter tolerates a day-end tip receipt only when the guest has left. That makes D127's open accountant question narrow.
9. **Euro.** Dual price display ended on 08.08.2026, so euro only is right. Fines written in leva in older laws apply converted to euro.

## 1. Q63 and the NRA list (ЗДДС чл. 118, ал. 16)

**The re-check.** Same method as the 10-18 list file.
- [TEXT] The NRA's public register ("Публичен електронен списък на софтуерите за управление на продажби в търговските обекти по чл. 118, ал. 16 от ЗДДС") was searched with every field empty. It returned "Показване на резултати от 1 до 130 от общо 130".
- [TEXT] The newest entries are №1101 (included 11.09.2026) and №1100 (27.08.2026), as on 10-18.
- [TEXT] All 130 rows were checked for the product and producer names of the pilot POS and of the other POS named in the list file, in Latin and Cyrillic. No match.
- Source: https://portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home (no sign-in, no CAPTCHA, no personal data).

**What the law makes of that.**
- [TEXT] Choosing listed software is optional. A venue "може да избере" listed software; only a venue that chose it "е длъжно да ползва само този софтуер" (ЗДДС чл. 118, ал. 18).
- [TEXT] The fine falls on a venue that chose listed software and still manages sales with an unlisted module (чл. 185б, ал. 1). The amounts are BGN 5,000–10,000 for a company, applied in euro at 1.95583 since 01.01.2026 (ЗВЕРБ § 5, ал. 1).
- [TEXT] The producer's authorisation for outside modules sits in the rules for listed software (Н-18 чл. 52з, ал. 5).

**Working answer.** [READING] At a venue whose POS is not listed, and which filed no Annex 32 for other listed software at the site, Restro's writes can't expose the venue under чл. 185б. Q63 then has no consequence for the pilot. The 10-21 analysis (the "safe" and "risky" readings) stays right for any later venue on listed software.

**How sure:** high on the text and the register. Medium that the venue hasn't chosen other listed software at the site: only the venue can say (list file, open item 1).

**What it changes.**
- The 10-21 file proposed a pilot gate: the POS producer's written authorisation under Н-18 чл. 52з, ал. 5 (its §1, "May change D122 §8"). For the pilot, the legal basis falls away. Restro still needs the producer's agreement to use its API, but that is a commercial and technical matter, not a fiscal one.
- New pilot checks:
  1. the venue confirms in writing that it has filed no Annex 32 for the site;
  2. the register is searched again in the week before go-live, and whenever a venue changes POS.
- Q63 moves to "after the pilot", for the first venue on listed software.

**Left for the lawyer:** nothing for the pilot. 10-21 question 1 stays for later.

## 2. L3 and the rest of Q74: the receipt for an app payment

### L3: an anonymous session as the guest's "профил"

- [TEXT] A venue with a fiscal device may issue electronic receipts only if it "е избрало да използва в търговския обект софтуер, включен в списъка по чл. 118, ал. 16 от ЗДДС" and has the client data needed (Н-18 чл. 3, ал. 18, т. 1–2; ЗДДС чл. 118, ал. 21, т. 2).
- **For the pilot:** the POS isn't listed (§1), so no electronic receipt is possible at all. The receipt is paper, and the venue hands it over "едновременно с получаване на плащането" (Н-18 чл. 25, ал. 6). L3 doesn't arise.
- **For later venues on listed software:**
  - [TEXT] Delivery is "чрез изпращане на електронния му адрес или чрез съхраняване и визуализация в негов профил в интернет сайт или мобилно приложение" (Н-18 чл. 52з, ал. 17). Listed software must be able to send the receipt "към негов профил" (Прил. 29, т. 24.1).
  - [TEXT] For ИАСУТД and ЕСФП only, the ordinance adds "или по друг начин чрез изпращане по електронен път", and the venue must store how and when it delivered (чл. 25, ал. 13; чл. 3, ал. 19, т. 2). A venue with a fiscal device has no such wider route.
  - [READING] "His profile" reads as an account that belongs to the guest and persists, not a one-off page. Where the legislator wanted a looser channel, it said "по друг начин", and it didn't say so for fiscal devices. An anonymous session is therefore probably not a "профил".
- **How sure:** high that L3 is moot at the pilot. Medium on the later reading.
- **What it changes:**
  - Pilot: paper receipt at the table, as D122 §8 already plans (the waiter brings it).
  - The pay screen's line on the receipt (10-21 file §4, item 5) drops "or by email where offered".
  - No email field at the pilot. That also fits D125 3.7: Restro passes no email to Stripe.
- **Left for the lawyer:** after the pilot only (10-21 question 4).

### L1: is a card payment through a payment provider exempt from the receipt?

- [TEXT] The exemption covers payment "чрез внасяне на пари в наличност по платежна сметка, кредитен превод, директен дебит или наличен паричен превод, извършен чрез доставчик на платежна услуга" (Н-18 чл. 3, ал. 1; repeated in чл. 25, ал. 1, т. 1).
- [READING] A card payment, Apple Pay and Google Pay included, is a card transaction, not a credit transfer or a direct debit. It isn't exempt, and the venue's fiscal device issues the receipt. This matches D125 ("the venue's fiscal device issues the receipt").
- **How sure:** high.
- **Changes:** nothing. It confirms D125.
- **Lawyer:** 10-21 question 9 can be dropped from the pilot list.

### L7: when the receipt is due when the card is held, then captured

- [TEXT] The receipt "се издава при извършване на плащането", and the venue hands it over "едновременно с получаване на плащането" (Н-18 чл. 25, ал. 6).
- [READING] At a card terminal, too, the receipt prints when the bank approves the payment (an authorisation), and the money settles days later. D122 §8 and D127 run approve-and-hold, then close (the receipt prints), then capture within seconds. In substance that is the same moment. A hold released before any close prints nothing (D127 3.10: never release once a close has been attempted). The only gap is a capture refused after the close: a storno corrects it, which D127 3.14 already alerts on.
- **How sure:** medium-high.
- **Changes:** nothing in D122 or D127.
- **Lawyer:** kept as a short confirming question (lawyer question 6 below), because it decides whether every refused capture needs a storno.

### L12: an Н-18 amendment affecting Restro

- [TEXT] The consolidated Н-18 on lex.bg still ends at ДВ бр. 42 от 2025 г. No later amendment is published.
- **Changes:** 10-21 question 11 is answered "none published" as of 10-26. Re-check before go-live.

### The rest of Q74

L2 is settled by D125, L9 and L10 stay on the 10-21 list, and L11 is §1 above. Nothing else is open for the pilot.

## 3. Tips (Q10)

**No change in the law.**
- [UNKNOWN] No 2026 amendment on tips was found in ЗДДФЛ, ЗДДС or Н-18. A search of news and the public-consultation portal (strategy.bg) turned up none either.
- The NRA letter ВК-30-14766/23.10.2025, as the 10-21 file read it, stays the rule. Re-read on 10-26 from the copy at https://accountingnews.bg/userfiles/ВК-30-14766+от+23_10_2025+г.pdf. It is still marked "Ограничено ползване – TLP-AMBER" and was not found on nra.bg.

**The day-end tip receipt (D127, open for the accountant).**
- [TEXT] The letter, p. 9:
  - A tip paid after the sale's receipt needs a second receipt with the tip, in group А.
  - A receipt summing several tips is no breach only where the guest has left: a tip left in cash on the table, or a terminal tip where the guest left after the authorisation.
- [READING] An in-app tip is chosen before the hold and is part of it (D125 3.10). The guest is still at the table when the bill closes. That isn't the letter's "guest has left" case, so a day-end summary receipt for in-app tips is weak ground.
- [READING] The letter also allows a separate receipt for the tip alone, issued at the same time (p. 9, as the 10-21 file read it). That is the fallback if the POS can't add a tip line to the same receipt.
- **How sure:** medium. The letter is NRA practice, not a court ruling.

**What it changes.** D127 holds as written: no tip where the POS can't put it on the receipt. The accountant's question narrows to the one in the accountant list below, so Martin can ask it before giving up the tip at a POS that can't print a tip line.

## 4. Privacy (Q67, T31)

The 10-21 file's roles, DPIA advice, DPA contents and notice items stand. Four additions:

**4.1 Stripe calls the platform a "data controller".**
- [TEXT] Stripe's Connected Account Agreement (last modified 18.11.2025), §1: a Connect platform may "act as a data controller to instruct Stripe to process User Data", under the platform agreement it has with the venue. §4.1(a): the venue instructs Stripe to share its data, including its customers' personal data, with its platforms. https://stripe.com/legal/connect-account
- [TEXT] Stripe's DPA (28.09.2026), §2: Stripe is sole controller for its own purposes (banks and payment methods, fraud, loss and security, internal operations, AML/KYC, product development). §4.3: the venue "must provide all necessary notices (including by making available a Privacy Policy)" to its customers. https://stripe.com/legal/dpa
- [READING] Under the GDPR the facts decide, not a contract's label (EDPB Guidelines 07/2020, cited in the 10-21 file). Restro uses its key on the venue's account only for the venue's payments (D125, D127). That is processing on the venue's behalf, if the venue agreement says so.
- [LAWYER] whether Stripe's wording makes Restro a controller toward Stripe in spite of an Art. 28 venue agreement.
- **Changes T31's venue agreement:**
  - Restro uses the Stripe connection only on the venue's documented instructions and for the purposes in D125 and D127.
  - Restro doesn't use the data it reads from Stripe for its own purposes.
  - The venue's privacy notice links Stripe's own policy.

**4.2 The sub-processor list must be readily available.**
- [TEXT] EDPB Opinion 22/2024 (adopted 09.10.2024), executive summary and para. 31: controllers "should have the information on the identity (i.e. name, address, contact person) of all processors, sub-processors etc. readily available at all times", "regardless of the risk". The processor "should proactively provide" it and keep it current. Verifying sub-processors' guarantees applies at every risk level, scaled to the risk (para. 47). https://www.edpb.europa.eu/system/files/2024-10/edpb_opinion_202422_relianceonprocessors-sub-processors_en.pdf
- **Changes T31's venue agreement:** an annexed, dated list of Restro's sub-processors (name, address, contact, what each does, where data goes). Include Cloudflare, hosting, error tracking and Telegram, and any sub-processor of theirs that sees guest data. Add a notice to the venue before any change, and the venue's right to object.

**4.3 What the pilot needs less of.** No electronic receipt, so no guest email (§2), and no card digits or device identifiers on Restro's records (D127 4.2). The notice and the DPIA get shorter: no "receipt email" purpose. The 10-21 file's retention line on the receipt email (§3) falls away at the pilot.

**4.4 The Digital Omnibus is not law.** [UNKNOWN] Secondary summaries found on 10-26 (not the EU's own record) say the GDPR changes, including EU-wide DPIA lists and the Art. 30 easing, are still in negotiation (procedure 2025/0360(COD)). The KZLD list and Arts. 30 and 35 apply as they stand.

**DPIA: unchanged.** The 10-21 advice stands: one short DPIA covering the location check and payments, with the "not high risk" finding for the lawyer.

**T31's date.** Still not done. #52 is resolved only when T31 is done or dated before the pilot. Recommendation: one ticket now for the four drafts (venue agreement with the Art. 26 annex and the sub-processor list, the guest notice, the DPIA, Restro's Art. 30 records), due before the first live payment. The lead sets the date.

## 5. The guest's payment terms

The 10-21 working answer stands: not a distance contract, so ЗЗП чл. 4 applies, and there is no right of withdrawal. Now checked at the EU source, with two refinements.

**The definition, read at the source.**
- [TEXT] A distance contract needs "the simultaneous physical presence of the trader and the consumer" to be absent, and "the exclusive use of one or more means of distance communication up to and including the time at which the contract is concluded" (CRD Art. 2(7)). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011L0083-20220528
- [TEXT] Recital 20: "a contract which is negotiated at the business premises of the trader and finally concluded by means of distance communication should not be considered a distance contract." https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011L0083
- **How sure:** high that ordering and paying at the table is not a distance contract.

**Refinement 1: what is "apparent from the context".**
- [TEXT] CRD Art. 5(1) (ЗЗП чл. 4, ал. 1) requires the information "if that information is not already apparent from the context".
- [TEXT] The Commission's guidance (2021/C 525/01, §3.1): "trader's geographical address and identity could be considered as 'obvious or apparent from the context', as the consumers would normally know the address of a shop or restaurant that they are in." https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52021XC1229(04)
- [READING] What the pay screen itself must carry:
  1. the lines and the total with VAT, in euro;
  2. the tip as an optional amount, starting at zero (ЗЗП чл. 62д; D127);
  3. how to complain or get a refund: the venue;
  4. an unambiguous pay button.
- [READING] The venue's legal name, ЕИК and address are not needed on the screen: the guest is in the venue. They still belong in the terms and privacy notice behind a link, and they print on the fiscal receipt anyway.
- [READING] Bulgarian stays mandatory (ЗЗП чл. 5, ал. 1).
- **Changes:** trims the 10-21 file's pay-screen list (its §4, items 1 and 5). Venue settings still need the legal name, ЕИК and address, for the notice and the terms.
- [LAWYER] whether a club trading under a brand that differs from its company name must show the legal entity before payment.

**Refinement 2: the Accessibility Act probably doesn't apply.**
- [TEXT] The Act covers "e-commerce services" provided to consumers after 28.06.2025: "services provided at a distance, through websites and mobile device-based services by electronic means and at the individual request of a consumer with a view to concluding a consumer contract" (Dir. 2019/882, Art. 2(2)(f), Art. 3(30)). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0882
- [TEXT] Bulgaria transposed it in the Закон за изискванията за достъпност на продукти и услуги (ЗИДПУ, ДВ бр. 31/2025, in force 28.06.2025):
  - the definition is "услуги, предоставяни от разстояние …" (§ 1, т. 40);
  - "Микропредприятията, които предлагат услуги, се освобождават" (чл. 46, ал. 3);
  - КЗП supervises e-commerce services (чл. 54).

  Read in a Ciela copy dated 12.05.2025, hosted by ДАМТН: https://www.damtn.government.bg/wp-content/uploads/zakoni/zakon_za_iziskvaniyata_za_dostapnost_na_produkti_i_uslugi.pdf. [UNKNOWN] later amendments.
- [READING] A guest ordering inside the venue isn't served "at a distance", for the same reason as above. A micro-enterprise (under 10 staff and at most €2m turnover or balance sheet) would be exempt anyway.
- **How sure:** medium. The Act's "at a distance" hasn't been tested on in-venue ordering.
- **Changes:** no legal gate. Recommendation: build the guest pages to WCAG 2.1 AA, the level of the EU accessibility standard EN 301 549, as good practice. It costs little now, and it covers a later venue where "at a distance" is argued.

**P2B, DSA, PSD2:** nothing new. 10-21 questions 14–16 stay, after the pilot.

## 6. Allergens

**The 2025 change, read at the source.**
- [TEXT] The ordinance ("Наредба за предоставянето на информация на потребителите за храните", ПМС 97/2021) now reads to ДВ бр. 62 от 2026 г. https://lex.bg/laws/ldoc/2137211121
- [TEXT] чл. 5, ал. 1: for food sold to the final consumer without prepacking, the venue gives the allergens (Reg. 1169/2011 Art. 9(1)(c)). It also gives the particulars of 9(1)(a), (f) and (h): name, date, operator.
- [TEXT] чл. 6: this information is given in Bulgarian. Point 3, as amended by ДВ бр. 35 от 2025 г., in force 27.07.2025, says how: "чрез посочване в менюто за предлаганите ястия - за храни, които се консумират в заведения за обществено хранене".
- [TEXT] The 2026 amendment (ДВ 62/2026) touches only чл. 4, ал. 8 (batch marking).
- **This corrects the receipt file §4,** which read the earlier text: "при поискване на клиента". The 10-21 file had flagged the 2025 amendment as unread.

**Drinks.**
- [TEXT] Art. 44(1)(a) makes allergen information mandatory for all non-prepacked food. "Food" includes drinks under Reg. 178/2002, which Reg. 1169/2011 Art. 2(1)(a) adopts.
- [TEXT] Annex II covers, among others:
  - cereals containing gluten, barley included, except those "used for making alcoholic distillates";
  - milk;
  - eggs;
  - nuts, except in distillates;
  - sulphites above 10 mg/litre.

  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011R1169-20180101
- [READING] In a club, draft beer (gluten), wine by the glass (sulphites) and cocktails with cream, egg white or nut liqueur carry allergens. Pure spirits mostly don't. Bottled drinks served sealed are prepacked, and their label covers them.
- [READING] The "in the menu" rule names "ястия" (dishes). Whether drinks must also be marked in the menu, or may still be told on request, is unclear. [LAWYER]

**Is the phone menu "the menu"?**
- [READING] Where the phone menu is how guests order, it is the menu they read before choosing. If the venue keeps no paper menu, it is the only menu. Either way, showing allergens there is the safe reading.
- [LAWYER] whether a venue with a compliant paper menu may leave allergens off its phone menu.

**Art. 14(2): is a QR menu "distance communication"?**
- [TEXT] "‘means of distance communication’ means any means which, without the simultaneous physical presence of the supplier and the consumer, may be used for the conclusion of a contract between those parties" (Art. 2(2)(u)). Art. 14(2) applies the distance rules to non-prepacked food "offered for sale by means of distance communication".
- [READING] Staff are present and the food is served at the table, so it isn't distance communication. The same answer runs through the CRD (§5).
- [READING] The question now weighs little. Under чл. 6, т. 3 the dishes' allergens must be in the menu anyway. It matters only for drinks, if the lawyer reads "ястия" narrowly.
- **How sure:** medium-high.

**Who answers for the data.** [READING] The venue, as the food business operator under whose name the food is sold (Art. 8(1)). Restro shows what the venue enters and must not change it, which D42 and the source layers already ensure.

**What it changes. Recommendation for D42 and the V4 check** (Martin decides):
- D42 keeps V4 ("every food Item has allergens set") as a warning "until the legal answer (Q42)". The text now answers it for dishes.
- Recommendation: before publish, the composer blocks a food item with no allergen set, where an explicit empty set ("no allergens") is allowed. Drinks get the same check, as a warning until the lawyer answers.
- At the pilot, every menu item carries allergens or an explicit "none" before the first guest. Allergens show on the item in the phone menu, in Bulgarian.
- The POS rarely holds allergens (Q42 asked whether the pilot's does), so the venue enters them in Restro as enrichment.
- Q42 in `docs/open-items.md` gets this answer. Its remaining part is the drinks and paper-menu questions.

## 7. Euro: prices and fines

- [TEXT] Dual display "започва на 8 август 2025 г. и приключва на 8 август 2026 г." (ЗВЕРБ чл. 15, ал. 2, as amended by ДВ 65/2025). https://lex.bg/laws/ldoc/2137244903
- [TEXT] The rule printing totals in both currencies on the fiscal receipt applies only "в периода на двойно обозначаване" (чл. 20, ал. 1).
- [TEXT] Payments are recorded in euro and cents (чл. 20, ал. 2).
- [TEXT] Laws that set fines in leva keep applying, converted (§ 5, ал. 1).
- **Changes:** none. D122's "prices show in € everywhere" is right. Leva amounts in older research files are converted at 1.95583.

## Recommendations for decisions

Proposals only. Nothing here is edited into `docs/decisions/`.

1. **D42 and the V4 check (allergens):** the composer blocks publishing a food item with no allergen set, where an explicit "none" counts as set. Drinks get the same check as a warning until the lawyer answers. At the pilot, every item has allergens or "none", shown in the phone menu (§6).
2. **D122 §8, pilot gates:**
   - drop "the POS producer's written authorisation under Н-18 чл. 52з, ал. 5" as a legal gate while the POS is unlisted;
   - add the venue's written confirmation that it has filed no Annex 32 at the site;
   - re-run the NRA register search the week before go-live and at any change of POS (§1).
3. **D122 §8, the receipt at the pilot:** paper, handed over at the table at payment. No email field (§2).
4. **D122 §8, the pay screen:**
   - **must carry:** the lines and total in euro with VAT, the tip at zero with presets allowed, who handles complaints and refunds (the venue), and a "Плати X €" button;
   - **behind links:** the venue's legal name, ЕИК and address, and the privacy notice;
   - **optional:** "Payment processed by [provider] for [venue]";
   - all in Bulgarian (§5).
5. **T31, the venue agreement:**
   - the Stripe clause (§4.1);
   - the sub-processor annex with change notice and objection (§4.2);
   - the venue's privacy notice links Stripe's policy;
   - one ticket, dated before the first live payment (§4).
6. **The guest pages:** build to WCAG 2.1 AA as good practice, not as a legal gate (§5).

## Questions for the lawyer

These replace the pilot part of the 10-21 file's list (its questions 1–22). The rest of that list moves to "after the pilot", as marked below. Each question is the interpretation only and can be forwarded as written.

**For the pilot**

1. **Allergens on drinks** (ПМС 97/2021 чл. 6, т. 3; Рег. 1169/2011 чл. 44)
   - BG: Изискването алергените да се посочват „в менюто за предлаганите ястия" обхваща ли и напитките, приготвени в заведението (коктейли, наливна бира, вино на чаша), или за тях информацията може да се дава при поискване?
   - EN: Does the requirement to show allergens "in the menu for the dishes offered" cover drinks prepared in the venue (cocktails, draft beer, wine by the glass), or may that information be given on request?
2. **The phone menu as "the menu"** (ПМС 97/2021 чл. 6, т. 3)
   - BG: Когато гостите поръчват от меню на телефона (QR код на масата), а заведението има и хартиено меню с алергени, трябва ли алергените да са посочени и в менюто на телефона?
   - EN: When guests order from a phone menu (a QR code on the table) and the venue also has a paper menu with allergens, must the phone menu show the allergens too?
3. **The legal entity before payment** (ЗЗП чл. 4, ал. 1, т. 2; Насоки на ЕК 2021/C 525/01, т. 3.1)
   - BG: Заведение работи с търговско име, различно от фирмата на дружеството. Трябва ли фирмата, ЕИК и адресът да се покажат на екрана за плащане в приложението, или е достатъчно те да са в общите условия и в издадения фискален бон, тъй като гостът е в заведението?
   - EN: A club trades under a brand that differs from its company name. Must the company name, ЕИК and address appear on the app's payment screen, or is it enough that they are in the terms and on the fiscal receipt, given that the guest is inside the venue?
4. **Restro's role toward Stripe** (GDPR чл. 4(7), 28; Stripe Connected Account Agreement §1)
   - BG: Условията на Stripe определят платформата като „администратор", който дава указания на Stripe. Ако договорът между заведението и Restro по чл. 28 предвижда, че Restro използва връзката със Stripe само по указания на заведението и за неговите плащания, обработващ ли е Restro, или става администратор?
   - EN: Stripe's terms call the platform a "controller" that instructs Stripe. If the venue–Restro Art. 28 agreement says Restro uses the Stripe connection only on the venue's instructions and for its payments, is Restro a processor or a controller?
5. **The tips letter** (НАП ВК-30-14766/23.10.2025; 10-21 question 12)
   - BG: Може ли заведението да разчита на становището на НАП от 23.10.2025 (ограничено ползване, не е публикувано на nra.bg) за бакшиш, платен с карта в приложението заедно със сметката: в същия фискален бон, група „А", департамент „БАКШИШ"?
   - EN: May the venue rely on the NRA's opinion of 23.10.2025 (restricted, not published on nra.bg) for a tip paid by card in the app with the bill: on the same fiscal receipt, group А, department "БАКШИШ"?
6. **Receipt at close, before capture** (Н-18 чл. 25, ал. 6; L7)
   - BG: Плащането с карта се одобрява и блокира, след това сметката се приключва и ФУ издава бона, а сумата се усвоява (capture) секунди по-късно. Издаден ли е бонът „при извършване на плащането"? Ако усвояването след това бъде отказано, сторно ли е правилната корекция?
   - EN: The card is approved and held, then the bill is closed and the device prints the receipt, and the money is captured seconds later. Is the receipt issued "when the payment is made"? If the capture is then refused, is a storno the right correction?
7. **Privacy**, carried over unchanged from the 10-21 file: questions 17 (the dispute evidence and Log: processor or controller), 18 and 19 (location Q4 and Q5), 20–22 (location Q1–Q3).

**After the pilot** (from the 10-21 list):
- Q63 for listed software (1);
- L3 and the electronic receipt (4, 5);
- uncollected paper with a PDF (6);
- the bill screen as a document (7);
- storno to card (8);
- Restro's records under Н-18 чл. 52к (10);
- distance contract and ЗЕТ (13, 14);
- P2B/DSA (15);
- PSD2 Art. 3(j) (16);
- deposits and song requests (23–26).

**Dropped:** 2 (L2: settled by D125), 9 (L1: §2), 11 (L12: none published as of 10-26).

## Questions for the accountant

1. **The day-end tip receipt** (D127, open; NRA letter p. 9)
   - BG: Бакшишът се избира от госта в приложението преди плащането и се плаща с картата заедно със сметката, докато гостът е на масата. Ако POS не може да добави ред „бакшиш" в същия бон, приемливо ли е един обобщен бон за бакшишите в края на деня, или трябва отделен бон за всеки бакшиш в момента на плащането?
   - EN: The guest picks the tip in the app before paying, and pays it by card with the bill while still at the table. If the POS can't add a tip line to the same receipt, is one summary receipt for the day's tips acceptable, or must each tip get its own receipt at the moment of payment?
2. **Tips through payroll and the provider's fee** (10-21 question 28)
   - BG: Как да се отчетат бакшишите от приложението във ведомостта и как да се осчетоводи таксата на Stripe върху частта бакшиш?
   - EN: How should in-app tips go through payroll, and how is Stripe's fee on the tip part booked?
3. **"Card online" and payouts** (10-21 question 27)
   - BG: Може ли в POS да има отделен вид плащане „Карта онлайн", отчитан във ФУ като карта, и как да се равнява с изплащанията от Stripe (3 работни дни, нетно от такси)?
   - EN: May the POS hold a separate payment type "Card online", counted as card on the fiscal device, and how is it reconciled with Stripe's payouts (3 business days, net of fees)?
4. **Restro's fee** (10-21 question 29)
   - BG: Трябва ли фискален бон за абонамента на Restro, платен от заведението с карта, или е достатъчна фактура?
   - EN: Does Restro's subscription, paid by the venue by card, need a fiscal receipt, or is an invoice enough?

## Questions for the venue (not legal; Martin asks)

1. Has the venue filed Annex 32 (Н-18 чл. 52з, ал. 1) for any listed sales software at the club? If yes, which software and version? (§1)
2. Does the venue keep a paper menu with allergens, and who will enter allergens for every item, drinks included? (§6)

## Sources

All read on 2026-10-26, except where marked.

- NRA register of sales software (ЗДДС чл. 118, ал. 16): https://portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home
- ЗДДС, to ДВ 69/2026 (чл. 118, ал. 14–22; чл. 185а, 185б): https://lex.bg/laws/ldoc/2135533201
- Н-18, to ДВ 42/2025 (чл. 3, ал. 1, 18, 19; чл. 25, ал. 1, 6, 13; чл. 52з, ал. 17; Прил. 29, т. 20–24): https://lex.bg/bg/laws/ldoc/2135540645
- ЗВЕРБ, the euro law, to ДВ 92/2026 (чл. 15, 16, 20; § 5): https://lex.bg/laws/ldoc/2137244903
- Food-information ordinance, ПМС 97/2021, to ДВ 62/2026 (чл. 5, 6): https://lex.bg/laws/ldoc/2137211121
- ЗЗП (latest change seen: ДВ 87/2026) and ЗЕТ (latest change seen: ДВ 55/2026). Only their amendment lists were checked; the articles cited are as the 10-21 file read them. https://lex.bg/laws/ldoc/2135513678, https://lex.bg/laws/ldoc/2135530547
- Reg. (EU) 1169/2011, consolidated 01.01.2018 (Art. 2(2)(d), (u); Art. 14; Art. 44; Annex II): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011R1169-20180101
- Dir. 2011/83/EU, consolidated 28.05.2022 (Art. 2(7), Art. 5) and the original OJ text (recital 20): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011L0083-20220528, https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011L0083
- Commission guidance on Dir. 2011/83/EU, 2021/C 525/01 (§1.7.6, §3.1): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52021XC1229(04)
- Dir. (EU) 2019/882, the Accessibility Act (Art. 2(2)(f), Art. 3(23), (30), Art. 4(5)): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0882
- ЗИДПУ, ДВ 31/2025, in a Ciela copy dated 12.05.2025 (чл. 2, 46, 54; § 1, т. 40): https://www.damtn.government.bg/wp-content/uploads/zakoni/zakon_za_iziskvaniyata_za_dostapnost_na_produkti_i_uslugi.pdf
- NRA letter ВК-30-14766/23.10.2025 on tips (TLP-AMBER), as republished: https://accountingnews.bg/userfiles/ВК-30-14766+от+23_10_2025+г.pdf
- EDPB Opinion 22/2024 on processors and sub-processors (adopted 09.10.2024): https://www.edpb.europa.eu/system/files/2024-10/edpb_opinion_202422_relianceonprocessors-sub-processors_en.pdf
- Stripe Connected Account Agreement, last modified 18.11.2025 [vendor]: https://stripe.com/legal/connect-account
- Stripe DPA, updated 28.09.2026 [vendor]: https://stripe.com/legal/dpa
- Digital Omnibus, procedure 2025/0360(COD): not read at the source; status from secondary summaries only, for example https://eudigitalpolicy.eu/instruments/data-omnibus/ (search result, 10-26).
